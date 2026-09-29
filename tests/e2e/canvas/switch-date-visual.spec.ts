import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import type { FontManager } from '@open-pencil/core/text'
import type { SceneNode } from '@open-pencil/scene-graph'

import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'
import { mockFontsource } from '#tests/helpers/fonts/fontsource'
import { trackFontModuleResources } from '#tests/helpers/fonts/runtime'

test.use({ viewport: { width: 1400, height: 1000 } })

for (const renderer of ['retained', 'tiled'] as const) {
  test(`${renderer}: switch and date initial appearances survive bound state updates`, async ({
    page
  }, info) => {
    test.setTimeout(90000)
    await mockFontsource(page, [])
    await page.goto(`/?test&renderer=${renderer}&navigation-benchmark`)
    const canvas = new CanvasHelper(page)
    await canvas.waitForInit()
    const ids = await page.evaluate(async () => {
      const editor = window.openPencil.getStore()
      const graph = editor.graph
      graph.updateNode(graph.rootId, {
        lowcodeDocumentState: [
          { id: 'enabled', name: 'enabled', type: 'boolean', defaultValue: false },
          { id: 'date', name: 'date', type: 'string', defaultValue: '2024-02-29' }
        ]
      })
      const root = graph.createNode('FRAME', editor.state.currentPageId, {
        name: 'Switch and date',
        width: 440,
        height: 302,
        clipsContent: true,
        fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }]
      })
      const label = (text: string, x: number, y: number) =>
        graph.createNode('TEXT', root.id, {
          text,
          x,
          y,
          width: 190,
          height: 22,
          fontFamily: 'Inter',
          fontSize: 14,
          fontWeight: 400,
          fills: [
            { type: 'SOLID', color: { r: 0.09, g: 0.17, b: 0.3, a: 1 }, opacity: 1, visible: true }
          ]
        })
      label('Switch: off / on / disabled', 16, 16)
      label('Date: initial appearances', 224, 16)
      const toggle = (
        x: number,
        y: number,
        props: Record<string, unknown>,
        overrides: Partial<SceneNode> = {}
      ) =>
        graph.createNode('SWITCH', root.id, {
          x,
          y,
          interactiveProps: props,
          ...overrides
        })
      const boundSwitch = toggle(
        16,
        56,
        { checked: true },
        { bindings: { value: { kind: 'docState', docStateName: 'enabled' } } }
      )
      toggle(80, 56, { checked: true })
      toggle(144, 56, { checked: true, disabled: true })
      label('Wide authored surface', 16, 96)
      toggle(
        16,
        126,
        { checked: true },
        {
          width: 180,
          height: 44,
          cornerRadius: 6,
          paddingLeft: 12,
          paddingRight: 12,
          fills: [
            { type: 'SOLID', color: { r: 0.96, g: 0.97, b: 0.99, a: 1 }, opacity: 1, visible: true }
          ]
        }
      )
      label('Small bounds / padding', 16, 186)
      toggle(16, 216, { checked: false }, { width: 22, height: 12 })
      toggle(
        80,
        212,
        { checked: true },
        {
          width: 64,
          height: 32,
          paddingLeft: 10,
          paddingRight: 10,
          paddingTop: 4,
          paddingBottom: 4
        }
      )
      const date = (
        y: number,
        props: Record<string, unknown>,
        overrides: Partial<SceneNode> = {}
      ) =>
        graph.createNode('DATEPICKER', root.id, {
          x: 224,
          y,
          width: 200,
          height: 36,
          fontFamily: 'Inter',
          fontSize: 14,
          interactiveProps: props,
          ...overrides
        })
      const boundDate = date(
        50,
        { value: '2000-01-01' },
        { bindings: { value: { kind: 'docState', docStateName: 'date' } } }
      )
      date(98, { value: '' })
      date(146, { value: '2026-09-24', disabled: true })
      date(194, { value: '2026-02-30' })
      date(242, { value: '2026-09-24', readOnly: true })
      await editor.loadFontsForNodes([root.id])
      editor.zoomToBounds(-30, -30, 470, 332)
      editor.requestRender()
      return { root: root.id, switch: boundSwitch.id, date: boundDate.id }
    })
    await page.evaluate(() => window.openPencil?.test?.navigation?.waitForSettlement())
    await canvas.canvas.screenshot({ path: info.outputPath(`${renderer}-live-initial.png`) })
    const initial = await page.evaluate(async (rootId) => {
      const png = await window.openPencil.getStore().renderExportImage([rootId], 1, 'PNG')
      if (!png) throw new Error('Raster export unavailable')
      return Array.from(png)
    }, ids.root)
    expect(Buffer.from(initial)).toMatchSnapshot('switch-date-initial.png', {
      maxDiffPixels: 0,
      threshold: 0.2
    })
    await page.evaluate(() => {
      const editor = window.openPencil.getStore()
      const root = editor.graph.getNode(editor.graph.rootId)
      editor.graph.updateNode(editor.graph.rootId, {
        lowcodeDocumentState: root?.lowcodeDocumentState?.map((state) => ({
          ...state,
          defaultValue: state.type === 'boolean' ? true : '2026-09-24'
        }))
      })
      editor.requestRender()
    })
    await page.evaluate(() => window.openPencil?.test?.navigation?.waitForSettlement())
    await canvas.canvas.screenshot({ path: info.outputPath(`${renderer}-live-updated.png`) })
    const changed = await page.evaluate(async (ids) => {
      const editor = window.openPencil.getStore()
      const png = await editor.renderExportImage([ids.root], 1, 'PNG')
      if (!png) throw new Error('Raster export unavailable')
      return {
        png: Array.from(png),
        nodes: [ids.switch, ids.date].map((id) => {
          const node = editor.graph.getNode(id)
          return { type: node?.type, children: node?.childIds, props: node?.interactiveProps }
        })
      }
    }, ids)
    expect(Buffer.from(changed.png)).toMatchSnapshot('switch-date-updated.png', {
      maxDiffPixels: 0,
      threshold: 0.2
    })
    expect(changed.png).not.toEqual(initial)
    expect(changed.nodes).toEqual([
      { type: 'SWITCH', children: [], props: { checked: true } },
      { type: 'DATEPICKER', children: [], props: { value: '2000-01-01' } }
    ])
    writeFileSync(info.outputPath('controls-initial.png'), Buffer.from(initial))
    writeFileSync(info.outputPath('controls-updated.png'), Buffer.from(changed.png))
    canvas.assertNoErrors()
  })
}

test('saved template FIG paints its switch and bound date without regenerating the file', async ({
  page
}, info) => {
  test.setTimeout(90000)
  const supplied = process.env.OPENPENCIL_TEMPLATE_FIG_PATH
  const path = supplied ? resolve(supplied) : info.outputPath('all-templates.fig')
  if (!supplied) {
    mkdirSync(dirname(path), { recursive: true })
    execFileSync(
      'bun',
      [
        'tests/helpers/compiler/components/templates/compile-fig.ts',
        'react',
        path,
        '--create-fixture'
      ],
      {
        cwd: process.cwd(),
        maxBuffer: 16 * 1024 * 1024
      }
    )
  }
  const bytes = readFileSync(path)
  await trackFontModuleResources(page)
  await mockFontsource(page, [])
  await page.goto('/?test&renderer=retained&navigation-benchmark')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  const roots = await page.evaluate(async (bytes) => {
    const editor = window.openPencil.getStore()
    const url = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((url) => url.includes('/packages/core/src/text/fonts.ts'))
    if (!url) throw new Error('Font manager module not observed')
    const { fontManager } = (await import(/* @vite-ignore */ url)) as { fontManager: FontManager }
    const response = await fetch('/tests/fixtures/fonts/NotoSansCJK-Test.otf')
    if (!response.ok) throw new Error('Licensed font fixture unavailable')
    fontManager.markLoaded('Noto Sans CJK SC', 'Regular', await response.arrayBuffer())
    fontManager.setCJKFallbackFamily('Noto Sans CJK SC')
    await editor.openFigFile(new File([new Uint8Array(bytes)], 'all-templates.fig'))
    const roots = editor.graph
      .getChildren(editor.state.currentPageId)
      .filter((node) => ['开关', '日期选择'].includes(node.name))
    if (roots.length !== 2) throw new Error('Switch/date templates missing')
    await editor.loadFontsForNodes(roots.map((node) => node.id))
    return roots.map((node) => ({ id: node.id, name: node.name }))
  }, Array.from(bytes))
  for (const [index, root] of roots.entries()) {
    const image = await page.evaluate(async (id) => {
      const editor = window.openPencil.getStore()
      const node = editor.graph.getNode(id)
      if (!node) throw new Error('Template disappeared')
      editor.zoomToBounds(
        node.x - 20,
        node.y - 20,
        node.x + node.width + 20,
        node.y + node.height + 20
      )
      editor.requestRender()
      const png = await editor.renderExportImage([id], 1, 'PNG')
      if (!png) throw new Error('Template PNG unavailable')
      return Array.from(png)
    }, root.id)
    await page.evaluate(() => window.openPencil?.test?.navigation?.waitForSettlement())
    await canvas.canvas.screenshot({ path: info.outputPath(`template-${index}-live.png`) })
    writeFileSync(info.outputPath(`template-${index}.png`), Buffer.from(image))
    expect(Buffer.from(image)).toMatchSnapshot(`template-${index}.png`, {
      maxDiffPixels: 0,
      threshold: 0.2
    })
  }
  expect(readFileSync(path)).toEqual(bytes)
  writeFileSync(
    info.outputPath('source.json'),
    JSON.stringify(
      { path, sha256: createHash('sha256').update(bytes).digest('hex'), roots },
      null,
      2
    )
  )
  canvas.assertNoErrors()
})
