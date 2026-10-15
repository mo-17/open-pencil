import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

const RICH_TEXT_PLUGIN = 'open-pencil.rich-text'

test('discovers a component by description, favorites it and inserts with working undo', async ({
  page
}) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  const componentId = await page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const editor = window.openPencil.getStore()
    const component = editor.graph.createNode('COMPONENT', editor.state.currentPageId, {
      name: 'Customer card',
      symbolDescription: 'Contact details for the account manager',
      width: 180,
      height: 80
    })
    editor.requestRender()
    return component.id
  })
  await page.getByTestId('left-panel-assets-tab').click()
  const panel = page.getByTestId('assets-panel')
  await panel.getByRole('combobox', { name: 'Asset source' }).click()
  await page.getByRole('option', { name: 'This file', exact: true }).click()
  await panel.getByRole('searchbox').fill('account manager')
  const item = panel.locator(`[data-asset-id="${componentId}"]`)
  await expect(item).toBeVisible()
  await item.getByRole('button', { name: 'Add to favorites', exact: true }).click()
  await panel.getByRole('button', { name: 'Favorites only', exact: true }).click()
  await expect(item).toBeVisible()
  await item.click()
  await page.getByTestId('asset-details-insert').click()
  await expect(page.getByTestId('asset-details-dialog')).toBeHidden()
  await expect(panel.getByRole('status')).toContainText('Inserted and selected')
  const insertedId = await page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
    return [...window.openPencil.getStore().state.selectedIds][0]
  })
  expect(
    await page.evaluate((id) => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
      return window.openPencil.getStore().graph.getNode(id)?.componentId
    }, insertedId)
  ).toBe(componentId)
  await canvas.undo()
  expect(
    await page.evaluate((id) => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
      return window.openPencil.getStore().graph.getNode(id)
    }, insertedId)
  ).toBeUndefined()
  await expect(item.getByRole('button', { name: 'Remove from favorites' })).toBeVisible()
  canvas.assertNoErrors()
})

test('plugin favorites survive reload and lead through insertion, configuration and disabled-plugin recovery', async ({
  page
}) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await page.evaluate(async (pluginId) => {
    const { appPluginStore, appPluginStoreReady } = await import('/src/app/plugins/index.ts')
    await appPluginStoreReady
    if (
      !appPluginStore
        .snapshot()
        .installed.some((entry) => entry.package.manifest.plugin.id === pluginId)
    )
      await appPluginStore.install(pluginId)
    await appPluginStore.setEnabled(pluginId, true)
  }, RICH_TEXT_PLUGIN)
  await page.getByTestId('left-panel-assets-tab').click()
  let panel = page.getByTestId('assets-panel')
  await panel.getByRole('combobox', { name: 'Asset source' }).click()
  await page.getByRole('option', { name: 'Plugin modules', exact: true }).click()
  await panel.getByRole('combobox', { name: 'Asset category' }).click()
  await page.getByRole('option', { name: 'Content', exact: true }).click()
  await panel.getByRole('searchbox').fill('Rich Text')
  let module = panel.locator('[data-module-type="rich-text"]')
  await expect(module).toBeVisible()
  await module.getByRole('button', { name: 'Add to favorites' }).click()
  await page.reload()
  await canvas.waitForInit()
  await page.getByTestId('left-panel-assets-tab').click()
  panel = page.getByTestId('assets-panel')
  await panel.getByRole('button', { name: 'Favorites only' }).click()
  module = panel.locator('[data-module-type="rich-text"]')
  await expect(module).toBeVisible()
  await module.getByRole('button', { name: 'Add to canvas', exact: true }).click()
  await expect(page.getByTestId('rich-text-content-editor')).toBeVisible()
  const insertedId = await page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
    return [...window.openPencil.getStore().state.selectedIds][0]
  })
  await canvas.undo()
  expect(
    await page.evaluate((id) => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
      return window.openPencil.getStore().graph.getNode(id)
    }, insertedId)
  ).toBeUndefined()
  await canvas.redo()
  await expect
    .poll(() =>
      page.evaluate(async (id) => {
        const { readModuleInstance } = await import('/packages/scene-graph/src/module.ts')
        if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
        return readModuleInstance(
          window.openPencil.getStore().graph.getNode(id)?.interactiveProps?.module
        )?.moduleType
      }, insertedId)
    )
    .toBe('rich-text')
  await page.getByTestId('left-panel-layers-tab').click()
  await page.locator(`[data-node-id="${insertedId}"]`).getByTestId('layers-item').click()
  const text = page.getByTestId('rich-text-inline-text').first()
  await text.fill('Configured from the workbench')
  await text.blur()
  await expect
    .poll(() =>
      page.evaluate(async (id) => {
        const { readModuleInstance } = await import('/packages/scene-graph/src/module.ts')
        if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
        return JSON.stringify(
          readModuleInstance(
            window.openPencil.getStore().graph.getNode(id)?.interactiveProps?.module
          )
        )
      }, insertedId)
    )
    .toContain('Configured from the workbench')
  await page.getByTestId('left-panel-assets-tab').click()
  await panel.getByRole('button', { name: 'Favorites only', exact: true }).click()
  await page.evaluate(async (pluginId) => {
    const { appPluginStore } = await import('/src/app/plugins/index.ts')
    await appPluginStore.setEnabled(pluginId, false)
  }, RICH_TEXT_PLUGIN)
  await expect(module).toHaveCount(0)
  await expect(panel.getByText('No matching favorites', { exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'Plugins', exact: true }).click()
  await expect(page.getByTestId('app-settings-dialog')).toBeVisible()
  canvas.assertNoErrors()
})

test('reports failed favorites persistence while keeping the session choice usable', async ({
  page
}) => {
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === 'open-pencil:asset-favorites:v1')
        throw new DOMException('quota', 'QuotaExceededError')
      return setItem.call(this, key, value)
    }
  })
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await page.getByTestId('left-panel-assets-tab').click()
  const panel = page.getByTestId('assets-panel')
  const module = panel.locator('[data-module-type="map"]')
  await module.getByRole('button', { name: 'Add to favorites' }).click()
  await expect(
    panel.getByRole('alert').filter({ hasText: 'Favorites could not be saved' })
  ).toContainText('Favorites could not be saved')
  await panel.getByRole('button', { name: 'Favorites only' }).click()
  await expect(module).toBeVisible()
  await expect(module.getByRole('button', { name: 'Remove from favorites' })).toBeVisible()
  canvas.assertNoErrors()
})

test('keyboard actions stay independent of the component card', async ({ page }) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  const componentId = await page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const editor = window.openPencil.getStore()
    const component = editor.graph.createNode('COMPONENT', editor.state.currentPageId, {
      name: 'Keyboard card',
      width: 180,
      height: 80,
      symbolLinks: [{ uri: 'https://example.com/component-docs', displayName: 'Component docs' }]
    })
    window.open = (url) => {
      document.documentElement.dataset.assetOpenedUrl = String(url)
      return null
    }
    editor.requestRender()
    return component.id
  })
  const instanceCount = () =>
    page.evaluate((id) => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

      const editor = window.openPencil.getStore()
      return editor.graph
        .getChildren(editor.state.currentPageId)
        .filter((node) => node.type === 'INSTANCE' && node.componentId === id).length
    }, componentId)
  await page.getByTestId('left-panel-assets-tab').click()
  await page.getByRole('button', { name: 'List view', exact: true }).click()
  const card = page.getByTestId('assets-panel').locator(`[data-asset-id="${componentId}"]`)
  const docs = card.getByTestId('asset-docs')
  await docs.focus()
  await docs.press('Enter')
  await expect(page.locator('html')).toHaveAttribute(
    'data-asset-opened-url',
    'https://example.com/component-docs'
  )
  expect(await instanceCount()).toBe(0)
  await docs.press('Space')
  expect(await instanceCount()).toBe(0)
  const insert = card.getByTestId('asset-insert')
  await insert.focus()
  await insert.press('Enter')
  await expect.poll(instanceCount).toBe(1)
  await expect(page.getByTestId('asset-details-dialog')).toBeHidden()
  await insert.press('Space')
  await expect.poll(instanceCount).toBe(2)
  await card.focus()
  await card.press('Enter')
  await expect.poll(instanceCount).toBe(3)
  canvas.assertNoErrors()
})
