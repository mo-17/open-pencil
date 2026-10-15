import type { Page } from '@playwright/test'

import { createEffectPickModuleFrameOverrides } from '@open-pencil/core/plugins'
import type * as EffectPickPlugin from '@open-pencil/core/plugins'
import type { FontManager } from '@open-pencil/core/text'
import type * as SceneGraphModule from '@open-pencil/scene-graph'

import type * as EffectPickPreview from '@/app/effect-pick/preview'

import { CanvasHelper } from '#tests/helpers/canvas'
import { mockFontsource } from '#tests/helpers/fonts/fontsource'
import { trackFontModuleResources } from '#tests/helpers/fonts/runtime'

/** User workflow driver plus a narrow document probe for the EffectPick integration. */
export class EffectPickDriver {
  readonly canvas: CanvasHelper
  constructor(readonly page: Page) {
    this.canvas = new CanvasHelper(page)
  }

  async open() {
    await this.page.goto('/?test')
    await this.canvas.waitForInit()
    // Exercise the existing download fallback; native file pickers require a human in headless Chromium.
    await this.page.evaluate(() => {
      window.showSaveFilePicker = undefined
    })
  }

  async assets() {
    await this.page.getByTestId('left-panel-assets-tab').click()
    const panel = this.page.getByTestId('assets-panel')
    await panel.getByRole('searchbox').fill('EffectPick')
    return panel
  }

  async insert(effectId: string) {
    const panel = await this.assets()
    await panel
      .locator(`[data-effect-id="${effectId}"]`)
      .getByRole('button', { name: 'Add to canvas' })
      .click()
    await this.canvas.waitForRender()
  }

  playground() {
    return this.page.getByRole('region', { name: 'Effect playground' })
  }

  frame() {
    return this.page.frameLocator('iframe[aria-label="Effect playground"]')
  }

  async selectedConfig() {
    return this.page.evaluate(async () => {
      const moduleURL = new URL('/packages/scene-graph/src/module.ts', window.location.origin).href
      const { readModuleInstance }: typeof SceneGraphModule = await import(
        /* @vite-ignore */ moduleURL
      )

      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

      const store = window.openPencil.getStore()
      const id = [...store.state.selectedIds][0]
      const module = id
        ? readModuleInstance(store.graph.getNode(id)?.interactiveProps?.module)
        : null
      return module?.pluginId === 'open-pencil.effect-pick' ? module.config : null
    })
  }

  async effectCount() {
    return this.page.evaluate(async () => {
      const moduleURL = new URL('/packages/scene-graph/src/module.ts', window.location.origin).href
      const { readModuleInstance }: typeof SceneGraphModule = await import(
        /* @vite-ignore */ moduleURL
      )

      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

      const store = window.openPencil.getStore()
      return store.graph
        .getChildren(store.state.currentPageId)
        .filter(
          (node) =>
            readModuleInstance(node.interactiveProps?.module)?.pluginId ===
            'open-pencil.effect-pick'
        ).length
    })
  }

  async resizeSelected(width: number, height: number) {
    await this.page.evaluate(
      ({ width, height }) => {
        if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

        const store = window.openPencil.getStore()
        const id = [...store.state.selectedIds][0]
        if (!id) throw new Error('EffectPick resize target is missing')
        store.graph.updateNode(id, { width, height })
        store.requestRender()
      },
      { width, height }
    )
    await this.canvas.waitForRender()
  }

  async selectedSize() {
    return this.page.evaluate(() => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

      const store = window.openPencil.getStore()
      const id = [...store.state.selectedIds][0]
      const node = id ? store.graph.getNode(id) : null
      return node
        ? { width: node.width, height: node.height, childCount: node.childIds.length }
        : null
    })
  }

  async playgroundLayout() {
    return this.frame()
      .locator('[data-effect-pick-surface]')
      .evaluate((surface) => {
        const button = surface.querySelector('button')
        const label = button?.querySelector('.fx-label')
        if (!(button instanceof HTMLElement) || !(label instanceof HTMLElement))
          throw new Error('EffectPick button layout is missing')
        const bounds = button.getBoundingClientRect()
        const range = document.createRange()
        range.selectNodeContents(label)
        return {
          width: window.innerWidth,
          height: window.innerHeight,
          text: label.textContent,
          lineCount: range.getClientRects().length,
          horizontalOverflow: label.scrollWidth > label.clientWidth + 1,
          scrollable: label.scrollHeight > label.clientHeight + 1,
          bounded:
            bounds.left >= 0 &&
            bounds.top >= 0 &&
            bounds.right <= window.innerWidth &&
            bounds.bottom <= window.innerHeight,
          paused: surface.hasAttribute('data-effect-pick-paused')
        }
      })
  }

  async openCanvasFixture(renderer: 'retained' | 'tiled') {
    await trackFontModuleResources(this.page)
    await mockFontsource(this.page, [])
    await this.page.goto(`/?test&renderer=${renderer}&navigation-benchmark`)
    await this.canvas.waitForInit()
    const examples = [
      { effectId: 'diagonal-fill', text: '开始创作', x: 16, y: 16, width: 320, height: 120 },
      { effectId: 'diagonal-fill', text: '开始创作', x: 352, y: 16, width: 224, height: 101 },
      {
        effectId: 'diagonal-fill',
        text: '更长的文案 Continue creating',
        x: 16,
        y: 156,
        width: 160,
        height: 101
      },
      {
        effectId: 'animated-gradient',
        text: '色彩流动 Colors',
        x: 200,
        y: 156,
        width: 224,
        height: 120
      },
      { effectId: 'orbit-eclipse', text: 'Orbit', x: 448, y: 156, width: 240, height: 120 },
      { effectId: 'neon-sign', text: '静态预览 Neon', x: 16, y: 292, width: 672, height: 112 }
    ].map(({ effectId, text, ...bounds }) => ({
      ...createEffectPickModuleFrameOverrides({ effectId, text }),
      ...bounds
    }))
    const ids = await this.page.evaluate(async (examples) => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

      const store = window.openPencil.getStore()
      const moduleURL = performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((url) => url.includes('/packages/core/src/text/fonts.ts'))
      if (!moduleURL) throw new Error('Font manager module not observed')
      const { fontManager } = (await import(/* @vite-ignore */ moduleURL)) as {
        fontManager: FontManager
      }
      const response = await fetch('/tests/fixtures/fonts/NotoSansSC-Regular.ttf')
      if (!response.ok) throw new Error('Local CJK fixture unavailable')
      fontManager.markLoaded('Noto Sans SC', 'Regular', await response.arrayBuffer())
      fontManager.setCJKFallbackFamily('Noto Sans SC')
      const root = store.graph.createNode('FRAME', store.state.currentPageId, {
        name: 'EffectPick static previews',
        width: 704,
        height: 420,
        clipsContent: true,
        fills: [
          { type: 'SOLID', color: { r: 0.97, g: 0.97, b: 0.98, a: 1 }, visible: true, opacity: 1 }
        ]
      })
      const modules = examples.map(
        (example) =>
          store.graph.createNode('FRAME', root.id, { ...example, textLanguage: 'zh-CN' }).id
      )
      await store.loadFontsForNodes([root.id])
      store.zoomToBounds(-24, -24, 728, 444)
      store.requestRender()
      return { root: root.id, modules }
    }, examples)
    await this.page.evaluate(() => {
      if (!window.openPencil) throw new Error('Editor test API is unavailable')
      return window.openPencil.test?.navigation?.waitForSettlement()
    })
    return ids
  }

  async canvasImage(rootId: string) {
    return this.page.evaluate(async (rootId) => {
      const moduleURL = new URL('/packages/scene-graph/src/module.ts', window.location.origin).href
      const { readModuleInstance }: typeof SceneGraphModule = await import(
        /* @vite-ignore */ moduleURL
      )

      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

      const store = window.openPencil.getStore()
      const root = store.graph.getNode(rootId)
      if (!root) throw new Error('EffectPick visual root disappeared')
      const before = store.graph.getChildren(root.id).map((node) => ({
        id: node.id,
        childIds: [...node.childIds],
        module: structuredClone(readModuleInstance(node.interactiveProps?.module))
      }))
      const png = await store.renderExportImage([rootId], 1, 'PNG')
      if (!png) throw new Error('EffectPick PNG export unavailable')
      const after = store.graph.getChildren(root.id).map((node) => ({
        id: node.id,
        childIds: [...node.childIds],
        module: structuredClone(readModuleInstance(node.interactiveProps?.module))
      }))
      return { image: Array.from(png), before, after }
    }, rootId)
  }

  async updateCanvasFixture(ids: { root: string; modules: string[] }) {
    const updated = createEffectPickModuleFrameOverrides({
      effectId: 'diagonal-fill',
      text: '已更新 Updated',
      color: '#22d3ee'
    })
    await this.page.evaluate(
      async ({ ids, updated }) => {
        if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

        const store = window.openPencil.getStore()
        const id = ids.modules[1]
        if (!id) throw new Error('EffectPick update target is missing')
        store.graph.updateNode(id, {
          interactiveProps: updated.interactiveProps,
          rotation: 6,
          opacity: 0.8
        })
        await store.loadFontsForNodes([ids.root])
        store.requestRender()
        await window.openPencil.test?.navigation?.waitForSettlement()
      },
      { ids, updated }
    )
  }

  async focusCanvasToolbar() {
    await this.page.getByTestId('toolbar').getByRole('button').first().focus()
  }

  async reopen(bytes: number[]) {
    await this.page.evaluate(async (data) => {
      const moduleURL = new URL('/packages/scene-graph/src/module.ts', window.location.origin).href
      const { readModuleInstance }: typeof SceneGraphModule = await import(
        /* @vite-ignore */ moduleURL
      )

      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

      const store = window.openPencil.getStore()
      await store.openFigFile(new File([new Uint8Array(data)], 'effectpick.fig'))
      const node = store.graph
        .getChildren(store.state.currentPageId)
        .find(
          (candidate) =>
            readModuleInstance(candidate.interactiveProps?.module)?.pluginId ===
            'open-pencil.effect-pick'
        )
      if (!node) throw new Error('Saved EffectPick module was not reopened')
      store.select([node.id])
      store.requestRender()
    }, bytes)
    await this.canvas.waitForRender()
  }

  async rapidPreviewReplacement() {
    return this.page.evaluateHandle(async () => {
      const { createEffectPickPreview } = (await import(
        new URL('/src/app/effect-pick/preview.ts', window.location.origin).href
      )) as typeof EffectPickPreview
      const { createEffectPickConfig } = (await import(
        new URL('/packages/core/src/plugins/effect-pick/index.ts', window.location.origin).href
      )) as typeof EffectPickPlugin
      const container = document.createElement('div')
      container.style.cssText =
        'position:fixed;left:20px;top:20px;width:360px;height:220px;z-index:9999'
      const iframe = document.createElement('iframe')
      iframe.title = 'Effect lifecycle fixture'
      iframe.style.cssText = 'width:100%;height:100%'
      container.append(iframe)
      document.body.append(container)
      const errors: string[] = []
      const previous = createEffectPickPreview(iframe, createEffectPickConfig('diagonal-fill'), {
        onError: (message) => errors.push(message)
      })
      previous.setConfig(createEffectPickConfig('water-text'))
      const current = createEffectPickPreview(iframe, createEffectPickConfig('animated-gradient'), {
        onError: (message) => errors.push(message)
      })
      previous.destroy()
      current.setConfig(createEffectPickConfig('character-wave', { text: 'Rapid final selection' }))
      current.setConfig(createEffectPickConfig('diagonal-fill', { text: 'Latest selected effect' }))
      return {
        errors,
        remove() {
          current.destroy()
          previous.destroy()
          container.remove()
        }
      }
    })
  }

  async addBrowserStateAction(text = 'Run browser effect') {
    await this.page.evaluate(async (text) => {
      const moduleURL = new URL('/packages/scene-graph/src/module.ts', window.location.origin).href
      const { readModuleInstance }: typeof SceneGraphModule = await import(
        /* @vite-ignore */ moduleURL
      )

      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

      const store = window.openPencil.getStore()
      const id = [...store.state.selectedIds][0]
      const node = id ? store.graph.getNode(id) : null
      const module = readModuleInstance(node?.interactiveProps?.module)
      if (!node || !module) throw new Error('EffectPick action target is missing')
      store.graph.updateNode(store.graph.rootId, {
        lowcodeDocumentState: [
          { id: 'effect-browser-clicks', name: 'effectClicks', type: 'number', defaultValue: 0 }
        ]
      })
      store.graph.updateNode(node.id, {
        x: 20,
        y: 20,
        interactiveProps: {
          ...node.interactiveProps,
          module: {
            ...module,
            config: { ...module.config, text }
          }
        },
        events: {
          onClick: [
            {
              id: 'effect-browser-click',
              kind: 'setVariable',
              targetName: 'effectClicks',
              valueExpr: '$prev + 1'
            }
          ]
        }
      })
      store.graph.createNode('TEXT', store.state.currentPageId, {
        name: 'Browser EffectPick result',
        text: 'Browser effect clicks: 0',
        x: 20,
        y: 240,
        width: 320,
        height: 40,
        bindings: { text: { kind: 'expr', expr: '"Browser effect clicks: " + effectClicks' } }
      })
      store.requestRender()
    }, text)
  }
}
