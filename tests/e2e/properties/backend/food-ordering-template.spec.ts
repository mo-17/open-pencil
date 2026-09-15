import { expect, test } from '#tests/e2e/fixtures'
import { closeBackendPreviewIfOpen, openBackendLibrary } from '#tests/helpers/backend-library'
import { CanvasHelper } from '#tests/helpers/canvas'

test('creates the restaurant ordering template and restores all eight pages with undo and redo', async ({
  page
}, info) => {
  test.setTimeout(90_000)
  await page.goto('/?test&navigation-benchmark')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  const settle = () =>
    page.evaluate(async () => {
      const navigation = window.openPencil?.test?.navigation
      if (!navigation) throw new Error('Canvas settlement hook not initialized')
      await navigation.waitForSettlement()
    })
  const library = await openBackendLibrary(page)
  const title = 'Restaurant ordering'
  await library.getByRole('button', { name: title, exact: true }).click()
  const details = library.getByRole('region', { name: title, exact: true })
  await expect(details).toContainText('food-manager')
  await expect(details).toContainText('PostgreSQL and OIDC')
  await expect(details).toContainText('Creation does not grant roles, start services')
  const titles = [
    'Business sign in',
    'Account setup',
    'Order food',
    'My food cart',
    'Confirm food order',
    'My food orders',
    'Kitchen orders',
    'Manage menu'
  ]
  for (const pageTitle of titles) await expect(details).toContainText(pageTitle)
  await page.screenshot({ path: info.outputPath('food-template-requirements.png') })
  await library.getByRole('button', { name: 'Use template', exact: true }).click()
  await expect(library).toBeHidden()
  await closeBackendPreviewIfOpen(page)
  const pages = page.getByTestId('pages-panel').getByTestId('pages-item')
  await expect(pages).toHaveCount(9)
  for (const pageTitle of titles)
    await expect(pages.getByText(pageTitle, { exact: true })).toBeVisible()
  await settle()
  await page.screenshot({ path: info.outputPath('food-template-created.png') })
  await canvas.canvas.click({ position: { x: 10, y: 10 } })
  await canvas.undo()
  await expect(pages).toHaveCount(1)
  await canvas.redo()
  await expect(pages).toHaveCount(9)
  for (const pageTitle of titles)
    await expect(pages.getByText(pageTitle, { exact: true })).toBeVisible()
  await settle()
  await page.screenshot({ path: info.outputPath('food-template-restored.png') })
  canvas.assertNoErrors()
})
