import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'

const editor = useEditorSetupWithClear()

test('button text color is editable without replacing the button label', async () => {
  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const page = store.graph.getNode(store.state.currentPageId)
    if (!page) throw new Error('Current page not found')
    const button = store.graph.createNode('BUTTON', page.id, {
      name: 'Text color button',
      x: 120,
      y: 120,
      width: 180,
      height: 48,
      interactiveProps: { text: 'Keep this label' }
    })
    store.select([button.id])
    store.requestRender()
  })
  await editor.canvas.waitForRender()

  const panel = editor.page.getByTestId('lowcode-interactive-props')
  await panel.scrollIntoViewIfNeeded()
  await expect(panel).toBeVisible()
  const colorField = editor.page.getByTestId('lowcode-interactive-textColor')
  await expect(colorField).toBeVisible()
  const hexInput = colorField.getByTestId('color-hex-input')
  await expect(hexInput).toHaveValue('111827')
  await hexInput.fill('F9FAFB')
  await hexInput.press('Tab')
  await editor.canvas.waitForRender()

  const interactiveProps = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const id = [...store.state.selectedIds][0]
    return id ? store.graph.getNode(id)?.interactiveProps : undefined
  })
  expect(interactiveProps).toMatchObject({ text: 'Keep this label', textColor: '#F9FAFB' })
  editor.canvas.assertNoErrors()
})
