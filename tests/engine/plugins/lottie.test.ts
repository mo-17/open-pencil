import { describe, expect, test } from 'bun:test'

import {
  LOTTIE_MODULE_DEFAULT_SIZE,
  LOTTIE_MODULE_DEFINITION,
  LOTTIE_MODULE_LIMITS,
  createLottieModuleInstance,
  isCanonicalPublicLottieUrl,
  resolveLottieModule,
  validateLottieAnimationData,
  type LottieAnimationDataV1
} from '#core/plugins/lottie'

function vectorData(overrides: Record<string, unknown> = {}): LottieAnimationDataV1 {
  return {
    v: '5.13.0',
    fr: 60,
    ip: 0,
    op: 120,
    w: 360,
    h: 360,
    layers: [{ ty: 4, nm: 'Vector shape' }],
    ...overrides
  }
}

describe('built-in Lottie plugin definition', () => {
  test('creates an exact bounded default and exposes editable fields', () => {
    const instance = createLottieModuleInstance()
    const resolved = resolveLottieModule(instance)

    expect(LOTTIE_MODULE_DEFINITION.defaultSize).toEqual(LOTTIE_MODULE_DEFAULT_SIZE)
    expect(LOTTIE_MODULE_DEFINITION.fields.map((field) => field.path.join('.'))).toEqual([
      'source',
      'url',
      'data',
      'autoplay',
      'loop',
      'speed',
      'direction',
      'fit'
    ])
    expect(resolved?.ok).toBe(true)
    if (!resolved?.ok) throw new Error('expected Lottie module to resolve')
    expect(resolved.config).toMatchObject({
      source: 'url',
      url: '',
      autoplay: true,
      loop: true,
      speed: 1,
      direction: 'forward',
      fit: 'contain'
    })
    expect(resolved.config.data).toEqual({
      v: '5.13.0',
      fr: 60,
      ip: 0,
      op: 1,
      w: 360,
      h: 360,
      layers: []
    })
  })

  test('accepts canonical HTTPS or embedded vector JSON without fetching either source', () => {
    const url = 'https://animations.example.com/hero/loading.json?version=1'
    const data = vectorData()
    const remote = createLottieModuleInstance({ source: 'url', url, data })
    const embedded = createLottieModuleInstance({
      source: 'json',
      url,
      data,
      speed: 1.5,
      direction: 'reverse',
      fit: 'cover'
    })

    expect(isCanonicalPublicLottieUrl(url)).toBe(true)
    expect(resolveLottieModule(remote)?.ok).toBe(true)
    const resolved = resolveLottieModule(embedded)
    expect(resolved?.ok).toBe(true)
    if (!resolved?.ok) throw new Error('expected embedded Lottie module to resolve')
    expect(resolved.config.source).toBe('json')
    expect(resolved.config.speed).toBe(1.5)
    expect(resolved.config.direction).toBe('reverse')
    expect(resolved.config.fit).toBe('cover')

    data.layers.push({ ty: 4, nm: 'Mutated after creation' })
    expect(resolved.config.data.layers).toHaveLength(1)
  })

  test('rejects local, literal-IP, credentialed, fragmented, and non-canonical URLs', () => {
    for (const url of [
      'http://animations.example.com/demo.json',
      'https://localhost/demo.json',
      'https://preview.local/demo.json',
      'https://127.0.0.1/demo.json',
      'https://[::1]/demo.json',
      'https://user:secret@animations.example.com/demo.json',
      'https://animations.example.com/demo.json#frame=1',
      'https://animations.example.com:443/demo.json'
    ]) {
      expect(() => createLottieModuleInstance({ url })).toThrow('canonical public HTTPS URL')
      expect(isCanonicalPublicLottieUrl(url)).toBe(false)
    }
  })

  test('rejects expressions, image/audio assets, external fonts, and unsafe JSON keys', () => {
    expect(() =>
      createLottieModuleInstance({
        source: 'json',
        data: vectorData({ layers: [{ ty: 4, ks: { o: { x: '$bm_rt = 100' } } }] })
      })
    ).toThrow('unsupported Lottie expression')
    expect(() =>
      createLottieModuleInstance({
        source: 'json',
        data: vectorData({ assets: [{ id: 'image_0', p: 'image.png', u: 'images/' }] })
      })
    ).toThrow('image asset')
    expect(() =>
      createLottieModuleInstance({
        source: 'json',
        data: vectorData({ layers: [{ ty: 6, nm: 'Audio' }] })
      })
    ).toThrow('audio layer')
    expect(() =>
      createLottieModuleInstance({
        source: 'json',
        data: vectorData({ fonts: { list: [{ fName: 'Example', fPath: 'font.woff2' }] } })
      })
    ).toThrow('must not load an external font')

    const unsafe = JSON.parse(
      '{"v":"5.13.0","fr":60,"ip":0,"op":1,"w":32,"h":32,"layers":[],"__proto__":{"polluted":true}}'
    ) as unknown
    expect(validateLottieAnimationData(unsafe)).toContain('unsafe key')
  })

  test('enforces structural, duration, size, speed, and exact-key bounds', () => {
    expect(() => createLottieModuleInstance({ data: vectorData({ fr: 0 }) })).toThrow(
      'fr must be greater than 0'
    )
    expect(() => createLottieModuleInstance({ data: vectorData({ fr: 1, op: 601 }) })).toThrow(
      'duration must not exceed'
    )
    expect(() => createLottieModuleInstance({ data: vectorData({ w: 0 }) })).toThrow(
      'w must be an integer'
    )
    expect(() => createLottieModuleInstance({ speed: 0 })).toThrow('speed must be between')
    expect(() => createLottieModuleInstance({ source: 'asset' })).toThrow(
      'source must be url or json'
    )
    expect(() => createLottieModuleInstance({ direction: 'alternate' })).toThrow(
      'direction must be forward or reverse'
    )
    expect(() => createLottieModuleInstance({ fit: 'scale-down' })).toThrow(
      'contain, cover, or fill'
    )
    expect(() =>
      createLottieModuleInstance({
        source: 'url',
        url: '',
        data: vectorData(),
        autoplay: true,
        loop: true,
        speed: 1,
        direction: 'forward',
        fit: 'contain',
        rendererSettings: { expressions: true }
      })
    ).toThrow('contain exactly')

    const oversized = vectorData({
      layers: Array.from({ length: 240 }, (_, index) => ({
        ty: 4,
        nm: `${index}-${'x'.repeat(210)}`
      }))
    })
    expect(new TextEncoder().encode(JSON.stringify(oversized)).byteLength).toBeGreaterThan(
      LOTTIE_MODULE_LIMITS.dataBytes
    )
    expect(validateLottieAnimationData(oversized)).toContain('maximum serialized size')
  })
})
