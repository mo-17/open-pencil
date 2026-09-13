import { expect, test } from '@playwright/test'

import { closeBackendPreviewIfOpen, useBackendTemplate } from '#tests/helpers/backend-library'
import { CanvasHelper } from '#tests/helpers/canvas'

test('authors NestJS public access and declared queries, then binds LIST and request controls', async ({
  page
}, testInfo) => {
  test.setTimeout(30_000)
  await page.route('http://127.0.0.1:7600/health', (route) =>
    route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
  )
  await page.goto('/')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  const panel = page.getByTestId('lowcode-backend-editor')
  await useBackendTemplate(page, 'Personal notes', {
    issuer: 'https://identity.example.com',
    clientId: 'catalog-public-client'
  })
  await closeBackendPreviewIfOpen(page)
  await panel.getByRole('button', { name: 'Data model', exact: true }).click()
  await expect(panel.getByRole('button', { name: '+ Enum', exact: true })).toBeVisible()
  await panel.getByRole('button', { name: '+ Enum', exact: true }).click()
  await panel.getByLabel('Enum name', { exact: true }).fill('catalog_status')
  await panel.getByTestId('lowcode-backend-add-field').click()
  const price = panel.getByTestId('lowcode-backend-field').last()
  await price.getByLabel('Field name', { exact: true }).fill('price')
  const type = price.getByLabel('Field type', { exact: true })
  for (const value of ['date', 'datetime', 'enum'])
    await expect(type.getByRole('option', { name: value, exact: true })).toBeEnabled()
  await type.selectOption('integer')

  await panel.getByRole('button', { name: 'HTTP API & Login', exact: true }).click()
  const query = panel.getByRole('group', { name: 'List query options', exact: true })
  await query
    .getByRole('group', { name: 'Exact filters', exact: true })
    .getByLabel('title', { exact: true })
    .check()
  await query
    .getByRole('group', { name: 'Text search', exact: true })
    .getByLabel('title', { exact: true })
    .check()
  const sorting = query.getByRole('group', { name: 'Sorting', exact: true })
  await expect(sorting.getByLabel('title', { exact: true })).toBeDisabled()
  await sorting.getByLabel('price', { exact: true }).check()

  await panel.getByRole('button', { name: 'Owner, tenant & RLS', exact: true }).click()
  const security = panel.getByTestId('lowcode-backend-security')
  await security.getByRole('button', { name: '+ Role', exact: true }).click()
  await security.getByLabel('Role name', { exact: true }).fill('catalog_manager')
  await expect(security.getByTestId('lowcode-backend-role')).toContainText('Role ID:')
  await expect(security.getByRole('button', { name: '+ Tenant', exact: true })).toHaveCount(0)
  await security.getByRole('button', { name: '+ RLS intent', exact: true }).click()
  const publicRule = security.getByTestId('lowcode-backend-rls-intent').last()
  await publicRule.getByLabel('Principal', { exact: true }).selectOption('anonymous')
  await expect(publicRule.getByLabel('select', { exact: true })).toBeChecked()
  for (const operation of ['insert', 'update', 'delete']) {
    await expect(publicRule.getByLabel(operation, { exact: true })).not.toBeChecked()
    await expect(publicRule.getByLabel(operation, { exact: true })).toBeDisabled()
  }
  await expect(security).toContainText('Published-only conditions are not supported')
  await panel.getByTestId('lowcode-backend-save').click()
  const ids = await page.evaluate(async () => {
    const editor = window.openPencil?.getStore?.()
    if (!editor) throw new Error('Missing editor')
    const list = [...editor.graph.getAllNodes()].find((node) => node.type === 'LIST')
    const button = [...editor.graph.getAllNodes()].find(
      (node) => node.type === 'BUTTON' && node.name === 'Delete'
    )
    const notes = editor.graph.getPages().find((node) => node.lowcodeRoutePattern === '/notes')
    if (!list || !button || !notes) throw new Error('Missing generated controls')
    await editor.switchPage(notes.id)
    editor.select([list.id])
    return { listId: list.id, buttonId: button.id }
  })
  const listPanel = page.getByTestId('lowcode-list-section')
  await listPanel.getByLabel('title · Filter value expression', { exact: true }).fill('"Tea"')
  await listPanel.getByLabel('title · Filter value expression', { exact: true }).blur()
  await listPanel.getByLabel('Search expression', { exact: true }).fill('"Tea"')
  await listPanel.getByLabel('Search expression', { exact: true }).blur()
  await listPanel.getByRole('combobox', { name: 'Sort field', exact: true }).selectOption('field')
  await listPanel
    .getByRole('combobox', { name: 'Sort direction', exact: true })
    .selectOption('desc')
  await page.evaluate((id) => window.openPencil?.getStore?.().select([id]), ids.buttonId)
  const events = page.getByTestId('lowcode-events-section')
  await events.getByRole('combobox', { name: 'Operation', exact: true }).selectOption('list')
  await events.getByLabel('title · Filter value expression', { exact: true }).fill('"Coffee"')
  await events.getByLabel('title · Filter value expression', { exact: true }).blur()
  await events.getByLabel('Search expression', { exact: true }).fill('"Coffee"')
  await events.getByLabel('Search expression', { exact: true }).blur()
  await events.getByRole('combobox', { name: 'Sort field', exact: true }).selectOption('field')
  await events.getByRole('combobox', { name: 'Sort direction', exact: true }).selectOption('asc')
  await page.evaluate((id) => window.openPencil?.getStore?.().select([id]), ids.listId)
  await expect(listPanel.getByLabel('Search expression', { exact: true })).toHaveValue('"Tea"')
  await expect(
    listPanel.getByRole('combobox', { name: 'Sort direction', exact: true })
  ).toHaveValue('desc')
  const authored = await page.evaluate((controls) => {
    const graph = window.openPencil?.getStore?.().graph
    return {
      list: graph?.getNode(controls.listId)?.interactiveProps?.dataSourceRef,
      action: graph?.getNode(controls.buttonId)?.events?.onClick?.[0]
    }
  }, ids)
  expect(authored.list).toMatchObject({
    filterEntries: [{ key: 'title', valueExpr: '"Tea"' }],
    searchExpr: '"Tea"',
    sortField: 'field',
    sortDirection: 'desc'
  })
  expect(authored.action).toMatchObject({
    kind: 'backendRequest',
    operation: 'list',
    filterEntries: [{ key: 'title', valueExpr: '"Coffee"' }],
    searchExpr: '"Coffee"',
    sortField: 'field',
    sortDirection: 'asc'
  })
  await listPanel
    .getByRole('group', { name: 'List query bindings', exact: true })
    .scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('query-list-bindings.png') })
  await listPanel.getByRole('button', { name: 'Clear query bindings', exact: true }).click()
  await expect(listPanel.getByLabel('Search expression', { exact: true })).toHaveValue('')
  await expect(listPanel.getByRole('combobox', { name: 'Sort field', exact: true })).toHaveValue('')
  canvas.assertNoErrors()
})
