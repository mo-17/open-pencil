import { describe, expect, test } from 'bun:test'

import { FEATURE_KINDS } from '#docs-config/theme/landing/content/features'
import { posterParts, posterPath } from '#docs-config/theme/landing/posters'
import { posterTargets } from '#landing-posters/capture'

const TARGET = {
  fingerprint: '0123456789abcdef',
  locale: 'ru',
  theme: 'dark',
  layout: 'phone'
} as const

describe('landing poster paths', () => {
  test('name the fingerprint, locale, theme, layout, stage, and part', () => {
    expect(posterPath(TARGET, 'design', 'panel')).toBe(
      'landing-posters/0123456789abcdef/ru/dark-phone/design-panel.webp'
    )
  })

  test('split single-editor stages into canvas and panel, and keep collaboration whole', () => {
    expect(posterParts('design')).toEqual(['canvas', 'panel'])
    expect(posterParts('ai')).toEqual(['canvas', 'panel'])
    expect(posterParts('collab')).toEqual(['frame'])
  })

  test('are unique across every stage and part of a page', () => {
    const paths = FEATURE_KINDS.flatMap((kind) =>
      posterParts(kind).map((part) => posterPath(TARGET, kind, part))
    )
    expect(new Set(paths).size).toBe(paths.length)
  })
})

describe('landing poster build locale contract', () => {
  test('captures only maintained default locales with every theme and layout', () => {
    const targets = posterTargets(TARGET.fingerprint, undefined)
    expect(new Set(targets.map((target) => target.locale))).toEqual(new Set(['root', 'zh-cn']))
    expect(targets).toHaveLength(8)
    for (const locale of ['root', 'zh-cn']) {
      expect(
        targets
          .filter((target) => target.locale === locale)
          .map((target) => `${target.theme}/${target.layout}`)
      ).toEqual(['light/desktop', 'light/phone', 'dark/desktop', 'dark/phone'])
    }
  })

  test('retains explicitly enabled locales and canonicalizes capture cache identity', () => {
    const german = posterTargets(TARGET.fingerprint, 'en,de')
    expect(new Set(german.map((target) => target.locale))).toEqual(new Set(['root', 'de']))
    expect(german).toHaveLength(8)
    expect(JSON.stringify(posterTargets(TARGET.fingerprint, 'de,en'))).toBe(JSON.stringify(german))
    expect(JSON.stringify(posterTargets(TARGET.fingerprint, 'en,zh-cn'))).not.toBe(
      JSON.stringify(german)
    )
    const all = posterTargets(TARGET.fingerprint, 'en,de,fr,es,it,pl,ru,zh-cn')
    expect(all).toHaveLength(32)
    expect(new Set(all.map((target) => target.locale)).size).toBe(8)
    expect(
      new Set(all.map((target) => `${target.locale}/${target.theme}/${target.layout}`)).size
    ).toBe(32)
    expect(() => posterTargets(TARGET.fingerprint, 'de')).toThrow()
    expect(() => posterTargets(TARGET.fingerprint, 'en,unknown')).toThrow()
  })
})
