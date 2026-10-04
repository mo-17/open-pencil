import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'

test('drawer content is created, edited and restored through the normal inspector', async ({
  page
}, info) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/?test&navigation-benchmark')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await page.evaluate(async () => {
    const { appPluginStore, appPluginStoreReady } = await import('/src/app/plugins/index.ts')
    await appPluginStoreReady
    const id = 'open-pencil.slide-menu'
    const installed = appPluginStore
      .snapshot()
      .installed.find((entry) => entry.package.manifest.plugin.id === id)
    if (!installed) await appPluginStore.install(id)
    if (!installed?.enabled) await appPluginStore.setEnabled(id, true)
  })
  await page.getByTestId('toolbar-plugin-modules').click()
  await page.getByTestId('toolbar-plugin-module-open-pencil.slide-menu-slide-menu').click()
  await expect(page.getByTestId('modal-create-content')).toBeVisible()
  await page.getByTestId('modal-create-content').click()
  const banner = page.getByTestId('content-edit-banner')
  await expect(banner).toBeVisible()
  const initialBanner = await banner.textContent()
  const point = await page.evaluate(() => {
    const editor = window.openPencil.getStore()
    const root =
      editor.state.contentEdit?.rootId && editor.graph.getNode(editor.state.contentEdit.rootId)
    if (!root) throw new Error('Missing drawer edit surface')
    const origin = editor.graph.getAbsolutePosition(root.id)
    return {
      x: (origin.x + root.width - 90) * editor.state.zoom + editor.state.panX,
      y: (origin.y + root.height - 55) * editor.state.zoom + editor.state.panY,
      width: 60 * editor.state.zoom,
      height: 30 * editor.state.zoom
    }
  })
  await canvas.drawRect(point.x, point.y, point.width, point.height)
  await expect(
    page.getByTestId('layers-item').filter({ has: page.getByText('Rectangle', { exact: true }) })
  ).toBeVisible()
  await page.screenshot({ path: info.outputPath('drawer-editing.png') })
  await page.getByTestId('modal-finish-content').click()
  await expect(banner).toHaveCount(0)
  await expect(page.getByTestId('modal-edit-content')).toBeEnabled()
  await page.getByTestId('modal-edit-content').click()
  await expect(banner).toHaveText(initialBanner ?? '')
  await expect(
    page.getByTestId('layers-item').filter({ has: page.getByText('Rectangle', { exact: true }) })
  ).toBeVisible()
  await page.getByTestId('modal-finish-content').click()
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
    await window.openPencil.test?.navigation?.waitForSettlement()
  })
  await expect(canvas.canvas).toHaveScreenshot('drawer-trigger-after-content-edit.png')
  await page.screenshot({ path: info.outputPath('drawer-trigger-inspector.png') })
  await page.getByTestId('modal-create-content').click()
  await expect(banner).toBeVisible()
  const secondBanner = await banner.textContent()
  expect(secondBanner).not.toBe(initialBanner)
  await page.getByTestId('modal-finish-content').click()
  const content = page.getByTestId('module-content-child-select').getByRole('combobox')
  const secondSelection = await content.textContent()
  await canvas.undo()
  await expect(content).not.toHaveText(secondSelection ?? '')
  await canvas.redo()
  await expect(content).toHaveText(secondSelection ?? '')
  canvas.assertNoErrors()
})
