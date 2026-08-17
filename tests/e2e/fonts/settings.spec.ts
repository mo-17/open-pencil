import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

test('font settings popover exposes web font access without desktop-only cache actions', async ({
  page
}) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      let url: string
      if (typeof input === 'string') url = input
      else if (input instanceof URL) url = input.href
      else url = input.url
      if (url !== 'https://api.fontsource.org/v1/fonts') return originalFetch(input, init)
      const response = new Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
      Object.defineProperty(response, 'url', { configurable: true, value: url })
      return response
    }
  })
  await page.goto('/')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()

  await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const id = store.createShape('TEXT', 120, 120, 240, 40)
    store.updateNode(id, {
      characters: 'Font settings smoke',
      fontFamily: 'Missing Test Sans'
    })
    store.select([id])
  })

  const typography = page.getByRole('region', { name: 'Typography' })
  await expect(typography).toBeVisible()
  await expect(
    typography.getByRole('button', { name: 'Reload missing font: Missing Test Sans' })
  ).toBeVisible()
  const fontBanner = page.getByTestId('font-status-banner')
  await expect(fontBanner).toContainText('1 font face is unavailable or substituted')
  await fontBanner.getByTestId('font-status-retry').click()
  await expect(fontBanner.getByTestId('font-status-retry')).toBeEnabled()
  await page.getByTestId('font-status-toggle').click()
  await expect(page.getByTestId('font-status-issue')).toContainText(
    'Missing Test Sans Regular → Inter'
  )
  await page.getByTestId('font-status-select').click()
  await expect(page.getByTestId('font-status-banner')).toBeVisible()
  const selected = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    return store ? [...store.state.selectedIds] : []
  })
  expect(selected).toHaveLength(1)
  const fontSettings = page.getByRole('button', { name: 'Font settings' })
  await expect(fontSettings).toHaveAttribute('data-test-id', 'font-settings-trigger')
  await fontSettings.hover()
  await expect(page.locator('[role=tooltip]').filter({ hasText: 'Font settings' })).toBeVisible()
  await fontSettings.click()
  await expect(page.locator('[role=tooltip]').filter({ hasText: 'Font settings' })).toHaveCount(0)

  await expect(page.getByText('Allow browser access to local fonts')).toBeVisible()
  await expect(page.getByTestId('font-settings-request-access')).toBeVisible()
  await expect(page.getByTestId('font-settings-toggle-online-fonts')).toHaveText('Disable')
  await expect(page.getByText('Google Fonts (Unavailable)')).toBeVisible()
  await expect(page.getByText('Bunny Fonts (Unavailable)')).toBeVisible()
  await expect(page.getByText('Fontshare (Unavailable)')).toBeVisible()
  await expect(page.getByTestId('font-settings-provider-google')).not.toBeChecked()
  await expect(page.getByTestId('font-settings-provider-google')).toBeDisabled()
  await expect(page.getByTestId('font-settings-provider-fontsource')).toBeChecked()
  await expect(page.getByTestId('font-settings-provider-bunny')).not.toBeChecked()
  await expect(page.getByTestId('font-settings-provider-bunny')).toBeDisabled()
  await expect(page.getByTestId('font-settings-provider-fontshare')).not.toBeChecked()
  await expect(page.getByTestId('font-settings-provider-fontshare')).toBeDisabled()
  await page.getByTestId('font-settings-toggle-online-fonts').click()
  await expect(page.getByTestId('font-settings-toggle-online-fonts')).toHaveText('Enable')
  await expect(page.getByTestId('font-settings-provider-google')).toBeDisabled()
  await page.getByTestId('font-settings-toggle-online-fonts').click()
  await expect(page.getByTestId('font-settings-toggle-online-fonts')).toHaveText('Disable')
  await expect(page.getByTestId('font-settings-provider-fontsource')).toBeEnabled()
  await expect(page.getByTestId('font-settings-download-fallbacks')).toHaveCount(0)
  await expect(page.getByTestId('font-settings-import-file')).toHaveCount(0)
  await expect(page.getByTestId('font-settings-refresh-cache')).toHaveCount(0)
  await expect(page.getByTestId('font-settings-clear-cache')).toHaveCount(0)
  await expect(page.getByText('Download CJK and Arabic fallbacks')).toHaveCount(0)

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('font-settings-panel')).toBeHidden()
  await expect(typography).toBeVisible()
})
