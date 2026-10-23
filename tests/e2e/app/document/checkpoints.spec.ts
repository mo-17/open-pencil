import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'
import { getPageChildren } from '#tests/helpers/store'

const editor = useEditorSetup('/?test')

test('named checkpoints compare and restore in a new tab while preserving current work', async () => {
  const { page, canvas } = editor
  await canvas.drawRect(100, 100, 120, 80)
  const original = (await getPageChildren(page)).map((node) => ({
    type: node.type,
    width: node.width,
    height: node.height
  }))

  await page.getByRole('button', { name: 'Local checkpoints', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Local checkpoints', exact: true })
  await dialog.getByLabel('Checkpoint name', { exact: true }).fill('One rectangle')
  await dialog.getByRole('button', { name: 'Create checkpoint', exact: true }).click()
  await expect(dialog.getByRole('list', { name: 'Local checkpoints' })).toContainText(
    'One rectangle'
  )
  await dialog.getByRole('button', { name: 'Close', exact: true }).last().click()

  await canvas.drawEllipse(280, 100, 100, 100)
  const edited = await getPageChildren(page)
  expect(edited).toHaveLength(2)
  await page.getByRole('button', { name: 'Local checkpoints', exact: true }).click()
  await dialog.getByRole('button', { name: 'Compare with current document', exact: true }).click()
  await expect(dialog.locator('[data-change-kind="added"]')).toHaveCount(1)
  await page.screenshot({ path: test.info().outputPath('checkpoint-comparison.png') })
  await dialog.getByRole('button', { name: 'Open checkpoint as new document', exact: true }).click()
  await expect(page.getByTestId('tabbar-tab')).toHaveCount(2)
  await expect
    .poll(async () =>
      (await getPageChildren(page)).map((node) => ({
        type: node.type,
        width: node.width,
        height: node.height
      }))
    )
    .toEqual(original)
  await expect(page.getByTestId('tabbar-tab').last().getByRole('progressbar')).toBeHidden()
  await expect(page.getByTestId('document-file-status')).toHaveAttribute('data-phase', 'idle')

  await page.getByTestId('tabbar-tab').first().click()
  await expect.poll(() => getPageChildren(page)).toEqual(edited)
  await page.getByRole('button', { name: 'Local checkpoints', exact: true }).click()
  await expect(
    dialog.getByRole('list', { name: 'Local checkpoints' }).getByRole('listitem')
  ).toHaveCount(2)
})
