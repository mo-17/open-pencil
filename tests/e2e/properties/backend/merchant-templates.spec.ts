import { expect, test } from '@playwright/test'

import {
  closeBackendPreviewIfOpen,
  openBackendLibrary,
  useBackendTemplate
} from '#tests/helpers/backend-library'
import { CanvasHelper } from '#tests/helpers/canvas'

test.beforeEach(async ({ page }) => {
  test.setTimeout(45_000)
  await page.route('http://127.0.0.1:7600/health', (route) =>
    route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
  )
  await page.goto('/')
  await new CanvasHelper(page).waitForInit()
})

for (const [title, pageCount, role] of [
  ['Single-merchant shop', 5, 'catalog-manager'],
  ['Multi-merchant marketplace', 7, 'merchant']
] as const) {
  test(`reviews and installs ${title} with its pages, roles and resource boundaries`, async ({
    page
  }, info) => {
    const library = await openBackendLibrary(page)
    await library.getByRole('button', { name: title, exact: true }).click()
    const details = library.getByRole('region', { name: title, exact: true })
    await expect(
      details.getByRole('heading', { name: 'Application mode', exact: true })
    ).toBeVisible()
    await expect(
      details.getByRole('heading', { name: 'Roles and access', exact: true })
    ).toBeVisible()
    await expect(details).toContainText('No payments, multi-item cart, shipping')
    await expect(details).toContainText('openpencil_roles')
    if (role === 'merchant') {
      await expect(details).toContainText('One account owns one store.')
      await expect(details).toContainText('stores.owner_id and stores.id')
    } else await expect(details).toContainText('does not isolate stores')
    await page.screenshot({ path: info.outputPath('merchant-template-details.png') })
    await page.keyboard.press('Escape')
    await useBackendTemplate(page, title, {
      issuer: 'https://identity.example.com',
      clientId: 'merchant-public-client'
    })
    await closeBackendPreviewIfOpen(page)
    const pages = page.getByTestId('pages-panel').getByTestId('pages-item')
    await expect(pages).toHaveCount(pageCount + 1)
    const panel = page.getByTestId('lowcode-backend-editor')
    await panel.getByRole('button', { name: 'HTTP API & Login', exact: true }).click()
    await expect(panel.getByLabel('Public client ID', { exact: true })).toHaveValue(
      'merchant-public-client'
    )
    const buyerOrders = panel.getByRole('group', { name: 'orders', exact: true })
    const merchantOrders = panel.getByRole('group', { name: 'merchant-orders', exact: true })
    await expect(
      buyerOrders.getByRole('note', { name: 'Resource read policies', exact: true })
    ).toContainText('own-orders')
    await expect(
      merchantOrders.getByRole('note', { name: 'Resource read policies', exact: true })
    ).toContainText(role === 'merchant' ? 'merchant-orders' : 'manage-orders')
    // A normal query edit must not drop the independently selected read policy subset.
    await buyerOrders
      .getByRole('group', { name: 'Exact filters', exact: true })
      .getByLabel('status', { exact: true })
      .uncheck()
    await panel.getByRole('button', { name: 'Owner, tenant & RLS', exact: true }).click()
    const security = panel.getByTestId('lowcode-backend-security')
    await expect(security.getByTestId('lowcode-backend-role')).toContainText(role)
    const tenants = security.getByTestId('lowcode-backend-tenant-rule')
    await expect(tenants).toHaveCount(role === 'merchant' ? 2 : 0)
    if (role === 'merchant') {
      for (const tenant of await tenants.all()) {
        await expect(tenant.getByTestId('lowcode-backend-membership-identity-field')).toHaveValue(
          'owner_id'
        )
        await expect(tenant.getByTestId('lowcode-backend-membership-tenant-field')).toHaveValue(
          'id'
        )
      }
      const memberRules = security.getByTestId('lowcode-backend-rls-intent').filter({
        has: page.getByLabel('Required role in addition to membership', { exact: true })
      })
      await expect(memberRules).toHaveCount(2)
      const first = memberRules.first()
      const reference = first.getByLabel('Access rule reference', { exact: true })
      await reference.selectOption(await reference.inputValue())
      await expect(
        first.getByLabel('Required role in addition to membership', { exact: true })
      ).toHaveValue('merchant')
    }
    await panel.getByTestId('lowcode-backend-save').click()
    await expect(
      panel.getByText('Backend model saved with undo history.', { exact: true })
    ).toBeVisible()
    await panel.getByRole('button', { name: 'HTTP API & Login', exact: true }).click()
    await expect(
      buyerOrders.getByRole('note', { name: 'Resource read policies', exact: true })
    ).toContainText('own-orders')
    await expect(
      buyerOrders
        .getByRole('group', { name: 'Exact filters', exact: true })
        .getByLabel('status', { exact: true })
    ).not.toBeChecked()
    await expect(
      merchantOrders.getByRole('note', { name: 'Resource read policies', exact: true })
    ).toContainText(role === 'merchant' ? 'merchant-orders' : 'manage-orders')
    await merchantOrders
      .getByRole('note', { name: 'Resource read policies', exact: true })
      .scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath('merchant-resource-policies.png') })
    const again = await openBackendLibrary(page)
    await again.getByRole('button', { name: 'Single-item checkout', exact: true }).click()
    await expect(again.getByRole('button', { name: 'Use template', exact: true })).toBeDisabled()
    await expect(again).toContainText('Your current backend and login flow are preserved.')
  })
}
