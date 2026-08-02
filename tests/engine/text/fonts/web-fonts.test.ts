import { describe, expect, test } from 'bun:test'

import {
  normalizedCoverageText,
  WebFontResolver,
  webFontSubsetsForText
} from '@open-pencil/core/text'
import { webFontAssetFamilySlug } from '@open-pencil/core/text/web-font/assets'

import { retryableCachedPromise, withWebFontFetchProxy } from '#core/text/web-font/fetch-proxy'

describe('web font coverage requests', () => {
  test('normalizes coverage without splitting supplementary code points', () => {
    expect(normalizedCoverageText('界A界𠀀A')).toBe(normalizedCoverageText('A界𠀀'))
    expect(Array.from(normalizedCoverageText('𠀀'))).toEqual(['𠀀'])
  })

  test('requests script-specific subsets instead of Latin only', () => {
    expect(webFontSubsetsForText('مرحبا')).toContain('arabic')
    expect(webFontSubsetsForText('한글')).toContain('korean')
    expect(webFontSubsetsForText('かな')).toContain('japanese')
    expect(webFontSubsetsForText('你好')).toEqual(
      expect.arrayContaining(['chinese-simplified', 'chinese-traditional', 'japanese'])
    )
  })

  test('clears only the requested font negative-cache entries before a retry', () => {
    const resolver = new WebFontResolver()
    const failures = Reflect.get(resolver, 'failedFonts') as Set<string>
    const clients = Reflect.get(resolver, 'unifontPromises') as Map<string, Promise<unknown>>
    failures.add('google|Retry Sans|Regular|AB')
    failures.add('fontsource|Retry Sans|Regular|AB')
    failures.add('google|Other Sans|Regular|AB')
    clients.set('google', Promise.resolve({}))
    clients.set('fontsource', Promise.resolve({}))

    resolver.clearFailedFont(['Retry Sans'], 'Regular', 'BA')

    expect(failures).toEqual(new Set(['google|Other Sans|Regular|AB']))
    expect(clients.has('google')).toBe(false)
    expect(clients.has('fontsource')).toBe(false)
  })

  test('serializes temporary global fetch proxies and restores the original', async () => {
    const originalFetch = globalThis.fetch
    let releaseFirst = (): void => undefined
    let secondStarted = false
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const fetchA = async () => new Response('a')
    const fetchB = async () => new Response('b')

    const first = withWebFontFetchProxy(fetchA, async () => {
      expect(await (await globalThis.fetch('https://fonts.test/a')).text()).toBe('a')
      await firstGate
      expect(await (await globalThis.fetch('https://fonts.test/a-again')).text()).toBe('a')
    })
    await Promise.resolve()
    const second = withWebFontFetchProxy(fetchB, async () => {
      secondStarted = true
      expect(await (await globalThis.fetch('https://fonts.test/b')).text()).toBe('b')
    })
    await Promise.resolve()

    expect(secondStarted).toBe(false)
    releaseFirst()
    await Promise.all([first, second])
    expect(globalThis.fetch).toBe(originalFetch)
  })

  test('evicts failed initialization promises so a later request can retry', async () => {
    const cache = new Map<string, Promise<string>>()
    let attempts = 0
    const create = async () => {
      attempts++
      if (attempts === 1) throw new Error('initialization failed')
      return 'ready'
    }

    const first = retryableCachedPromise(cache, 'google', create)
    expect(retryableCachedPromise(cache, 'google', create)).toBe(first)
    await expect(first).rejects.toThrow('initialization failed')
    expect(cache.has('google')).toBe(false)
    await expect(retryableCachedPromise(cache, 'google', create)).resolves.toBe('ready')
    expect(attempts).toBe(2)
  })

  test('creates stable, non-empty, collision-resistant family asset slugs', () => {
    expect(webFontAssetFamilySlug(' Ｉｎｔｅｒ ')).toBe(webFontAssetFamilySlug('Inter'))
    expect(webFontAssetFamilySlug('思源黑体')).toMatch(/^font-[a-f\d]{8}$/)
    expect(webFontAssetFamilySlug('Noto Sans')).not.toBe(webFontAssetFamilySlug('Noto-Sans'))
  })
})
