import { readFile } from 'node:fs/promises'

import type { Page, Route } from '@playwright/test'

/** Exercise provider URL pinning and retries through actual browser requests. */
export async function mockFontsource(
  page: Page,
  families: string[] = [],
  { assetFailures = 0, unavailable = false }: { assetFailures?: number; unavailable?: boolean } = {}
) {
  const counts = { metadata: 0, assets: 0, latestAssets: 0 }
  const headers = { 'access-control-allow-origin': '*' }
  const pattern =
    /^https:\/\/(api\.fontsource\.org\/v1\/fonts|cdn\.jsdelivr\.net\/fontsource\/fonts\/)/
  const fontId = (family: string) =>
    family
      .toLocaleLowerCase()
      .replaceAll(/[^a-z\d]+/gu, '-')
      .replaceAll(/^-|-$/gu, '')

  async function handle(route: Route) {
    const url = new URL(route.request().url())
    if (unavailable) {
      if (url.hostname === 'cdn.jsdelivr.net') {
        counts.assets++
        if (url.pathname.includes('@latest/')) counts.latestAssets++
      } else counts.metadata++
      await route.fulfill({ headers, status: 503, body: 'Font provider unavailable' })
      return
    }
    if (url.hostname === 'cdn.jsdelivr.net') {
      counts.assets++
      if (url.pathname.includes('@latest/')) counts.latestAssets++
      if (counts.assets <= assetFailures) {
        await route.fulfill({ headers, status: 503, body: 'temporarily unavailable' })
        return
      }
      await route.fulfill({
        headers,
        contentType: 'font/ttf',
        body: await readFile('public/Inter-Regular.ttf')
      })
      return
    }
    counts.metadata++
    if (url.pathname === '/v1/fonts') {
      await route.fulfill({
        headers,
        json: families.map((family) => ({
          category: 'sans-serif',
          defSubset: 'latin',
          family,
          id: fontId(family),
          styles: ['normal'],
          subsets: ['latin'],
          variable: false,
          weights: [400]
        }))
      })
      return
    }
    const id = url.pathname.slice('/v1/fonts/'.length)
    const family = families.find((candidate) => fontId(candidate) === id)
    if (!family) {
      await route.fulfill({ headers, status: 404, body: 'not found' })
      return
    }
    await route.fulfill({
      headers,
      json: {
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
      }
    })
  }
  await page.route(pattern, handle)
  return { counts, dispose: () => page.unroute(pattern, handle) }
}
