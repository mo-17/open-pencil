import { describe, expect, test } from 'bun:test'

import { FontManager, MAX_BUNDLED_FONT_WORKER_BYTES } from '#core/text/fonts'

import { expectDefined } from '#tests/helpers/assert'
import { asDouble } from '#tests/helpers/doubles'

function requestURL(input: RequestInfo | URL): string {
  if (input instanceof URL) return input.href
  if (typeof input === 'string') return input
  return input.url
}

async function withDedicatedFontWorker<T>(
  workerFetch: typeof fetch,
  run: () => Promise<T>
): Promise<T> {
  const keys = ['close', 'postMessage', 'location', 'fetch'] as const
  const previous = new Map(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  )
  Object.defineProperties(globalThis, {
    close: { configurable: true, value: () => undefined },
    postMessage: { configurable: true, value: () => undefined },
    location: {
      configurable: true,
      value: { href: 'https://editor.openpencil.test/assets/browser-preview-worker.js' }
    },
    fetch: { configurable: true, value: workerFetch }
  })
  try {
    return await run()
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
}

describe('Dedicated Worker bundled font fetch', () => {
  test('uses a bounded credential-free same-origin request', async () => {
    let requestedURL = ''
    let requestedInit: RequestInit | undefined
    const result = await withDedicatedFontWorker(
      asDouble<typeof fetch>(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestedURL = requestURL(input)
        requestedInit = init
        return new Response(new Uint8Array([0, 1, 2, 3]), {
          headers: { 'content-length': '4' }
        })
      }),
      () => new FontManager().fetchBundledFont('/assets/Inter-Regular.ttf')
    )

    expect([...new Uint8Array(expectDefined(result, 'bundled font'))]).toEqual([0, 1, 2, 3])
    expect(requestedURL).toBe('https://editor.openpencil.test/assets/Inter-Regular.ttf')
    expect(requestedInit).toMatchObject({
      credentials: 'omit',
      mode: 'same-origin',
      redirect: 'error',
      referrerPolicy: 'no-referrer'
    })
  })

  test('uses an installed asset locator and shares concurrent Worker requests', async () => {
    const locatedFiles: string[] = []
    const requestedURLs: string[] = []
    let requestedInit: RequestInit | undefined
    const result = await withDedicatedFontWorker(
      asDouble<typeof fetch>(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestedURLs.push(requestURL(input))
        requestedInit = init
        return new Response(new Uint8Array([0, 1, 0, 0]))
      }),
      async () => {
        const manager = new FontManager()
        manager.setBundledFontLocator((file) => {
          locatedFiles.push(file)
          return '/assets/Inter-Regular-reviewed.ttf'
        })
        const first = manager.fetchBundledFont('/Inter-Regular.ttf')
        const second = manager.fetchBundledFont('/Inter-Regular.ttf')
        expect(second).toBe(first)
        const [firstResult, secondResult] = await Promise.all([first, second])
        expect(secondResult).toBe(firstResult)
        return firstResult
      }
    )

    expect(locatedFiles).toEqual(['Inter-Regular.ttf'])
    expect(requestedURLs).toEqual([
      'https://editor.openpencil.test/assets/Inter-Regular-reviewed.ttf'
    ])
    expect([...new Uint8Array(expectDefined(result, 'located bundled font'))]).toEqual([0, 1, 0, 0])
    expect(requestedInit).toMatchObject({
      credentials: 'omit',
      mode: 'same-origin',
      redirect: 'error',
      referrerPolicy: 'no-referrer'
    })
  })

  test('rejects a cross-origin asset locator before making a Worker request', async () => {
    let requestCount = 0
    await withDedicatedFontWorker(
      asDouble<typeof fetch>(async () => {
        requestCount += 1
        return new Response(new Uint8Array([0, 1, 0, 0]))
      }),
      async () => {
        const manager = new FontManager()
        manager.setBundledFontLocator(() => 'https://fonts.example/Inter-Regular.ttf')
        await expect(manager.fetchBundledFont('/Inter-Regular.ttf')).rejects.toThrow(
          'Dedicated Worker HTTP(S) origin'
        )
        expect(requestCount).toBe(0)
      }
    )
  })

  test('rejects cross-origin and oversized responses', async () => {
    let requestCount = 0
    let oversizedResponseCancelled = false
    await withDedicatedFontWorker(
      asDouble<typeof fetch>(async () => {
        requestCount += 1
        return new Response(
          new ReadableStream<Uint8Array>({
            cancel() {
              oversizedResponseCancelled = true
            }
          }),
          {
            headers: { 'content-length': String(MAX_BUNDLED_FONT_WORKER_BYTES + 1) }
          }
        )
      }),
      async () => {
        const crossOriginManager = new FontManager()
        crossOriginManager.setBundledFontLocator(() => 'https://fonts.example/Inter-Regular.ttf')
        await expect(crossOriginManager.fetchBundledFont('/Inter-Regular.ttf')).rejects.toThrow(
          'Dedicated Worker HTTP(S) origin'
        )
        expect(requestCount).toBe(0)

        await expect(
          new FontManager().fetchBundledFont('/assets/Inter-Regular.ttf')
        ).rejects.toThrow('exceeds 12 MiB')
        expect(requestCount).toBe(1)
        expect(oversizedResponseCancelled).toBe(true)
      }
    )
  })

  test('rejects non-ok responses and streamed bodies beyond the byte ceiling', async () => {
    const responses = [
      new Response(null, { status: 404 }),
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(MAX_BUNDLED_FONT_WORKER_BYTES))
            controller.enqueue(new Uint8Array([1]))
            controller.close()
          }
        })
      )
    ]
    await withDedicatedFontWorker(
      asDouble<typeof fetch>(async () => responses.shift() ?? new Response(null, { status: 500 })),
      async () => {
        await expect(new FontManager().fetchBundledFont('/assets/missing.ttf')).rejects.toThrow(
          'HTTP 404'
        )
        await expect(new FontManager().fetchBundledFont('/assets/too-large.ttf')).rejects.toThrow(
          'exceeds 12 MiB'
        )
      }
    )
  })
})

describe('Node bundled font asset loading', () => {
  test('keeps filesystem loading independent of a browser asset locator', async () => {
    const manager = new FontManager()
    manager.setBundledFontLocator(() => {
      throw new Error('Node must not resolve a browser asset URL')
    })

    const result = expectDefined(
      await manager.fetchBundledFont('/Inter-Regular.ttf'),
      'filesystem bundled font'
    )
    expect(Array.from(new Uint8Array(result).slice(0, 4))).toEqual([0, 1, 0, 0])
    expect(result.byteLength).toBeGreaterThan(100_000)
  })
})
