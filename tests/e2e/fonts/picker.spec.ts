import { expect, test, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'
import { mockFontsource } from '#tests/helpers/fonts/fontsource'
import { mockGoogleFonts } from '#tests/helpers/fonts/google'

async function openTypographyForText(page: Page) {
  await page.goto('/')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()

  return page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const id = store.createShape('TEXT', 120, 120, 240, 40)
    store.updateNode(id, { text: 'Font picker smoke' })
    store.select([id])
    return id
  })
}

async function openFontPicker(page: Page) {
  await page.getByTestId('font-picker-trigger').click()
}

async function searchFonts(page: Page, query: string) {
  await page.getByRole('combobox', { name: 'Search fonts…' }).fill(query)
}

test('font picker selects local fonts without requiring Google metadata access', async ({
  page
}) => {
  const fonts = await mockGoogleFonts(page)
  await page.addInitScript(() => {
    Object.defineProperty(window, 'queryLocalFonts', {
      configurable: true,
      value: async () => [
        {
          family: 'Inter',
          fullName: 'Inter Regular',
          postscriptName: 'Inter-Regular',
          style: 'Regular'
        },
        {
          family: 'OpenPencil Local Font',
          fullName: 'OpenPencil Local Font Regular',
          postscriptName: 'OpenPencilLocalFont-Regular',
          style: 'Regular',
          blob: async () => {
            const response = await fetch('/Inter-Regular.ttf')
            return new Blob([await response.arrayBuffer()], { type: 'font/ttf' })
          }
        }
      ]
    })
  })

  const textId = await openTypographyForText(page)
  expect(fonts.counts.metadata).toBe(0)
  await openFontPicker(page)
  await searchFonts(page, 'OpenPencil Local Font')

  const localFont = page
    .getByTestId('font-picker-item')
    .filter({ hasText: 'OpenPencil Local Font' })
  await expect(localFont).toBeVisible()
  await expect(localFont).toHaveAttribute('data-license-status', 'declared_open')
  await expect(localFont.getByTestId('font-license-badge')).toContainText('Open license declared')
  await localFont.click()

  await expect(page.getByTestId('font-picker-trigger')).toContainText('OpenPencil Local Font')
  await expect(page.getByTestId('font-license-trigger-badge')).toContainText(
    'Open license declared'
  )
  await expect
    .poll(async () =>
      page.evaluate((id) => {
        const store = window.openPencil?.getStore?.()
        const node = store?.graph.getNode(id)
        return node?.type === 'TEXT' ? node.fontFamily : null
      }, textId)
    )
    .toBe('OpenPencil Local Font')
  expect(fonts.counts.metadata).toBe(0)
})

test('font picker downloads an approved Fontsource face from a pinned CDN URL', async ({
  page
}) => {
  const family = 'OpenPencil Fontsource Font'
  await mockGoogleFonts(page, [])
  const fontsource = await mockFontsource(page, [family])
  await page.addInitScript(() => {
    if (window.top !== window) return
    Reflect.deleteProperty(window, 'queryLocalFonts')
    // oxlint-disable-next-line open-pencil/no-direct-storage-access -- Test provider policy must exist before app startup.
    window.localStorage.setItem('op-online-fonts-enabled', 'true')
    // oxlint-disable-next-line open-pencil/no-direct-storage-access -- Test provider policy must exist before app startup.
    window.localStorage.setItem(
      'op-font-providers',
      JSON.stringify({ bunny: false, fontshare: false, fontsource: true, google: false })
    )
  })

  const textId = await openTypographyForText(page)
  await openFontPicker(page)

  const remoteFont = page.getByTestId('font-picker-item').filter({ hasText: family })
  await expect(remoteFont).toBeVisible()
  await expect.poll(() => fontsource.counts.assets).toBeGreaterThan(0)
  await remoteFont.click()

  await expect(page.getByTestId('font-picker-trigger')).toContainText(family)
  await expect
    .poll(async () =>
      page.evaluate((id) => {
        const store = window.openPencil?.getStore?.()
        const node = store?.graph.getNode(id)
        return node?.type === 'TEXT' ? node.fontFamily : null
      }, textId)
    )
    .toBe(family)
  expect(fontsource.counts.latestAssets).toBe(0)
  expect(fontsource.counts.metadata).toBeGreaterThanOrEqual(2)
})

test('font picker retries a failed Fontsource preview when the item is shown again', async ({
  page
}) => {
  const family = 'OpenPencil Retry Font'
  await mockGoogleFonts(page, [])
  const fontsource = await mockFontsource(page, [family], { assetFailures: 1 })
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, 'queryLocalFonts')
    // oxlint-disable-next-line open-pencil/no-direct-storage-access -- Test provider policy must exist before app startup.
    window.localStorage.setItem('op-online-fonts-enabled', 'true')
    // oxlint-disable-next-line open-pencil/no-direct-storage-access -- Test provider policy must exist before app startup.
    window.localStorage.setItem(
      'op-font-providers',
      JSON.stringify({ bunny: false, fontshare: false, fontsource: true, google: false })
    )
  })

  await openTypographyForText(page)
  await openFontPicker(page)
  await expect(page.getByTestId('font-picker-item').filter({ hasText: family })).toBeVisible()
  await expect.poll(() => fontsource.counts.assets).toBe(1)

  await page.waitForTimeout(100)
  await page.keyboard.press('Escape')
  await openFontPicker(page)

  await expect.poll(() => fontsource.counts.assets).toBeGreaterThan(1)
})

test('font picker keeps bundled fonts when local and web fonts are unavailable', async ({
  page
}) => {
  const fonts = await mockGoogleFonts(page, [], { unavailable: true })
  const fontsource = await mockFontsource(page, [], { unavailable: true })
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, 'queryLocalFonts')
  })

  await openTypographyForText(page)
  await openFontPicker(page)
  await searchFonts(page, 'Inter')

  const inter = page
    .getByTestId('font-picker-item')
    .filter({ has: page.getByText('Inter', { exact: true }) })
  await expect(inter).toBeVisible()
  await expect(inter).toHaveAttribute('data-license-status', 'free')
  await expect(inter.getByTestId('font-license-badge')).toContainText('Free')
  const licenseFilter = page.getByTestId('font-license-filter')
  await expect(licenseFilter).toHaveAccessibleName('Filter fonts by license')
  await licenseFilter.selectOption('free')
  await expect(inter).toBeVisible()
  await licenseFilter.selectOption('unknown')
  await expect(inter).toHaveCount(0)
  await expect(page.getByText('No fonts found', { exact: true })).toBeVisible()
  await searchFonts(page, '')
  await expect(page.getByText('No fonts match this license filter.')).toBeVisible()
  await licenseFilter.selectOption('all')
  await expect(
    page.getByTestId('font-picker-item').filter({ hasText: 'OpenPencil Google Font' })
  ).toHaveCount(0)
  expect(fonts.counts.metadata).toBe(0)
  expect(fonts.counts.previews).toBe(0)
  await expect.poll(() => fontsource.counts.metadata).toBeGreaterThan(0)
  expect(fontsource.counts.assets).toBe(0)
  await expect(page.getByText('Local fonts are not available in this browser.')).toHaveCount(0)
})

test('font picker keeps bundled fonts when local font permission is rejected', async ({ page }) => {
  const fonts = await mockGoogleFonts(page)
  await page.addInitScript(() => {
    Object.defineProperty(window, 'queryLocalFonts', {
      configurable: true,
      value: async () => {
        throw new Error('denied')
      }
    })
  })

  await openTypographyForText(page)
  await openFontPicker(page)
  await searchFonts(page, 'Inter')

  await expect(
    page.getByTestId('font-picker-item').filter({ has: page.getByText('Inter', { exact: true }) })
  ).toBeVisible()
  await expect(
    page.getByTestId('font-picker-item').filter({ hasText: 'OpenPencil Google Font' })
  ).toHaveCount(0)
  await expect(page.getByText('Local font access is blocked for this site.')).toHaveCount(0)
  expect(fonts.counts.metadata).toBe(0)
})

test('font picker keeps bundled Inter available when local and Google fonts are unavailable', async ({
  page
}) => {
  await mockGoogleFonts(page, [])
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, 'queryLocalFonts')
  })

  await openTypographyForText(page)
  await openFontPicker(page)
  await searchFonts(page, 'Inter')

  await expect(
    page.getByTestId('font-picker-item').filter({ has: page.getByText('Inter', { exact: true }) })
  ).toBeVisible()
})
