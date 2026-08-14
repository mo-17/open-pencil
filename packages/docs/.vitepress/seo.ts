import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DOCS_BUILD_LOCALES, isLocalizedDocsLocale, type DocsLocale } from './locale-constants'

export const BASE = 'https://openpencil.dev'

export const LOCALES = {
  en: { hreflang: 'en', ogLocale: 'en_US', prefix: '' },
  de: { hreflang: 'de', ogLocale: 'de_DE', prefix: '/de' },
  fr: { hreflang: 'fr', ogLocale: 'fr_FR', prefix: '/fr' },
  es: { hreflang: 'es', ogLocale: 'es_ES', prefix: '/es' },
  it: { hreflang: 'it', ogLocale: 'it_IT', prefix: '/it' },
  pl: { hreflang: 'pl', ogLocale: 'pl_PL', prefix: '/pl' },
  ru: { hreflang: 'ru', ogLocale: 'ru_RU', prefix: '/ru' },
  'zh-cn': { hreflang: 'zh-CN', ogLocale: 'zh_CN', prefix: '/zh-cn' }
} as const satisfies Record<DocsLocale, { hreflang: string; ogLocale: string; prefix: string }>

const docsRoot = fileURLToPath(new URL('..', import.meta.url))

export const siteHead: [string, Record<string, string>][] = [
  ['link', { rel: 'icon', type: 'image/png', href: '/favicon.png' }],
  ['link', { rel: 'alternate', type: 'text/plain', title: 'llms.txt', href: '/llms.txt' }],
  [
    'link',
    { rel: 'alternate', type: 'text/plain', title: 'llms-full.txt', href: '/llms-full.txt' }
  ],
  ['meta', { property: 'og:type', content: 'website' }],
  ['meta', { property: 'og:site_name', content: 'OpenPencil' }],
  ['meta', { property: 'og:image', content: `${BASE}/screenshot.png` }],
  ['meta', { property: 'og:image:width', content: '2784' }],
  ['meta', { property: 'og:image:height', content: '1824' }],
  ['meta', { property: 'og:image:alt', content: 'OpenPencil — AI-Native Design Editor' }],
  ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
  ['meta', { name: 'twitter:site', content: '@openpencildev' }],
  ['meta', { name: 'twitter:image', content: `${BASE}/screenshot.png` }]
]

type SitemapItem = {
  url: string
  links?: Array<{ lang: string; url: string }>
}

type PageDataLike = {
  relativePath: string
  title?: string
  description?: string
  frontmatter: {
    head?: [string, Record<string, string>][]
  }
}

export type MarkdownSourceExists = (relativePath: string) => boolean

function normalizedRoutePath(path: string): string {
  let pathname = path
  if (/^https?:\/\//.test(path)) {
    try {
      pathname = new URL(path).pathname
    } catch {
      pathname = path
    }
  }
  return pathname.split(/[?#]/, 1)[0].replace(/^\/+|\/+$/g, '')
}

function stripLocalePrefix(path: string): string {
  const normalized = normalizedRoutePath(path)
  const [firstSegment, ...remainingSegments] = normalized.split('/')
  return firstSegment && isLocalizedDocsLocale(firstSegment)
    ? remainingSegments.join('/')
    : normalized
}

function localeKeyForPath(path: string): DocsLocale {
  const firstSegment = normalizedRoutePath(path).split('/', 1)[0]
  return firstSegment && isLocalizedDocsLocale(firstSegment) ? firstSegment : 'en'
}

function slugForPath(path: string): string {
  return stripLocalePrefix(path)
    .replace(/\.md$/, '')
    .replace(/\/index$/, '')
    .replace(/^index$/, '')
    .replace(/\/$/, '')
}

function localizedUrl(slug: string, prefix: string): string {
  if (slug) return `${BASE}${prefix}/${slug}`
  return `${BASE}${prefix || ''}`
}

function sourceCandidates(slug: string, localeKey: DocsLocale): string[] {
  const prefix = LOCALES[localeKey].prefix.replace(/^\//, '')
  const route = [prefix, slug].filter(Boolean).join('/') || 'index'
  return [`${route}.md`, `${route}/index.md`]
}

function defaultMarkdownSourceExists(relativePath: string): boolean {
  return existsSync(resolve(docsRoot, relativePath))
}

export function availableLocaleKeysForSlug(
  slug: string,
  sourceExists: MarkdownSourceExists = defaultMarkdownSourceExists,
  enabledLocales: readonly DocsLocale[] = DOCS_BUILD_LOCALES
): DocsLocale[] {
  return enabledLocales.filter((localeKey) => sourceCandidates(slug, localeKey).some(sourceExists))
}

function localeKeysForExistingPage(
  path: string,
  sourceExists: MarkdownSourceExists,
  enabledLocales: readonly DocsLocale[]
): DocsLocale[] {
  const currentLocale = localeKeyForPath(path)
  const available = new Set(
    availableLocaleKeysForSlug(slugForPath(path), sourceExists, enabledLocales)
  )
  available.add(currentLocale)
  return enabledLocales.filter((localeKey) => available.has(localeKey))
}

export function withAlternateSitemapLinks<T extends SitemapItem>(
  items: T[],
  enabledLocales: readonly DocsLocale[] = DOCS_BUILD_LOCALES
): T[] {
  return withAlternateSitemapLinksUsing(items, defaultMarkdownSourceExists, enabledLocales)
}

export function withAlternateSitemapLinksUsing<T extends SitemapItem>(
  items: T[],
  sourceExists: MarkdownSourceExists,
  enabledLocales: readonly DocsLocale[] = DOCS_BUILD_LOCALES
): T[] {
  return items.map((item) => {
    const slug = slugForPath(item.url)
    return {
      ...item,
      links: localeKeysForExistingPage(item.url, sourceExists, enabledLocales).map((localeKey) => {
        const locale = LOCALES[localeKey]
        const url = slug ? `${BASE}${locale.prefix}/${slug}` : `${BASE}${locale.prefix || '/'}`
        return { lang: locale.hreflang, url }
      })
    }
  })
}

export function applyPageSeo(
  pageData: PageDataLike,
  enabledLocales: readonly DocsLocale[] = DOCS_BUILD_LOCALES
): void {
  applyPageSeoUsing(pageData, defaultMarkdownSourceExists, enabledLocales)
}

export function applyPageSeoUsing(
  pageData: PageDataLike,
  sourceExists: MarkdownSourceExists,
  enabledLocales: readonly DocsLocale[] = DOCS_BUILD_LOCALES
): void {
  const localeKey = localeKeyForPath(pageData.relativePath)
  const locale = LOCALES[localeKey]
  const slug = slugForPath(pageData.relativePath)
  const pageUrl = localizedUrl(slug, locale.prefix)
  const enSlug = slug ? `${BASE}/${slug}` : BASE
  const availableLocaleKeys = localeKeysForExistingPage(
    pageData.relativePath,
    sourceExists,
    enabledLocales
  )

  pageData.frontmatter.head ??= []
  const head = pageData.frontmatter.head

  head.push(['link', { rel: 'canonical', href: pageUrl }])
  head.push(['meta', { property: 'og:url', content: pageUrl }])
  head.push(['meta', { property: 'og:locale', content: locale.ogLocale }])

  for (const key of availableLocaleKeys) {
    if (key !== localeKey) {
      const loc = LOCALES[key]
      // VitePress de-duplicates meta tags by their first attribute. Keep content
      // first so multiple valid Open Graph locale alternates survive the merge.
      head.push(['meta', { content: loc.ogLocale, property: 'og:locale:alternate' }])
    }
  }

  for (const availableLocaleKey of availableLocaleKeys) {
    const localeOption = LOCALES[availableLocaleKey]
    head.push([
      'link',
      {
        rel: 'alternate',
        hreflang: localeOption.hreflang,
        href: localizedUrl(slug, localeOption.prefix),
      },
    ])
  }
  if (availableLocaleKeys.includes('en')) {
    head.push(['link', { rel: 'alternate', hreflang: 'x-default', href: enSlug }])
  }

  if (pageData.title) {
    const ogTitle = `${pageData.title} — OpenPencil`
    head.push(['meta', { property: 'og:title', content: ogTitle }])
    head.push(['meta', { name: 'twitter:title', content: ogTitle }])
  }

  if (pageData.description) {
    head.push(['meta', { property: 'og:description', content: pageData.description }])
    head.push(['meta', { name: 'twitter:description', content: pageData.description }])
    head.push(['meta', { name: 'description', content: pageData.description }])
  }
}
