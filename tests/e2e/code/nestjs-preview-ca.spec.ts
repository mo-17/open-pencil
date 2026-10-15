import { expect, test, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'
import {
  createNotes,
  managedCommands,
  mockDesktopPreview,
  readPreviewFixtureState,
  resolvePreviewCA
} from '#tests/helpers/nestjs-preview'

async function installPreview(page: Page) {
  await page.route('http://127.0.0.1:7600/health', (route) =>
    route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
  )
  await mockDesktopPreview(page)
}

async function openCertificateSettings(page: Page, canvas: CanvasHelper, appURL = '/') {
  await page.goto(appURL)
  await page.getByRole('button', { name: 'New design', exact: true }).click()
  await canvas.waitForInit()
  await createNotes(page)
  await page.getByTestId('lowcode-preview-local-backend-toggle').click()
  await page.getByTestId('backend-preview-managed-mode').click()
  await page.getByRole('button', { name: 'Apply preset', exact: true }).click()
  await expect(page.getByTestId('managed-backend-ca')).toBeVisible()
}

test('CA paths survive panel and app reopening, stay local to the computer, and can be forgotten', async ({
  page,
  browser
}) => {
  test.setTimeout(120_000)
  await installPreview(page)
  const canvas = new CanvasHelper(page)
  await openCertificateSettings(page, canvas)
  const certificate = page.getByTestId('managed-backend-ca')
  const trigger = page.getByTestId('lowcode-preview-local-backend-toggle')
  const panel = page.getByTestId('lowcode-preview-local-backend-settings')
  await expect(certificate).toHaveValue('')
  await certificate.fill('/tmp/typed-local-ca.pem')
  await page.getByRole('button', { name: 'Close backend panel' }).click()
  await expect(panel).not.toBeVisible()
  await trigger.click()
  await expect(certificate).toHaveValue('/tmp/typed-local-ca.pem')

  await page.getByRole('button', { name: 'Choose file', exact: true }).click()
  await expect.poll(() => readPreviewFixtureState(page).then((state) => state.caDialogs)).toBe(1)
  await resolvePreviewCA(page, '/tmp/chosen-local-ca.pem')
  await expect(certificate).toHaveValue('/tmp/chosen-local-ca.pem')
  await expect(panel).toContainText('remembered only on this computer')
  expect(await managedCommands(page)).toEqual([])

  await page.reload()
  await openCertificateSettings(page, canvas)
  await expect(certificate).toHaveValue('/tmp/chosen-local-ca.pem')

  const otherComputer = await browser.newContext()
  try {
    const otherPage = await otherComputer.newPage()
    await installPreview(otherPage)
    const otherCanvas = new CanvasHelper(otherPage)
    await openCertificateSettings(otherPage, otherCanvas, new URL(page.url()).origin)
    await expect(otherPage.getByTestId('managed-backend-ca')).toHaveValue('')
    await expect(otherPage.getByTestId('managed-backend-prepare')).toBeDisabled()
    await expect(certificate).toHaveValue('/tmp/chosen-local-ca.pem')
    otherCanvas.assertNoErrors()
  } finally {
    await otherComputer.close()
  }

  await certificate.fill('')
  await page.reload()
  await openCertificateSettings(page, canvas)
  await expect(certificate).toHaveValue('')
  await expect(page.getByTestId('managed-backend-prepare')).toBeDisabled()
  expect(await managedCommands(page)).toEqual([])
  canvas.assertNoErrors()
})

test('environment results explain a moved CA, redact the report and support rechecking without setup', async ({
  page
}) => {
  test.setTimeout(90_000)
  await installPreview(page)
  const canvas = new CanvasHelper(page)
  await openCertificateSettings(page, canvas)
  const certificate = page.getByTestId('managed-backend-ca')
  await certificate.fill('/tmp/private-moved-ca.pem')
  const diagnostics = page.getByTestId('managed-backend-diagnostics')
  await diagnostics.getByRole('button', { name: 'Check environment', exact: true }).click()
  await expect(diagnostics).toContainText('File or command missing')
  await expect(diagnostics).toContainText('Certificate verification failed')
  await expect(diagnostics).toContainText('ca-file:missing')
  await expect(diagnostics).not.toContainText('/tmp/private-moved-ca.pem')
  await expect.poll(() => managedCommands(page)).toEqual(['diagnose', 'close'])
  await certificate.fill('/tmp/reselected-ca.pem')
  await expect(diagnostics).not.toContainText('ca-file:missing')
  await diagnostics.getByRole('button', { name: 'Check environment', exact: true }).click()
  await expect(diagnostics).toContainText('ca-file:passed')
  await expect(diagnostics).toContainText('database:unavailable')
  await expect(diagnostics.getByRole('button', { name: 'Check again', exact: true })).toBeEnabled()
  expect(await managedCommands(page)).toEqual(['diagnose', 'close', 'diagnose', 'close'])
  expect(await managedCommands(page)).not.toContain('setup')
  expect(await managedCommands(page)).not.toContain('apply')
  canvas.assertNoErrors()
})
