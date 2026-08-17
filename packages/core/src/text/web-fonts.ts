import type { FontFaceData, RemoteFontSource, ResolveFontResult } from 'unifont'

import { IS_BROWSER } from '#core/constants'
import { parseFontStyle } from '#core/text/face'
import {
  coordinatedWebFontFetch,
  retryableCachedPromise,
  withWebFontFetchProxy
} from '#core/text/web-font/fetch-proxy'
import {
  createProviderUnifont,
  isRemoteFontSource,
  type WebFontResolveOptions,
  type WebUnifont
} from '#core/text/web-font/providers'

export const WEB_FONT_PROVIDER_IDS = ['google', 'fontsource', 'bunny', 'fontshare'] as const
export type WebFontProviderId = (typeof WEB_FONT_PROVIDER_IDS)[number]

export const WEB_FONT_PROVIDER_LABELS: Record<WebFontProviderId, string> = {
  google: 'Google Fonts',
  fontsource: 'Fontsource',
  bunny: 'Bunny Fonts',
  fontshare: 'Fontshare'
}

export const DEFAULT_WEB_FONT_PROVIDER_SETTINGS: Record<WebFontProviderId, boolean> = {
  google: true,
  fontsource: true,
  bunny: false,
  fontshare: false
}

export type WebFontFetch = (url: string, init?: RequestInit) => Promise<Response>

const DEFAULT_WEB_FONT_SUBSETS = [
  'latin',
  'latin-ext',
  'vietnamese',
  'cyrillic',
  'cyrillic-ext',
  'greek',
  'greek-ext'
]

function inRange(codePoint: number, start: number, end: number): boolean {
  return codePoint >= start && codePoint <= end
}

function isLatinCodePoint(codePoint: number): boolean {
  return (
    inRange(codePoint, 0x0041, 0x005a) ||
    inRange(codePoint, 0x0061, 0x007a) ||
    inRange(codePoint, 0x00c0, 0x00ff) ||
    inRange(codePoint, 0x0100, 0x024f) ||
    inRange(codePoint, 0x1e00, 0x1eff) ||
    inRange(codePoint, 0x2c60, 0x2c7f) ||
    inRange(codePoint, 0xa720, 0xa7ff) ||
    inRange(codePoint, 0xab30, 0xab6f) ||
    inRange(codePoint, 0xff21, 0xff3a) ||
    inRange(codePoint, 0xff41, 0xff5a)
  )
}

function isLatinExtendedCodePoint(codePoint: number): boolean {
  return isLatinCodePoint(codePoint) && codePoint > 0x00ff
}

function isVietnameseCodePoint(codePoint: number): boolean {
  return (
    codePoint === 0x0102 ||
    codePoint === 0x0103 ||
    codePoint === 0x0110 ||
    codePoint === 0x0111 ||
    codePoint === 0x0128 ||
    codePoint === 0x0129 ||
    codePoint === 0x0168 ||
    codePoint === 0x0169 ||
    inRange(codePoint, 0x01a0, 0x01a1) ||
    inRange(codePoint, 0x01af, 0x01b0) ||
    inRange(codePoint, 0x1ea0, 0x1ef9)
  )
}

export function normalizedCoverageText(text: string): string {
  return Array.from(new Set(text)).sort().join('')
}

export function webFontSubsetsForText(text: string): string[] {
  // An empty coverage string means the caller cannot prove which glyphs are
  // needed. Preserve the historical broad request in that case. Once text is
  // known, requesting every Latin/Greek/Cyrillic shard multiplies CDN traffic
  // and can exhaust the bounded browser-preview request budget.
  if (!text) return [...DEFAULT_WEB_FONT_SUBSETS]

  const codePoints = Array.from(text, (character) => character.codePointAt(0) ?? 0)
  const hasLatin = codePoints.some(isLatinCodePoint)
  const hasVietnamese = codePoints.some(isVietnameseCodePoint)
  const hasLatinExtended = codePoints.some(
    (codePoint) => isLatinExtendedCodePoint(codePoint) && !isVietnameseCodePoint(codePoint)
  )
  const hasCyrillic = /\p{Script=Cyrillic}/u.test(text)
  const hasCyrillicExtended = codePoints.some(
    (codePoint) => inRange(codePoint, 0x0460, 0x052f) || inRange(codePoint, 0x2de0, 0x2dff)
  )
  const hasGreek = /\p{Script=Greek}/u.test(text)
  const hasGreekExtended = codePoints.some((codePoint) => inRange(codePoint, 0x1f00, 0x1fff))
  const subsets: string[] = []
  if (hasLatin) subsets.push('latin')
  if (hasLatinExtended) subsets.push('latin-ext')
  if (hasVietnamese) subsets.push('vietnamese')
  if (hasCyrillic) subsets.push('cyrillic')
  if (hasCyrillicExtended) subsets.push('cyrillic-ext')
  if (hasGreek) subsets.push('greek')
  if (hasGreekExtended) subsets.push('greek-ext')
  if (/\p{Script=Arabic}/u.test(text)) subsets.push('arabic')
  if (/\p{Script=Hangul}/u.test(text)) subsets.push('korean')
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) subsets.push('japanese')
  if (/\p{Script=Han}/u.test(text)) {
    subsets.push('chinese-simplified', 'chinese-traditional')
    if (!subsets.includes('japanese')) subsets.push('japanese')
  }
  // Digits, punctuation, emoji, and unclassified scripts still need a
  // deterministic provider request. Latin is the smallest portable fallback.
  return subsets.length > 0 ? subsets : ['latin']
}

export interface WebFontFaceAttempt {
  weight: number
  style: 'normal' | 'italic'
}

export function webFontFaceAttempts(
  weight: number,
  style: 'normal' | 'italic'
): WebFontFaceAttempt[] {
  const values: WebFontFaceAttempt[] = [
    { weight, style },
    { weight: 400, style },
    { weight: 400, style: 'normal' }
  ]
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = `${value.weight}|${value.style}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function preferredRemoteSource(face: FontFaceData): RemoteFontSource | undefined {
  const sources = face.src.filter(isRemoteFontSource)
  return (
    sources.find((source) => source.format === 'truetype' || source.format === 'ttf') ??
    sources.find((source) => source.format === 'opentype' || source.format === 'otf') ??
    sources.find((source) => source.format === 'woff2') ??
    sources.find((source) => source.format === 'woff') ??
    sources[0]
  )
}

function resolvedRemoteFaces(result: ResolveFontResult): Array<{
  source: RemoteFontSource
  init?: RequestInit
}> {
  const candidates = result.fonts.flatMap((face) => {
    const source = preferredRemoteSource(face)
    return source ? [{ source, init: face.meta?.init, priority: face.meta?.priority ?? 0 }] : []
  })
  const preferredPriority = Math.min(...candidates.map((candidate) => candidate.priority))
  const seen = new Set<string>()
  const faces: Array<{ source: RemoteFontSource; init?: RequestInit }> = []
  for (const candidate of candidates) {
    if (candidate.priority !== preferredPriority || seen.has(candidate.source.url)) continue
    seen.add(candidate.source.url)
    faces.push({ source: candidate.source, init: candidate.init })
  }
  return faces
}

function isArrayBuffer(value: ArrayBuffer | null): value is ArrayBuffer {
  return value !== null
}

export interface ResolvedWebFont {
  buffers: ArrayBuffer[]
  provider: WebFontProviderId
}

export class WebFontResolver {
  private enabled = new Set<WebFontProviderId>(
    WEB_FONT_PROVIDER_IDS.filter((provider) => DEFAULT_WEB_FONT_PROVIDER_SETTINGS[provider])
  )
  private unifontPromises = new Map<WebFontProviderId, Promise<WebUnifont>>()
  private familiesCache = new Map<WebFontProviderId, string[]>()
  private familiesPromises = new Map<WebFontProviderId, Promise<string[]>>()
  private failedFonts = new Set<string>()
  private fontPromises = new Map<string, Promise<ArrayBuffer[]>>()
  private remoteFetch: WebFontFetch | null = null

  setEnabled(settings: Partial<Record<WebFontProviderId, boolean>>): void {
    this.enabled = new Set(WEB_FONT_PROVIDER_IDS.filter((provider) => settings[provider] === true))
    this.failedFonts.clear()
  }

  setRemoteFetch(fetcher: WebFontFetch | null): void {
    this.remoteFetch = fetcher
    this.unifontPromises.clear()
    this.familiesPromises.clear()
    this.familiesCache.clear()
    this.failedFonts.clear()
  }

  enabledProviders(): WebFontProviderId[] {
    return WEB_FONT_PROVIDER_IDS.filter((provider) => this.enabled.has(provider))
  }

  preloadFamilies(): void {
    if (IS_BROWSER && !this.remoteFetch) return
    for (const provider of this.enabledProviders()) void this.listFamilies(provider)
  }

  async listFamilies(provider: WebFontProviderId): Promise<string[]> {
    const cached = this.familiesCache.get(provider)
    if (cached) return cached

    let promise = this.familiesPromises.get(provider)
    if (!promise) {
      promise = this.loadFamilies(provider)
      this.familiesPromises.set(provider, promise)
    }
    return promise
  }

  async fetchFont(
    families: string[],
    style: string,
    characters = ''
  ): Promise<ResolvedWebFont | null> {
    const providers = this.enabledProviders()
    if (providers.length === 0 || (IS_BROWSER && !this.remoteFetch)) return null

    for (const family of families) {
      for (const provider of providers) {
        const buffers = await this.fetchFromProvider(family, style, provider, characters)
        if (buffers.length > 0) return { buffers, provider }
      }
    }

    return null
  }

  clearFailedFont(families: readonly string[], style: string, characters = ''): void {
    const coverage = normalizedCoverageText(characters)
    for (const family of families) {
      for (const provider of this.enabledProviders()) {
        const key = `${provider}|${family}|${style}|${coverage}`
        this.fontPromises.delete(key)
        if (this.failedFonts.delete(key)) this.unifontPromises.delete(provider)
      }
    }
  }

  private async withFetchProxy<T>(operation: () => Promise<T>): Promise<T> {
    return withWebFontFetchProxy(this.remoteFetch ?? undefined, operation)
  }

  private async fetchRemote(url: string, init?: RequestInit): Promise<Response> {
    return coordinatedWebFontFetch(this.remoteFetch ?? undefined, url, init)
  }

  private async unifont(provider: WebFontProviderId): Promise<WebUnifont> {
    return retryableCachedPromise(this.unifontPromises, provider, () =>
      this.withFetchProxy(() => createProviderUnifont(provider))
    )
  }

  private async loadFamilies(provider: WebFontProviderId): Promise<string[]> {
    if (typeof fetch === 'undefined' || (IS_BROWSER && !this.remoteFetch)) return []

    try {
      const unifont = await this.unifont(provider)
      const listedFamilies = await this.withFetchProxy(() => unifont.listFonts())
      const families = listedFamilies
        ? [...new Set(listedFamilies)].sort((a, b) => a.localeCompare(b))
        : []
      this.familiesCache.set(provider, families)
      return families
    } catch {
      this.familiesPromises.delete(provider)
      return []
    }
  }

  private async fetchFromProvider(
    family: string,
    style: string,
    provider: WebFontProviderId,
    characters: string
  ): Promise<ArrayBuffer[]> {
    const coverage = normalizedCoverageText(characters)
    const key = `${provider}|${family}|${style}|${coverage}`
    if (this.failedFonts.has(key)) return []

    let promise = this.fontPromises.get(key)
    if (!promise) {
      promise = this.loadFromProvider(family, style, provider, coverage)
      this.fontPromises.set(key, promise)
    }

    const result = await promise
    this.fontPromises.delete(key)
    if (result.length === 0) this.failedFonts.add(key)
    return result
  }

  private async loadFromProvider(
    family: string,
    style: string,
    provider: WebFontProviderId,
    characters: string
  ): Promise<ArrayBuffer[]> {
    try {
      const parsed = parseFontStyle(style)
      const unifont = await this.unifont(provider)
      const requestedStyle = parsed.italic ? 'italic' : 'normal'
      for (const attempt of webFontFaceAttempts(parsed.weight, requestedStyle)) {
        const options = {
          weights: [String(attempt.weight)],
          styles: [attempt.style],
          formats: ['ttf', 'otf', 'woff2', 'woff'],
          subsets: webFontSubsetsForText(characters)
        } satisfies WebFontResolveOptions
        const result = await this.withFetchProxy<ResolveFontResult>(() =>
          unifont.resolveFont(family, options)
        )
        const faces = resolvedRemoteFaces(result)
        if (faces.length === 0) continue
        const buffers = await Promise.all(
          faces.map(async ({ source, init }) => {
            const response = await this.fetchRemote(source.url, init)
            return response.ok ? response.arrayBuffer() : null
          })
        )
        return buffers.filter(isArrayBuffer)
      }
      return []
    } catch {
      return []
    }
  }
}
