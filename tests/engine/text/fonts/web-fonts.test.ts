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

  test('aborts a font load queued behind an active provider request', async () => {
    const resolver = new WebFontResolver()
    resolver.setEnabled({ google: true })
    let requestStarted: (() => void) | null = null
    let releaseRequest: (() => void) | null = null
    const started = new Promise<void>((resolve) => {
      requestStarted = resolve
    })
    const blocked = new Promise<Response>((resolve) => {
      releaseRequest = () => resolve(new Response('{}', { status: 200 }))
    })
    resolver.setRemoteFetch(async () => {
      requestStarted?.()
      return blocked
    })
    const first = resolver.listFamilies('google')
    await started
    const abort = new AbortController()
    const queued = resolver.fetchFont(['Inter'], 'Regular', '', abort.signal)

    abort.abort()

    await expect(queued).rejects.toHaveProperty('name', 'AbortError')
    releaseRequest?.()
    await first
  })

  test('aborts promptly while provider resolution is pending', async () => {
    const resolver = new WebFontResolver()
    resolver.setEnabled({ google: true })
    let providerRequestStarted: (() => void) | null = null
    let releaseProviderRequest: (() => void) | null = null
    const started = new Promise<void>((resolve) => {
      providerRequestStarted = resolve
    })
    const blocked = new Promise<Response>((resolve) => {
      releaseProviderRequest = () => resolve(new Response('{}', { status: 200 }))
    })
    resolver.setRemoteFetch(async () => {
      providerRequestStarted?.()
      return blocked
    })
    const abort = new AbortController()
    const loading = resolver.fetchFont(['Inter'], 'Regular', '', abort.signal)
    await started

    abort.abort()

    await expect(loading).rejects.toHaveProperty('name', 'AbortError')
    releaseProviderRequest?.()
  })

  test('keeps shared provider initialization alive when one waiter aborts', async () => {
    const resolver = new WebFontResolver()
    resolver.setEnabled({ google: true })
    let providerRequestStarted: (() => void) | null = null
    let releaseProviderRequest: (() => void) | null = null
    const started = new Promise<void>((resolve) => {
      providerRequestStarted = resolve
    })
    const blocked = new Promise<Response>((resolve) => {
      releaseProviderRequest = () =>
        resolve(
          Response.json({
            familyMetadataList: [{ family: 'Inter', axes: [], fonts: { '400': {} } }]
          })
        )
    })
    resolver.setRemoteFetch(async (url) => {
      if (url.includes('fonts.google.com/metadata/fonts')) {
        providerRequestStarted?.()
        return blocked
      }
      if (url.includes('fonts.googleapis.com/css2')) {
        return new Response(
          "@font-face { font-family: 'Inter'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/s/inter-test.ttf) format('truetype'); }",
          { status: 200 }
        )
      }
      if (url === 'https://fonts.gstatic.com/s/inter-test.ttf') {
        return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 })
      }
      throw new Error(`Unexpected web font request: ${url}`)
    })
    const firstAbort = new AbortController()
    const secondAbort = new AbortController()
    const first = resolver.fetchFont(['Inter'], 'Regular', 'A', firstAbort.signal)
    await started
    const second = resolver.fetchFont(['Inter'], 'Regular', 'A', secondAbort.signal)

    firstAbort.abort()

    await expect(first).rejects.toHaveProperty('name', 'AbortError')
    releaseProviderRequest?.()
    const result = await second
    expect(result?.provider).toBe('google')
    expect(result?.buffers).toHaveLength(1)
    expect(result?.buffers[0]?.byteLength).toBe(4)
  })

  test('requests script-specific subsets instead of Latin only', () => {
    expect(webFontSubsetsForText('مرحبا')).toContain('arabic')
    expect(webFontSubsetsForText('한글')).toContain('korean')
    expect(webFontSubsetsForText('かな')).toContain('japanese')
    expect(webFontSubsetsForText('你好')).toEqual(
      expect.arrayContaining(['chinese-simplified', 'chinese-traditional', 'japanese'])
    )
  })

  test('requests only the font shards required by known Latin-family text', () => {
    expect(webFontSubsetsForText('Source Sans 3')).toEqual(['latin'])
    expect(webFontSubsetsForText('Příliš žluťoučký kůň')).toEqual(['latin', 'latin-ext'])
    expect(webFontSubsetsForText('Tiếng Việt')).toEqual(['latin', 'vietnamese'])
    expect(webFontSubsetsForText('Привет')).toEqual(['cyrillic'])
    expect(webFontSubsetsForText('Γειά')).toEqual(['greek'])
  })

  test('keeps a conservative provider fallback when no glyph coverage is known', () => {
    expect(webFontSubsetsForText('')).toEqual([
      'latin',
      'latin-ext',
      'vietnamese',
      'cyrillic',
      'cyrillic-ext',
      'greek',
      'greek-ext'
    ])
    expect(webFontSubsetsForText('123 🎨')).toEqual(['latin'])
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
