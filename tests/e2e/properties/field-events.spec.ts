import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'

const editor = useEditorSetupWithClear('/?test')

async function createFields() {
  const ids = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('Editor unavailable')
    store.graph.updateNode(store.state.currentPageId, {
      state: [{ id: 'output', name: 'output', type: 'string', defaultValue: '' }]
    })
    const field = store.graph.createNode('INPUT', store.state.currentPageId, {
      name: 'Editable events',
      x: 80,
      y: 80,
      width: 240,
      height: 44,
      events: {
        onFocus: [{ id: 'focus', kind: 'setState', targetStateId: 'output', valueExpr: '"focus"' }],
        onBlur: [{ id: 'blur', kind: 'setState', targetStateId: 'output', valueExpr: '"blur"' }]
      }
    })
    const second = store.graph.createNode('SELECT', store.state.currentPageId, {
      name: 'Independent field',
      x: 80,
      y: 160,
      width: 240,
      height: 44,
      interactiveProps: { options: ['First', 'Second'] }
    })
    store.select([field.id])
    return { field: field.id, second: second.id }
  })
  await editor.canvas.waitForRender()
  return ids
}

async function selectEvent(name: string) {
  await editor.page.getByRole('combobox', { name: 'Event', exact: true }).click()
  await editor.page.getByRole('option', { name, exact: true }).click()
}

test('fields expose independent change/focus/blur actions and preserve undo', async () => {
  const ids = await createFields()
  const section = editor.page.getByTestId('lowcode-events-section')
  await expect(section).toBeVisible()
  await expect(section.getByTestId('lowcode-action-expr')).toHaveValue('"focus"')
  await selectEvent('On change')
  await expect(section.getByTestId('lowcode-action-row')).toHaveCount(0)
  await section.getByTestId('lowcode-action-add').click()
  await section.getByTestId('lowcode-action-expr').fill('$value')
  await section.getByTestId('lowcode-action-expr').press('Tab')
  await expect
    .poll(() =>
      editor.page.evaluate((id) => {
        const action = window.openPencil?.getStore?.().graph.getNode(id)?.events?.onChange?.[0]
        return action?.kind === 'setState' ? action.valueExpr : null
      }, ids.field)
    )
    .toBe('$value')
  await selectEvent('On blur')
  await expect(section.getByTestId('lowcode-action-expr')).toHaveValue('"blur"')
  await section.getByTestId('lowcode-action-expr').fill('"Edited blur"')
  await section.getByTestId('lowcode-action-expr').press('Tab')
  await expect(editor.page.getByRole('combobox', { name: 'Event', exact: true })).toHaveText(
    'On blur'
  )
  await expect(section.getByTestId('lowcode-action-expr')).toHaveValue('"Edited blur"')
  await editor.page.evaluate(() => window.openPencil?.getStore?.().undo.undo())
  await expect(section.getByTestId('lowcode-action-expr')).toHaveValue('"blur"')
  await selectEvent('On focus')
  await expect(section.getByTestId('lowcode-action-expr')).toHaveValue('"focus"')
  await editor.page.evaluate(() => window.openPencil?.getStore?.().undo.undo())
  await selectEvent('On change')
  await expect(section.getByTestId('lowcode-action-expr')).not.toHaveValue('$value')
  await editor.page.evaluate(() => window.openPencil?.getStore?.().undo.redo())
  await expect(section.getByTestId('lowcode-action-expr')).toHaveValue('$value')
  await editor.page.screenshot({ path: test.info().outputPath('field-events.png') })
  editor.canvas.assertNoErrors()
})

test('action navigation selects its event and late field drafts do not mutate another selection', async () => {
  const ids = await createFields()
  await selectEvent('On blur')
  await editor.page.evaluate(async (id) => {
    const { requestLowcodeActionFocus } = await import(
      new URL('/src/app/lowcode/action/focus.ts', window.location.origin).href
    )
    const graph = window.openPencil?.getStore?.().graph
    if (!graph) throw new Error('Editor unavailable')
    requestLowcodeActionFocus(graph, { nodeId: id, actionId: 'focus', actionPath: 'onFocus[0]' })
  }, ids.field)
  await expect(editor.page.locator('[data-lowcode-action-path="onFocus[0]"]')).toBeFocused()
  const expression = editor.page
    .getByTestId('lowcode-events-section')
    .getByTestId('lowcode-action-expr')
  await expression.fill('"uncommitted"')
  await editor.page.evaluate((id) => window.openPencil?.getStore?.().select([id]), ids.second)
  await expect(editor.page.getByRole('combobox', { name: 'Event', exact: true })).toHaveText(
    'On change'
  )
  await expect(
    editor.page.getByTestId('lowcode-events-section').getByTestId('lowcode-action-row')
  ).toHaveCount(0)
  expect(
    await editor.page.evaluate(
      (id) => window.openPencil?.getStore?.().graph.getNode(id)?.events,
      ids.second
    )
  ).toBeUndefined()
  editor.canvas.assertNoErrors()
})
