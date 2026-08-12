import { DEFAULT_FONT_FAMILY } from '@open-pencil/core/constants'
import {
  collectGraphFontRequirements,
  embeddedFontLicenseMetadata,
  requiredNodeFontFaces
} from '@open-pencil/core/text'
import { normalizeFontFamily, parseFontStyle, type SceneGraph } from '@open-pencil/scene-graph'

import { exactArrayBuffer } from './bytes'
import type { CompileWarning, CompilerFontFaceAsset, CompilerFontManifest } from './types'

const FONT_ASSET_PREFIX = 'src/assets/fonts/'
const EXPO_FONT_ASSET_PREFIX = 'assets/fonts/'
const EXPO_FONT_VERSION = '~57.0.1'

interface RequestedFace {
  family: string
  weight: number
  style: 'normal' | 'italic'
}

function requestedFaces(
  graph: SceneGraph,
  pageIds: readonly string[]
): { faces: RequestedFace[]; families: string[] } {
  const requirements = collectGraphFontRequirements(graph, pageIds)
  const faces = new Map<string, RequestedFace>()
  const families = new Map<string, string>()
  for (const node of requirements.nodes) {
    for (const face of requiredNodeFontFaces(node)) {
      const parsed = parseFontStyle(face.style)
      const normalized = normalizeFontFamily(face.family)
      const requested: RequestedFace = {
        family: normalized,
        weight: parsed.weight,
        style: parsed.italic ? 'italic' : 'normal'
      }
      faces.set(`${normalized}\0${requested.weight}\0${requested.style}`, requested)
      families.set(normalized.toLocaleLowerCase(), normalized)
    }
  }
  return { faces: [...faces.values()], families: [...families.values()] }
}

function validFontAssetPath(path: string): boolean {
  if (!path.startsWith(FONT_ASSET_PREFIX) || path.includes('\\')) return false
  const segments = path.split('/')
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

function fontWeightValue(weight: CompilerFontFaceAsset['weight']): string {
  return Array.isArray(weight) ? `${weight[0]} ${weight[1]}` : String(weight)
}

function restrictedEmbeddingWarning(face: CompilerFontFaceAsset): CompileWarning | undefined {
  const evidence = face.licenseEvidence
  const embedded = embeddedFontLicenseMetadata(exactArrayBuffer(face.content))
  const evidenceFsType = evidence?.kind === 'restricted' ? evidence.fsType : undefined
  if (evidenceFsType === undefined && embedded?.embedding.restricted !== true) return undefined
  const fsTypeValue = evidenceFsType ?? embedded?.fsType ?? 0x0002
  const fsType = `0x${fsTypeValue.toString(16).padStart(4, '0')}`
  return {
    code: 'font-license-embedding-restricted',
    message: `${face.family} ${fontWeightValue(face.weight)} ${face.style} declares restricted embedding in OpenType OS/2 fsType ${fsType}; its font bytes were omitted from generated assets`
  }
}

function cssString(value: string): string {
  return JSON.stringify(value)
}

function fontSourceValue(face: CompilerFontFaceAsset): string {
  const relativePath = `./${face.path.slice('src/'.length)}`
  return `url(${cssString(relativePath)}) format(${cssString(face.format)})`
}

function fontFaceRule(face: CompilerFontFaceAsset): string {
  const declarations = [
    `font-family:${cssString(face.family)}`,
    `src:${fontSourceValue(face)}`,
    `font-weight:${fontWeightValue(face.weight)}`,
    `font-style:${face.style}`,
    `font-display:${face.display ?? 'swap'}`,
    ...(face.stretch ? [`font-stretch:${face.stretch}`] : []),
    ...(face.unicodeRange && face.unicodeRange.length > 0
      ? [`unicode-range:${face.unicodeRange.join(',')}`]
      : [])
  ]
  return `@font-face{${declarations.join(';')}}`
}

function cssClassName(value: string): string {
  let escaped = ''
  for (const character of value) {
    escaped += /[a-zA-Z0-9_-]/.test(character) ? character : `\\${character}`
  }
  return escaped
}

function familyClass(family: string): string {
  return `font-[${family.replaceAll(' ', '_')}]`
}

function uniqueFamilies(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const family = normalizeFontFamily(value)
    const key = family.toLocaleLowerCase()
    if (!family || seen.has(key)) continue
    seen.add(key)
    result.push(family)
  }
  return result
}

function familyStack(primary: string, fallbacks: readonly string[]): string[] {
  return uniqueFamilies([
    primary,
    ...(primary === DEFAULT_FONT_FAMILY ? [] : [DEFAULT_FONT_FAMILY]),
    ...fallbacks
  ])
}

function familyStackRule(primary: string, fallbacks: readonly string[]): string {
  const stack = [...familyStack(primary, fallbacks).map(cssString), 'sans-serif'].join(',')
  if (primary === DEFAULT_FONT_FAMILY) return `html{font-family:${stack}}`
  return `.${cssClassName(familyClass(primary))}{font-family:${stack}}`
}

function fontCSS(
  faces: readonly CompilerFontFaceAsset[],
  families: readonly string[],
  fallbacks: string[]
) {
  const rules = [
    ...faces.map(fontFaceRule),
    familyStackRule(DEFAULT_FONT_FAMILY, fallbacks),
    ...families
      .filter((family) => family !== DEFAULT_FONT_FAMILY)
      .map((family) => familyStackRule(family, fallbacks)),
    'button,input,optgroup,select,textarea{font-family:inherit}'
  ]
  return `\n/* OpenPencil resolved font plan */\n${rules.join('\n')}\n`
}

function numericWeight(weight: CompilerFontFaceAsset['weight']): [number, number] | null {
  if (Array.isArray(weight)) return weight
  if (typeof weight === 'number') return [weight, weight]
  const values = weight.trim().split(/\s+/).map(Number).filter(Number.isFinite)
  if (values.length === 1) return [values[0], values[0]]
  if (values.length >= 2) return [values[0], values[1]]
  return null
}

function faceSupportsRequest(face: CompilerFontFaceAsset, request: RequestedFace): boolean {
  if (normalizeFontFamily(face.family) !== request.family) return false
  if (face.style.toLocaleLowerCase() !== request.style) return false
  const range = numericWeight(face.weight)
  return range !== null && request.weight >= range[0] && request.weight <= range[1]
}

function faceFamilyMatches(face: CompilerFontFaceAsset, request: RequestedFace): boolean {
  return normalizeFontFamily(face.family) === request.family
}

function unresolvedFaceRequests(
  requests: readonly RequestedFace[],
  faces: readonly CompilerFontFaceAsset[]
): Array<{ request: RequestedFace; familyFaces: CompilerFontFaceAsset[] }> {
  const unresolved: Array<{ request: RequestedFace; familyFaces: CompilerFontFaceAsset[] }> = []
  for (const request of requests) {
    if (faces.some((face) => faceSupportsRequest(face, request))) continue
    unresolved.push({
      request,
      familyFaces: faces.filter((face) => faceFamilyMatches(face, request))
    })
  }
  return unresolved
}

function fontResolutionWarnings(
  requests: readonly RequestedFace[],
  faces: readonly CompilerFontFaceAsset[]
): CompileWarning[] {
  const warnings: CompileWarning[] = []
  for (const { request, familyFaces: actual } of unresolvedFaceRequests(requests, faces)) {
    if (actual.length === 0) {
      warnings.push({
        code: 'font-face-unavailable',
        message: `${request.family} ${request.weight} ${request.style} has no embeddable face; generated output may use a fallback font`
      })
      continue
    }
    const actualFaces = [
      ...new Set(actual.map((face) => `${fontWeightValue(face.weight)} ${face.style}`))
    ].join(', ')
    warnings.push({
      code: 'font-face-synthesized',
      message: `${request.family} ${request.weight} ${request.style} resolves to ${actualFaces}; the browser will synthesize the requested face like the canvas`
    })
  }
  return warnings
}

function fontLicenseWarnings(faces: readonly CompilerFontFaceAsset[]): CompileWarning[] {
  const warnings: CompileWarning[] = []
  const seen = new Set<string>()
  for (const face of faces) {
    if (face.licenseEvidence?.kind === 'verified_open') continue
    const provider = face.sourceProvider?.trim()
    const key = `${normalizeFontFamily(face.family).toLocaleLowerCase()}\0${provider ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    if (face.licenseEvidence?.kind === 'provider_policy' && provider) {
      warnings.push({
        code: 'font-license-review-required',
        message: `${face.family} comes from ${provider}'s free-font catalog (${face.licenseEvidence.policyUrl}), but that catalog policy does not replace the family-specific license required for redistribution`
      })
      continue
    }
    warnings.push({
      code: 'font-license-unverified',
      message: `${face.family} has no verified redistribution evidence; review its license before publishing generated font files`
    })
  }
  return warnings
}

function embeddableFaces(manifest: CompilerFontManifest): {
  faces: CompilerFontFaceAsset[]
  warnings: CompileWarning[]
} {
  const warnings: CompileWarning[] = []
  const faces: CompilerFontFaceAsset[] = []
  const seenPaths = new Set<string>()
  const warnedRestrictedFaces = new Set<string>()
  for (const face of manifest.faces) {
    const restrictedWarning = restrictedEmbeddingWarning(face)
    if (restrictedWarning) {
      const key = `${normalizeFontFamily(face.family).toLocaleLowerCase()}\0${fontWeightValue(face.weight)}\0${face.style.toLocaleLowerCase()}`
      if (!warnedRestrictedFaces.has(key)) {
        warnedRestrictedFaces.add(key)
        warnings.push(restrictedWarning)
      }
      continue
    }
    if (!validFontAssetPath(face.path)) {
      warnings.push({
        code: 'font-asset-path-invalid',
        message: `Font asset path must stay under ${FONT_ASSET_PREFIX}: ${face.path}`
      })
      continue
    }
    if (seenPaths.has(face.path)) continue
    seenPaths.add(face.path)
    faces.push(face)
  }
  return { faces, warnings }
}

/** Add resolved font bytes + CSS to an adapter-emitted project. */
export function applyCompilerFontManifest(
  files: Map<string, string | Uint8Array>,
  graph: SceneGraph,
  pageIds: readonly string[],
  manifest: CompilerFontManifest
): CompileWarning[] {
  const collected = embeddableFaces(manifest)
  const warnings = [...collected.warnings]
  const validFaces = collected.faces
  for (const face of validFaces) files.set(face.path, face.content)

  const requested = requestedFaces(graph, pageIds)
  const css = files.get('src/index.css')
  if (typeof css === 'string') {
    files.set(
      'src/index.css',
      css + fontCSS(validFaces, requested.families, manifest.fallbackFamilies ?? [])
    )
  }
  warnings.push(...fontResolutionWarnings(requested.faces, validFaces))
  warnings.push(...fontLicenseWarnings(validFaces))
  return warnings
}

/** Add native-loadable font assets and an expo-font hook to an Expo project. */
export function applyExpoCompilerFontManifest(
  files: Map<string, string | Uint8Array>,
  graph: SceneGraph,
  pageIds: readonly string[],
  manifest: CompilerFontManifest
): CompileWarning[] {
  const collected = embeddableFaces(manifest)
  const warnings = [...collected.warnings]
  const nativeFaces: CompilerFontFaceAsset[] = []
  const families = new Set<string>()
  for (const face of collected.faces) {
    if (!nativeFontFace(face)) {
      warnings.push({
        code: 'expo-font-format-unsupported',
        message: `${face.family} ${fontWeightValue(face.weight)} ${face.style} uses ${face.format}; Expo native output only bundles .ttf/.otf faces and will use a system fallback`
      })
      continue
    }
    const family = normalizeFontFamily(face.family)
    const familyKey = family.toLocaleLowerCase()
    if (families.has(familyKey)) {
      warnings.push({
        code: 'expo-font-face-variant-unsupported',
        message: `Expo static MVP registered the first native face for ${family}; additional weight/style ${fontWeightValue(face.weight)} ${face.style} uses that family fallback`
      })
      continue
    }
    families.add(familyKey)
    nativeFaces.push(face)
  }

  for (const face of nativeFaces) {
    files.set(expoFontPath(face.path), face.content)
  }
  if (nativeFaces.length > 0) {
    files.set('src/generated-fonts.ts', expoFontLoader(nativeFaces))
    addExpoFontDependency(files)
  }
  const requested = requestedFaces(graph, pageIds)
  warnings.push(...nativeFontResolutionWarnings(requested.faces, nativeFaces))
  warnings.push(...fontLicenseWarnings(nativeFaces))
  return warnings
}

/**
 * Flutter stays fail-closed until the manifest can carry complete license and copyright notices.
 * SPDX ids alone are insufficient to redistribute font bytes in a generated source archive.
 */
export function applyFlutterCompilerFontManifest(
  _files: Map<string, string | Uint8Array>,
  graph: SceneGraph,
  pageIds: readonly string[],
  manifest: CompilerFontManifest
): CompileWarning[] {
  const collected = embeddableFaces(manifest)
  const warnings = [...collected.warnings]
  for (const face of collected.faces) {
    if (!nativeFontFace(face)) {
      warnings.push({
        code: 'flutter-font-format-unsupported',
        message: `${face.family} ${fontWeightValue(face.weight)} ${face.style} uses ${face.format}; Flutter output only bundles .ttf/.otf faces and will use a system fallback`
      })
      continue
    }
    warnings.push({
      code: 'font-license-notice-unavailable',
      message: `${face.family} ${fontWeightValue(face.weight)} ${face.style} (${face.path}) was omitted from Flutter output because the manifest does not contain the full license text and copyright notice required for redistribution${
        face.licenseEvidence?.kind === 'verified_open'
          ? `; declared license ids: ${face.licenseEvidence.licenseIds.join(', ')}`
          : ''
      }`
    })
  }
  const requested = requestedFaces(graph, pageIds)
  warnings.push(...flutterFontResolutionWarnings(requested.faces, []))
  warnings.push(...fontLicenseWarnings(collected.faces))
  return warnings
}

function flutterFontResolutionWarnings(
  requests: readonly RequestedFace[],
  faces: readonly CompilerFontFaceAsset[]
): CompileWarning[] {
  return unresolvedFaceRequests(requests, faces).map(({ request, familyFaces }) => ({
    code: familyFaces.length === 0 ? 'font-face-unavailable' : 'flutter-font-face-variant-fallback',
    message:
      familyFaces.length === 0
        ? `${request.family} ${request.weight} ${request.style} has no native-loadable face; Flutter output will use a system fallback font`
        : `${request.family} ${request.weight} ${request.style} has no exact Flutter asset declaration; Flutter uses the family's nearest bundled face`
  }))
}

function nativeFontFace(face: CompilerFontFaceAsset): boolean {
  if (face.format !== 'opentype' && face.format !== 'truetype') return false
  return /\.(?:otf|ttf)$/i.test(face.path)
}

function expoFontPath(path: string): string {
  return `${EXPO_FONT_ASSET_PREFIX}${path.slice(FONT_ASSET_PREFIX.length)}`
}

function expoFontLoader(faces: readonly CompilerFontFaceAsset[]): string {
  const entries = faces
    .map(
      (face) =>
        `    ${JSON.stringify(normalizeFontFamily(face.family))}: require(${JSON.stringify(`../${expoFontPath(face.path)}`)})`
    )
    .join(',\n')
  return `import { useFonts } from 'expo-font'

export function useOpenPencilFonts(): boolean {
  const [loaded, error] = useFonts({
${entries}
  })
  return loaded || error !== null
}
`
}

function addExpoFontDependency(files: Map<string, string | Uint8Array>): void {
  const source = files.get('package.json')
  if (typeof source !== 'string') return
  const value = JSON.parse(source) as { dependencies?: Record<string, string> }
  value.dependencies = { ...value.dependencies, 'expo-font': EXPO_FONT_VERSION }
  files.set('package.json', `${JSON.stringify(value, null, 2)}\n`)
}

function nativeFontResolutionWarnings(
  requests: readonly RequestedFace[],
  faces: readonly CompilerFontFaceAsset[]
): CompileWarning[] {
  const warnings: CompileWarning[] = []
  for (const { request, familyFaces } of unresolvedFaceRequests(requests, faces)) {
    warnings.push({
      code: familyFaces.length === 0 ? 'font-face-unavailable' : 'expo-font-face-variant-fallback',
      message:
        familyFaces.length === 0
          ? `${request.family} ${request.weight} ${request.style} has no native-loadable face; Expo output will use a system fallback font`
          : `${request.family} ${request.weight} ${request.style} has no exact registered native face; Expo output uses the family's bundled fallback face`
    })
  }
  return warnings
}
