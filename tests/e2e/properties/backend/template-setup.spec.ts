import { expect, test } from '@playwright/test'

import { closeBackendPreviewIfOpen } from '#tests/helpers/backend-library'
import { CanvasHelper } from '#tests/helpers/canvas'

test('guides template creation and routes missing conditions to their existing editors', async ({
  page
}) => {
  test.setTimeout(45_000)
  await page.route('http://127.0.0.1:7600/health', (route) =>
    route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
  )
  await page.goto('/')
  await new CanvasHelper(page).waitForInit()
  const panel = page.getByTestId('lowcode-backend-editor')
  const pages = page.getByTestId('pages-panel').getByTestId('pages-item')
  const initialPages = await pages.count()
  await panel.getByRole('button', { name: 'Template setup', exact: true }).click()
  const setup = page.getByRole('dialog', { name: 'Template setup', exact: true })
  await setup
    .getByRole('combobox', { name: 'Templates', exact: true })
    .selectOption('personal-notes')
  await setup.getByRole('button', { name: 'Continue', exact: true }).click()
  await setup
    .getByRole('combobox', { name: 'Authentication profile', exact: true })
    .selectOption('oidc')
  const next = setup.getByRole('button', { name: 'Continue', exact: true })
  await expect(next).toBeDisabled()
  await setup
    .getByRole('textbox', { name: 'OIDC issuer', exact: true })
    .fill('https://identity.example.com')
  await setup.getByRole('textbox', { name: 'Client ID', exact: true }).fill('setup-public-client')
  await next.click()
  await expect(pages).toHaveCount(initialPages)
  await setup.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(setup.getByRole('textbox', { name: 'Client ID', exact: true })).toHaveValue(
    'setup-public-client'
  )
  await next.click()
  await setup.getByRole('button', { name: 'Create application', exact: true }).click()
  const readiness = setup.getByRole('region', { name: 'Application readiness', exact: true })
  await expect(readiness.locator('[data-condition="model"]')).toHaveAttribute(
    'data-state',
    'configured'
  )
  await expect(readiness.locator('[data-condition="runtime"]')).toHaveAttribute(
    'data-state',
    'unverified'
  )
  await expect(pages).toHaveCount(initialPages + 2)
  await readiness.getByRole('button', { name: 'Edit sign-in configuration', exact: true }).click()
  await expect(setup).toBeHidden()
  await closeBackendPreviewIfOpen(page)
  const clientId = panel.getByLabel('Public client ID', { exact: true })
  await expect(clientId).toHaveValue('setup-public-client')
  await clientId.fill('edited-public-client')
  await clientId.blur()
  await panel.getByRole('button', { name: 'Template setup', exact: true }).click()
  await expect(readiness.locator('[data-condition="model"]')).toHaveAttribute(
    'data-state',
    'missing'
  )
  await readiness.getByRole('button', { name: 'Edit and save Backend model', exact: true }).click()
  await expect(setup).toBeHidden()
  await expect(panel.getByTestId('lowcode-backend-save')).toBeEnabled()
})
