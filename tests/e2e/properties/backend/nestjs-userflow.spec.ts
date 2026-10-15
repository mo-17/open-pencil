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
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

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
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

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
      page.evaluate(() => {
        if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
        return window.openPencil
          ?.getStore?.()
          .graph.getPages()
          .map((entry) => entry.id)
      })
    )
    .toEqual(initial.pages)
  await canvas.redo()
  await expect
    .poll(() =>
      page.evaluate(() => {
        if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
        return window.openPencil?.getStore?.().graph.getPages().length
      })
    )
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
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const editor = window.openPencil?.getStore?.()
    if (!editor) throw new Error('Editor unavailable')
    const notes = editor.graph.getPages().find((entry) => entry.lowcodeRoutePattern === '/notes')
    const nodes = [...editor.graph.getAllNodes()]
    const list = nodes.find((node) => node.type === 'LIST')
    const remove = nodes.find((node) => node.type === 'BUTTON' && node.name === 'Delete')
    if (!notes || !list || !remove) throw new Error('Authored notes controls unavailable')
    await editor.switchPage(notes.id)
    editor.select([list.id])
    const clickActions = structuredClone(remove.events?.onClick ?? [])
    const guard = clickActions[0]
    if (guard?.kind !== 'condition') throw new Error('Missing protected delete condition')
    const confirmation = guard.consequent.find((action) => action.kind === 'confirm')
    if (!confirmation) throw new Error('Missing protected delete confirmation')
    const requests = confirmation.consequent.filter((action) => action.kind === 'backendRequest')
    const request = requests[0]
    if (requests.length !== 1 || !request) throw new Error('Missing unique delete request')
    return {
      listId: list.id,
      deleteId: remove.id,
      deleteActionId: request.id,
      clickActions
    }
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

  await page.evaluate((id) => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
    return window.openPencil?.getStore?.().select([id])
  }, bindingNodes.deleteId)
  const eventsPanel = page.getByTestId('lowcode-events-section')
  await eventsPanel.scrollIntoViewIfNeeded()
  const deleteFields = eventsPanel
    .getByTestId('lowcode-action-kind')
    .and(
      eventsPanel.locator(
        `[data-lowcode-action-id="${bindingNodes.deleteActionId}"] > div > select`
      )
    )
    .locator('..')
  await expect(
    deleteFields.getByRole('combobox', { name: 'Action kind', exact: true })
  ).toHaveValue('backendRequest')
  await deleteFields
    .getByRole('combobox', { name: 'Backend resource', exact: true })
    .selectOption('notes')
  await deleteFields.getByRole('combobox', { name: 'Operation', exact: true }).selectOption('read')
  await deleteFields.getByLabel('Record ID expression', { exact: true }).fill('item.id')
  await deleteFields.getByLabel('Record ID expression', { exact: true }).blur()
  await deleteFields
    .getByRole('combobox', { name: 'Operation', exact: true })
    .selectOption('delete')
  await deleteFields.getByLabel('Record ID expression', { exact: true }).fill('item.id')
  await deleteFields.getByLabel('Record ID expression', { exact: true }).blur()
  await deleteFields
    .getByRole('combobox', { name: 'Error document state', exact: true })
    .selectOption('notesError')

  await page.evaluate((id) => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
    return window.openPencil?.getStore?.().select([id])
  }, bindingNodes.listId)
  await expect(source).toHaveValue('backend:notes')
  await expect(listPanel.getByLabel('Maximum page size', { exact: true })).toHaveValue('7')
  await page.evaluate((id) => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
    return window.openPencil?.getStore?.().select([id])
  }, bindingNodes.deleteId)
  await expect(deleteFields.getByRole('combobox', { name: 'Operation', exact: true })).toHaveValue(
    'delete'
  )
  await expect(deleteFields.getByLabel('Record ID expression', { exact: true })).toHaveValue(
    'item.id'
  )
  const bound = await page.evaluate((ids) => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const graph = window.openPencil.getStore().graph
    const actions = structuredClone(graph.getNode(ids.deleteId)?.events?.onClick ?? [])
    const guard = actions[0]
    const originalGuard = ids.clickActions[0]
    if (guard?.kind !== 'condition' || originalGuard?.kind !== 'condition')
      throw new Error('Missing protected delete condition')
    const confirmation = guard.consequent.find((action) => action.kind === 'confirm')
    const originalConfirmation = originalGuard.consequent.find(
      (action) => action.kind === 'confirm'
    )
    if (!confirmation || !originalConfirmation)
      throw new Error('Missing protected delete confirmation')
    const requests = confirmation.consequent.filter((action) => action.kind === 'backendRequest')
    const request = requests[0]
    if (requests.length !== 1 || !request || request.id !== ids.deleteActionId)
      throw new Error('Request action identity changed')
    const originalRequest = originalConfirmation.consequent.find(
      (action) => action.kind === 'backendRequest' && action.id === request.id
    )
    if (!originalRequest) throw new Error('Original delete request unavailable')
    const authoredRequest = structuredClone(request)
    confirmation.consequent = confirmation.consequent.map((action) =>
      action.id === request.id ? originalRequest : action
    )
    return {
      source: graph.getNode(ids.listId)?.interactiveProps?.dataSourceRef,
      action: authoredRequest,
      protectedActions: actions
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
  expect(bound.protectedActions).toEqual(bindingNodes.clickActions)
  expect(bound.action).toMatchObject({
    kind: 'backendRequest',
    resourceId: 'notes',
    operation: 'delete',
    idExpr: 'item.id',
    errorTarget: 'notesError'
  })
})
