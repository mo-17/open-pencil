import { describe, expect, test } from 'bun:test'

import {
  CAROUSEL_MODULE_LIMITS,
  CAROUSEL_STYLE_DEFAULTS,
  CAROUSEL_NAVIGATION_DEFAULTS,
  createCarouselModuleInstance,
  isSafeCarouselHref,
  resolveCarouselModule
} from '#core/plugins/carousel'

function sparseArray<T>(length: number): T[] {
  const value: T[] = []
  value.length = length
  return value
}

function legacyInstance() {
  const current = createCarouselModuleInstance()
  const config = structuredClone(current.config)
  for (const key of Object.keys({ ...CAROUSEL_STYLE_DEFAULTS, ...CAROUSEL_NAVIGATION_DEFAULTS }))
    Reflect.deleteProperty(config, key)
  return { ...current, configVersion: 1, config }
}

describe('built-in carousel plugin', () => {
  test('creates style version 3 with the previous split-layout defaults', () => {
    const instance = createCarouselModuleInstance()
    expect(instance.configVersion).toBe(3)
    expect(instance.config).toMatchObject({
      layout: 'split',
      imageFit: 'cover',
      textPosition: 'bottom',
      textAlign: 'left',
      overlayOpacity: 0.45,
      paginationStyle: 'dots',
      showDots: true
    })
  })

  test('resolves a strict v1 into a defensive v3 projection without rewriting legacy data', () => {
    const legacy = legacyInstance()
    const original = structuredClone(legacy)
    const resolved = resolveCarouselModule(legacy)
    if (!resolved?.ok) throw new Error('Expected legacy carousel')
    expect(resolved.config).toMatchObject(CAROUSEL_STYLE_DEFAULTS)
    expect(resolved.instance.configVersion).toBe(3)
    expect(legacy).toEqual(original)
    resolved.config.slides[0].title = 'Changed projection'
    expect(legacy).toEqual(original)
    expect(resolveCarouselModule({ ...legacy, configVersion: 2 })?.ok).toBe(false)
    expect(
      resolveCarouselModule({ ...legacy, config: { ...legacy.config, layout: 'overlay' } })?.ok
    ).toBe(false)
    expect(resolveCarouselModule({ ...legacy, configVersion: 3 })?.ok).toBe(false)
  })

  test('validates every style field and finite overlay bounds without coercion', () => {
    for (const patch of [
      { layout: 'grid' },
      { imageFit: 'crop' },
      { textPosition: 'baseline' },
      { textAlign: 'justify' },
      { paginationStyle: 'thumbnails' },
      { overlayOpacity: -0.01 },
      { overlayOpacity: 0.91 },
      { overlayOpacity: Number.NaN },
      { overlayOpacity: Number.POSITIVE_INFINITY },
      { overlayOpacity: '0.45' },
      { imageOnly: true }
    ])
      expect(() => createCarouselModuleInstance(patch)).toThrow()
    for (const overlayOpacity of [0, 0.45, 0.9]) {
      const instance = createCarouselModuleInstance({ layout: 'overlay', overlayOpacity })
      expect(resolveCarouselModule(instance)?.ok).toBe(true)
    }
  })

  test('preserves inactive overlay and pagination preferences in canonical data', () => {
    const source = createCarouselModuleInstance({
      layout: 'split',
      imageFit: 'contain',
      textPosition: 'top',
      textAlign: 'right',
      overlayOpacity: 0.2,
      showDots: false,
      paginationStyle: 'fraction'
    })
    const resolved = resolveCarouselModule(source)
    expect(resolved?.ok && resolved.config).toEqual(source.config)
    const incomplete = structuredClone(source)
    Reflect.deleteProperty(incomplete.config, 'imageFit')
    expect(resolveCarouselModule(incomplete)?.ok).toBe(false)
  })
  test('creates a bounded accessible default and returns defensive slide copies', () => {
    const source = [
      {
        title: 'Remote image',
        description: 'Safe content',
        imageUrl: 'https://media.example.com/slide.webp',
        alt: 'A product preview',
        href: '/details'
      }
    ]
    const instance = createCarouselModuleInstance({ slides: source })
    source[0].title = 'Changed'
    const resolved = resolveCarouselModule(instance)

    expect(resolved?.ok).toBe(true)
    if (!resolved?.ok) throw new Error('expected carousel module to resolve')
    expect(resolved.config.label).toBe('Featured content')
    expect(resolved.config.slides[0].title).toBe('Remote image')
    expect(resolved.config.initialIndex).toBe(0)
  })

  test('accepts only empty, local, fragment, or canonical public HTTPS destinations', () => {
    for (const href of ['', '/', '/features?a=1', '#details', 'https://example.com/path?q=1']) {
      expect(isSafeCarouselHref(href)).toBe(true)
    }
    for (const href of [
      '//example.com/path',
      'http://example.com/path',
      'https://localhost/path',
      'https://127.0.0.1/path',
      'https://user@example.com/path',
      'https://example.com:444/path',
      'https://example.com/path#fragment',
      '/unsafe\\path'
    ]) {
      expect(isSafeCarouselHref(href)).toBe(false)
    }
  })

  test('rejects malformed slides, unsafe media, missing alt text, and sparse arrays', () => {
    expect(() => createCarouselModuleInstance({ slides: [] })).toThrow(
      `1 to ${CAROUSEL_MODULE_LIMITS.slides}`
    )
    expect(() => createCarouselModuleInstance({ slides: sparseArray(1) })).toThrow('slide object')
    expect(() =>
      createCarouselModuleInstance({
        slides: [
          {
            title: 'Title',
            description: '',
            imageUrl: 'http://example.com/image.png',
            alt: 'Unsafe',
            href: '',
            extra: true
          }
        ]
      })
    ).toThrow('must contain exactly')
    expect(() =>
      createCarouselModuleInstance({
        slides: [
          {
            title: 'Title',
            description: '',
            imageUrl: 'https://example.com/image.png',
            alt: '',
            href: ''
          }
        ]
      })
    ).toThrow('.alt must contain 1')
  })

  test('bounds index, timing, colors, enums, and the serialized config budget', () => {
    expect(() => createCarouselModuleInstance({ initialIndex: 3 })).toThrow('existing slide')
    expect(() =>
      createCarouselModuleInstance({ intervalMs: CAROUSEL_MODULE_LIMITS.intervalMsMin - 1 })
    ).toThrow('intervalMs must be between')
    expect(() => createCarouselModuleInstance({ transition: 'spin' })).toThrow('slide or fade')
    expect(() => createCarouselModuleInstance({ accentColor: 'blue' })).toThrow('#RRGGBB')
    expect(() =>
      createCarouselModuleInstance({
        slides: Array.from({ length: CAROUSEL_MODULE_LIMITS.slides }, (_, index) => ({
          title: `Slide ${index}`,
          description: 'x'.repeat(CAROUSEL_MODULE_LIMITS.description),
          imageUrl: `https://media.example.com/${'x'.repeat(1900)}${index}`,
          alt: 'x'.repeat(CAROUSEL_MODULE_LIMITS.alt),
          href: `https://example.com/${'x'.repeat(1900)}${index}`
        }))
      })
    ).toThrow('encoded bytes')
  })
})
