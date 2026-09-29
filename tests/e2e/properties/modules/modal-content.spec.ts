import type { Page } from '@playwright/test'

import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'

const output = 'output/modal-canvas-content-20260925'

async function prepare(page: Page): Promise<CanvasHelper> {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/?test&navigation-benchmark')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await page.evaluate(async () => {
    const { appPluginStore, appPluginStoreReady } = await import('/src/app/plugins/index.ts')
    await appPluginStoreReady
    const id = 'open-pencil.modal'
    const installed = appPluginStore
      .snapshot()
      .installed.find((entry) => entry.package.manifest.plugin.id === id)
    if (!installed) await appPluginStore.install(id)
    if (!installed?.enabled) await appPluginStore.setEnabled(id, true)
  })
  return canvas
}

async function waitForCanvasSettlement(page: Page) {
  await page.evaluate(async () => {
    // Let Vue resize/recreate the scene surface after showing or hiding the content banner.
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
    const navigation = window.openPencil.test?.navigation
    if (!navigation) throw new Error('Canvas settlement hooks are unavailable')
    await navigation.waitForSettlement()
  })
  // A stable page-color placeholder is not proof that the current scene finished painting.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const renderers = window.openPencil
          .getStore()
          .canvasRenderers.filter((renderer) => renderer.tracksSceneSettlement)
        return (
          renderers.length > 0 && renderers.every((renderer) => renderer.sceneBackingBuild === null)
        )
      })
    )
    .toBe(true)
}

function layer(page: Page, name: string) {
  return page.getByTestId('layers-item').filter({ has: page.getByText(name, { exact: true }) })
}

async function selectLayer(page: Page, name: string) {
  await page.getByTestId('left-panel-layers-tab').click()
  const row = layer(page, name)
  for (let depth = 0; depth < 12 && (await row.count()) === 0; depth++) {
    const collapsed = page
      .getByTestId('layers-item')
      .locator('[data-slot="disclosure"][aria-expanded="false"]')
    if ((await collapsed.count()) === 0) break
    await collapsed.first().click()
  }
  await expect(row).toBeVisible()
  await row.click()
}

async function insertModal(page: Page) {
  await page.getByTestId('toolbar-plugin-modules').click()
  await page.getByTestId('toolbar-plugin-module-open-pencil.modal-modal').click()
  await expect(page.getByTestId('modal-create-content')).toBeVisible()
}

async function drawContentRectangle(page: Page, canvas: CanvasHelper) {
  const point = await page.evaluate(() => {
    const editor = window.openPencil.getStore()
    const rootId = editor.state.contentEdit?.rootId
    const root = rootId && editor.graph.getNode(rootId)
    if (!root) throw new Error('Dialog content editing has not started')
    const origin = editor.graph.getAbsolutePosition(root.id)
    return {
      x: (origin.x + root.width - 72) * editor.state.zoom + editor.state.panX,
      y: (origin.y + root.height - 48) * editor.state.zoom + editor.state.panY,
      width: 40 * editor.state.zoom,
      height: 24 * editor.state.zoom
    }
  })
  await canvas.drawRect(point.x, point.y, point.width, point.height)
  await expect(layer(page, 'Rectangle')).toBeVisible()
}

test('edits an existing dialog form using normal properties and drawing tools and keeps edits on return', async ({
  page
}) => {
  test.setTimeout(60_000)
  const canvas = await prepare(page)
  await page.getByTestId('left-panel-assets-tab').click()
  const assets = page.getByTestId('assets-panel')
  await assets.getByRole('combobox', { name: 'Asset source', exact: true }).click()
  await page.getByRole('option', { name: 'Component templates', exact: true }).click()
  await assets.getByRole('searchbox').fill('dialog-form')
  await assets
    .locator('[data-component-template="dialog-form"]')
    .getByRole('button', { name: 'Insert template', exact: true })
    .click()
  await selectLayer(page, 'Modal')
  await page.getByTestId('modal-edit-content').click()
  const banner = page.getByTestId('content-edit-banner')
  await expect(banner).toContainText('Dialog form content')

  await selectLayer(page, 'Save locally')
  const label = page.getByTestId('lowcode-button-interactive-text')
  await expect(label).toHaveValue('Save locally')
  await label.fill('Save profile changes')
  await label.blur()
  await drawContentRectangle(page, canvas)
  await waitForCanvasSettlement(page)
  await page.screenshot({ path: output + '/editing-existing.png' })

  await page.getByTestId('modal-finish-content').click()
  await expect(banner).toHaveCount(0)
  await expect(page.getByTestId('modal-edit-content')).toBeEnabled()
  await page.getByTestId('modal-edit-content').click()
  await expect(banner).toContainText('Dialog form content')
  await expect(layer(page, 'Rectangle')).toBeVisible()
  await selectLayer(page, 'Save locally')
  await expect(label).toHaveValue('Save profile changes')
  canvas.assertNoErrors()
})

test('creating custom content is undoable and keeps the previous content available', async ({
  page
}) => {
  test.setTimeout(60_000)
  const canvas = await prepare(page)
  await insertModal(page)
  const original = page.getByTestId('multiline-module-text-source')
  await original.fill('Original modal explanation')
  await original.blur()
  await page.getByTestId('modal-create-content').click()
  const banner = page.getByTestId('content-edit-banner')
  await expect(banner).toContainText('Dialog content')
  await waitForCanvasSettlement(page)
  await page.screenshot({ path: output + '/custom-content.png' })
  await page.getByTestId('modal-finish-content').click()
  await expect(original).toHaveValue('Original modal explanation')
  await waitForCanvasSettlement(page)
  await expect(canvas.canvas).toHaveScreenshot('modal-trigger-after-content-edit.png')
  await page.screenshot({ path: output + '/trigger-panel.png' })

  await page.getByTestId('modal-create-content').click()
  await expect(banner).toContainText('Dialog content 2')
  await page.getByTestId('modal-finish-content').click()
  const content = page.getByTestId('module-content-child-select').getByRole('combobox')
  await expect(content).toContainText('Dialog content 2')
  await canvas.undo()
  await expect(content).toContainText('Dialog content')
  await expect(content).not.toContainText('Dialog content 2')
  await expect(original).toHaveValue('Original modal explanation')
  await canvas.redo()
  await expect(content).toContainText('Dialog content 2')
  await content.click()
  await page.getByRole('option', { name: 'Dialog content', exact: true }).click()
  await page.getByTestId('modal-edit-content').click()
  await expect(banner).toContainText('Dialog content')
  await expect(banner).not.toContainText('Dialog content 2')
  await page.getByTestId('modal-finish-content').click()
  await expect(original).toHaveValue('Original modal explanation')
  canvas.assertNoErrors()
})

test('selecting an outside layer or changing page leaves content editing', async ({ page }) => {
  test.setTimeout(60_000)
  const canvas = await prepare(page)
  await canvas.drawRect(80, 90, 120, 70)
  await layer(page, 'Rectangle').dblclick()
  await page.getByTestId('layers-item-input').fill('Outside dialog')
  await page.getByTestId('layers-item-input').press('Enter')
  await canvas.pressKey('Escape')
  await insertModal(page)
  await page.getByTestId('modal-create-content').click()
  const banner = page.getByTestId('content-edit-banner')
  await expect(banner).toBeVisible()
  await selectLayer(page, 'Outside dialog')
  await expect(banner).toHaveCount(0)
  await selectLayer(page, 'Modal')
  await page.getByTestId('modal-edit-content').click()
  await expect(banner).toBeVisible()
  await page.getByTestId('pages-add').click()
  await expect(banner).toHaveCount(0)
  await expect(page.getByTestId('modal-finish-content')).toHaveCount(0)
  await page.getByTestId('pages-item').filter({ hasText: 'Page 1' }).click()
  await expect(banner).toHaveCount(0)
  await selectLayer(page, 'Modal')
  await expect(page.getByTestId('modal-edit-content')).toBeEnabled()
  canvas.assertNoErrors()
})
