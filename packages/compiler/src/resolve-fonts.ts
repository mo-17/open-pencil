import { DEFAULT_FONT_FAMILY } from '@open-pencil/core/constants'
import {
  assessFontLicenseBytes,
  collectGraphFontRequirements,
  embeddedFontLicenseMetadata,
  fontCoverageDemand,
  fontFaceDemand,
  fontFallbackEntry,
  fontManager,
  fontResolver,
  requiredNodeFontFaces,
  webFontSubsetsForText,
  weightToStyle,
  type FontFallbackScript,
  type WebFontFetch,
  type WebFontProviderId
} from '@open-pencil/core/text'
import {
  exportWebFontFaceAssets,
  webFontAssetFamilySlug,
  type WebFontFaceRequest
} from '@open-pencil/core/text/web-font/assets'
import { normalizeFontFamily, parseFontStyle, type SceneGraph } from '@open-pencil/scene-graph'

import type {
  CompilerFontFaceAsset,
  CompilerFontLicenseEvidence,
  CompilerFontManifest
} from './types'

export interface ResolveCompilerWebFontsInput {
  graph: SceneGraph
  pageIds: readonly string[]
  providers?: WebFontProviderId[]
  fetcher?: WebFontFetch
  /** Reuse the canvas resolver's loaded/cache/local result (preview only). */
  preferLoaded?: boolean
  /** Bypass the per-graph resolution cache (used by the preview reload action). */
  refresh?: boolean
}

interface FontPlanRequirements {
  primary: WebFontFaceRequest[]
  scripts: FontFallbackScript[]
  fallbackCandidates: string[][]
  subsets: string[]
  /** Kept local and used only to address the existing downloaded-font cache. */
  cacheCharacters: string
}

interface LoadedFontPlan {
  faces: CompilerFontFaceAsset[]
  resolvedRequests: Set<string>
  fallbackFamilies: Map<FontFallbackScript, string>
}

const resolutionCache = new WeakMap<SceneGraph, Map<string, Promise<CompilerFontManifest>>>()
// A CJK face can exceed 10 MiB and each manifest owns its byte snapshots. Keep
// only the current and immediately previous plan (useful for undo) per graph.
const MAX_GRAPH_RESOLUTION_CACHE_ENTRIES = 2

function cacheResolution(
  graphCache: Map<string, Promise<CompilerFontManifest>>,
  key: string,
  resolution: Promise<CompilerFontManifest>
): void {
  graphCache.delete(key)
  graphCache.set(key, resolution)
  while (graphCache.size > MAX_GRAPH_RESOLUTION_CACHE_ENTRIES) {
    const oldestKey = graphCache.keys().next().value
    if (oldestKey === undefined) break
    graphCache.delete(oldestKey)
  }
}

function requestFromFace(family: string, style: string, subsets: string[]): WebFontFaceRequest {
  const parsed = parseFontStyle(style)
  return {
    family: normalizeFontFamily(family),
    weight: parsed.weight,
    style: parsed.italic ? 'italic' : 'normal',
    subsets
  }
}

function pushRequest(requests: Map<string, WebFontFaceRequest>, request: WebFontFaceRequest): void {
  const key = requestKey(request)
  if (!requests.has(key)) requests.set(key, request)
}

function requestKey(request: WebFontFaceRequest): string {
  return `${request.family}\0${request.weight}\0${request.style ?? 'normal'}`
}

function buildRequirements(graph: SceneGraph, pageIds: readonly string[]): FontPlanRequirements {
  const requirements = collectGraphFontRequirements(graph, pageIds)
  const subsets = webFontSubsetsForText(requirements.characters)
  const requests = new Map<string, WebFontFaceRequest>()
  const authoredFaces: WebFontFaceRequest[] = []
  for (const node of requirements.nodes) {
    for (const face of requiredNodeFontFaces(node)) {
      const request = requestFromFace(face.family, face.style, subsets)
      pushRequest(requests, request)
      authoredFaces.push(request)
    }
  }

  // CanvasKit inserts Inter after every non-Inter primary and applies the same
  // requested weight/slant to it. Resolve the same faces for the browser stack.
  for (const request of authoredFaces) {
    if (request.family === DEFAULT_FONT_FAMILY) continue
    pushRequest(requests, { ...request, family: DEFAULT_FONT_FAMILY })
  }

  const orderedScripts = [
    ...requirements.scripts.filter((script) => script === 'arabic'),
    ...requirements.scripts.filter((script) => script !== 'arabic')
  ]
  const fallbackCandidates = orderedScripts.map(
    (script) => fontFallbackEntry(script).remoteFamilies
  )
  return {
    primary: [...requests.values()],
    scripts: orderedScripts,
    fallbackCandidates,
    subsets,
    cacheCharacters: requirements.characters
  }
}

function planCacheKey(
  requirements: FontPlanRequirements,
  providers: readonly WebFontProviderId[] | undefined,
  preferLoaded: boolean
): string {
  const faces = requirements.primary
    .map((request) => `${request.family}|${request.weight}|${request.style}`)
    .sort()
    .join(';')
  return [
    providers?.join(',') ?? 'default',
    preferLoaded ? 'loaded' : 'portable',
    faces,
    requirements.fallbackCandidates.map((families) => families.join(',')).join(';'),
    requirements.subsets.join(','),
    glyphCoverageCacheKey(requirements.cacheCharacters),
    preferLoaded ? String(fontManager.generation()) : ''
  ].join('\0')
}

function glyphCoverageCacheKey(characters: string): string {
  const codePoints = new Set<number>()
  for (const character of characters) {
    const codePoint = character.codePointAt(0)
    if (codePoint !== undefined) codePoints.add(codePoint)
  }
  let hash = 0xcbf29ce484222325n
  for (const codePoint of [...codePoints].sort((left, right) => left - right)) {
    hash ^= BigInt(codePoint)
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return `${codePoints.size}:${hash.toString(16)}`
}

function fontBytesFormat(data: ArrayBuffer): {
  format: CompilerFontFaceAsset['format']
  extension: string
} {
  const signature = data.byteLength >= 4 ? new DataView(data).getUint32(0) : 0
  if (signature === 0x774f4632) return { format: 'woff2', extension: 'woff2' }
  if (signature === 0x774f4646) return { format: 'woff', extension: 'woff' }
  if (signature === 0x4f54544f) return { format: 'opentype', extension: 'otf' }
  return { format: 'truetype', extension: 'ttf' }
}

type RestrictedEmbeddingEvidence = Extract<CompilerFontLicenseEvidence, { kind: 'restricted' }>

function restrictedEmbeddingEvidence(data: ArrayBuffer): RestrictedEmbeddingEvidence | undefined {
  const metadata = embeddedFontLicenseMetadata(data)
  if (metadata?.embedding.restricted !== true) return undefined
  return {
    kind: 'restricted',
    restriction: 'embedding',
    fsType: metadata.fsType ?? 0x0002
  }
}

function assetArrayBuffer(content: Uint8Array): ArrayBuffer {
  if (
    content.buffer instanceof ArrayBuffer &&
    content.byteOffset === 0 &&
    content.byteLength === content.buffer.byteLength
  ) {
    return content.buffer
  }
  const copy = new Uint8Array(content.byteLength)
  copy.set(content)
  return copy.buffer
}

function preserveRestrictedEmbedding(face: CompilerFontFaceAsset): CompilerFontFaceAsset {
  const restricted = restrictedEmbeddingEvidence(assetArrayBuffer(face.content))
  return restricted ? { ...face, licenseEvidence: restricted } : face
}

async function loadedFaceAssets(family: string, style: string): Promise<CompilerFontFaceAsset[]> {
  const dataShards = fontManager.loadedDataShards(family, style)
  if (dataShards.length === 0) return []
  const parsed = parseFontStyle(style)
  const slant = parsed.italic ? 'italic' : 'normal'
  const familySlug = webFontAssetFamilySlug(family)
  return Promise.all(
    dataShards.map(async (data, index) => {
      const { format, extension } = fontBytesFormat(data)
      const shard = dataShards.length > 1 ? `-${index + 1}` : ''
      const license = await assessFontLicenseBytes(family, style, data)
      const restricted = restrictedEmbeddingEvidence(data)
      let licenseEvidence: CompilerFontLicenseEvidence | undefined = restricted
      if (!licenseEvidence && license.classification === 'verified_open' && license.license) {
        licenseEvidence = {
          kind: 'verified_open',
          licenseIds: [license.license.id]
        }
      }
      return {
        family,
        weight: parsed.weight,
        style: slant,
        format,
        path: `src/assets/fonts/${familySlug}-${parsed.weight}-${slant}${shard}.${extension}`,
        content: new Uint8Array(data),
        ...(licenseEvidence ? { licenseEvidence } : {})
      }
    })
  )
}

async function resolveLoadedFontPlan(requirements: FontPlanRequirements): Promise<LoadedFontPlan> {
  const faces = new Map<string, CompilerFontFaceAsset>()
  const resolvedRequests = new Set<string>()
  for (const request of requirements.primary) {
    const style = weightToStyle(request.weight, request.style === 'italic')
    await fontManager.loadCachedFont(request.family, style, requirements.cacheCharacters)
    const snapshot = await fontResolver.retry(fontFaceDemand(request.family, style))
    if (snapshot.state !== 'loaded' || !snapshot.candidate) continue
    const assets = await loadedFaceAssets(snapshot.candidate.family, snapshot.candidate.style)
    if (assets.length === 0) continue
    for (const asset of assets) faces.set(asset.path, asset)
    resolvedRequests.add(requestKey(request))
  }

  const fallbackFamilies = new Map<FontFallbackScript, string>()
  for (const script of requirements.scripts) {
    await fontResolver.retry(fontCoverageDemand(script))
    // The global CJK list is only an aggregate used by the CanvasKit stack.
    // Ask for the script-specific resolved list so mixed SC/JP/KR documents do
    // not export the first CJK face for every script and omit later faces.
    const families = (await fontManager.ensureFallbackPack([script]))[script] ?? []
    const family = families.find((candidate) => fontManager.isStyleLoaded(candidate, 'Regular'))
    if (!family) continue
    const assets = await loadedFaceAssets(family, 'Regular')
    if (assets.length === 0) continue
    for (const asset of assets) faces.set(asset.path, asset)
    fallbackFamilies.set(script, family)
  }
  return { faces: [...faces.values()], resolvedRequests, fallbackFamilies }
}

async function resolveFallbackFamily(
  candidates: readonly string[],
  subsets: string[],
  providers: WebFontProviderId[] | undefined,
  fetcher: WebFontFetch | undefined
): Promise<{ family?: string; faces: CompilerFontFaceAsset[] }> {
  for (const family of candidates) {
    const result = await exportWebFontFaceAssets({
      fonts: [{ family, weight: 400, style: 'normal', subsets }],
      assetBasePath: 'src/assets/fonts',
      ...(providers ? { providers } : {}),
      ...(fetcher ? { fetcher } : {})
    })
    if (result.assets.length > 0) return { family, faces: result.assets }
  }
  return { faces: [] }
}

async function resolvePlan(
  requirements: FontPlanRequirements,
  providers: WebFontProviderId[] | undefined,
  fetcher: WebFontFetch | undefined,
  preferLoaded: boolean
): Promise<CompilerFontManifest> {
  const loaded = preferLoaded
    ? await resolveLoadedFontPlan(requirements)
    : { faces: [], resolvedRequests: new Set<string>(), fallbackFamilies: new Map() }
  const unresolvedPrimary = requirements.primary.filter(
    (request) => !loaded.resolvedRequests.has(requestKey(request))
  )
  const primary = await exportWebFontFaceAssets({
    fonts: unresolvedPrimary,
    assetBasePath: 'src/assets/fonts',
    ...(providers ? { providers } : {}),
    ...(fetcher ? { fetcher } : {})
  })
  const fallbackResults = []
  for (const [index, candidates] of requirements.fallbackCandidates.entries()) {
    const loadedFamily = loaded.fallbackFamilies.get(requirements.scripts[index])
    fallbackResults.push(
      loadedFamily
        ? { family: loadedFamily, faces: [] }
        : await resolveFallbackFamily(candidates, requirements.subsets, providers, fetcher)
    )
  }
  const facesByPath = new Map<string, CompilerFontFaceAsset>()
  for (const candidate of [
    ...loaded.faces,
    ...primary.assets,
    ...fallbackResults.flatMap((result) => result.faces)
  ]) {
    const face = preserveRestrictedEmbedding(candidate)
    facesByPath.set(face.path, face)
  }
  return {
    faces: [...facesByPath.values()],
    fallbackFamilies: fallbackResults.flatMap((result) => (result.family ? [result.family] : []))
  }
}

/**
 * Resolve portable web-font assets before calling synchronous `compile()`.
 * The resolver tries the requested face first, then Regular with the same
 * slant, then upright Regular — mirroring the canvas synthetic-face policy.
 */
export function resolveCompilerWebFonts({
  graph,
  pageIds,
  providers,
  fetcher,
  preferLoaded = false,
  refresh = false
}: ResolveCompilerWebFontsInput): Promise<CompilerFontManifest> {
  const requirements = buildRequirements(graph, pageIds)
  const key = planCacheKey(requirements, providers, preferLoaded)
  let graphCache = resolutionCache.get(graph)
  if (!graphCache) {
    graphCache = new Map()
    resolutionCache.set(graph, graphCache)
  }
  if (refresh) graphCache.delete(key)
  const cached = graphCache.get(key)
  if (cached) {
    cacheResolution(graphCache, key, cached)
    return cached
  }
  const pending = resolvePlan(requirements, providers, fetcher, preferLoaded)
  cacheResolution(graphCache, key, pending)
  return pending
}
