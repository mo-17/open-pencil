import * as OpenTypeSync from 'opentype.js'

import { assessFontLicenseBytes } from '#core/text/font/license'
import {
  fontFamilyLicenseDisplayFromAssessments,
  type FontFamilyLicenseDisplay
} from '#core/text/font/license-display'

export const MAX_IMPORTED_FONT_BYTES = 32 * 1024 * 1024

export type ImportedFontFormat = 'truetype' | 'opentype' | 'woff'

export interface ImportedFontInspection {
  family: string
  style: string
  postscriptName?: string
  format: ImportedFontFormat
  byteLength: number
  licenseDisplay: FontFamilyLicenseDisplay
}

interface ImportedOpenTypeFont {
  getEnglishName(name: string): string | undefined
}

function cleanName(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined
  const cleaned = Array.from(value)
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0
      return code >= 32 && code !== 127
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned ? cleaned.slice(0, maxLength) : undefined
}

export function importedFontFormat(bytes: ArrayBuffer): ImportedFontFormat | null {
  if (bytes.byteLength < 4) return null
  const signature = new DataView(bytes).getUint32(0)
  if (signature === 0x00010000 || signature === 0x74727565 || signature === 0x74797031) {
    return 'truetype'
  }
  if (signature === 0x4f54544f) return 'opentype'
  if (signature === 0x774f4646) return 'woff'
  return null
}

/**
 * Parse caller-owned font bytes before they enter a renderer or persistent cache.
 * WOFF2 and TTC are intentionally rejected until the app has bounded decoders for them.
 */
export async function inspectImportedFontBytes(
  bytes: ArrayBuffer
): Promise<ImportedFontInspection> {
  if (bytes.byteLength === 0) throw new Error('The selected font file is empty')
  if (bytes.byteLength > MAX_IMPORTED_FONT_BYTES) {
    throw new Error(`Font files must be ${MAX_IMPORTED_FONT_BYTES / 1024 / 1024} MiB or smaller`)
  }
  const format = importedFontFormat(bytes)
  if (!format) throw new Error('Only valid TTF, OTF, and WOFF font files are supported')

  let font: ImportedOpenTypeFont
  try {
    font = OpenTypeSync.parse(bytes.slice(0)) as ImportedOpenTypeFont
  } catch {
    throw new Error('The selected font file is damaged or unsupported')
  }

  const family = cleanName(
    font.getEnglishName('preferredFamily') ?? font.getEnglishName('fontFamily'),
    200
  )
  if (!family) throw new Error('The selected font file has no usable family name')
  const style =
    cleanName(
      font.getEnglishName('preferredSubfamily') ?? font.getEnglishName('fontSubfamily'),
      100
    ) ?? 'Regular'
  const postscriptName = cleanName(font.getEnglishName('postScriptName'), 200)
  const assessment = await assessFontLicenseBytes(family, style, bytes)

  return {
    family,
    style,
    ...(postscriptName ? { postscriptName } : {}),
    format,
    byteLength: bytes.byteLength,
    licenseDisplay: fontFamilyLicenseDisplayFromAssessments([assessment])
  }
}
