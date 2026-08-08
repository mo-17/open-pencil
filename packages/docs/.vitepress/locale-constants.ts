export const DEFAULT_DOCS_LOCALE = 'en' as const

export const LOCALE_PREFIXES = ['de', 'fr', 'es', 'it', 'pl', 'ru', 'zh-cn'] as const

export const ALL_DOCS_LOCALES = [DEFAULT_DOCS_LOCALE, ...LOCALE_PREFIXES] as const

export type DocsLocale = (typeof ALL_DOCS_LOCALES)[number]
export type LocalizedDocsLocale = (typeof LOCALE_PREFIXES)[number]

const LOCALIZED_DOCS_LOCALES = new Set<string>(LOCALE_PREFIXES)
const KNOWN_DOCS_LOCALES = new Set<string>(ALL_DOCS_LOCALES)

/** English and Simplified Chinese are the maintained documentation surfaces for this fork. */
export const DOCS_BUILD_LOCALES = ['en', 'zh-cn'] as const satisfies readonly DocsLocale[]

export function isLocalizedDocsLocale(value: string): value is LocalizedDocsLocale {
  return LOCALIZED_DOCS_LOCALES.has(value)
}

export function isDocsLocale(value: string): value is DocsLocale {
  return KNOWN_DOCS_LOCALES.has(value)
}

/** Resolve an optional comma-separated production locale override in canonical order. */
export function resolveDocsBuildLocales(configured: string | undefined): DocsLocale[] {
  if (configured === undefined) return [...DOCS_BUILD_LOCALES]

  const requested = configured.split(',').map((locale) => locale.trim())
  if (requested.some((locale) => locale.length === 0)) {
    throw new Error('DOCS_LOCALES must be a comma-separated list without empty entries')
  }

  const selected = new Set<DocsLocale>()
  for (const locale of requested) {
    if (!isDocsLocale(locale)) {
      throw new Error(`DOCS_LOCALES contains unsupported locale ${JSON.stringify(locale)}`)
    }
    if (selected.has(locale)) {
      throw new Error(`DOCS_LOCALES contains duplicate locale ${JSON.stringify(locale)}`)
    }
    selected.add(locale)
  }

  if (!selected.has(DEFAULT_DOCS_LOCALE)) {
    throw new Error('DOCS_LOCALES must include en as the canonical documentation locale')
  }

  return ALL_DOCS_LOCALES.filter((locale) => selected.has(locale))
}
