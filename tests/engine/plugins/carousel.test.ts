import { describe, expect, test } from 'bun:test'

import {
  CAROUSEL_MODULE_LIMITS,
  createCarouselModuleInstance,
  isSafeCarouselHref,
  resolveCarouselModule
} from '#core/plugins/carousel'

function sparseArray<T>(length: number): T[] {
  const value: T[] = []
  value.length = length
  return value
}

describe('built-in carousel plugin', () => {
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
