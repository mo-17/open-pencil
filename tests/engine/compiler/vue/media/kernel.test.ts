import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { runInNewContext } from 'node:vm'

import { buildLottieSafetySource, LOTTIE_CONFIG_SOURCE } from '#compiler/adapters/lottie/source'
import { QR_BARCODE_RUNTIME_SOURCE } from '#compiler/adapters/qr-barcode/source'
import { buildOpenPencilLottieComponent } from '#compiler/adapters/react/modules/lottie'

import {
  createAudioPlayerModuleInstance,
  createQrBarcodeModuleInstance,
  LOTTIE_MODULE_LIMITS
} from '@open-pencil/core/plugins'

import {
  MEDIA_ANIMATION,
  MEDIA_REMOTE_URL,
  mediaConfigs
} from '#tests/helpers/compiler/modules/vue-media/fixture'

interface Kernel {
  validateAnimationData(data: unknown): typeof MEDIA_ANIMATION
  canonicalURL(url: string): string
  fetchBoundedAnimationData(
    url: string,
    controller: AbortController
  ): Promise<typeof MEDIA_ANIMATION>
  preserveAspectRatio(fit: 'contain' | 'cover' | 'fill'): string
}
function kernel(fetcher: typeof fetch = fetch): Kernel {
  const source = new Bun.Transpiler({ loader: 'ts' })
    .transformSync(LOTTIE_CONFIG_SOURCE + '\n' + buildLottieSafetySource())
    .replace(/export\s+/g, '')
  return runInNewContext(
    source +
      '\n({validateAnimationData,canonicalURL:canonicalPublicHttpsUrl,fetchBoundedAnimationData,preserveAspectRatio})',
    {
      Object,
      Reflect,
      Array,
      Number,
      JSON,
      WeakSet,
      URL,
      TextEncoder,
      TextDecoder,
      Uint8Array,
      structuredClone,
      fetch: fetcher,
      window: { setTimeout, clearTimeout }
    }
  ) as Kernel
}
function response(source: string | Uint8Array, url = MEDIA_REMOTE_URL, type = 'application/json') {
  const result = new Response(source, { headers: { 'content-type': type } })
  Object.defineProperty(result, 'url', { value: url })
  return result
}

test('shared Lottie extraction retains the exact established React emitted source', () => {
  expect(createHash('sha256').update(buildOpenPencilLottieComponent()).digest('hex')).toBe(
    '44e985018d695f7e868730d8d25a7344b4e79351a88d3e1e10c0f2682b834a3f'
  )
})

test('shared Lottie kernel returns defensive JSON and rejects active or unbounded data', () => {
  const runtime = kernel(),
    data = structuredClone(MEDIA_ANIMATION),
    copy = runtime.validateAnimationData(data)
  expect(copy).toEqual(data)
  expect(copy).not.toBe(data)
  data.layers.length = 0
  expect(copy.layers).toHaveLength(1)
  const invalid = [
    { ...MEDIA_ANIMATION, layers: [{ ty: 6 }] },
    { ...MEDIA_ANIMATION, layers: [{ ty: 2 }] },
    { ...MEDIA_ANIMATION, layers: [{ ty: 4, ks: { o: { x: 'execute()' } } }] },
    { ...MEDIA_ANIMATION, assets: [{ id: 'image', p: 'https://example.com/image.png', u: '' }] },
    { ...MEDIA_ANIMATION, fonts: { list: [{ fPath: 'https://example.com/font.woff' }] } },
    { ...MEDIA_ANIMATION, fr: 0 },
    { ...MEDIA_ANIMATION, op: 18001 },
    { ...MEDIA_ANIMATION, w: LOTTIE_MODULE_LIMITS.dimension + 1 },
    {
      ...MEDIA_ANIMATION,
      layers: Array.from({ length: LOTTIE_MODULE_LIMITS.layers + 1 }, () => ({ ty: 4 }))
    },
    { ...MEDIA_ANIMATION, nm: 'x'.repeat(LOTTIE_MODULE_LIMITS.dataString + 1) },
    JSON.parse('{"v":"5.13.0","fr":30,"ip":0,"op":60,"w":120,"h":120,"layers":[],"__proto__":{}}')
  ]
  for (const value of invalid) expect(() => runtime.validateAnimationData(value)).toThrow()
  expect(
    ['contain', 'cover', 'fill'].map((fit) =>
      runtime.preserveAspectRatio(fit as 'contain' | 'cover' | 'fill')
    )
  ).toEqual(['xMidYMid meet', 'xMidYMid slice', 'none'])
})

test('Lottie public HTTPS boundary rejects local hosts, IPs, credentials, fragments and noncanonical URLs', () => {
  const runtime = kernel()
  expect(runtime.canonicalURL(MEDIA_REMOTE_URL)).toBe(MEDIA_REMOTE_URL)
  for (const url of [
    'http://example.com/a.json',
    'https://localhost/a.json',
    'https://device.local/a.json',
    'https://127.0.0.1/a.json',
    'https://[::1]/a.json',
    'https://user:pass@example.com/a.json',
    'https://example.com/a.json#frame',
    'https://example.com:443/a.json',
    'https://EXAMPLE.com/a.json'
  ])
    expect(() => runtime.canonicalURL(url)).toThrow()
})

test('Lottie bounded stream enforces response authority, MIME, byte budget and UTF8', async () => {
  const requests: RequestInit[] = []
  const valid = kernel((async (_input, init) => {
    requests.push(init ?? {})
    return response(JSON.stringify(MEDIA_ANIMATION))
  }) as typeof fetch)
  expect(await valid.fetchBoundedAnimationData(MEDIA_REMOTE_URL, new AbortController())).toEqual(
    MEDIA_ANIMATION
  )
  expect(requests[0]).toMatchObject({
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
    mode: 'cors'
  })
  for (const bad of [
    response('{}', 'https://other.example.com/a.json'),
    response('{}', MEDIA_REMOTE_URL, 'text/html'),
    response('x'.repeat(LOTTIE_MODULE_LIMITS.dataBytes + 1)),
    response(new Uint8Array([255]))
  ]) {
    const runtime = kernel((async () => bad) as typeof fetch)
    await expect(
      runtime.fetchBoundedAnimationData(MEDIA_REMOTE_URL, new AbortController())
    ).rejects.toThrow()
  }
  const controller = new AbortController(),
    runtime = kernel(
      (async (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true
          })
        })) as typeof fetch
    )
  const pending = runtime.fetchBoundedAnimationData(MEDIA_REMOTE_URL, controller)
  controller.abort()
  await expect(pending).rejects.toThrow('aborted')
})

test('shared QR options preserve local encoder values and authored config limits', () => {
  const source = new Bun.Transpiler({ loader: 'ts' })
    .transformSync(QR_BARCODE_RUNTIME_SOURCE)
    .replace(/export\s+/g, '')
  const runtime = runInNewContext(source + '\n({qrCodeOptions,barcodeOptions})') as {
    qrCodeOptions(config: ReturnType<typeof mediaConfigs>['qr']): unknown
    barcodeOptions(config: ReturnType<typeof mediaConfigs>['barcode']): unknown
  }
  const config = mediaConfigs()
  expect(runtime.qrCodeOptions(config.qr)).toEqual({
    color: { dark: '#111827', light: '#FFFFFF' },
    errorCorrectionLevel: 'M',
    margin: 3,
    width: 1024
  })
  expect(runtime.barcodeOptions(config.barcode)).toEqual({
    background: '#FFFFFF',
    displayValue: false,
    format: 'CODE128',
    height: 160,
    lineColor: '#111827',
    margin: 12,
    width: 3
  })
  for (const invalid of [
    { value: 'x'.repeat(2049) },
    { value: 'x\n' },
    { format: 'code128', value: '中文' },
    { quietZone: 33 },
    { format: 'svg' }
  ])
    expect(() => createQrBarcodeModuleInstance(invalid)).toThrow()
  for (const src of [
    ['java', 'script:alert(1)'].join(''),
    '//example.com/audio.wav',
    '/../secret.wav',
    '/a/%2e%2e/b.wav',
    'https://localhost/audio.wav'
  ])
    expect(() => createAudioPlayerModuleInstance({ src })).toThrow()
  expect(() => createAudioPlayerModuleInstance({ src: '/media/local-tone.wav' })).not.toThrow()
})
