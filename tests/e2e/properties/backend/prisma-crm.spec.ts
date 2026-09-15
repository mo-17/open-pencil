import { expect, test } from '@playwright/test'

import {
  closeBackendPreviewIfOpen,
  openAdvancedProviderSettings,
  useBackendTemplate
} from '#tests/helpers/backend-library'
import { CanvasHelper } from '#tests/helpers/canvas'

const PLUGIN_ID = 'open-pencil.nestjs-prisma-crm-backend'
const PROVIDER_LABEL = 'NestJS + Prisma 8 CRM (Experimental) · ' + PLUGIN_ID

test('opts into Prisma CRM, restores the saved provider and rejects editor preview', async ({
  page
}, info) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1800, height: 1000 })
  // The isolated editor has no identity service or user MCP service dependency.
  await page.route('http://127.0.0.1:7600/health', (route) =>
    route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
  )
  await page.route('https://identity.example.com/**', (route) => route.abort('blockedbyclient'))
  await page.goto('/?test')
  await new CanvasHelper(page).waitForInit()
  await closeBackendPreviewIfOpen(page)

  await page.getByTestId('app-settings-trigger').click()
  await page.getByTestId('settings-section-plugins').click()
  await page.getByTestId('settings-plugins-view').getByText('Browse', { exact: true }).click()
  const catalog = page.getByTestId(`plugin-catalog-${PLUGIN_ID}`)
  await page.getByTestId('plugin-discover-search').fill('Prisma')
  await expect(catalog).toContainText('Experimental')
  await page.getByTestId(`plugin-install-${PLUGIN_ID}`).click()
  const enabled = page.getByTestId(`plugin-enabled-${PLUGIN_ID}`)
  await expect(enabled).not.toBeChecked()
  await enabled.click()
  await expect(enabled).toBeChecked()
  await page.getByTestId('app-settings-done').click()

  await useBackendTemplate(page, 'Customer CRM', {
    issuer: 'https://identity.example.com',
    clientId: 'crm-public-client'
  })
  await closeBackendPreviewIfOpen(page)
  const panel = page.getByTestId('lowcode-backend-editor')
  const selection = await openAdvancedProviderSettings(page)
  await expect(selection.locator('option:checked')).toHaveText(
    'nestjs · open-pencil.nestjs-backend'
  )
  await selection.selectOption({ label: PROVIDER_LABEL })
  const hint = panel.getByTestId('lowcode-backend-prisma-crm-hint')
  await expect(hint).toContainText('Experimental CRM source export')
  await expect(hint).toContainText('editor preview are unsupported')
  await expect(panel.getByRole('button', { name: 'HTTP API & Login', exact: true })).toBeVisible()
  const save = panel.getByTestId('lowcode-backend-save')
  await expect(save).toBeEnabled()
  await save.click()
  await expect(save).toBeDisabled()

  // Selecting a layer unmounts the document services editor; Escape opens a fresh editor instance.
  await page.getByTestId('layers-item').first().click()
  await expect(panel).toBeHidden()
  await page.keyboard.press('Escape')
  await expect(panel).toBeVisible()
  const restored = await openAdvancedProviderSettings(page)
  await expect(restored.locator('option:checked')).toHaveText(PROVIDER_LABEL)
  await expect(hint).toBeVisible()
  await expect(save).toBeDisabled()
  await page.screenshot({ path: info.outputPath('prisma-crm-restored.png') })

  await page.getByTestId('lowcode-preview-open').click()
  const preview = page.getByTestId('lowcode-preview-pane')
  await expect(preview).toHaveAttribute('data-preview-status', /^(error|unsupported)$/, {
    timeout: 30_000
  })
  await page.getByTestId('lowcode-preview-diagnostics-toggle').click()
  await expect(page.getByTestId('lowcode-preview-diagnostics')).toContainText(
    'backend-preview-server-capability-unavailable'
  )
  await expect(page.locator('iframe[aria-label="lowcode preview"]')).toHaveCount(0)
  await expect(page.getByTestId('lowcode-preview-local-status')).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('prisma-crm-preview-unsupported.png') })
})
