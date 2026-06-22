import type { ArgsDef } from 'citty'

/**
 * Phase 3 §9 v13 — shared `--i18n` / `--locale` / `--source-locale` flags for the
 * codegen commands (`compile`, `build`). Without these the entire §9 i18n chain
 * (react-intl runtime, locale catalogs, LocaleSwitcher, RTL, coverage report) had
 * no CLI entry point (the editor preview compiles with i18n off). Shared here so
 * both commands stay identical (and to avoid a jscpd clone).
 */
export const i18nArgs: ArgsDef = {
  i18n: {
    type: 'boolean',
    description:
      'Enable the react-intl i18n runtime (externalize text, emit locale catalogs + LocaleSwitcher).',
    required: false
  },
  locale: {
    type: 'string',
    description:
      'A target locale beyond the source (repeatable, e.g. --locale fr --locale ar). Implies --i18n.',
    required: false
  },
  'source-locale': {
    type: 'string',
    description: 'The locale the canvas strings are authored in (default: en). Implies --i18n.',
    required: false
  }
}

/** The raw i18n-related args as citty parses them. */
export interface RawI18nArgs {
  i18n?: boolean
  locale?: string | string[]
  'source-locale'?: string
}

/** Resolve the parsed flags into compiler options. `--locale` / `--source-locale`
 *  imply `--i18n` (else the emitted catalogs would be dead). A repeated `--locale`
 *  arrives as an array; a single one as a string. */
export function resolveI18nFlags(args: RawI18nArgs): {
  i18n: boolean
  locales: string[]
  sourceLocale: string | undefined
} {
  const raw = args.locale
  let locales: string[] = []
  if (Array.isArray(raw)) locales = raw
  else if (raw !== undefined) locales = [raw]
  const sourceLocale = args['source-locale']
  const i18n = args.i18n === true || locales.length > 0 || sourceLocale !== undefined
  return { i18n, locales, sourceLocale }
}
