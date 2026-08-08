import { describe, expect, test } from 'bun:test'

import {
  applyPageSeoUsing,
  availableLocaleKeysForSlug,
  withAlternateSitemapLinksUsing,
  type MarkdownSourceExists
} from '../.vitepress/seo'

function sourceChecker(paths: readonly string[]): MarkdownSourceExists {
  const sources = new Set(paths)
  return (relativePath) => sources.has(relativePath)
}

describe('localized documentation SEO', () => {
  test('recognizes only locales with a Markdown source for the same route', () => {
    const sourceExists = sourceChecker([
      'guide/getting-started.md',
      'de/guide/getting-started.md',
      'zh-cn/guide/getting-started.md'
    ])

    expect(availableLocaleKeysForSlug('guide/getting-started', sourceExists)).toEqual([
      'en',
      'zh-cn'
    ])
    expect(
      availableLocaleKeysForSlug('guide/getting-started', sourceExists, ['en', 'de', 'zh-cn'])
    ).toEqual(['en', 'de', 'zh-cn'])
    expect(availableLocaleKeysForSlug('', sourceChecker(['index.md', 'zh-cn/index.md']))).toEqual([
      'en',
      'zh-cn'
    ])
  })

  test('uses Chinese Open Graph metadata without advertising missing translations', () => {
    const page = {
      relativePath: 'zh-cn/guide/getting-started.md',
      title: '快速开始',
      description: '开始使用 OpenPencil。',
      frontmatter: {
        head: [] as [string, Record<string, string>][]
      }
    }
    const sourceExists = sourceChecker([
      'guide/getting-started.md',
      'de/guide/getting-started.md',
      'zh-cn/guide/getting-started.md'
    ])

    applyPageSeoUsing(page, sourceExists)

    const localeMetadata = page.frontmatter.head
      .filter(([tag, attributes]) => tag === 'meta' && attributes.property === 'og:locale')
      .map(([, attributes]) => attributes.content)
    const alternateOgLocales = page.frontmatter.head
      .filter(
        ([tag, attributes]) => tag === 'meta' && attributes.property === 'og:locale:alternate'
      )
      .map(([, attributes]) => attributes.content)
    const alternateOgMetadata = page.frontmatter.head.filter(
      ([tag, attributes]) => tag === 'meta' && attributes.property === 'og:locale:alternate'
    )
    const alternateLanguages = page.frontmatter.head
      .filter(([tag, attributes]) => tag === 'link' && attributes.rel === 'alternate')
      .map(([, attributes]) => attributes.hreflang)

    expect(localeMetadata).toEqual(['zh_CN'])
    expect(alternateOgLocales).toEqual(['en_US'])
    expect(
      alternateOgMetadata.every(([, attributes]) => Object.keys(attributes)[0] === 'content')
    ).toBe(true)
    expect(alternateLanguages).toEqual(['en', 'zh-CN', 'x-default'])
    expect(page.frontmatter.head).not.toContainEqual([
      'link',
      expect.objectContaining({ href: 'https://openpencil.dev/de/guide/getting-started' })
    ])
    expect(page.frontmatter.head).not.toContainEqual([
      'link',
      expect.objectContaining({ href: 'https://openpencil.dev/fr/guide/getting-started' })
    ])
  })

  test('restores archived locale metadata only when explicitly enabled', () => {
    const page = {
      relativePath: 'zh-cn/guide/getting-started.md',
      title: '快速开始',
      description: '开始使用 OpenPencil。',
      frontmatter: {
        head: [] as [string, Record<string, string>][]
      }
    }
    const sourceExists = sourceChecker([
      'guide/getting-started.md',
      'de/guide/getting-started.md',
      'zh-cn/guide/getting-started.md'
    ])

    applyPageSeoUsing(page, sourceExists, ['en', 'de', 'zh-cn'])

    const alternateLanguages = page.frontmatter.head
      .filter(([tag, attributes]) => tag === 'link' && attributes.rel === 'alternate')
      .map(([, attributes]) => attributes.hreflang)
    expect(alternateLanguages).toEqual(['en', 'de', 'zh-CN', 'x-default'])
  })

  test('omits missing locale URLs from sitemap alternates', () => {
    const items = [
      {
        url: 'https://openpencil.dev/zh-cn/user-guide/plugins',
        links: [] as Array<{ lang: string; url: string }>
      }
    ]
    const result = withAlternateSitemapLinksUsing(
      items,
      sourceChecker(['user-guide/plugins.md', 'zh-cn/user-guide/plugins.md'])
    )

    expect(result[0].links).toEqual([
      { lang: 'en', url: 'https://openpencil.dev/user-guide/plugins' },
      { lang: 'zh-CN', url: 'https://openpencil.dev/zh-cn/user-guide/plugins' }
    ])
  })
})
