import { expect, test, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

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

async function installGoogleFontsMock(
  page: Page,
  families = ['Inter', 'OpenPencil Google Font'],
  fontsourceFamilies: string[] = [],
  fontsourceAssetFailures = 0
) {
  await page.addInitScript(
    ({ fontsourceAssetFailures, fontsourceFamilies, googleFamilies }) => {
      const win = window as Window & {
        __fontsourceAssetFetchCount?: number
        __fontsourceFetchCount?: number
        __fontsourceLatestFetchCount?: number
        __googleFontsFetchCount?: number
        __googleFontPreviewFetchCount?: number
      }
      win.__fontsourceAssetFetchCount = 0
      win.__fontsourceFetchCount = 0
      win.__fontsourceLatestFetchCount = 0
      win.__googleFontsFetchCount = 0
      win.__googleFontPreviewFetchCount = 0
      const originalFetch = window.fetch.bind(window)

      const responseAt = (url: string, body: BodyInit, init?: ResponseInit) => {
        const response = new Response(body, init)
        Object.defineProperty(response, 'url', { configurable: true, value: url })
        return response
      }

      const fontsourceId = (family: string) =>
        family
          .toLocaleLowerCase()
          .replaceAll(/[^a-z\d]+/gu, '-')
          .replaceAll(/^-|-$/gu, '')

      window.fetch = async (input, init) => {
        let url: string
        if (typeof input === 'string') url = input
        else if (input instanceof URL) url = input.href
        else url = input.url
        if (url === 'https://api.fontsource.org/v1/fonts') {
          win.__fontsourceFetchCount = (win.__fontsourceFetchCount ?? 0) + 1
          return responseAt(
            url,
            JSON.stringify(
              fontsourceFamilies.map((family) => ({
                category: 'sans-serif',
                defSubset: 'latin',
                family,
                id: fontsourceId(family),
                styles: ['normal'],
                subsets: ['latin'],
                variable: false,
                weights: [400]
              }))
            ),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
        }
        if (url.startsWith('https://api.fontsource.org/v1/fonts/')) {
          win.__fontsourceFetchCount = (win.__fontsourceFetchCount ?? 0) + 1
          const id = url.slice('https://api.fontsource.org/v1/fonts/'.length)
          const family = fontsourceFamilies.find((candidate) => fontsourceId(candidate) === id)
          if (!family) return responseAt(url, 'not found', { status: 404 })
          return responseAt(
            url,
            JSON.stringify({
              family,
              id,
              npmVersion: '1.2.3',
              unicodeRange: { latin: 'U+0000-00FF' },
              variants: {
                400: {
                  normal: {
                    latin: {
                      url: {
                        ttf: `https://cdn.jsdelivr.net/fontsource/fonts/${id}@latest/latin-400-normal.ttf`
                      }
                    }
                  }
                }
              }
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
        }
        if (url.startsWith('https://cdn.jsdelivr.net/fontsource/fonts/')) {
          win.__fontsourceAssetFetchCount = (win.__fontsourceAssetFetchCount ?? 0) + 1
          if (url.includes('@latest/')) {
            win.__fontsourceLatestFetchCount = (win.__fontsourceLatestFetchCount ?? 0) + 1
          }
          if (win.__fontsourceAssetFetchCount <= fontsourceAssetFailures) {
            return responseAt(url, 'temporarily unavailable', { status: 503 })
          }
          const bundled = await originalFetch('/Inter-Regular.ttf')
          return responseAt(url, await bundled.arrayBuffer(), {
            status: 200,
            headers: { 'content-type': 'font/ttf' }
          })
        }
        if (url.startsWith('https://fonts.openpencil.test/')) {
          win.__googleFontPreviewFetchCount = (win.__googleFontPreviewFetchCount ?? 0) + 1
          return responseAt(url, new ArrayBuffer(8), { status: 200 })
        }
        if (url.startsWith('https://fonts.google.com/metadata/fonts')) {
          win.__googleFontsFetchCount = (win.__googleFontsFetchCount ?? 0) + 1
          return responseAt(
            url,
            JSON.stringify({
              familyMetadataList: googleFamilies.map((family) => ({
                family,
                axes: [],
                fonts: { '400': {} }
              }))
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
        }
        if (url.startsWith('https://fonts.googleapis.com/css2')) {
          const family = new URL(url).searchParams.get('family')?.split(':')[0] ?? 'Inter'
          return responseAt(
            url,
            `@font-face { font-family: '${family}'; font-style: normal; font-weight: 400; src: url(https://fonts.openpencil.test/${encodeURIComponent(family)}.ttf) format('truetype'); }`,
            { status: 200, headers: { 'content-type': 'text/css' } }
          )
        }
        return originalFetch(input, init)
      }
    },
    { fontsourceAssetFailures, fontsourceFamilies, googleFamilies: families }
  )
}

test('font picker selects local fonts without requiring Google metadata access', async ({
  page
}) => {
  await installGoogleFontsMock(page)
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
  expect(
    await page.evaluate(
      () => (window as Window & { __googleFontsFetchCount?: number }).__googleFontsFetchCount
    )
  ).toBe(0)
  await openFontPicker(page)

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
  expect(
    await page.evaluate(
      () => (window as Window & { __googleFontsFetchCount?: number }).__googleFontsFetchCount
    )
  ).toBe(0)
})

test('font picker downloads an approved Fontsource face from a pinned CDN URL', async ({
  page
}) => {
  const family = 'OpenPencil Fontsource Font'
  await installGoogleFontsMock(page, [], [family])
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
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __fontsourceAssetFetchCount?: number })
            .__fontsourceAssetFetchCount ?? 0
      )
    )
    .toBeGreaterThan(0)
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
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __fontsourceLatestFetchCount?: number })
          .__fontsourceLatestFetchCount ?? 0
    )
  ).toBe(0)
  expect(
    await page.evaluate(
      () => (window as Window & { __fontsourceFetchCount?: number }).__fontsourceFetchCount ?? 0
    )
  ).toBeGreaterThanOrEqual(2)
})

test('font picker retries a failed Fontsource preview when the item is shown again', async ({
  page
}) => {
  const family = 'OpenPencil Retry Font'
  await installGoogleFontsMock(page, [], [family], 1)
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
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __fontsourceAssetFetchCount?: number })
            .__fontsourceAssetFetchCount ?? 0
      )
    )
    .toBe(1)

  await page.waitForTimeout(100)
  await page.keyboard.press('Escape')
  await openFontPicker(page)

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __fontsourceAssetFetchCount?: number })
            .__fontsourceAssetFetchCount ?? 0
      )
    )
    .toBeGreaterThan(1)
})

test('font picker keeps bundled fonts when local and web fonts are unavailable', async ({
  page
}) => {
  await installGoogleFontsMock(page)
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, 'queryLocalFonts')
  })

  await openTypographyForText(page)
  await openFontPicker(page)

  const inter = page.getByTestId('font-picker-item').filter({ hasText: 'Inter' })
  await expect(inter).toBeVisible()
  await expect(inter).toHaveAttribute('data-license-status', 'free')
  await expect(inter.getByTestId('font-license-badge')).toContainText('Free')
  const licenseFilter = page.getByTestId('font-license-filter')
  await expect(licenseFilter).toHaveAccessibleName('Filter fonts by license')
  await licenseFilter.selectOption('free')
  await expect(inter).toBeVisible()
  await licenseFilter.selectOption('unknown')
  await expect(inter).toHaveCount(0)
  await expect(page.getByText('No fonts match this license filter.')).toBeVisible()
  await licenseFilter.selectOption('all')
  await expect(
    page.getByTestId('font-picker-item').filter({ hasText: 'OpenPencil Google Font' })
  ).toHaveCount(0)
  expect(
    await page.evaluate(
      () => (window as Window & { __googleFontsFetchCount?: number }).__googleFontsFetchCount
    )
  ).toBe(0)
  await expect(page.getByText('Local fonts are not available in this browser.')).toHaveCount(0)
})

test('font picker keeps bundled fonts when local font permission is rejected', async ({ page }) => {
  await installGoogleFontsMock(page)
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

  await expect(page.getByTestId('font-picker-item').filter({ hasText: 'Inter' })).toBeVisible()
  await expect(
    page.getByTestId('font-picker-item').filter({ hasText: 'OpenPencil Google Font' })
  ).toHaveCount(0)
  await expect(page.getByText('Local font access is blocked for this site.')).toHaveCount(0)
  expect(
    await page.evaluate(
      () => (window as Window & { __googleFontsFetchCount?: number }).__googleFontsFetchCount
    )
  ).toBe(0)
})

test('font picker keeps bundled Inter available when local and Google fonts are unavailable', async ({
  page
}) => {
  await installGoogleFontsMock(page, [])
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, 'queryLocalFonts')
  })

  await openTypographyForText(page)
  await openFontPicker(page)

  await expect(page.getByTestId('font-picker-item').filter({ hasText: 'Inter' })).toBeVisible()
})
