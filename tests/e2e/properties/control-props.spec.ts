import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'

const editor = useEditorSetupWithClear('/?test')

test('native input options commit through controlled fields and undo without editing another selection', async () => {
  const ids = await editor.page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('Missing editor')
    const first = store.createShape('INPUT', 120, 120, 220, 40)
    const second = store.createShape('INPUT', 120, 200, 220, 40)
    store.select([first])
    return { first, second }
  })
  const panel = editor.page.getByTestId('lowcode-interactive-props')
  await expect(panel).toBeVisible()
  await panel.getByRole('combobox', { name: 'Input type', exact: true }).click()
  await editor.page.getByRole('option', { name: 'number', exact: true }).click()
  const name = panel.getByRole('textbox', { name: 'Accessible name', exact: true })
  await name.fill('Quantity')
  await name.press('Tab')
  await panel.getByRole('checkbox', { name: 'Read only', exact: true }).check()
  expect(
    await editor.page.evaluate((id) => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
      return window.openPencil?.getStore?.().graph.getNode(id)?.interactiveProps
    }, ids.first)
  ).toMatchObject({ inputType: 'number', ariaLabel: 'Quantity', readOnly: true })
  await editor.page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
    return window.openPencil?.getStore?.().undo.undo()
  })
  await expect(panel.getByRole('checkbox', { name: 'Read only', exact: true })).not.toBeChecked()
  await name.fill('Uncommitted draft')
  await editor.page.evaluate((id) => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
    return window.openPencil?.getStore?.().select([id])
  }, ids.second)
  await expect(panel.getByRole('textbox', { name: 'Accessible name', exact: true })).toHaveValue('')
  expect(
    await editor.page.evaluate((id) => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
      return window.openPencil?.getStore?.().graph.getNode(id)?.interactiveProps?.ariaLabel
    }, ids.second)
  ).toBeUndefined()
  await editor.canvas.click(500, 500)
  editor.canvas.assertNoErrors()
})

test('static select edits labels and values independently while preserving legacy entries', async () => {
  const id = await editor.page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('Missing editor')
    const id = store.createShape('SELECT', 120, 120, 220, 40)
    store.graph.updateNode(id, {
      interactiveProps: { options: ['Legacy', { label: 'Express delivery', value: 'express' }] }
    })
    store.select([id])
    return id
  })
  const options = editor.page.locator('[data-property="lowcode-select-option"]')
  await expect(options).toHaveCount(2)
  await expect(options.nth(0).getByRole('textbox', { name: 'Display label' })).toHaveValue('Legacy')
  const label = options.nth(1).getByRole('textbox', { name: 'Display label' })
  await label.fill('Priority delivery')
  await label.press('Tab')
  await options.nth(1).getByRole('checkbox', { name: 'Disabled 2', exact: true }).check()
  expect(
    await editor.page.evaluate((id) => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
      return window.openPencil?.getStore?.().graph.getNode(id)?.interactiveProps?.options
    }, id)
  ).toEqual([
    { label: 'Legacy', value: 'Legacy' },
    { label: 'Priority delivery', value: 'express', disabled: true }
  ])
  editor.canvas.assertNoErrors()
})
