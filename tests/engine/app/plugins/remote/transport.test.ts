import { describe, expect, test } from 'bun:test'

import {
  REMOTE_PLUGIN_TRANSPORT_LIMITS,
  createRemotePluginTransport,
  parseRemotePluginURL
} from '@/app/plugins'

describe('remote plugin transport', () => {
  test('requires HTTPS and rejects credentials and fragments', () => {
    expect(() => parseRemotePluginURL('http://plugins.example/catalog.json')).toThrow('HTTPS')
    expect(() => parseRemotePluginURL('https://user:secret@plugins.example/catalog.json')).toThrow(
      'credentials'
    )
    expect(() => parseRemotePluginURL('https://plugins.example/catalog.json#unsigned')).toThrow(
      'fragment'
    )
    expect(
      parseRemotePluginURL('http://127.0.0.1:4173/catalog.json', {
        allowLoopbackHttp: true
      }).href
    ).toBe('http://127.0.0.1:4173/catalog.json')
    expect(() =>
      parseRemotePluginURL('http://192.168.1.10/catalog.json', { allowLoopbackHttp: true })
    ).toThrow('HTTPS')
  })

  test('loads bounded JSON without credentials and sends conditional cache validators', async () => {
    let request: Request | null = null
    let requestInit: RequestInit | undefined
    const transport = createRemotePluginTransport({
      fetchImpl: async (input, init) => {
        request = new Request(input, init)
        requestInit = init
        return new Response('{"catalog":"ok"}', {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            etag: '"catalog-v1"',
            'last-modified': 'Tue, 04 Aug 2026 12:00:00 GMT'
          }
        })
      }
    })

    const result = await transport.loadCatalog('https://plugins.example/catalog.json', {
      etag: '"old"',
      lastModified: 'Mon, 03 Aug 2026 12:00:00 GMT'
    })

    expect(result).toMatchObject({
      status: 'fresh',
      json: { catalog: 'ok' },
      etag: '"catalog-v1"'
    })
    expect(requestInit?.credentials).toBe('omit')
    expect(requestInit?.redirect).toBe('error')
    expect(request?.headers.get('if-none-match')).toBe('"old"')
    expect(request?.headers.get('if-modified-since')).toBe('Mon, 03 Aug 2026 12:00:00 GMT')
  })

  test('accepts 304 but rejects redirects, non-JSON, invalid UTF-8, and oversized bodies', async () => {
    const notModified = createRemotePluginTransport({
      fetchImpl: async () => new Response(null, { status: 304, headers: { etag: '"same"' } })
    })
    expect(await notModified.loadCatalog('https://plugins.example/catalog.json')).toMatchObject({
      status: 'not-modified',
      etag: '"same"'
    })

    const redirected = createRemotePluginTransport({
      fetchImpl: async () =>
        Object.defineProperty(
          new Response('{}', { headers: { 'content-type': 'application/json' } }),
          'url',
          {
            value: 'https://evil.example/catalog.json'
          }
        )
    })
    await expect(redirected.loadCatalog('https://plugins.example/catalog.json')).rejects.toThrow(
      'redirects'
    )

    const html = createRemotePluginTransport({
      fetchImpl: async () => new Response('<html>', { headers: { 'content-type': 'text/html' } })
    })
    await expect(html.loadCatalog('https://plugins.example/catalog.json')).rejects.toThrow(
      'application/json'
    )

    const invalidUtf8 = createRemotePluginTransport({
      fetchImpl: async () =>
        new Response(Uint8Array.of(0xc3, 0x28), {
          headers: { 'content-type': 'application/json' }
        })
    })
    await expect(invalidUtf8.loadCatalog('https://plugins.example/catalog.json')).rejects.toThrow()

    const oversized = createRemotePluginTransport({
      fetchImpl: async () =>
        new Response('{}', {
          headers: {
            'content-type': 'application/json',
            'content-length': String(REMOTE_PLUGIN_TRANSPORT_LIMITS.maxCatalogBytes + 1)
          }
        })
    })
    await expect(oversized.loadCatalog('https://plugins.example/catalog.json')).rejects.toThrow(
      'byte limit'
    )
  })
})
