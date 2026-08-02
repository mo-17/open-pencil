import { DEFAULT_FONT_FAMILY } from '@open-pencil/core/constants'
import { collectGraphFontRequirements, requiredNodeFontFaces } from '@open-pencil/core/text'
import { normalizeFontFamily, parseFontStyle, type SceneGraph } from '@open-pencil/scene-graph'

import type { CompileWarning, CompilerFontFaceAsset, CompilerFontManifest } from './types'

const FONT_ASSET_PREFIX = 'src/assets/fonts/'

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

function fontCss(
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

function fontResolutionWarnings(
  requests: readonly RequestedFace[],
  faces: readonly CompilerFontFaceAsset[]
): CompileWarning[] {
  const warnings: CompileWarning[] = []
  for (const request of requests) {
    if (faces.some((face) => faceSupportsRequest(face, request))) continue
    const actual = faces.filter((face) => faceFamilyMatches(face, request))
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

/** Add resolved font bytes + CSS to an adapter-emitted project. */
export function applyCompilerFontManifest(
  files: Map<string, string | Uint8Array>,
  graph: SceneGraph,
  pageIds: readonly string[],
  manifest: CompilerFontManifest
): CompileWarning[] {
  const warnings: CompileWarning[] = []
  const validFaces: CompilerFontFaceAsset[] = []
  const seenPaths = new Set<string>()
  for (const face of manifest.faces) {
    if (!validFontAssetPath(face.path)) {
      warnings.push({
        code: 'font-asset-path-invalid',
        message: `Font asset path must stay under ${FONT_ASSET_PREFIX}: ${face.path}`
      })
      continue
    }
    if (seenPaths.has(face.path)) continue
    seenPaths.add(face.path)
    validFaces.push(face)
    files.set(face.path, face.content)
  }

  const requested = requestedFaces(graph, pageIds)
  const css = files.get('src/index.css')
  if (typeof css === 'string') {
    files.set(
      'src/index.css',
      css + fontCss(validFaces, requested.families, manifest.fallbackFamilies ?? [])
    )
  }
  warnings.push(...fontResolutionWarnings(requested.faces, validFaces))
  warnings.push(...fontLicenseWarnings(validFaces))
  return warnings
}
