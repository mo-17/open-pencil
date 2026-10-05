import { execFileSync } from 'node:child_process'

import { expect, type Page } from '@playwright/test'
import { toUint8Array } from 'js-base64'

import type { FontManager } from '@open-pencil/core/text'

import { CanvasHelper } from '#tests/helpers/canvas'
import { mockFontsource } from '#tests/helpers/fonts/fontsource'
import { trackFontModuleResources } from '#tests/helpers/fonts/runtime'

import type { CanvasStateFamily, StateLocale } from './types'

export async function openComponentStateCanvas(
  page: Page,
  family: CanvasStateFamily,
  locale: StateLocale,
  renderer: 'retained' | 'tiled'
) {
  const makeGraph =
    family === 'rich-text'
      ? `richTextTypographyGraph(${JSON.stringify(locale)})`
      : `componentStateGraph(${JSON.stringify(family)},${JSON.stringify(locale)})`
  const source = `import {componentStateGraph,richTextTypographyGraph} from './tests/helpers/compiler/components/states/fixture';import {initCodec} from '@open-pencil/core/kiwi';import {exportFigFile} from '@open-pencil/core/io/formats/fig';await initCodec();const {graph}=${makeGraph};process.stdout.write(Buffer.from(await exportFigFile(graph)).toString('base64'));`
  const bytes = Buffer.from(
    toUint8Array(
      execFileSync('bun', ['-e', source], {
        cwd: process.cwd(),
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024
      })
    )
  )
  await trackFontModuleResources(page)
  await mockFontsource(page, [])
  await page.goto(`/?test&no-rulers&renderer=${renderer}&navigation-benchmark`)
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  const rootId = await page.evaluate(async (data) => {
    const editor = window.openPencil.getStore()
    const url = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((url) => url.includes('/packages/core/src/text/fonts.ts'))
    if (!url) throw new Error('Font manager module unavailable')
    const { fontManager } = (await import(/* @vite-ignore */ url)) as { fontManager: FontManager }
    const response = await fetch('/tests/fixtures/fonts/NotoSansCJK-Test.otf')
    if (!response.ok) throw new Error('Licensed CJK fallback unavailable')
    fontManager.markLoaded('Noto Sans CJK SC', 'Regular', await response.arrayBuffer())
    fontManager.setCJKFallbackFamily('Noto Sans CJK SC')
    await editor.openFigFile(new File([new Uint8Array(data)], 'component-states.fig'))
    const root = editor.graph.getChildren(editor.state.currentPageId)[0]
    if (!root) throw new Error('State fixture root unavailable')
    await editor.loadFontsForNodes([root.id])
    editor.clearSelection()
    editor.requestRender()
    return root.id
  }, Array.from(bytes))
  await page.evaluate(() => window.openPencil.test?.navigation?.waitForSettlement())
  return { canvas, rootId }
}

export async function componentStateCanvasMetrics(page: Page, rootId: string) {
  return page.evaluate((id) => {
    const editor = window.openPencil.getStore()
    const root = editor.graph.getNode(id)
    const pane = editor.panes.getActivePane()
    const canvas = document.querySelector<HTMLCanvasElement>(
      '[data-test-id="canvas-area"][data-active-pane="true"] [data-test-id="canvas-element"]'
    )
    return {
      root: root ? { width: root.width, height: root.height } : null,
      pane: { id: pane.id, width: pane.viewportWidth, height: pane.viewportHeight },
      canvas: canvas
        ? { paneId: canvas.dataset.paneId, width: canvas.clientWidth, height: canvas.clientHeight }
        : null,
      viewport: { zoom: editor.state.zoom, panX: editor.state.panX, panY: editor.state.panY }
    }
  }, rootId)
}

export async function captureComponentStateCanvas(page: Page, rootId: string): Promise<Buffer> {
  const png = await page.evaluate(async (id) => {
    const image = await window.openPencil.getStore().renderExportImage([id], 1, 'PNG')
    if (!image?.length) throw new Error('State Canvas PNG unavailable')
    return Array.from(image)
  }, rootId)
  return Buffer.from(png)
}

export async function zoomComponentStateCanvas(
  page: Page,
  rootId: string,
  padding: number
): Promise<void> {
  await expect
    .poll(
      async () => {
        const { pane, canvas } = await componentStateCanvasMetrics(page, rootId)
        return {
          samePane: canvas?.paneId === pane.id,
          widthReady: pane.width > 0 && canvas?.width === pane.width,
          heightReady: pane.height > 0 && canvas?.height === pane.height
        }
      },
      {
        message: 'Active Canvas viewport cache must match its presented dimensions',
        timeout: 10_000
      }
    )
    .toEqual({ samePane: true, widthReady: true, heightReady: true })
  await page.evaluate(
    ({ id, padding }) => {
      const editor = window.openPencil.getStore()
      const root = editor.graph.getNode(id)
      if (!root) throw new Error('State fixture root disappeared')
      editor.zoomToBounds(-padding, -padding, root.width + padding, root.height + padding)
      editor.requestRepaint()
    },
    { id: rootId, padding }
  )
  await page.evaluate(() => window.openPencil.test?.navigation?.waitForSettlement())
}
