import { expect, test } from '#tests/e2e/fixtures'
import { closeBackendPreviewIfOpen, openBackendLibrary } from '#tests/helpers/backend-library'
import { CanvasHelper } from '#tests/helpers/canvas'

test('installs Video and creates the reviewed media template with atomic undo and redo', async ({
  page
}, info) => {
  test.setTimeout(90_000)
  await page.goto('/?test&navigation-benchmark')
  const canvas = new CanvasHelper(page)
  // Wait for the visible canvas paint, without reading or asserting the graph.
  const settle = () =>
    page.evaluate(async () => {
      const navigation = window.openPencil?.test?.navigation
      if (!navigation) throw new Error('Canvas settlement hook not initialized')
      await navigation.waitForSettlement()
    })
  await canvas.waitForInit()

  await page.getByTestId('app-settings-trigger').click()
  await page.getByTestId('settings-section-plugins').click()
  const views = page.getByTestId('settings-plugins-view')
  await views.getByText('Browse', { exact: true }).click()
  await page.getByTestId('plugin-discover-search').fill('Video')
  await page.getByTestId('plugin-install-open-pencil.video').click()
  await expect(page.getByTestId('plugin-installed-open-pencil.video')).toBeVisible()
  await views.getByText('Installed', { exact: true }).click()
  const enabled = page.getByTestId('plugin-enabled-open-pencil.video')
  await expect(enabled).not.toBeChecked()
  await enabled.click()
  await expect(enabled).toBeChecked()
  await page.getByTestId('app-settings-done').click()

  const title = 'Video library and live channels'
  const library = await openBackendLibrary(page)
  await library.getByRole('button', { name: title, exact: true }).click()
  const details = library.getByRole('region', { name: title, exact: true })
  await expect(details).toContainText('media-creator')
  await expect(details).toContainText('media-admin')
  await expect(details).toContainText('Install and enable Video')
  await expect(details).toContainText('public HTTPS video or HLS playback URLs')
  await expect(details).toContainText('Operators manage channel status')
  await expect(details).toContainText('Creation does not grant roles, start services')
  await expect(details).toContainText('PostgreSQL and OIDC')
  const pageTitles = [
    'Business sign in',
    'Account setup',
    'Video library',
    'Live channels',
    'My favorites',
    'Creator videos',
    'Creator channels'
  ]
  for (const pageTitle of pageTitles) await expect(details).toContainText(pageTitle)
  await page.screenshot({ path: info.outputPath('media-template-roles.png') })
  await details.getByText('Install and enable Video', { exact: false }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('media-template-requirements.png') })

  const apply = library.getByRole('button', { name: 'Use template', exact: true })
  await expect(apply).toBeEnabled()
  await apply.click()
  await expect(library).toBeHidden()
  await closeBackendPreviewIfOpen(page)
  const pages = page.getByTestId('pages-panel').getByTestId('pages-item')
  await expect(pages).toHaveCount(8)
  for (const pageTitle of pageTitles)
    await expect(pages.getByText(pageTitle, { exact: true })).toBeVisible()
  await settle()
  await page.screenshot({ path: info.outputPath('media-template-created.png') })

  await canvas.canvas.click({ position: { x: 10, y: 10 } })
  await canvas.undo()
  await expect(pages).toHaveCount(1)
  await canvas.redo()
  await expect(pages).toHaveCount(8)
  for (const pageTitle of pageTitles)
    await expect(pages.getByText(pageTitle, { exact: true })).toBeVisible()
  await settle()
  await page.screenshot({ path: info.outputPath('media-template-restored.png') })
  canvas.assertNoErrors()
})
