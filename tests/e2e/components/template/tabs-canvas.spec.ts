import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import type { FontManager } from '@open-pencil/core/text'

import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'
import { withComponentTemplateFiles } from '#tests/helpers/compiler/components/templates/browser'
import { parseCompilerFigOutput } from '#tests/helpers/compiler/output'
import { mockFontsource } from '#tests/helpers/fonts/fontsource'
import { trackFontModuleResources } from '#tests/helpers/fonts/runtime'

function diskFixture(path: string, create: boolean) {
  if (create) {
    mkdirSync(dirname(path), { recursive: true })
    execFileSync(
      'bun',
      [
        'tests/helpers/compiler/components/templates/compile-fig.ts',
        'react',
        path,
        '--create-fixture'
      ],
      { cwd: process.cwd(), maxBuffer: 16 * 1024 * 1024 }
    )
  }
  return readFileSync(path)
}

test('canvas shows only the selected tab content below its header from an on-disk FIG', async ({
  page
}, info) => {
  test.setTimeout(90000)
  const suppliedPath = process.env.OPENPENCIL_TEMPLATE_FIG_PATH
  const path = suppliedPath ? resolve(suppliedPath) : info.outputPath('all-templates.fig')
  const bytes = diskFixture(path, !suppliedPath)
  await trackFontModuleResources(page)
  await mockFontsource(page, [])
  // Keep the screenshot profile explicit; tiled/live rendering has different readiness signals.
  await page.goto('/?test&renderer=retained')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  const nodes = await page.evaluate(async (data) => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('Editor unavailable')
    const moduleURL = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((url) => url.includes('/packages/core/src/text/fonts.ts'))
    if (!moduleURL) throw new Error('Font manager module unavailable')
    const { fontManager } = (await import(/* @vite-ignore */ moduleURL)) as {
      fontManager: FontManager
    }
    const response = await fetch('/tests/fixtures/fonts/NotoSansCJK-Test.otf')
    if (!response.ok) throw new Error('Licensed local CJK font fixture unavailable')
    fontManager.markLoaded('Noto Sans CJK SC', 'Regular', await response.arrayBuffer())
    fontManager.setCJKFallbackFamily('Noto Sans CJK SC')
    await store.openFigFile(new File([new Uint8Array(data)], 'all-templates.fig'))
    const root = store.graph
      .getChildren(store.state.currentPageId)
      .find((node) => node.name === '分栏详情与表单')
    if (!root) throw new Error('Tabs template missing')
    const tabs = store.graph.getChildren(root.id).find((node) => node.interactiveProps?.module)
    if (!tabs) throw new Error('Tabs module missing')
    const overview = store.graph.getChildren(tabs.id).find((node) => node.name === '概览内容')
    const details = store.graph.getChildren(tabs.id).find((node) => node.name === '详情表单内容')
    const heading = overview && store.graph.getChildren(overview.id)[0]
    if (!overview || !details || !heading) throw new Error('Tabs content missing')
    await store.loadFontsForNodes([root.id])
    store.zoomToBounds(root.x, root.y, root.x + root.width, root.y + root.height)
    store.requestRender()
    return { rootId: root.id, tabsId: tabs.id, detailsId: details.id, headingId: heading.id }
  }, Array.from(bytes))
  await canvas.waitForRender()
  // This retained profile builds scene backing over multiple frames; two frames can still be blank.
  await page.waitForFunction(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const store = window.openPencil?.getStore?.()
    const renderer = store?.canvasRenderers.find((candidate) => candidate.tracksSceneSettlement)
    if (!store || !renderer || store.state.loading) return false
    return (
      renderer.pageId === store.state.currentPageId &&
      renderer.sceneBacking?.sceneVersion === store.state.sceneVersion &&
      !renderer.sceneBackingBuild &&
      !renderer.sceneBackingNeedsCrispRender &&
      !renderer.tiledScenePending
    )
  })
  const viewportScreenshot = info.outputPath('editor-tabs-viewport.png')
  await canvas.canvas.screenshot({ path: viewportScreenshot })
  await info.attach('Editor canvas viewport', {
    path: viewportScreenshot,
    contentType: 'image/png'
  })
  const result = await page.evaluate(async (ids) => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('Editor unavailable')
    const root = store.graph.getNode(ids.rootId)
    const tabs = store.graph.getNode(ids.tabsId)
    const details = store.graph.getNode(ids.detailsId)
    const heading = store.graph.getNode(ids.headingId)
    if (!root || !tabs || !details || !heading) throw new Error('Imported tabs disappeared')
    const render = async () => {
      const png = await store.renderExportImage([root.id], 1, 'PNG')
      if (!png?.length) throw new Error('Tabs canvas export failed')
      const image = await createImageBitmap(new Blob([new Uint8Array(png)], { type: 'image/png' }))
      const output = document.createElement('canvas')
      output.width = image.width
      output.height = image.height
      const ctx = output.getContext('2d')
      if (!ctx) throw new Error('Pixel reader unavailable')
      ctx.drawImage(image, 0, 0)
      image.close()
      return { png: Array.from(png), pixels: ctx.getImageData(0, 0, output.width, output.height) }
    }
    function changedPixels(a: ImageData, b: ImageData) {
      if (a.width !== b.width || a.height !== b.height) throw new Error('Canvas bounds changed')
      let count = 0
      let minX = a.width
      let minY = a.height
      let maxX = -1
      let maxY = -1
      for (let index = 0; index < a.data.length; index += 4) {
        if ([0, 1, 2, 3].every((channel) => a.data[index + channel] === b.data[index + channel]))
          continue
        const x = (index / 4) % a.width
        const y = Math.floor(index / 4 / a.width)
        count++
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
      return { count, minX, minY, maxX, maxY }
    }
    const initial = await render()
    store.graph.updateNode(details.id, { visible: false })
    const inactiveHidden = await render()
    store.graph.updateNode(details.id, { visible: true })
    store.graph.updateNode(heading.id, { visible: false })
    const headingHidden = await render()
    store.graph.updateNode(heading.id, { visible: true })
    return {
      image: initial.png,
      width: initial.pixels.width,
      height: initial.pixels.height,
      tabs: { x: tabs.x, y: tabs.y, width: tabs.width, height: tabs.height },
      inactiveDifference: changedPixels(initial.pixels, inactiveHidden.pixels),
      headingDifference: changedPixels(initial.pixels, headingHidden.pixels)
    }
  }, nodes)
  const screenshot = info.outputPath('canvas-tabs-overview.png')
  writeFileSync(screenshot, Buffer.from(result.image))
  await info.attach('Tabs canvas from saved FIG', { path: screenshot, contentType: 'image/png' })
  const evidencePath = info.outputPath('tabs-canvas-pixels.json')
  const { image: _image, ...measurements } = result
  writeFileSync(
    evidencePath,
    JSON.stringify(
      { path, sha256: createHash('sha256').update(bytes).digest('hex'), ...measurements },
      null,
      2
    )
  )
  await info.attach('Tabs pixel measurements', {
    path: evidencePath,
    contentType: 'application/json'
  })
  expect
    .soft(result.inactiveDifference.count, 'Inactive panel must contribute no canvas pixels')
    .toBe(0)
  expect.soft(result.headingDifference.count, 'Active content must be painted').toBeGreaterThan(0)
  expect.soft(result.headingDifference.minX).toBeGreaterThanOrEqual(result.tabs.x + 12)
  expect.soft(result.headingDifference.minY).toBeGreaterThanOrEqual(result.tabs.y + 44)
  expect.soft(result.headingDifference.maxX).toBeLessThan(result.tabs.x + result.tabs.width)
  expect(Buffer.from(result.image)).toMatchSnapshot('tabs-canvas-overview.png')
  canvas.assertNoErrors()
})

for (const target of ['react', 'vue'] as const) {
  test(`${target} reopens saved tabs and switches editable form content`, async ({
    page
  }, info) => {
    test.setTimeout(90000)
    const suppliedPath = process.env.OPENPENCIL_TEMPLATE_FIG_PATH
    const path = suppliedPath ? resolve(suppliedPath) : info.outputPath('all-templates.fig')
    diskFixture(path, !suppliedPath)
    const compiled = parseCompilerFigOutput(
      execFileSync(
        'bun',
        ['tests/helpers/compiler/components/templates/compile-fig.ts', target, path],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          maxBuffer: 16 * 1024 * 1024
        }
      )
    )
    await withComponentTemplateFiles(page, target, new Map(compiled.files), async () => {
      const overview = page.getByRole('tab', { name: '概览', exact: true })
      const details = page.getByRole('tab', { name: '详情', exact: true })
      const panel = page.getByRole('tabpanel')
      await expect(overview).toHaveAttribute('aria-selected', 'true')
      await expect(panel).toContainText('信息各就其位')
      await expect(panel.getByRole('textbox')).toHaveCount(0)
      const overviewBounds = await overview.boundingBox()
      const headingBounds = await panel.getByText('信息各就其位', { exact: true }).boundingBox()
      if (!overviewBounds || !headingBounds) throw new Error('Visible tab geometry unavailable')
      expect(headingBounds.y).toBeGreaterThanOrEqual(overviewBounds.y + overviewBounds.height)
      await panel.screenshot({ path: info.outputPath(`${target}-tabs-overview.png`) })
      await overview.focus()
      await overview.press('ArrowRight')
      await expect(details).toBeFocused()
      await expect(overview).toHaveAttribute('aria-selected', 'true')
      await details.press('Enter')
      await expect(details).toHaveAttribute('aria-selected', 'true')
      const name = panel.getByRole('textbox', { name: '姓名', exact: true })
      await name.fill('跨标签保留')
      await expect(panel.getByText('信息各就其位', { exact: true })).toHaveCount(0)
      await overview.click()
      await expect(panel.getByRole('textbox')).toHaveCount(0)
      await details.click()
      await expect(name).toHaveValue('跨标签保留')
      await panel.screenshot({ path: info.outputPath(`${target}-tabs-details.png`) })
    })
  })
}
