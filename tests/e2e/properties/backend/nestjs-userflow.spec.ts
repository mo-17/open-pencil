import { expect, test } from '@playwright/test'

import { closeBackendPreviewIfOpen, useBackendTemplate } from '#tests/helpers/backend-library'
import { CanvasHelper } from '#tests/helpers/canvas'

test('authors NestJS login and notes pages through the Backend panel with undo and redo', async ({
  page
}) => {
  test.setTimeout(30_000)
  await page.route('http://127.0.0.1:7600/health', (route) =>
    route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
  )
  await page.goto('/')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  const initial = await page.evaluate(() => {
    const editor = window.openPencil?.getStore?.()
    if (!editor) throw new Error('Editor unavailable')
    return {
      pages: editor.graph.getPages().map((entry) => entry.id),
      pluginData: editor.graph.getNode(editor.graph.rootId)?.pluginData
    }
  })
  const panel = page.getByTestId('lowcode-backend-editor')
  await useBackendTemplate(page, 'Personal notes', {
    issuer: 'https://identity.example.com',
    clientId: 'notes-public-client'
  })
  await closeBackendPreviewIfOpen(page)
  const authored = await page.evaluate(() => {
    const editor = window.openPencil?.getStore?.()
    if (!editor) throw new Error('Editor unavailable')
    const root = editor.graph.getNode(editor.graph.rootId)
    return {
      pages: editor.graph.getPages().map((entry) => ({
        id: entry.id,
        route: entry.lowcodeRoutePattern,
        guarded: entry.lowcodeRequiresAuth
      })),
      pluginData: root?.pluginData,
      lists: [...editor.graph.getAllNodes()]
        .filter((node) => node.type === 'LIST')
        .map((node) => node.interactiveProps),
      actions: [...editor.graph.getAllNodes()].flatMap((node) =>
        Object.values(node.events ?? {}).flat()
      )
    }
  })
  expect(authored.pages).toHaveLength(initial.pages.length + 2)
  expect(authored.pages).toContainEqual(expect.objectContaining({ route: '/notes', guarded: true }))
  expect(authored.pages).toContainEqual(expect.objectContaining({ route: '/login' }))
  expect(authored.lists[0]).toMatchObject({
    dataSourceRef: { kind: 'backendResource', resourceId: 'notes' }
  })
  expect(authored.actions).toContainEqual(
    expect.objectContaining({ kind: 'backendAuth', operation: 'signIn', returnPath: '/notes' })
  )
  const declaration = authored.pluginData?.find(
    (entry) => entry.pluginId === 'open-pencil' && entry.key === 'lowcode/backendProvider.v1'
  )
  expect(JSON.parse(declaration?.value ?? '{}')).toMatchObject({
    application: {
      httpApi: {
        browserClient: {
          authentication: {
            issuer: 'https://identity.example.com',
            clientId: 'notes-public-client'
          }
        }
      }
    }
  })
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await canvas.undo()
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.openPencil
          ?.getStore?.()
          .graph.getPages()
          .map((entry) => entry.id)
      )
    )
    .toEqual(initial.pages)
  await canvas.redo()
  await expect
    .poll(() => page.evaluate(() => window.openPencil?.getStore?.().graph.getPages().length))
    .toBe(initial.pages.length + 2)

  await panel.getByRole('button', { name: 'Data model', exact: true }).click()
  const fields = panel.getByTestId('lowcode-backend-field')
  await expect(fields).toHaveCount(4)
  const fieldNames = await fields
    .getByRole('textbox', { name: 'Field name', exact: true })
    .evaluateAll((elements) => elements.map((element) => (element as HTMLInputElement).value))
  const primaryKeyIndex = fieldNames.indexOf('id')
  const ownerIndex = fieldNames.indexOf('owner_id')
  const contentIndex = fieldNames.indexOf('content')
  expect(primaryKeyIndex).toBeGreaterThanOrEqual(0)
  expect(ownerIndex).toBeGreaterThanOrEqual(0)
  expect(contentIndex).toBeGreaterThanOrEqual(0)
  for (const protectedIndex of [primaryKeyIndex, ownerIndex]) {
    await expect(
      fields.nth(protectedIndex).getByRole('combobox', { name: 'Field type', exact: true })
    ).toBeDisabled()
  }
  await fields.nth(contentIndex).getByLabel('Field name', { exact: true }).fill('body_text')
  await fields.nth(contentIndex).getByLabel('Field name', { exact: true }).blur()
  await panel.getByTestId('lowcode-backend-save').click()

  const bindingNodes = await page.evaluate(async () => {
    const editor = window.openPencil?.getStore?.()
    if (!editor) throw new Error('Editor unavailable')
    const notes = editor.graph.getPages().find((entry) => entry.lowcodeRoutePattern === '/notes')
    const nodes = [...editor.graph.getAllNodes()]
    const list = nodes.find((node) => node.type === 'LIST')
    const remove = nodes.find((node) => node.type === 'BUTTON' && node.name === 'Delete')
    if (!notes || !list || !remove) throw new Error('Authored notes controls unavailable')
    await editor.switchPage(notes.id)
    editor.select([list.id])
    return { listId: list.id, deleteId: remove.id }
  })
  const listPanel = page.getByTestId('lowcode-list-section')
  await listPanel.scrollIntoViewIfNeeded()
  const source = listPanel.getByTestId('lowcode-list-datasource')
  await source.selectOption('')
  await source.selectOption('backend:notes')
  await listPanel.getByLabel('Maximum page size', { exact: true }).fill('7')
  await listPanel.getByLabel('Maximum page size', { exact: true }).blur()
  await listPanel
    .getByLabel('Page cursor expression (optional)', { exact: true })
    .fill('notesAfter')
  await listPanel.getByLabel('Page cursor expression (optional)', { exact: true }).blur()
  await listPanel
    .getByRole('combobox', { name: 'Next cursor document state', exact: true })
    .selectOption('notesCursor')
  await listPanel
    .getByRole('combobox', { name: 'Error document state', exact: true })
    .selectOption('notesError')

  await page.evaluate((id) => window.openPencil?.getStore?.().select([id]), bindingNodes.deleteId)
  const eventsPanel = page.getByTestId('lowcode-events-section')
  await eventsPanel.scrollIntoViewIfNeeded()
  await eventsPanel
    .getByRole('combobox', { name: 'Action kind', exact: true })
    .selectOption('backendRequest')
  await eventsPanel
    .getByRole('combobox', { name: 'Backend resource', exact: true })
    .selectOption('notes')
  await eventsPanel.getByRole('combobox', { name: 'Operation', exact: true }).selectOption('read')
  await eventsPanel.getByLabel('Record ID expression', { exact: true }).fill('item.id')
  await eventsPanel.getByLabel('Record ID expression', { exact: true }).blur()
  await eventsPanel.getByRole('combobox', { name: 'Operation', exact: true }).selectOption('delete')
  await eventsPanel.getByLabel('Record ID expression', { exact: true }).fill('item.id')
  await eventsPanel.getByLabel('Record ID expression', { exact: true }).blur()
  await eventsPanel
    .getByRole('combobox', { name: 'Error document state', exact: true })
    .selectOption('notesError')

  await page.evaluate((id) => window.openPencil?.getStore?.().select([id]), bindingNodes.listId)
  await expect(source).toHaveValue('backend:notes')
  await expect(listPanel.getByLabel('Maximum page size', { exact: true })).toHaveValue('7')
  await page.evaluate((id) => window.openPencil?.getStore?.().select([id]), bindingNodes.deleteId)
  await expect(eventsPanel.getByRole('combobox', { name: 'Operation', exact: true })).toHaveValue(
    'delete'
  )
  await expect(eventsPanel.getByLabel('Record ID expression', { exact: true })).toHaveValue(
    'item.id'
  )
  const bound = await page.evaluate((ids) => {
    const graph = window.openPencil?.getStore?.().graph
    return {
      source: graph?.getNode(ids.listId)?.interactiveProps?.dataSourceRef,
      action: graph?.getNode(ids.deleteId)?.events?.onClick?.[0]
    }
  }, bindingNodes)
  expect(bound.source).toEqual({
    kind: 'backendResource',
    resourceId: 'notes',
    limit: 7,
    afterExpr: 'notesAfter',
    nextCursorTarget: 'notesCursor',
    errorTarget: 'notesError'
  })
  expect(bound.action).toMatchObject({
    kind: 'backendRequest',
    resourceId: 'notes',
    operation: 'delete',
    idExpr: 'item.id',
    errorTarget: 'notesError'
  })
})
