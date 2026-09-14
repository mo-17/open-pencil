import { expect, test } from '@playwright/test'

import type * as BackendDocumentModule from '@/app/lowcode/backend/document'

import { closeBackendPreviewIfOpen, openBackendLibrary } from '#tests/helpers/backend-library'
import { CanvasHelper } from '#tests/helpers/canvas'

test.beforeEach(async ({ page }) => {
  test.setTimeout(60_000)
  await page.route('http://127.0.0.1:7600/health', (route) =>
    route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
  )
  await page.goto('/')
  await new CanvasHelper(page).waitForInit()
})

for (const title of ['Single-merchant commerce', 'Multi-merchant commerce'] as const) {
  test(`installs ${title} with explicit simulation, commission and role boundaries`, async ({
    page
  }, info) => {
    const library = await openBackendLibrary(page)
    await library.getByRole('button', { name: title, exact: true }).click()
    const details = library.getByRole('region', { name: title, exact: true })
    await expect(details).toContainText('no money is collected')
    await expect(details).toContainText('not a bank transfer')
    await expect(details).toContainText('commerce-operator')
    await expect(details).toContainText('7 days after delivery')
    const commission = library.getByRole('spinbutton', {
      name: 'Commission (basis points)',
      exact: true
    })
    const apply = library.getByRole('button', { name: 'Use template', exact: true })
    await expect(commission).toHaveValue('0')
    for (const invalid of ['-1', '0.5', '10001', '']) {
      await commission.fill(invalid)
      await expect(apply).toBeDisabled()
      await expect(library).toContainText('Enter an integer commission')
    }
    await commission.fill('175')
    await expect(apply).toBeEnabled()
    await page.screenshot({ path: info.outputPath('operations-template-review.png') })
    await apply.click()
    await expect(library).toBeHidden()
    await closeBackendPreviewIfOpen(page)
    await expect(page.getByTestId('pages-panel').getByTestId('pages-item')).toHaveCount(13)
    const panel = page.getByTestId('lowcode-backend-editor')
    await panel.getByRole('button', { name: 'HTTP API & Login', exact: true }).click()
    for (const [resource, policy] of [
      ['orders', 'buyer-orders'],
      ['merchant-orders', 'merchant-orders'],
      ['operator-refunds', 'operator-refunds']
    ] as const) {
      const note = panel
        .getByRole('group', { name: resource, exact: true })
        .getByRole('note', { name: 'Resource read policies', exact: true })
      await expect(note).toContainText(policy)
    }
    const persisted = await page.evaluate(async () => {
      const documentURL = new URL('/src/app/lowcode/backend/document.ts', location.origin).href
      const { readBackendProviderDocumentRequest } = (await import(
        /* @vite-ignore */ documentURL
      )) as typeof BackendDocumentModule
      const editor = window.openPencil?.getStore?.()
      if (!editor) throw new Error('Missing editor')
      return readBackendProviderDocumentRequest(editor.graph)?.application.commerce
    })
    expect(persisted).toMatchObject({
      commissionBasisPoints: 175,
      mode: title.startsWith('Single') ? 'single-merchant' : 'multi-merchant'
    })
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    })
    await page.keyboard.press('Meta+z')
    await expect(page.getByTestId('pages-panel').getByTestId('pages-item')).toHaveCount(1)
    await page.keyboard.press('Meta+Shift+z')
    await expect(page.getByTestId('pages-panel').getByTestId('pages-item')).toHaveCount(13)
    const again = await openBackendLibrary(page)
    await again.getByRole('button', { name: 'Single-item checkout', exact: true }).click()
    await expect(again.getByRole('button', { name: 'Use template', exact: true })).toBeDisabled()
    await expect(again).toContainText('Your current backend and login flow are preserved.')
  })
}
