import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'
import {
  addNotesField,
  createNotes,
  changeNotesClient,
  managedCommands,
  mockDesktopPreview,
  type PreviewFixtureWindow
} from '#tests/helpers/nestjs-preview'

test.beforeEach(async ({ page }) => {
  await page.route('http://127.0.0.1:7600/health', (route) =>
    route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
  )
})

test('desktop explicitly connects a local Backend, updates frontend and disconnects on model drift', async ({
  page
}) => {
  test.setTimeout(60_000)
  await mockDesktopPreview(page)
  const canvas = new CanvasHelper(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'New design', exact: true }).click()
  await canvas.waitForInit()
  const loginPath = await createNotes(page)
  await page.getByTestId('lowcode-preview-local-backend-toggle').click()
  await page.getByTestId('backend-preview-external-mode').click()
  const settings = page.getByTestId('lowcode-preview-local-backend-settings')
  await expect(settings).toContainText('http://127.0.0.1:5181/_openpencil/auth/callback')
  await page.getByTestId('lowcode-preview-local-connect').click()
  await expect(page.getByTestId('lowcode-preview-local-status')).toContainText('Connected.')
  await expect(page.locator('iframe[aria-label="lowcode preview"]')).toHaveCount(0)
  const fixture = await page.evaluate(() => (window as PreviewFixtureWindow).__OP_NESTJS_PREVIEW__)
  const latest = fixture.spawns.at(-1)
  if (!latest) throw new Error('No local preview sidecar was launched')
  const connection = JSON.parse(latest.args[latest.args.indexOf('--local-backend') + 1])
  expect(connection).toEqual({
    previewPort: 5181,
    apiPort: 3000,
    apiBasePath: '/api',
    applicationId: expect.any(String),
    applicationDigest: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/)
  })
  await page.getByTestId('lowcode-preview-local-open').click()
  await expect
    .poll(() => page.evaluate(() => (window as PreviewFixtureWindow).__OP_NESTJS_PREVIEW__.opened))
    .toEqual([`http://127.0.0.1:5181${loginPath}`])
  await page.keyboard.press('Escape')
  const previousUpdates = fixture.updates.length
  await page.evaluate(() => {
    const editor = window.openPencil?.getStore?.()
    if (!editor) throw new Error('Missing editor')
    const label = [...editor.graph.getAllNodes()].find((node) => node.type === 'TEXT')
    if (!label) throw new Error('Missing notes label')
    editor.updateNodeWithUndo(label.id, { text: 'Live frontend edit' }, 'Update preview text')
  })
  await expect
    .poll(() =>
      page.evaluate(() => (window as PreviewFixtureWindow).__OP_NESTJS_PREVIEW__.updates.length)
    )
    .toBeGreaterThan(previousUpdates)
  await expect
    .poll(() =>
      page.evaluate(() => (window as PreviewFixtureWindow).__OP_NESTJS_PREVIEW__.updates.at(-1))
    )
    .toContain('Live frontend edit')
  await page.evaluate(async () => {
    const editor = window.openPencil?.getStore?.()
    if (!editor) throw new Error('Missing editor')
    const backendURL = new URL('/src/app/plugins/host/backend-provider.ts', window.location.origin)
      .href
    const { readAppBackendProviderDocumentRequest, appBackendProviderDocumentValue } = await import(
      /* @vite-ignore */ backendURL
    )
    const request = structuredClone(readAppBackendProviderDocumentRequest(editor.graph))
    const root = editor.graph.getNode(editor.graph.rootId)
    if (!request || !root) throw new Error('Missing document backend')
    request.application.applicationId += '-changed'
    editor.updateNodeWithUndo(root.id, {
      pluginData: root.pluginData.map((entry) =>
        entry.key === 'lowcode/backendProvider.v1'
          ? { ...entry, value: appBackendProviderDocumentValue(request) }
          : entry
      )
    })
  })
  await page.getByTestId('lowcode-preview-local-backend-toggle').click()
  await expect(page.getByTestId('lowcode-preview-local-status')).toContainText(
    'Synchronize your local backend, then reconnect.'
  )
  await expect
    .poll(() => page.evaluate(() => (window as PreviewFixtureWindow).__OP_NESTJS_PREVIEW__.killed))
    .toContain(latest.pid)
  await expect(page.getByTestId('lowcode-preview-local-browser')).toHaveCount(0)
  await expect(page.locator('iframe[aria-label="lowcode preview"]')).toHaveCount(0)
  canvas.assertNoErrors()
})

test('browser editor explains the desktop requirement without exposing a local connection', async ({
  page
}) => {
  test.setTimeout(60_000)
  const canvas = new CanvasHelper(page)
  await page.goto('/')
  await canvas.waitForInit()
  await createNotes(page)
  await expect(page.getByTestId('lowcode-preview-local-backend-toggle')).toHaveCount(0)
  await expect(page.getByTestId('lowcode-preview-desktop-required')).toContainText('desktop editor')
  canvas.assertNoErrors()
})

test('managed panel keeps one next action and requires each current SQL review', async ({
  page
}) => {
  test.setTimeout(60_000)
  await mockDesktopPreview(page)
  const canvas = new CanvasHelper(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'New design', exact: true }).click()
  await canvas.waitForInit()
  const loginPath = await createNotes(page)
  await page.getByTestId('lowcode-preview-local-backend-toggle').click()
  await page.getByTestId('backend-preview-managed-mode').click()
  const panel = page.getByTestId('lowcode-preview-local-backend-settings')
  const prepare = page.getByTestId('managed-backend-prepare')
  const start = page.getByTestId('managed-backend-start')
  const open = page.getByTestId('managed-backend-open')
  const review = page.getByTestId('managed-backend-review-dialog')
  await expect(prepare).toBeVisible()
  await expect(prepare).toBeDisabled()
  await expect(start).not.toBeVisible()
  await expect(open).not.toBeVisible()
  await expect(page.getByTestId('managed-backend-confirm')).not.toBeVisible()
  const audience = page.getByLabel('Server audience', { exact: true })
  if (await audience.isHidden())
    await page.locator('summary').filter({ hasText: 'Connection & sign-in' }).click()
  await page.getByRole('combobox', { name: 'Configuration preset' }).selectOption('oidc')
  await audience.fill('openpencil-notes-api')
  await page.getByLabel('HTTPS JWKS URL', { exact: true }).fill('https://issuer.example/jwks')
  await expect(prepare).toBeEnabled()
  await panel.screenshot({ path: test.info().outputPath('managed-configure.png') })
  await prepare.click()
  await expect(page.getByTestId('managed-backend-review-open')).toBeVisible()
  await expect(start).not.toBeVisible()
  await expect(open).not.toBeVisible()
  await expect(review).not.toBeVisible()
  expect(await managedCommands(page)).not.toContain('setup')
  expect(await managedCommands(page)).not.toContain('start')
  await page.getByTestId('managed-backend-review-open').click()
  await expect(review).toBeVisible()
  await expect(page.getByTestId('managed-backend-sql')).toContainText('CREATE TABLE preview_notes')
  await review.screenshot({ path: test.info().outputPath('managed-sql-review.png') })
  await page.getByTestId('managed-backend-confirm').click()
  await expect(review).not.toBeVisible()
  await expect(start).toBeEnabled()
  expect(await managedCommands(page)).toContain('setup')
  await expect(prepare).not.toBeVisible()
  await expect(page.getByLabel('Server audience', { exact: true })).not.toBeVisible()
  await panel.screenshot({ path: test.info().outputPath('managed-ready.png') })
  await start.click()
  await expect(open).toBeEnabled()
  await expect(start).not.toBeVisible()
  await expect(page.getByTestId('managed-backend-stop')).toBeEnabled()
  await expect(page.locator('iframe[aria-label="lowcode preview"]')).toHaveCount(0)
  await panel.screenshot({ path: test.info().outputPath('managed-running.png') })
  await open.click()
  await expect
    .poll(() => page.evaluate(() => (window as PreviewFixtureWindow).__OP_NESTJS_PREVIEW__.opened))
    .toEqual([`http://127.0.0.1:5181${loginPath}`])
  const first = await page.evaluate(() =>
    (window as PreviewFixtureWindow).__OP_NESTJS_PREVIEW__.managedCommands.find(
      (command) => command.command === 'prepare'
    )
  )
  expect(first).toMatchObject({ config: { previewPort: 5181, apiPort: 3012, dbPort: 55443 } })

  await addNotesField(page, 'summary')
  await expect(page.getByTestId('managed-backend-plan')).toContainText(
    'Backend changes need review'
  )
  await expect(open).not.toBeVisible()
  expect(await managedCommands(page)).not.toContain('apply')
  await page.getByTestId('managed-backend-review-open').click()
  await expect(page.getByTestId('managed-backend-sql')).toContainText('summary')
  await addNotesField(page, 'review_revision')
  await expect(review).not.toBeVisible()
  await expect(page.getByTestId('managed-backend-confirm')).not.toBeVisible()
  expect(await managedCommands(page)).not.toContain('apply')
  await page.getByTestId('managed-backend-review-open').click()
  await expect(page.getByTestId('managed-backend-sql')).toContainText('review_revision')
  await page.getByTestId('managed-backend-confirm').click()
  await expect(review).not.toBeVisible()
  await expect(open).toBeEnabled()
  expect(await managedCommands(page)).toContain('apply')
  await page.getByTestId('managed-backend-stop').click()
  await expect(page.getByTestId('managed-backend-message')).toContainText(
    'database data is retained'
  )
  await expect(open).not.toBeVisible()
  await expect(start).toBeEnabled()
  await changeNotesClient(page, 'notes-reconfigured-client')
  await expect(start).not.toBeVisible()
  await expect(page.getByLabel('HTTPS JWKS URL', { exact: true })).toBeVisible()
  await expect(page.getByLabel('HTTPS JWKS URL', { exact: true })).toHaveValue('')
  await expect(panel.locator('summary').filter({ hasText: 'Connection & sign-in' })).toContainText(
    'Setup required'
  )
  await expect(panel.getByText('notes-reconfigured-client', { exact: true })).toBeVisible()
  await expect(prepare).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(panel).not.toBeVisible()
  await expect(page.getByTestId('lowcode-preview-local-backend-toggle')).toBeFocused()
  await page.getByTestId('lowcode-preview-close').click()
  await expect.poll(() => managedCommands(page)).toContain('close')
  canvas.assertNoErrors()
})

test('managed configuration stays local and presets only fill empty fields after Apply', async ({
  page
}) => {
  test.setTimeout(60_000)
  await mockDesktopPreview(page)
  const canvas = new CanvasHelper(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'New design', exact: true }).click()
  await canvas.waitForInit()
  await createNotes(page)
  const documentBackend = () =>
    page.evaluate(() => {
      const editor = window.openPencil?.getStore?.()
      if (!editor) throw new Error('Missing editor')
      return editor.graph
        .getNode(editor.graph.rootId)
        ?.pluginData.find((entry) => entry.key === 'lowcode/backendProvider.v1')?.value
    })
  const originalBackend = await documentBackend()
  const trigger = page.getByTestId('lowcode-preview-local-backend-toggle')
  await trigger.click()
  await page.getByTestId('backend-preview-managed-mode').click()
  const panel = page.getByTestId('lowcode-preview-local-backend-settings')
  const audience = page.getByLabel('Server audience', { exact: true })
  const jwks = page.getByLabel('HTTPS JWKS URL', { exact: true })
  if (await audience.isHidden())
    await page.locator('summary').filter({ hasText: 'Connection & sign-in' }).click()
  await audience.fill('my-existing-api')
  await jwks.fill('https://my-existing-identity.example/jwks')
  await page.getByRole('button', { name: 'Close backend panel' }).click()
  await expect(panel).not.toBeVisible()
  await expect(trigger).toBeFocused()
  await trigger.click()
  await expect(audience).toHaveValue('my-existing-api')
  await expect(jwks).toHaveValue('https://my-existing-identity.example/jwks')
  await page.getByTestId('backend-preview-external-mode').click()
  await expect(page.getByTestId('lowcode-preview-local-connect')).toBeVisible()
  await page.getByTestId('backend-preview-managed-mode').click()
  await expect(audience).toHaveValue('my-existing-api')
  await expect(jwks).toHaveValue('https://my-existing-identity.example/jwks')
  const preset = page.getByRole('combobox', { name: 'Configuration preset' })
  await preset.selectOption('local-keycloak')
  await expect(audience).toHaveValue('my-existing-api')
  await expect(jwks).toHaveValue('https://my-existing-identity.example/jwks')
  await page.getByRole('button', { name: 'Apply preset', exact: true }).click()
  await expect(audience).toHaveValue('my-existing-api')
  await expect(jwks).toHaveValue('https://my-existing-identity.example/jwks')
  await jwks.fill('')
  await expect(jwks).toHaveValue('')
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await trigger.click()
  await expect(jwks).toHaveValue('')
  expect(await managedCommands(page)).toEqual([])
  await page.getByRole('button', { name: 'Apply preset', exact: true }).click()
  await expect(audience).toHaveValue('my-existing-api')
  await expect(jwks).toHaveValue(
    'https://127.0.0.1:18443/realms/openpencil/protocol/openid-connect/certs'
  )
  await expect(page.getByTestId('managed-backend-prepare')).toBeDisabled()
  const certificate = page.getByTestId('managed-backend-ca')
  if (await certificate.isHidden())
    await page.locator('summary').filter({ hasText: 'Advanced settings' }).click()
  await certificate.fill('/tmp/openpencil-test-ca.pem')
  await expect(page.getByTestId('managed-backend-prepare')).toBeEnabled()
  await page.getByRole('button', { name: 'Apply preset', exact: true }).click()
  await expect(
    panel.getByText('Preset applied. You can prepare the backend.', { exact: true })
  ).toBeVisible()
  await jwks.fill('')
  await expect(page.getByTestId('managed-backend-prepare')).toBeDisabled()
  await expect(
    panel.getByText('Preset applied. You can prepare the backend.', { exact: true })
  ).not.toBeVisible()
  await page.getByRole('button', { name: 'Apply preset', exact: true }).click()
  await expect(page.getByTestId('managed-backend-prepare')).toBeEnabled()
  expect(await managedCommands(page)).toEqual([])
  await expect(panel).toContainText('http://127.0.0.1:18080/realms/openpencil')
  await expect(panel).toContainText('notes-public-client')
  expect(await documentBackend()).toEqual(originalBackend)
  await panel.screenshot({ path: test.info().outputPath('managed-preset.png') })
  canvas.assertNoErrors()
})

test('a late native certificate choice cannot overwrite a reopened or switched panel', async ({
  page
}) => {
  test.setTimeout(60_000)
  await mockDesktopPreview(page)
  const canvas = new CanvasHelper(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'New design', exact: true }).click()
  await canvas.waitForInit()
  await createNotes(page)
  const trigger = page.getByTestId('lowcode-preview-local-backend-toggle')
  await trigger.click()
  await page.getByTestId('backend-preview-managed-mode').click()
  const certificate = page.getByTestId('managed-backend-ca')
  if (await certificate.isHidden())
    await page.locator('summary').filter({ hasText: 'Advanced settings' }).click()
  await certificate.fill('/tmp/original-preview-ca.pem')
  let dialogCount = 0
  for (const transition of ['close', 'switch']) {
    await page.getByRole('button', { name: 'Choose file', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Choose file', exact: true })).toBeDisabled()
    await expect
      .poll(() =>
        page.evaluate(() => (window as PreviewFixtureWindow).__OP_NESTJS_PREVIEW__.caDialogs)
      )
      .toBe(++dialogCount)
    if (transition === 'close') {
      await page.getByRole('button', { name: 'Close backend panel' }).click()
      await expect(trigger).toBeFocused()
      await trigger.click()
    } else {
      await page.getByTestId('backend-preview-external-mode').click()
      await expect(page.getByTestId('lowcode-preview-local-connect')).toBeVisible()
      await page.getByTestId('backend-preview-managed-mode').click()
    }
    await page.evaluate(async () => {
      ;(window as PreviewFixtureWindow).__OP_NESTJS_RESOLVE_CA__('/tmp/late-preview-ca.pem')
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve())
      })
    })
    await expect(certificate).toBeVisible()
    await expect(certificate).toHaveValue('/tmp/original-preview-ca.pem')
    await expect(page.getByRole('button', { name: 'Choose file', exact: true })).toBeEnabled()
  }
  expect(await managedCommands(page)).toEqual([])
  canvas.assertNoErrors()
})
