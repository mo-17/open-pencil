import { expect, type Locator, type Page } from '@playwright/test'

export async function openBackendLibrary(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Browse backend library', exact: true }).click()
  const library = page.getByRole('dialog', { name: 'Backend library', exact: true })
  await expect(library).toBeVisible()
  return library
}

export async function openAdvancedProviderSettings(page: Page): Promise<Locator> {
  const panel = page.getByTestId('lowcode-backend-editor')
  const summary = panel.locator('summary').filter({ hasText: 'Advanced provider settings' })
  const details = summary.locator('..')
  if (!(await details.evaluate((element) => element.hasAttribute('open')))) await summary.click()
  return panel.getByTestId('lowcode-backend-provider')
}

export async function useBackendTemplate(
  page: Page,
  title: 'Personal notes' | 'Single-item checkout',
  authentication: { issuer: string; clientId: string } | 'local-keycloak' = 'local-keycloak'
): Promise<void> {
  const library = await openBackendLibrary(page)
  await library.getByRole('button', { name: title, exact: true }).click()
  const profile = library.getByRole('combobox', { name: 'Authentication profile', exact: true })
  if (authentication === 'local-keycloak') {
    await profile.selectOption({ label: 'Local Keycloak' })
  } else {
    await profile.selectOption({ label: 'Custom OIDC' })
    await library
      .getByRole('textbox', { name: 'OIDC issuer', exact: true })
      .fill(authentication.issuer)
    await library
      .getByRole('textbox', { name: 'Client ID', exact: true })
      .fill(authentication.clientId)
  }
  const apply = library.getByRole('button', { name: 'Use template', exact: true })
  await expect(apply).toBeEnabled()
  await apply.click()
  await expect(library).toBeHidden()
}

export async function closeBackendPreviewIfOpen(page: Page): Promise<void> {
  const close = page.getByTestId('lowcode-preview-close')
  if (await close.isVisible()) await close.click()
}
