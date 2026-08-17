import { describe, expect, test } from 'bun:test'

import { FontManager, MAX_BUNDLED_FONT_WORKER_BYTES } from '#core/text/fonts'

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
    const result: ArrayBuffer = await withDedicatedFontWorker(
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        requestedURL = requestURL(input)
        requestedInit = init
        return new Response(new Uint8Array([0, 1, 2, 3]), {
          headers: { 'content-length': '4' }
        })
      }) as typeof fetch,
      () => new FontManager().fetchBundledFont('/assets/Inter-Regular.ttf')
    )

    expect([...new Uint8Array(result)]).toEqual([0, 1, 2, 3])
    expect(requestedURL).toBe('https://editor.openpencil.test/assets/Inter-Regular.ttf')
    expect(requestedInit).toMatchObject({
      credentials: 'omit',
      mode: 'same-origin',
      redirect: 'error',
      referrerPolicy: 'no-referrer'
    })
  })

  test('rejects cross-origin and oversized responses', async () => {
    let requestCount = 0
    let oversizedResponseCancelled = false
    await withDedicatedFontWorker(
      (async () => {
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
      }) as typeof fetch,
      async () => {
        await expect(
          new FontManager().fetchBundledFont('https://fonts.example/Inter-Regular.ttf')
        ).rejects.toThrow('Dedicated Worker HTTP(S) origin')
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
      (async () => responses.shift() ?? new Response(null, { status: 500 })) as typeof fetch,
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
