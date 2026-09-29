import { expect, test, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

async function openTemplates(page: Page) {
  await page.getByTestId('left-panel-assets-tab').click()
  const panel = page.getByTestId('assets-panel')
  await panel.getByRole('combobox', { name: 'Asset source', exact: true }).click()
  await page.getByRole('option', { name: 'Component templates', exact: true }).click()
  return panel
}

test('finds both template kinds, retains favorites and inserts an independently undoable copy', async ({
  page
}) => {
  // This lifecycle scenario initializes the cold editor twice.
  test.setTimeout(30_000)
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  let panel = await openTemplates(page)
  await expect(panel.getByText('Editable local examples.', { exact: false })).toBeVisible()
  await panel.getByRole('combobox', { name: 'Template kind' }).click()
  await page.getByRole('option', { name: 'Basic components', exact: true }).click()
  await expect(panel.locator('[data-component-template]')).toHaveCount(54)
  await panel.getByRole('combobox', { name: 'Template kind' }).click()
  await page.getByRole('option', { name: 'Common combinations', exact: true }).click()
  await expect(panel.locator('[data-component-template]')).toHaveCount(8)
  await panel.getByRole('searchbox').fill('settings-card')
  let card = panel.locator('[data-component-template="settings-card"]')
  await expect(panel.locator('[data-component-template]')).toHaveCount(1)
  await card.getByRole('button', { name: 'Add to favorites', exact: true }).click()
  await page.reload()
  await canvas.waitForInit()
  panel = await openTemplates(page)
  await panel.getByRole('button', { name: 'Favorites only', exact: true }).click()
  card = panel.locator('[data-component-template="settings-card"]')
  await expect(panel.locator('[data-component-template]')).toHaveCount(1)
  await expect(card.getByRole('button', { name: 'Remove from favorites' })).toBeVisible()
  const before = await page.evaluate(() => window.openPencil.getStore().graph.nodes.size)
  const insert = card.getByRole('button', { name: 'Insert template', exact: true })
  await insert.focus()
  await insert.press('Enter')
  await expect(panel.getByRole('status')).toContainText('Inserted and selected')
  const first = await page.evaluate(() => {
    const editor = window.openPencil.getStore()
    return { id: [...editor.state.selectedIds][0], count: editor.graph.nodes.size }
  })
  expect(first.count).toBeGreaterThan(before)
  await canvas.undo()
  expect(await page.evaluate(() => window.openPencil.getStore().graph.nodes.size)).toBe(before)
  await canvas.redo()
  expect(await page.evaluate(() => window.openPencil.getStore().graph.nodes.size)).toBe(first.count)
  await insert.click()
  const second = await page.evaluate(() => [...window.openPencil.getStore().state.selectedIds][0])
  expect(second).not.toBe(first.id)
  await canvas.undo()
  expect(
    await page.evaluate((id) => window.openPencil.getStore().graph.getNode(id)?.id, first.id)
  ).toBe(first.id)
  canvas.assertNoErrors()
})

test('a favorited template cannot insert a disabled plugin module and offers plugin recovery', async ({
  page
}) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await page.evaluate(async () => {
    const { appPluginStore, appPluginStoreReady } = await import('/src/app/plugins/index.ts')
    const initialized = await appPluginStoreReady
    if (initialized.error) throw initialized.error
    if (
      !appPluginStore
        .snapshot()
        .installed.some((entry) => entry.package.manifest.plugin.id === 'open-pencil.upload-button')
    )
      await appPluginStore.install('open-pencil.upload-button')
    await appPluginStore.setEnabled('open-pencil.upload-button', true)
  })
  const panel = await openTemplates(page)
  await panel.getByRole('searchbox').fill('upload')
  const card = panel.locator('[data-component-template="upload"]')
  await expect(card.getByRole('button', { name: 'Insert template', exact: true })).toBeEnabled()
  await card.getByRole('button', { name: 'Add to favorites', exact: true }).click()
  await page.evaluate(async () => {
    const { appPluginStore, appPluginStoreReady } = await import('/src/app/plugins/index.ts')
    await appPluginStoreReady
    await appPluginStore.setEnabled('open-pencil.upload-button', false)
  })
  await panel.getByRole('button', { name: 'Favorites only', exact: true }).click()
  await expect(card.getByRole('button', { name: 'Insert template', exact: true })).toBeDisabled()
  await expect(card.getByRole('alert')).toContainText('upload-button')
  await page.screenshot({ path: test.info().outputPath('template-unavailable.png') })
  await card.getByRole('button', { name: 'Manage plugins', exact: true }).click()
  await expect(page.getByTestId('app-settings-dialog')).toBeVisible()
  canvas.assertNoErrors()
})

test('shows Chinese guidance, template filters and meaningful no-result recovery', async ({
  page
}) => {
  // This lifecycle scenario initializes the cold editor twice.
  test.setTimeout(30_000)
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await page.evaluate(async () => {
    const cache = await import(new URL('/src/app/cache/index.ts', window.location.origin).href)
    cache.writeLocalStorageText('open-pencil-locale', 'zh-CN')
  })
  await page.reload()
  await canvas.waitForInit()
  await page.getByTestId('left-panel-assets-tab').click()
  const panel = page.getByTestId('assets-panel')
  await panel.getByRole('combobox', { name: '资源来源', exact: true }).click()
  await page.getByRole('option', { name: '组件模板', exact: true }).click()
  await expect(panel.getByText('可编辑的本地示例，尚未连接后端、账号或文件上传。')).toBeVisible()
  await panel.getByRole('combobox', { name: '模板类型' }).click()
  await page.getByRole('option', { name: '基础组件', exact: true }).click()
  await expect(panel.locator('[data-component-template]')).toHaveCount(54)
  await panel.getByRole('searchbox').fill('textarea')
  const card = panel.locator('[data-component-template="textarea"]')
  await expect(card.getByRole('button', { name: '插入模板', exact: true })).toBeVisible()
  await card.getByText('行为与限制', { exact: true }).click()
  await expect(card.locator('details')).toHaveAttribute('open', '')
  await page.screenshot({ path: test.info().outputPath('component-templates-zh.png') })
  await panel.getByRole('searchbox').fill('no such template')
  await expect(panel.getByTestId('assets-empty')).toBeVisible()
  await panel.getByRole('button', { name: '清除筛选', exact: true }).click()
  await expect(panel.locator('[data-component-template]')).toHaveCount(62)
  canvas.assertNoErrors()
})

test('rejects a locked insertion target without partial changes and allows retry on the page', async ({
  page
}) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  const panel = await openTemplates(page)
  await panel.getByRole('searchbox').fill('button')
  const card = panel.locator('[data-component-template="button"]')
  const before = await page.evaluate(() => {
    const editor = window.openPencil.getStore()
    const locked = editor.graph.createNode('FRAME', editor.state.currentPageId, {
      name: 'Locked destination',
      locked: true,
      width: 320,
      height: 240
    })
    editor.state.enteredContainerId = locked.id
    editor.requestRender()
    return editor.graph.nodes.size
  })
  await card.getByRole('button', { name: 'Insert template', exact: true }).click()
  await expect(
    panel.getByRole('alert').filter({ hasText: 'Choose an unlocked page or frame' })
  ).toBeVisible()
  expect(await page.evaluate(() => window.openPencil.getStore().graph.nodes.size)).toBe(before)
  await page.evaluate(() => {
    window.openPencil.getStore().state.enteredContainerId = null
  })
  await card.getByRole('button', { name: 'Insert template', exact: true }).click()
  await expect(panel.getByRole('status')).toContainText('Inserted and selected')
  expect(await page.evaluate(() => window.openPencil.getStore().graph.nodes.size)).toBeGreaterThan(
    before
  )
  canvas.assertNoErrors()
})
