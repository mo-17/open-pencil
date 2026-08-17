import {
  DEFAULT_WEB_FONT_PROVIDER_SETTINGS,
  WEB_FONT_PROVIDER_IDS,
  type WebFontProviderId
} from '@open-pencil/core/text'

export type FontProviderSettings = Record<WebFontProviderId, boolean>

export interface FontProviderSettingsStorageSerializer {
  read(value: string): FontProviderSettings
  write(value: FontProviderSettings): string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Migrates the browser's persisted provider policy without trusting its shape.
 *
 * Provider ids are added over time. VueUse restores the old object verbatim, so a browser that
 * predates Fontsource otherwise reads its missing `fontsource` key as disabled forever. Preserve
 * explicit booleans and fill only absent or malformed values from the reviewed defaults.
 */
export function normalizeFontProviderSettings(value: unknown): FontProviderSettings {
  const stored = isRecord(value) ? value : {}
  return Object.fromEntries(
    WEB_FONT_PROVIDER_IDS.map((provider) => [
      provider,
      typeof stored[provider] === 'boolean'
        ? stored[provider]
        : DEFAULT_WEB_FONT_PROVIDER_SETTINGS[provider]
    ])
  ) as FontProviderSettings
}

/** Normalizes initial reads and every later cross-document storage event. */
export const FONT_PROVIDER_SETTINGS_STORAGE_SERIALIZER: FontProviderSettingsStorageSerializer =
  Object.freeze({
    read(value: string): FontProviderSettings {
      try {
        return normalizeFontProviderSettings(JSON.parse(value))
      } catch {
        return normalizeFontProviderSettings(null)
      }
    },
    write(value: FontProviderSettings): string {
      return JSON.stringify(normalizeFontProviderSettings(value))
    }
  })
