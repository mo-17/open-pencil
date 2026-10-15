import { readFile } from 'node:fs/promises'

import type { Page, Route } from '@playwright/test'

import { repoPath } from '#tests/helpers/paths'

interface FontsourceFixture {
  family: string
  subset: string
  data: Buffer
  format?: 'ttf' | 'otf'
  unicodeRange?: string
}

function fixtureUnicodeRange(
  fixture: string | FontsourceFixture | undefined
): Record<string, string> {
  if (typeof fixture === 'string') return { latin: 'U+0000-00FF' }
  if (fixture?.unicodeRange === undefined) return {}
  return { [fixture.subset]: fixture.unicodeRange }
}

/** Exercise provider URL pinning and retries through actual browser requests. */
export async function mockFontsource(
  page: Page,
  fixtures: readonly (string | FontsourceFixture)[] = [],
  { assetFailures = 0, unavailable = false }: { assetFailures?: number; unavailable?: boolean } = {}
) {
  const counts = { metadata: 0, assets: 0, latestAssets: 0, downloads: 0 }
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
      const fixture = fixtures.find(
        (entry) => typeof entry !== 'string' && url.pathname.includes(`/${fontId(entry.family)}@`)
      )
      const supplied = typeof fixture === 'object' ? fixture : undefined
      counts.downloads++
      await route.fulfill({
        headers,
        contentType: `font/${supplied?.format ?? 'ttf'}`,
        body: supplied?.data ?? (await readFile(repoPath('packages/core/assets/Inter-Regular.ttf')))
      })
      return
    }
    counts.metadata++
    if (url.pathname === '/v1/fonts') {
      await route.fulfill({
        headers,
        json: fixtures.map((fixture) => {
          const family = typeof fixture === 'string' ? fixture : fixture.family
          const subset = typeof fixture === 'string' ? 'latin' : fixture.subset
          return {
            category: 'sans-serif',
            defSubset: subset,
            family,
            id: fontId(family),
            styles: ['normal'],
            subsets: [subset],
            variable: false,
            weights: [400]
          }
        })
      })
      return
    }
    const id = url.pathname.slice('/v1/fonts/'.length)
    const fixture = fixtures.find(
      (entry) => fontId(typeof entry === 'string' ? entry : entry.family) === id
    )
    const family = typeof fixture === 'string' ? fixture : fixture?.family
    const subset = typeof fixture === 'object' ? fixture.subset : 'latin'
    const format = typeof fixture === 'object' ? (fixture.format ?? 'ttf') : 'ttf'
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
        unicodeRange: fixtureUnicodeRange(fixture),
        variants: {
          400: {
            normal: {
              [subset]: {
                url: {
                  [format]: `https://cdn.jsdelivr.net/fontsource/fonts/${id}@latest/${subset}-400-normal.${format}`
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
