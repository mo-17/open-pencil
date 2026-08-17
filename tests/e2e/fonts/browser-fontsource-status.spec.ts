import { resolve } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

const FONTSOURCE_VERSION = '5.3.0'

interface FontsourceFamily {
  id: string
  family: string
  weights: number[]
}

const families: FontsourceFamily[] = [
  { id: 'bebas-neue', family: 'Bebas Neue', weights: [400] },
  { id: 'source-sans-3', family: 'Source Sans 3', weights: [400, 500, 700] }
]

function fontsourceDetail({ id, weights }: FontsourceFamily) {
  return {
    id,
    npmVersion: FONTSOURCE_VERSION,
    unicodeRange: { latin: 'U+0000-00FF' },
    variants: Object.fromEntries(
      weights.map((weight) => [
        weight,
        {
          normal: {
            latin: {
              url: {
                ttf: `https://cdn.jsdelivr.net/fontsource/fonts/${id}@latest/latin-${weight}-normal.ttf`
              }
            }
          }
        }
      ])
    )
  }
}

async function installFontsourceRoutes(page: Page): Promise<string[]> {
  const assetRequests: string[] = []
  await page.route('https://api.fontsource.org/v1/fonts', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(
        families.map(({ family, id, weights }) => ({
          category: 'sans-serif',
          defSubset: 'latin',
          family,
          id,
          styles: ['normal'],
          subsets: ['latin'],
          variable: false,
          weights
        }))
      )
    })
  )
  await page.route('https://api.fontsource.org/v1/fonts/*', (route) => {
    const id = route.request().url().split('/').at(-1)
    const family = families.find((entry) => entry.id === id)
    if (!family) return route.fulfill({ status: 404, body: 'not found' })
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(fontsourceDetail(family))
    })
  })
  await page.route('https://cdn.jsdelivr.net/fontsource/fonts/**', (route) => {
    assetRequests.push(route.request().url())
    return route.fulfill({
      contentType: 'font/ttf',
      path: resolve('public/Inter-Regular.ttf')
    })
  })
  return assetRequests
}

test('migrates legacy provider settings and clears affected Fontsource banner faces', async ({
  page
}) => {
  const assetRequests = await installFontsourceRoutes(page)
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, 'queryLocalFonts')
    // This is the persisted shape from before Fontsource was added to the provider policy.
    // oxlint-disable-next-line open-pencil/no-direct-storage-access -- Migration must run before app startup.
    window.localStorage.setItem('op-online-fonts-enabled', 'true')
    // oxlint-disable-next-line open-pencil/no-direct-storage-access -- Migration must run before app startup.
    window.localStorage.setItem(
      'op-font-providers',
      JSON.stringify({ google: true, bunny: false, fontshare: false })
    )
  })

  await page.goto('/')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()

  await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const faces = [
      ['Bebas Neue', 700],
      ['Source Sans 3', 700],
      ['Source Sans 3', 500],
      ['Source Sans 3', 400]
    ] as const
    for (const [index, [family, fontWeight]] of faces.entries()) {
      const id = store.createShape('TEXT', 80, 80 + index * 48, 320, 40)
      store.updateNode(id, {
        text: `Browser Fontsource face ${index + 1}`,
        fontFamily: family,
        fontWeight
      })
    }
  })

  await expect.poll(() => new Set(assetRequests).size).toBe(4)
  expect(assetRequests.every((url) => url.includes(`@${FONTSOURCE_VERSION}/`))).toBe(true)
  await expect(page.getByTestId('font-status-banner')).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate(() => {
        // oxlint-disable-next-line open-pencil/no-direct-storage-access -- Verify the persisted migration result.
        return window.localStorage.getItem('op-font-providers')
      })
    )
    .toBe(JSON.stringify({ google: true, fontsource: true, bunny: false, fontshare: false }))
})
