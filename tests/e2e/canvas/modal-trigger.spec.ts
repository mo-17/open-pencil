import { createModalModuleFrameOverrides } from '@open-pencil/core/plugins'
import type { FontManager } from '@open-pencil/core/text'

import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'
import { mockFontsource } from '#tests/helpers/fonts/fontsource'
import { trackFontModuleResources } from '#tests/helpers/fonts/runtime'

test.use({ viewport: { width: 1440, height: 1000 } })

for (const renderer of ['retained', 'tiled'] as const) {
  test(`${renderer}: Modal trigger stays readable without its custom body covering it`, async ({
    page
  }, info) => {
    test.setTimeout(90_000)
    await trackFontModuleResources(page)
    await mockFontsource(page, [])
    await page.goto(`/?test&renderer=${renderer}&navigation-benchmark`)
    const canvas = new CanvasHelper(page)
    await canvas.waitForInit()
    const trigger = createModalModuleFrameOverrides({
      triggerLabel: '编辑资料 Edit',
      contentChildName: 'Body'
    })
    const nodeIds = await page.evaluate(
      async ({ trigger }) => {
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
          name: 'Modal trigger and content boundary',
          width: 440,
          height: 240,
          fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, visible: true, opacity: 1 }]
        })
        const modal = editor.graph.createNode('FRAME', root.id, {
          ...trigger,
          width: 320,
          height: 52,
          x: 20,
          y: 20,
          textLanguage: 'zh-CN',
          clipsContent: false
        })
        const body = editor.graph.createNode('FORM', modal.id, {
          name: 'Body',
          width: 320,
          height: 320
        })
        editor.graph.createNode('TEXT', body.id, { text: '姓名', width: 100, height: 24 })
        // More than the chunk split threshold: hidden content must stay hidden in tiled rendering.
        for (let index = 0; index < 40; index++)
          editor.graph.createNode('RECTANGLE', body.id, {
            x: index,
            y: 80,
            width: 20,
            height: 20,
            fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }]
          })
        editor.graph.createNode('FRAME', root.id, {
          ...trigger,
          width: 88,
          height: 34,
          x: 20,
          y: 110,
          textLanguage: 'zh-CN'
        })
        await editor.loadFontsForNodes([root.id])
        editor.zoomToBounds(-40, -40, 480, 280)
        editor.requestRender()
        return { root: root.id, modal: modal.id }
      },
      { trigger }
    )
    await page.evaluate(() => {
      if (!window.openPencil) throw new Error('Editor test API is unavailable')
      return window.openPencil.test?.navigation?.waitForSettlement()
    })
    await canvas.canvas.screenshot({ path: info.outputPath(`${renderer}-modal-trigger-live.png`) })
    const png = await page.evaluate(async ({ root }) => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

      const bytes = await window.openPencil.getStore().renderExportImage([root], 1, 'PNG')
      if (!bytes) throw new Error('Modal PNG unavailable')
      return Array.from(bytes)
    }, nodeIds)
    expect(Buffer.from(png)).toMatchSnapshot('modal-trigger.png', {
      maxDiffPixels: 0,
      threshold: 0.2
    })
    canvas.assertNoErrors()
  })
}
