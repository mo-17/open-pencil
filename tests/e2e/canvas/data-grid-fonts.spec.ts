import {
  createDataGridModuleFrameOverrides,
  DATA_GRID_MODULE_DEFAULT_CONFIG,
  type DataGridModuleConfigV1
} from '@open-pencil/core/plugins'
import type { FontManager } from '@open-pencil/core/text'

import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'
import { mockFontsource } from '#tests/helpers/fonts/fontsource'
import { trackFontModuleResources } from '#tests/helpers/fonts/runtime'

test.use({ viewport: { width: 1440, height: 1000 } })

const config: DataGridModuleConfigV1 = {
  ...DATA_GRID_MODULE_DEFAULT_CONFIG,
  fontSize: 20,
  initialSort: { columnId: 'count', direction: 'descending' },
  data: {
    columns: [
      {
        id: 'name',
        label: '名称 Name',
        type: 'text',
        align: 'start',
        width: 280,
        sortable: true,
        filterable: true
      },
      {
        id: 'count',
        label: '数量',
        type: 'number',
        align: 'end',
        width: 120,
        sortable: true,
        filterable: false
      }
    ],
    rows: [
      { id: 'first', cells: ['中文 Alpha', 42] },
      { id: 'second', cells: ['第二条 Beta', null] },
      { id: 'third', cells: ['第三条', 73] }
    ]
  }
}

for (const renderer of ['retained', 'tiled'] as const) {
  test(`${renderer}: DataGrid uses Chinese fallback for headers, cells, and clipped mixed text`, async ({
    page
  }, info) => {
    test.setTimeout(90_000)
    await trackFontModuleResources(page)
    await mockFontsource(page, [])
    await page.goto(`/?test&renderer=${renderer}&navigation-benchmark`)
    const canvas = new CanvasHelper(page)
    await canvas.waitForInit()
    const primary = createDataGridModuleFrameOverrides(config)
    const largeText = createDataGridModuleFrameOverrides({ ...config, fontSize: 32 })
    const noHeader = createDataGridModuleFrameOverrides({
      ...config,
      showHeader: false,
      fontSize: 14
    })
    const ids = await page.evaluate(
      async ({ primary, largeText, noHeader }) => {
        if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

        const editor = window.openPencil.getStore()
        const moduleURL = performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .find((url) => url.includes('/packages/core/src/text/fonts.ts'))
        if (!moduleURL) throw new Error('Font manager module not observed')
        const { fontManager } = (await import(/* @vite-ignore */ moduleURL)) as {
          fontManager: FontManager
        }
        const response = await fetch('/tests/fixtures/fonts/NotoSansSC-Regular.ttf')
        if (!response.ok) throw new Error('Licensed local CJK fixture unavailable')
        fontManager.markLoaded('Noto Sans SC', 'Regular', await response.arrayBuffer())
        fontManager.setCJKFallbackFamily('Noto Sans SC')
        const root = editor.graph.createNode('FRAME', editor.state.currentPageId, {
          name: 'DataGrid Chinese font coverage',
          width: 704,
          height: 380,
          clipsContent: true,
          fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, visible: true, opacity: 1 }]
        })
        const grid = editor.graph.createNode('FRAME', root.id, {
          ...primary,
          x: 16,
          y: 16,
          width: 420,
          height: 220,
          textLanguage: 'zh-CN'
        })
        editor.graph.createNode('FRAME', root.id, {
          ...largeText,
          x: 452,
          y: 16,
          width: 236,
          height: 220,
          textLanguage: 'zh-CN'
        })
        editor.graph.createNode('FRAME', root.id, {
          ...noHeader,
          x: 16,
          y: 252,
          width: 672,
          height: 112,
          textLanguage: 'zh-CN'
        })
        await editor.loadFontsForNodes([root.id])
        editor.zoomToBounds(-24, -24, 728, 404)
        editor.requestRender()
        return { root: root.id, grid: grid.id }
      },
      { primary, largeText, noHeader }
    )
    await page.evaluate(() => {
      if (!window.openPencil) throw new Error('Editor test API is unavailable')
      return window.openPencil.test?.navigation?.waitForSettlement()
    })
    await canvas.canvas.screenshot({ path: info.outputPath(`${renderer}-data-grid-live.png`) })
    const initial = await page.evaluate(async ({ root }) => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

      const editor = window.openPencil.getStore()
      const png = await editor.renderExportImage([root], 1, 'PNG')
      if (!png) throw new Error('DataGrid PNG export unavailable')
      return Array.from(png)
    }, ids)
    expect(Buffer.from(initial)).toMatchSnapshot('data-grid-chinese-fonts.png', {
      maxDiffPixels: 0,
      threshold: 0.2
    })
    const updated = createDataGridModuleFrameOverrides({
      ...config,
      fontSize: 24,
      data: { ...config.data, rows: [{ id: 'updated', cells: ['已更新 Updated', 99] }] }
    })
    const changed = await page.evaluate(
      async ({ ids, updated }) => {
        if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

        const editor = window.openPencil.getStore()
        editor.graph.updateNode(ids.grid, { interactiveProps: updated.interactiveProps })
        await editor.loadFontsForNodes([ids.root])
        editor.requestRender()
        await window.openPencil.test?.navigation?.waitForSettlement()
        const png = await editor.renderExportImage([ids.root], 1, 'PNG')
        if (!png) throw new Error('Updated DataGrid PNG export unavailable')
        return Array.from(png)
      },
      { ids, updated }
    )
    expect(changed).not.toEqual(initial)
    expect(Buffer.from(changed)).toMatchSnapshot('data-grid-chinese-updated.png', {
      maxDiffPixels: 0,
      threshold: 0.2
    })
    await canvas.canvas.screenshot({
      path: info.outputPath(`${renderer}-data-grid-live-updated.png`)
    })
    canvas.assertNoErrors()
  })
}
