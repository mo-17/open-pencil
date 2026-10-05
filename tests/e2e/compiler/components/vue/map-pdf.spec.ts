import { expect, test } from '@playwright/test'
import { toUint8Array } from 'js-base64'

import { withMapPDFModule } from '#tests/helpers/compiler/modules/map-pdf/browser'

test('Vue Map uses the local MapLibre runtime with mocked fixed-origin tiles and preserves overlays through failure/remount', async ({
  page
}) => {
  test.setTimeout(90000)
  const tileRequests: string[] = []
  await page.route('https://tile.openstreetmap.org/**', async (route) => {
    tileRequests.push(route.request().url())
    await route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        toUint8Array(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII='
        )
      )
    })
  })
  await withMapPDFModule(page, 'map', false, async () => {
    const host = page.locator('[data-openpencil-map]')
    const canvas = host.locator('.maplibregl-canvas')
    await expect(canvas).toBeVisible()
    await expect(host.getByText('Authored overlay', { exact: true })).toBeVisible()
    await expect(host.locator('.maplibregl-ctrl-attrib')).toContainText(
      '© OpenStreetMap contributors'
    )
    await host.locator('.maplibregl-marker').click()
    await expect(host.locator('.maplibregl-popup-content')).toContainText('<b>Plain venue</b>')
    await expect(host.locator('.maplibregl-popup-content b')).toHaveCount(0)
    await page.getByRole('button', { name: 'Equal config', exact: true }).click()
    await page.getByRole('button', { name: 'Rerender host', exact: true }).click()
    await expect(host.locator('.maplibregl-popup-content')).toContainText('<b>Plain venue</b>')
    await page.getByRole('button', { name: 'Replace config', exact: true }).click()
    await expect(host.locator('.maplibregl-popup-content')).toHaveCount(0)
    await expect(canvas).toHaveCSS('filter', /invert/)
    await canvas.dispatchEvent('webglcontextlost', { cancelable: true })
    await expect(host.getByRole('status')).toHaveText('Map unavailable')
    await expect(host.getByText('Authored overlay', { exact: true })).toBeVisible()
    await expect(canvas).toHaveCount(0)
    await page.getByRole('button', { name: 'Restore config', exact: true }).click()
    await expect(canvas).toBeVisible()
    await page.getByRole('button', { name: 'Toggle module', exact: true }).click()
    await expect(host).toHaveCount(0)
    await page.getByRole('button', { name: 'Toggle module', exact: true }).click()
    await expect(canvas).toBeVisible()
    expect(tileRequests.every((url) => url.startsWith('https://tile.openstreetmap.org/'))).toBe(
      true
    )
    await page.screenshot({ path: test.info().outputPath('vue-map-local-runtime.png') })
  })
})

test('Vue development PDF makes no source request until activation and revokes consent after source changes/remount', async ({
  page
}) => {
  test.setTimeout(90000)
  const requests: string[] = []
  await page.route('**/fixtures/*.pdf', async (route) => {
    requests.push(new URL(route.request().url()).pathname)
    await route.fulfill({
      contentType: 'application/pdf',
      body: '%PDF-1.4\n% mock request fixture, no drawing claim\n%%EOF'
    })
  })
  await withMapPDFModule(page, 'pdf', true, async () => {
    const host = page.locator('[data-openpencil-pdf-viewer]')
    await expect(host).toBeVisible()
    await expect(host.locator('iframe')).toHaveCount(0)
    await expect(host.getByRole('link', { name: 'Download', exact: true })).toHaveCount(0)
    expect(requests).toEqual([])
    await host.getByRole('button', { name: 'Load PDF preview', exact: true }).click()
    const frame = host.locator('iframe')
    await expect(frame).toHaveAttribute('src', '/fixtures/initial.pdf#page=2&view=FitH&toolbar=1')
    await expect(frame).toHaveAttribute('sandbox', '')
    await expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer')
    await expect.poll(() => requests.includes('/fixtures/initial.pdf')).toBe(true)
    await expect(host.getByRole('link', { name: 'Download', exact: true })).toHaveAttribute(
      'href',
      '/fixtures/initial.pdf'
    )
    await page.getByRole('button', { name: 'Replace config', exact: true }).click()
    await expect(frame).toHaveCount(0)
    await expect(host.getByRole('button', { name: 'Load PDF preview', exact: true })).toBeVisible()
    expect(requests.includes('/fixtures/alternate.pdf')).toBe(false)
    await page.getByRole('button', { name: 'Restore config', exact: true }).click()
    await expect(frame).toHaveCount(0)
    await host.getByRole('button', { name: 'Load PDF preview', exact: true }).click()
    await expect(frame).toBeVisible()
    await page.getByRole('button', { name: 'Toggle module', exact: true }).click()
    await page.getByRole('button', { name: 'Toggle module', exact: true }).click()
    await expect(frame).toHaveCount(0)
    await expect(host.getByText('Authored overlay', { exact: true })).toBeVisible()
  })
})

test('Vue production PDF projects its configured iframe immediately', async ({ page }) => {
  test.setTimeout(90000)
  await page.route('**/fixtures/*.pdf', (route) =>
    route.fulfill({ contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF' })
  )
  await withMapPDFModule(page, 'pdf', false, async () => {
    const host = page.locator('[data-openpencil-pdf-viewer]')
    await expect(host.locator('iframe')).toHaveAttribute(
      'src',
      '/fixtures/initial.pdf#page=2&view=FitH&toolbar=1'
    )
    await expect(host.getByRole('button', { name: 'Load PDF preview', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Replace config', exact: true }).click()
    await expect(host.locator('iframe')).toHaveAttribute(
      'src',
      '/fixtures/alternate.pdf#page=2&view=Fit&toolbar=0'
    )
    await expect(host.getByRole('link', { name: 'Download', exact: true })).toHaveCount(0)
  })
})
