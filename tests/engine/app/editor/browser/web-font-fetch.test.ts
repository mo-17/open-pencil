import { describe, expect, test } from 'bun:test'

import {
  type BrowserWebFontFetchError,
  createBrowserWebFontFetch
} from '@/app/editor/fonts/browser-web-font-fetch'

function responseAt(url: string, body: BodyInit | null, init: ResponseInit = {}): Response {
  const response = new Response(body, init)
  Object.defineProperty(response, 'url', { configurable: true, value: url })
  return response
}

function validFontsourceDetail() {
  return {
    id: 'inter',
    npmVersion: '5.3.0',
    unicodeRange: { latin: 'U+0000-00FF' },
    variants: {
      400: {
        normal: {
          latin: {
            url: {
              woff2: 'https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-400-normal.woff2'
            }
          }
        }
      }
    }
  }
}

interface TestSubsetVariant {
  url: Record<string, string>
}

type TestSubsetVariants = Record<string, TestSubsetVariant>
type TestStyleVariants = Record<string, TestSubsetVariants>
type TestWeightVariants = Record<string, TestStyleVariants>

describe('createBrowserWebFontFetch', () => {
  test('binds the default native fetch receiver to the browser global', async () => {
    const originalFetch = globalThis.fetch
    const url = 'https://api.fontsource.org/v1/fonts'
    let invoked = false
    const nativeStyleFetch = function (this: unknown, input: RequestInfo | URL) {
      if (this !== globalThis) throw new TypeError('Illegal invocation')
      invoked = true
      let requestURL: string
      if (typeof input === 'string') requestURL = input
      else if (input instanceof URL) requestURL = input.href
      else requestURL = input.url
      return Promise.resolve(responseAt(requestURL, '[]'))
    } as typeof globalThis.fetch
    Reflect.set(globalThis, 'fetch', nativeStyleFetch)

    try {
      const fontFetch = createBrowserWebFontFetch()
      await expect(fontFetch(url).then((response) => response.json())).resolves.toEqual([])
    } finally {
      Reflect.set(globalThis, 'fetch', originalFetch)
    }

    expect(invoked).toBe(true)
  })

  test('uses credential-free CORS requests with no referrer', async () => {
    let captured: { url: string; init?: RequestInit } | undefined
    const url = 'https://fonts.googleapis.com/css2?family=Inter:wght@400'
    const fontFetch = createBrowserWebFontFetch({
      fetch: async (input, init) => {
        captured = { url: String(input), init }
        return responseAt(url, '@font-face {}', {
          headers: { 'content-type': 'text/css' }
        })
      }
    })

    const result = await fontFetch(url, {
      headers: { accept: 'text/css', 'user-agent': 'synthetic-unifont-agent' }
    })

    expect(await result.text()).toBe('@font-face {}')
    expect(captured?.url).toBe(url)
    expect(captured?.init).toMatchObject({
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer'
    })
    expect(new Headers(captured?.init?.headers).get('user-agent')).toBeNull()
    expect(new Headers(captured?.init?.headers).get('accept')).toBe('text/css')
  })

  test('pins Fontsource detail variants to its validated npmVersion', async () => {
    const url = 'https://api.fontsource.org/v1/fonts/inter'
    const details = validFontsourceDetail()
    const fontFetch = createBrowserWebFontFetch({
      fetch: async (input) =>
        responseAt(String(input), JSON.stringify(details), {
          headers: { 'content-type': 'application/json' }
        })
    })

    const response = await fontFetch(url)
    const pinned = (await response.json()) as typeof details

    expect(pinned.variants[400].normal.latin.url.woff2).toBe(
      'https://cdn.jsdelivr.net/fontsource/fonts/inter@5.3.0/latin-400-normal.woff2'
    )
    expect(response.headers.get('content-length')).toBe(
      String(new TextEncoder().encode(JSON.stringify(pinned)).byteLength)
    )
  })

  test('rebuilds Fontsource list and detail responses without provider-controlled fields', async () => {
    const listURL = 'https://api.fontsource.org/v1/fonts'
    const detailURL = 'https://api.fontsource.org/v1/fonts/inter'
    const details = validFontsourceDetail()
    Object.assign(details, {
      credentials: 'provider-secret',
      source: 'https://malicious.example/font'
    })
    Object.defineProperty(details, '__proto__', {
      enumerable: true,
      value: { polluted: true }
    })
    const fontFetch = createBrowserWebFontFetch({
      fetch: async (input) => {
        const url = String(input)
        const body =
          url === listURL
            ? JSON.stringify([
                {
                  category: 'sans-serif',
                  credentials: 'provider-secret',
                  defSubset: 'latin',
                  family: 'Inter',
                  id: 'inter',
                  styles: ['normal'],
                  subsets: ['latin'],
                  variable: false,
                  weights: [400]
                }
              ])
            : JSON.stringify(details)
        return responseAt(url, body, { headers: { 'content-type': 'application/json' } })
      }
    })

    const list = (await (await fontFetch(listURL)).json()) as unknown[]
    expect(list).toEqual([
      {
        defSubset: 'latin',
        family: 'Inter',
        id: 'inter',
        styles: ['normal'],
        subsets: ['latin'],
        variable: false,
        weights: [400]
      }
    ])
    const detail: unknown = await (await fontFetch(detailURL)).json()
    if (typeof detail !== 'object' || detail === null || Array.isArray(detail)) {
      throw new TypeError('Expected a sanitized Fontsource detail object')
    }
    expect(Object.keys(detail).sort()).toEqual(['id', 'npmVersion', 'unicodeRange', 'variants'])
    expect(JSON.stringify(detail)).not.toContain('provider-secret')
    expect(JSON.stringify(detail)).not.toContain('malicious.example')
    expect(JSON.stringify(detail)).not.toContain('polluted')
  })

  test('accepts the exact Fontsource catalog and pinned asset request shapes', async () => {
    const seen: string[] = []
    const fontFetch = createBrowserWebFontFetch({
      fetch: async (input) => {
        const url = String(input)
        seen.push(url)
        return responseAt(url, url.includes('/v1/fonts') ? '[]' : new Uint8Array([1, 2, 3]))
      }
    })

    await expect(
      fontFetch('https://api.fontsource.org/v1/fonts').then((r) => r.json())
    ).resolves.toEqual([])
    await expect(
      fontFetch(
        'https://cdn.jsdelivr.net/fontsource/fonts/inter@5.3.0/latin-400-normal.woff2'
      ).then((r) => r.arrayBuffer())
    ).resolves.toHaveProperty('byteLength', 3)
    expect(seen).toEqual([
      'https://api.fontsource.org/v1/fonts',
      'https://cdn.jsdelivr.net/fontsource/fonts/inter@5.3.0/latin-400-normal.woff2'
    ])
  })

  test('fails closed for Google metadata and all Fontsource variable paths', async () => {
    let calls = 0
    const fontFetch = createBrowserWebFontFetch({
      fetch: async () => {
        calls++
        throw new Error('must not run')
      }
    })

    await expect(fontFetch('https://fonts.google.com/metadata/fonts')).rejects.toMatchObject({
      code: 'cors-unavailable'
    } satisfies Partial<BrowserWebFontFetchError>)
    await expect(
      fontFetch('https://cdn.jsdelivr.net/fontsource/fonts/inter:vf@latest/latin-wght-normal.woff2')
    ).rejects.toMatchObject({ code: 'url-not-allowed' } satisfies Partial<BrowserWebFontFetchError>)
    await expect(
      fontFetch('https://cdn.jsdelivr.net/fontsource/fonts/inter:vf@5.3.0/latin-wght-normal.woff2')
    ).rejects.toMatchObject({ code: 'url-not-allowed' } satisfies Partial<BrowserWebFontFetchError>)
    await expect(fontFetch('https://api.fontsource.org/v1/variable/inter')).rejects.toMatchObject({
      code: 'url-not-allowed'
    } satisfies Partial<BrowserWebFontFetchError>)
    expect(calls).toBe(0)
  })

  test('rejects mismatched exact versions in Fontsource details', async () => {
    const url = 'https://api.fontsource.org/v1/fonts/inter'
    const fontFetch = createBrowserWebFontFetch({
      fetch: async () =>
        responseAt(
          url,
          JSON.stringify({
            id: 'inter',
            npmVersion: '5.3.0',
            variants: {
              400: {
                normal: {
                  latin: {
                    url: {
                      woff2:
                        'https://cdn.jsdelivr.net/fontsource/fonts/inter@5.2.0/latin-400-normal.woff2'
                    }
                  }
                }
              }
            }
          })
        )
    })

    await expect(fontFetch(url)).rejects.toMatchObject({
      code: 'invalid-response'
    } satisfies Partial<BrowserWebFontFetchError>)
  })

  test('rejects deep, over-limit, and executable Fontsource detail shapes', async () => {
    const url = 'https://api.fontsource.org/v1/fonts/inter'
    const deeplyNested = {
      id: 'inter',
      npmVersion: '5.3.0',
      unicodeRange: { latin: 'U+0000-00FF' },
      variants: {
        400: {
          normal: {
            latin: {
              url: {
                woff2: { nested: { nested: { nested: 'https://malicious.example/font' } } }
              }
            }
          }
        }
      }
    }
    const baseStyles = validFontsourceDetail().variants[400]
    const weights: Record<string, typeof baseStyles> = {}
    for (let weight = 1; weight <= 17; weight++) {
      weights[String(weight)] = structuredClone(baseStyles)
    }
    const tooManyWeights = { ...validFontsourceDetail(), variants: weights }
    const tooManyStyles = {
      ...validFontsourceDetail(),
      variants: {
        400: {
          normal: baseStyles.normal,
          italic: baseStyles.normal,
          oblique: baseStyles.normal
        }
      }
    }
    const tooManySubsets = {
      ...validFontsourceDetail(),
      variants: {
        400: {
          normal: Object.fromEntries(
            Array.from({ length: 65 }, (_, index) => [`subset-${index}`, null])
          )
        }
      }
    }
    const tooManyFormats = validFontsourceDetail()
    Object.assign(tooManyFormats.variants[400].normal.latin.url, {
      otf: 'https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-400-normal.otf',
      ttf: 'https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-400-normal.ttf',
      woff: 'https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-400-normal.woff'
    })
    const executableFormat = validFontsourceDetail()
    Object.assign(executableFormat.variants[400].normal.latin.url, {
      javascript: ['java', 'script:alert(1)'].join('')
    })
    const payloads = [
      deeplyNested,
      tooManyWeights,
      tooManyStyles,
      tooManySubsets,
      tooManyFormats,
      executableFormat
    ]
    let index = 0
    const fontFetch = createBrowserWebFontFetch({
      fetch: async () => responseAt(url, JSON.stringify(payloads[index++]))
    })

    for (const _payload of payloads) {
      await expect(fontFetch(url)).rejects.toMatchObject({
        code: 'invalid-response'
      } satisfies Partial<BrowserWebFontFetchError>)
    }
  })

  test('rejects Fontsource catalogs over the bounded entry count', async () => {
    const url = 'https://api.fontsource.org/v1/fonts'
    const fontFetch = createBrowserWebFontFetch({
      fetch: async () => responseAt(url, JSON.stringify(Array.from({ length: 4_097 }, () => null)))
    })

    await expect(fontFetch(url)).rejects.toMatchObject({
      code: 'invalid-response'
    } satisfies Partial<BrowserWebFontFetchError>)
  })

  test('enforces the aggregate Fontsource detail URL limit without recursive traversal', async () => {
    const url = 'https://api.fontsource.org/v1/fonts/inter'
    const unicodeRange: Record<string, string> = {}
    const variants: TestWeightVariants = {}
    for (let subset = 0; subset < 11; subset++) unicodeRange[`subset-${subset}`] = 'U+0000-00FF'
    for (let weight = 1; weight <= 16; weight++) {
      const styles: TestStyleVariants = {}
      for (const style of ['normal', 'italic']) {
        const subsets: TestSubsetVariants = {}
        for (let subset = 0; subset < 11; subset++) {
          const subsetName = `subset-${subset}`
          const urls: Record<string, string> = {}
          for (const format of ['woff2', 'woff', 'ttf']) {
            urls[format] =
              `https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/` +
              `${subsetName}-${weight}-${style}.${format}`
          }
          subsets[subsetName] = { url: urls }
        }
        styles[style] = subsets
      }
      variants[String(weight)] = styles
    }
    const fontFetch = createBrowserWebFontFetch({
      fetch: async () =>
        responseAt(
          url,
          JSON.stringify({ id: 'inter', npmVersion: '5.3.0', unicodeRange, variants })
        )
    })

    await expect(fontFetch(url)).rejects.toMatchObject({
      code: 'invalid-response'
    } satisfies Partial<BrowserWebFontFetchError>)
  })

  test('uses independent small byte ceilings for Fontsource list and detail metadata', async () => {
    const listURL = 'https://api.fontsource.org/v1/fonts'
    const detailURL = 'https://api.fontsource.org/v1/fonts/inter'
    const declaredLengths = new Map([
      [listURL, String(1024 * 1024 + 1)],
      [detailURL, String(512 * 1024 + 1)]
    ])
    const fontFetch = createBrowserWebFontFetch({
      fetch: async (input) => {
        const url = String(input)
        return responseAt(url, '[]', {
          headers: { 'content-length': declaredLengths.get(url) ?? '0' }
        })
      }
    })

    await expect(fontFetch(listURL)).rejects.toMatchObject({
      code: 'response-limit'
    } satisfies Partial<BrowserWebFontFetchError>)
    await expect(fontFetch(detailURL)).rejects.toMatchObject({
      code: 'response-limit'
    } satisfies Partial<BrowserWebFontFetchError>)
  })

  test('rejects credentials, bodies, non-GET methods, sensitive headers, and unknown hosts', async () => {
    let calls = 0
    const fontFetch = createBrowserWebFontFetch({
      fetch: async () => {
        calls++
        throw new Error('must not run')
      }
    })
    const url = 'https://api.fontsource.org/v1/fonts'

    await expect(fontFetch(url, { method: 'POST' })).rejects.toMatchObject({
      code: 'invalid-request'
    } satisfies Partial<BrowserWebFontFetchError>)
    await expect(fontFetch(url, { body: 'secret' })).rejects.toMatchObject({
      code: 'invalid-request'
    } satisfies Partial<BrowserWebFontFetchError>)
    await expect(fontFetch(url, { credentials: 'include' })).rejects.toMatchObject({
      code: 'invalid-request'
    } satisfies Partial<BrowserWebFontFetchError>)
    await expect(fontFetch(url, { redirect: 'follow' })).rejects.toMatchObject({
      code: 'invalid-request'
    } satisfies Partial<BrowserWebFontFetchError>)
    await expect(
      fontFetch(url, { headers: { authorization: 'Bearer secret' } })
    ).rejects.toMatchObject({ code: 'invalid-request' } satisfies Partial<BrowserWebFontFetchError>)
    await expect(fontFetch('https://example.com/font.woff2')).rejects.toMatchObject({
      code: 'url-not-allowed'
    } satisfies Partial<BrowserWebFontFetchError>)
    expect(calls).toBe(0)
  })

  test('forbids redirected responses even when an injected fetch follows one', async () => {
    const requestedURL = 'https://api.fontsource.org/v1/fonts'
    const redirected = responseAt(requestedURL, '[]')
    Object.defineProperty(redirected, 'redirected', { configurable: true, value: true })
    const fontFetch = createBrowserWebFontFetch({ fetch: async () => redirected })

    await expect(fontFetch(requestedURL)).rejects.toMatchObject({
      code: 'url-not-allowed'
    } satisfies Partial<BrowserWebFontFetchError>)
  })

  test('cancels the stream when the per-response limit is exceeded', async () => {
    let cancelled = false
    const url = 'https://api.fontsource.org/v1/fonts'
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4))
        controller.enqueue(new Uint8Array(4))
      },
      cancel() {
        cancelled = true
      }
    })
    const fontFetch = createBrowserWebFontFetch({
      maxResponseBytes: 6,
      fetch: async () => responseAt(url, stream)
    })

    await expect(fontFetch(url)).rejects.toMatchObject({
      code: 'response-limit'
    } satisfies Partial<BrowserWebFontFetchError>)
    expect(cancelled).toBe(true)
  })

  test('enforces aggregate bytes and request count across calls', async () => {
    const url = 'https://api.fontsource.org/v1/fonts'
    const totalLimited = createBrowserWebFontFetch({
      maxTotalBytes: 3,
      fetch: async () => responseAt(url, '[]')
    })
    await expect(totalLimited(url)).resolves.toBeInstanceOf(Response)
    await expect(totalLimited(url)).rejects.toMatchObject({
      code: 'total-limit'
    } satisfies Partial<BrowserWebFontFetchError>)
    const renewedAfterTotalLimit = createBrowserWebFontFetch({
      maxTotalBytes: 3,
      fetch: async () => responseAt(url, '[]')
    })
    await expect(renewedAfterTotalLimit(url)).resolves.toBeInstanceOf(Response)

    const requestLimited = createBrowserWebFontFetch({
      maxRequests: 1,
      fetch: async () => responseAt(url, '[]')
    })
    await expect(requestLimited(url)).resolves.toBeInstanceOf(Response)
    await expect(requestLimited(url)).rejects.toMatchObject({
      code: 'request-limit'
    } satisfies Partial<BrowserWebFontFetchError>)
    const renewedAfterRequestLimit = createBrowserWebFontFetch({
      maxRequests: 1,
      fetch: async () => responseAt(url, '[]')
    })
    await expect(renewedAfterRequestLimit(url)).resolves.toBeInstanceOf(Response)
  })

  test('combines factory cancellation, request cancellation, and timeout', async () => {
    const url = 'https://api.fontsource.org/v1/fonts'
    const hangingFetch: typeof globalThis.fetch = async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (signal?.aborted) reject(signal.reason)
        else signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      })

    const timed = createBrowserWebFontFetch({ fetch: hangingFetch, timeoutMs: 5 })
    await expect(timed(url)).rejects.toMatchObject({
      code: 'timeout'
    } satisfies Partial<BrowserWebFontFetchError>)

    const factoryController = new AbortController()
    const factoryCancelled = createBrowserWebFontFetch({
      fetch: hangingFetch,
      signal: factoryController.signal
    })
    factoryController.abort('factory cancelled')
    await expect(factoryCancelled(url)).rejects.toMatchObject({
      code: 'aborted'
    } satisfies Partial<BrowserWebFontFetchError>)

    const requestController = new AbortController()
    const requestCancelled = createBrowserWebFontFetch({ fetch: hangingFetch })
    const pending = requestCancelled(url, { signal: requestController.signal })
    requestController.abort('request cancelled')
    await expect(pending).rejects.toMatchObject({
      code: 'aborted'
    } satisfies Partial<BrowserWebFontFetchError>)
  })
})
