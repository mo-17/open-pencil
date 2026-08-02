import type { RemoteFontSource, ResolveFontResult } from 'unifont'

import { WEB_FONT_LICENSE_POLICIES } from '#core/text/font-license-display'
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
import {
  DEFAULT_WEB_FONT_PROVIDER_SETTINGS,
  WEB_FONT_PROVIDER_IDS,
  webFontSubsetsForText,
  type WebFontFetch,
  type WebFontProviderId
} from '#core/text/web-fonts'

export interface WebFontFaceRequest {
  family: string
  weight: number
  style?: 'normal' | 'italic'
  /** Characters used locally to derive script subsets; never sent as a glyph payload. */
  characters?: string
  /** Provider subset labels; unlike `characters`, these do not disclose document text. */
  subsets?: string[]
}

export interface WebFontFaceAsset {
  family: string
  weight: string | number | [number, number]
  style: string
  display?: string
  stretch?: string
  unicodeRange?: string[]
  format: 'woff2' | 'woff' | 'opentype' | 'truetype'
  path: string
  content: Uint8Array
  /** Catalog that supplied the downloaded bytes. */
  sourceProvider?: WebFontProviderId
  /** Catalog-wide policy only; this is not proof of the exact artifact's license. */
  licenseEvidence?: {
    kind: 'provider_policy'
    policyUrl: string
    policyCheckedAt: string
  }
}

export interface ExportWebFontFaceAssetsOptions {
  fonts: WebFontFaceRequest[]
  providers?: WebFontProviderId[]
  assetBasePath?: string
  fetcher?: WebFontFetch
}

export interface ExportWebFontFaceAssetsResult {
  assets: WebFontFaceAsset[]
}

interface ResolvedRemoteFace {
  source: RemoteFontSource
  face: ResolveFontResult['fonts'][number]
}

const unifontByFetcher = new WeakMap<WebFontFetch, Map<WebFontProviderId, Promise<WebUnifont>>>()
const unifontByProvider = new Map<WebFontProviderId, Promise<WebUnifont>>()

function providerUnifont(
  provider: WebFontProviderId,
  fetcher: WebFontFetch | undefined
): Promise<WebUnifont> {
  let cache = unifontByProvider
  if (fetcher) {
    let byProvider = unifontByFetcher.get(fetcher)
    if (!byProvider) {
      byProvider = new Map()
      unifontByFetcher.set(fetcher, byProvider)
    }
    cache = byProvider
  }
  return retryableCachedPromise(cache, provider, () =>
    withWebFontFetchProxy(fetcher, () => createProviderUnifont(provider))
  )
}

function fontAssetExtension(source: RemoteFontSource): string {
  if (source.format === 'woff2') return 'woff2'
  if (source.format === 'woff') return 'woff'
  if (source.format === 'opentype' || source.format === 'otf') return 'otf'
  return 'ttf'
}

function fontAssetFormat(source: RemoteFontSource): WebFontFaceAsset['format'] {
  if (source.format === 'woff2') return 'woff2'
  if (source.format === 'woff') return 'woff'
  if (source.format === 'opentype' || source.format === 'otf') return 'opentype'
  return 'truetype'
}

function normalizedAssetFamily(family: string): string {
  return family.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

function shortFamilyHash(family: string): string {
  let hash = 0x811c9dc5
  for (const byte of new TextEncoder().encode(family)) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Stable, collision-resistant asset stem for ASCII and non-Latin family names. */
export function webFontAssetFamilySlug(family: string): string {
  const normalized = normalizedAssetFamily(family)
  let slug = ''
  let previousDash = false
  for (const char of normalized) {
    const code = char.charCodeAt(0)
    const isAlpha = code >= 97 && code <= 122
    const isDigit = code >= 48 && code <= 57
    if (isAlpha || isDigit) {
      slug += char
      previousDash = false
      continue
    }
    if (slug.length > 0 && !previousDash) {
      slug += '-'
      previousDash = true
    }
  }
  const asciiSlug = (slug.endsWith('-') ? slug.slice(0, -1) : slug) || 'font'
  return `${asciiSlug}-${shortFamilyHash(normalized)}`
}

function preferredWebSource(
  face: ResolveFontResult['fonts'][number]
): RemoteFontSource | undefined {
  const sources = face.src.filter(isRemoteFontSource)
  return (
    sources.find((source) => source.format === 'woff2') ??
    sources.find((source) => source.format === 'woff') ??
    sources.find((source) => source.format === 'truetype' || source.format === 'ttf') ??
    sources.find((source) => source.format === 'opentype' || source.format === 'otf') ??
    sources[0]
  )
}

function resolvedRemoteFaces(result: ResolveFontResult): ResolvedRemoteFace[] {
  const candidates = result.fonts.flatMap((face) => {
    const source = preferredWebSource(face)
    return source ? [{ source, face, priority: face.meta?.priority ?? 0 }] : []
  })
  if (candidates.length === 0) return []
  const preferredPriority = Math.min(...candidates.map(({ priority }) => priority))
  const seen = new Set<string>()
  const faces: ResolvedRemoteFace[] = []
  for (const candidate of candidates) {
    if (candidate.priority !== preferredPriority || seen.has(candidate.source.url)) continue
    seen.add(candidate.source.url)
    faces.push({ source: candidate.source, face: candidate.face })
  }
  return faces
}

function faceAttempts(
  request: WebFontFaceRequest
): Array<{ weight: number; style: 'normal' | 'italic' }> {
  const requestedStyle = request.style ?? 'normal'
  const values = [
    { weight: request.weight, style: requestedStyle },
    { weight: 400, style: requestedStyle },
    { weight: 400, style: 'normal' as const }
  ]
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = `${value.weight}|${value.style}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function resolveRemoteFontFaces(
  family: string,
  request: WebFontFaceRequest,
  provider: WebFontProviderId,
  fetcher: WebFontFetch | undefined
): Promise<ResolvedRemoteFace[]> {
  const unifont = await providerUnifont(provider, fetcher)
  for (const attempt of faceAttempts(request)) {
    const characters = request.characters ?? ''
    const options = {
      weights: [String(attempt.weight)],
      styles: [attempt.style],
      formats: ['woff2', 'woff', 'ttf'],
      subsets: request.subsets ?? webFontSubsetsForText(characters)
    } satisfies WebFontResolveOptions
    const result = await withWebFontFetchProxy<ResolveFontResult>(fetcher, () =>
      unifont.resolveFont(family, options)
    )
    const faces = resolvedRemoteFaces(result)
    if (faces.length > 0) return faces
  }
  return []
}

function weightSlug(weight: WebFontFaceAsset['weight']): string {
  return (Array.isArray(weight) ? weight.join('-') : String(weight)).replaceAll(' ', '-')
}

function styleSlug(style: string): string {
  return style.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-')
}

async function downloadResolvedFaces(
  family: string,
  request: WebFontFaceRequest,
  resolvedFaces: readonly ResolvedRemoteFace[],
  provider: WebFontProviderId,
  assetBasePath: string,
  fetcher: WebFontFetch | undefined,
  seenAssets: Set<string>
): Promise<WebFontFaceAsset[]> {
  const downloaded: WebFontFaceAsset[] = []
  for (const [index, resolved] of resolvedFaces.entries()) {
    const response = await coordinatedWebFontFetch(
      fetcher,
      resolved.source.url,
      resolved.face.meta?.init
    )
    if (!response.ok) continue
    const extension = fontAssetExtension(resolved.source)
    const weight = resolved.face.weight ?? request.weight
    const style = resolved.face.style ?? request.style ?? 'normal'
    const shard = resolvedFaces.length > 1 ? `-${index + 1}` : ''
    const path = `${assetBasePath}/${webFontAssetFamilySlug(family)}-${weightSlug(weight)}-${styleSlug(style)}${shard}.${extension}`
    const assetKey = `${family}|${weightSlug(weight)}|${style}|${resolved.source.url}`
    if (seenAssets.has(assetKey)) continue
    seenAssets.add(assetKey)
    downloaded.push({
      family,
      weight,
      style,
      display: resolved.face.display,
      stretch: resolved.face.stretch,
      unicodeRange: resolved.face.unicodeRange,
      format: fontAssetFormat(resolved.source),
      path,
      content: new Uint8Array(await response.arrayBuffer()),
      sourceProvider: provider,
      licenseEvidence: {
        kind: 'provider_policy',
        policyUrl: WEB_FONT_LICENSE_POLICIES[provider].url,
        policyCheckedAt: WEB_FONT_LICENSE_POLICIES[provider].checkedAt
      }
    })
  }
  return downloaded
}

async function exportRequestFromProvider(
  family: string,
  request: WebFontFaceRequest,
  provider: WebFontProviderId,
  assetBasePath: string,
  fetcher: WebFontFetch | undefined,
  seenAssets: Set<string>
): Promise<WebFontFaceAsset[]> {
  try {
    const resolvedFaces = await resolveRemoteFontFaces(family, request, provider, fetcher)
    if (resolvedFaces.length === 0) return []
    return await downloadResolvedFaces(
      family,
      request,
      resolvedFaces,
      provider,
      assetBasePath,
      fetcher,
      seenAssets
    )
  } catch (error) {
    console.warn(`Failed to export ${family} from ${provider} fonts`, error)
    return []
  }
}

export async function exportWebFontFaceAssets({
  fonts,
  providers = WEB_FONT_PROVIDER_IDS.filter(
    (provider) => DEFAULT_WEB_FONT_PROVIDER_SETTINGS[provider]
  ),
  assetBasePath = 'assets/fonts',
  fetcher
}: ExportWebFontFaceAssetsOptions): Promise<ExportWebFontFaceAssetsResult> {
  const assets: WebFontFaceAsset[] = []
  const seenRequests = new Set<string>()
  const seenAssets = new Set<string>()

  for (const request of fonts) {
    const family = request.family
    const requestStyle = request.style ?? 'normal'
    const requestKey = [
      family,
      request.weight,
      requestStyle,
      request.characters ?? '',
      request.subsets?.join(',') ?? ''
    ].join('|')
    if (seenRequests.has(requestKey)) continue
    seenRequests.add(requestKey)

    for (const provider of providers) {
      const downloaded = await exportRequestFromProvider(
        family,
        request,
        provider,
        assetBasePath,
        fetcher,
        seenAssets
      )
      if (downloaded.length === 0) continue
      assets.push(...downloaded)
      break
    }
  }

  return { assets }
}
