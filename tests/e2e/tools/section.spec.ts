import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'

const editor = useEditorSetupWithClear('/?test')

test('draw section in full editor without browser errors', async () => {
  await editor.canvas.drawSection(100, 100, 240, 160)

  await expect(
    editor.page
      .getByRole('tabpanel', { name: 'Design', exact: true })
      .getByRole('button', { name: 'Layer type', exact: true })
  ).toBeVisible()
  await expect
    .poll(async () => {
      return editor.page.evaluate(() => {
        if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

        const store = window.openPencil?.getStore?.()
        if (!store) throw new Error('OpenPencil store not initialized')
        const selectedId = [...store.state.selectedIds][0]
        return selectedId ? store.graph.getNode(selectedId)?.type : null
      })
    })
    .toBe('SECTION')

  editor.canvas.assertNoErrors()
})
