import { describe, expect, test } from 'bun:test'

import {
  countSitemapUrls,
  mergeHashmaps,
  mergeSitemaps,
  parseHashmap
} from '../.vitepress/build/merge'
import {
  ALL_DOCS_LOCALES,
  DOCS_BUILD_LOCALES,
  resolveDocsBuildLocales
} from '../.vitepress/locale-constants'

describe('partitioned VitePress build metadata', () => {
  test('builds only maintained English and Simplified Chinese partitions by default', () => {
    expect(DOCS_BUILD_LOCALES).toEqual(['en', 'zh-cn'])
    expect(ALL_DOCS_LOCALES).toEqual(['en', 'de', 'fr', 'es', 'it', 'pl', 'ru', 'zh-cn'])
  })

  test('accepts an explicit canonical locale override and rejects unsafe configurations', () => {
    expect(resolveDocsBuildLocales(undefined)).toEqual(['en', 'zh-cn'])
    expect(resolveDocsBuildLocales('zh-cn, de, en')).toEqual(['en', 'de', 'zh-cn'])
    expect(() => resolveDocsBuildLocales('zh-cn')).toThrow('must include en')
    expect(() => resolveDocsBuildLocales('en,klingon')).toThrow('unsupported locale')
    expect(() => resolveDocsBuildLocales('en,en')).toThrow('duplicate locale')
    expect(() => resolveDocsBuildLocales('en,')).toThrow('without empty entries')
  })

  test('merges and sorts disjoint page hashmaps', () => {
    const merged = mergeHashmaps([
      { label: 'en', value: { guide_index: 'english-hash' } },
      { label: 'de', value: { de_guide_index: 'german-hash' } }
    ])

    expect(merged).toEqual({
      de_guide_index: 'german-hash',
      guide_index: 'english-hash'
    })
    expect(parseHashmap(JSON.stringify(merged), 'merged')).toEqual(merged)
  })

  test('rejects conflicting hashmap entries', () => {
    expect(() =>
      mergeHashmaps([
        { label: 'en', value: { guide_index: 'first' } },
        { label: 'de', value: { guide_index: 'second' } }
      ])
    ).toThrow('Hashmap key "guide_index" differs in de')
  })

  test('merges sitemap bodies under one XML declaration and urlset', () => {
    const opening =
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    const merged = mergeSitemaps([
      { label: 'en', source: `${opening}<url><loc>https://example.test/</loc></url></urlset>` },
      {
        label: 'de',
        source: `${opening}<url><loc>https://example.test/de/</loc></url></urlset>`
      }
    ])

    expect(merged.match(/<\?xml/g)).toHaveLength(1)
    expect(merged.match(/<urlset\b/g)).toHaveLength(1)
    expect(countSitemapUrls(merged)).toBe(2)
    expect(merged).toContain('https://example.test/de/')
  })

  test('deduplicates identical sitemap URLs and rejects divergent duplicates', () => {
    const opening = '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    const first = '<url><loc>https://example.test/</loc><lastmod>2026-08-05</lastmod></url>'

    expect(
      countSitemapUrls(
        mergeSitemaps([
          { label: 'en', source: `${opening}${first}</urlset>` },
          { label: 'de', source: `${opening}${first}</urlset>` }
        ])
      )
    ).toBe(1)

    expect(() =>
      mergeSitemaps([
        { label: 'en', source: `${opening}${first}</urlset>` },
        {
          label: 'de',
          source: `${opening}<url><loc>https://example.test/</loc><lastmod>2026-08-06</lastmod></url></urlset>`
        }
      ])
    ).toThrow('de defines https://example.test/ differently')
  })

  test('rejects sitemap partitions with incompatible urlsets', () => {
    expect(() =>
      mergeSitemaps([
        { label: 'en', source: '<urlset xmlns="one"></urlset>' },
        { label: 'de', source: '<urlset xmlns="two"></urlset>' }
      ])
    ).toThrow('de uses a different sitemap urlset declaration')
  })
})
