import { expect, test } from '@playwright/test'

import { closeBackendPreviewIfOpen, useBackendTemplate } from '#tests/helpers/backend-library'
import { CanvasHelper } from '#tests/helpers/canvas'

test('creates and reviews the checkout example, then edits its declared command binding', async ({
  page
}, testInfo) => {
  test.setTimeout(30_000)
  await page.route('http://127.0.0.1:7600/health', (route) =>
    route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
  )
  await page.goto('/')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  const backend = page.getByTestId('lowcode-backend-editor')
  await useBackendTemplate(page, 'Single-item checkout')
  await closeBackendPreviewIfOpen(page)
  await expect(
    page
      .getByTestId('pages-row')
      .filter({ has: page.getByTestId('pages-item').filter({ hasText: 'Products' }) })
  ).toHaveAttribute('data-active', 'true')
  await canvas.waitForRender()
  await page.screenshot({ path: testInfo.outputPath('checkout-created.png') })
  const pages = page.getByTestId('pages-panel')
  for (const name of ['Products', 'My orders', 'Shop sign in', 'Catalog manager'])
    await expect(pages.getByTestId('pages-item').filter({ hasText: name })).toBeVisible()
  await backend.getByRole('button', { name: 'Atomic commands', exact: true }).click()
  const review = backend.getByTestId('backend-commands-editor')
  await expect(review.getByRole('heading', { name: 'Place an order', exact: true })).toBeVisible()
  await expect(review).toContainText('POST /commands/checkout')
  await expect(review).toContainText('quantity · integer · 1–99')
  await expect(review).toContainText('products, orders')
  await review.locator('summary').first().click()
  await expect(review).toContainText('caller-sub')
  await review.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('checkout-command-review.png') })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Meta+z')
  await expect(pages.getByTestId('pages-item')).toHaveCount(1)
  await expect(pages.getByTestId('pages-item').first()).toContainText('Page 1')
  await page.keyboard.press('Meta+Shift+z')
  await expect(pages.getByTestId('pages-item')).toHaveCount(5)
  await page.evaluate(async () => {
    const editor = window.openPencil?.getStore?.()
    if (!editor) throw new Error('Missing editor')
    const shop = editor.graph.getPages().find((value) => value.lowcodeRoutePattern === '/shop')
    const button = [...editor.graph.getAllNodes()].find(
      (value) => value.type === 'BUTTON' && value.name === 'Place order'
    )
    if (!editor || !shop || !button) throw new Error('Missing checkout example')
    await editor.switchPage(shop.id)
    editor.select([button.id])
  })
  const command = page.getByTestId('backend-command-action-editor').filter({
    has: page.getByRole('checkbox', { name: 'Allow recovery after refresh', exact: true })
  })
  await expect(
    command.getByRole('checkbox', { name: 'Allow recovery after refresh', exact: true })
  ).toBeChecked()
  await expect(command.getByRole('combobox', { name: 'Backend command', exact: true })).toHaveValue(
    'checkout'
  )
  await expect(command.getByLabel('skuId · Value expression', { exact: true })).toHaveValue(
    'selectedSku'
  )
  await expect(command.getByLabel('quantity · Value expression', { exact: true })).toHaveValue(
    'orderQuantity'
  )
  await expect(
    command.getByRole('combobox', { name: 'Attempt key state', exact: true })
  ).toHaveValue('checkoutAttempt')
  await command.getByLabel('quantity · Value expression', { exact: true }).fill('2')
  await command.getByLabel('quantity · Value expression', { exact: true }).blur()
  await expect(command).not.toContainText('must')
  await command.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('checkout-command-editor.png') })
  await page.evaluate(() => {
    const editor = window.openPencil?.getStore?.()
    const button =
      editor &&
      [...editor.graph.getAllNodes()].find(
        (value) => value.type === 'BUTTON' && value.name === 'View saved attempt'
      )
    if (!editor || !button) throw new Error('Missing recovery button')
    editor.select([button.id])
  })
  const recovery = page.getByTestId('backend-command-action-editor')
  await expect(
    recovery.getByRole('combobox', { name: 'Recovery operation', exact: true })
  ).toHaveValue('inspect')
  await expect(recovery.getByLabel('Saved attempt key expression', { exact: true })).toHaveCount(0)
  await recovery
    .getByRole('combobox', { name: 'Recovery operation', exact: true })
    .selectOption('retry')
  await recovery
    .getByLabel('Saved attempt key expression', { exact: true })
    .fill('checkoutRecovery.key')
  await recovery.getByLabel('Saved attempt key expression', { exact: true }).blur()
  await recovery
    .getByRole('combobox', { name: 'Result state', exact: true })
    .selectOption('checkoutResult')
  await expect(recovery.getByLabel('Saved attempt key expression', { exact: true })).toHaveValue(
    'checkoutRecovery.key'
  )
  await recovery.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('checkout-recovery-editor.png') })
  canvas.assertNoErrors()
})
