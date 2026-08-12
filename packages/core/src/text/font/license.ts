import * as OpenTypeSync from 'opentype.js'

import {
  bundledFontFace,
  bundledFontLicense,
  type BundledFontFace,
  type BundledFontLicense,
  type FontLicensePermission
} from '#core/text/bundled-fonts'
import { fontManager } from '#core/text/fonts'

export type FontLicenseClassification = 'verified_open' | 'restricted' | 'unknown'

export interface EmbeddedFontLicenseMetadata {
  copyright?: string
  trademark?: string
  manufacturer?: string
  licenseDescription?: string
  licenseUrl?: string
  candidateLicenseId?: 'OFL-1.1' | 'Apache-2.0'
  fsType?: number
  embedding: {
    installable: boolean | null
    restricted: boolean | null
    previewPrint: boolean | null
    editable: boolean | null
    noSubsetting: boolean | null
    bitmapOnly: boolean | null
  }
}

export interface FontLicenseAssessment {
  family: string
  style: string
  loaded: boolean
  classification: FontLicenseClassification
  license: {
    id: string
    name: string
    url: string
    copyright: string
    upstreamLicenseUrl: string
    permissions: {
      commercialUse: FontLicensePermission
      embedding: FontLicensePermission
      redistribution: FontLicensePermission
      modification: FontLicensePermission
    }
    conditions: string[]
  } | null
  embeddedMetadata: EmbeddedFontLicenseMetadata | null
  evidence: Array<{
    kind: 'bundled_digest' | 'bundled_manifest_candidate' | 'embedded_name_table' | 'embedded_os2'
    strength: 'verified' | 'candidate' | 'self_reported'
    sha256?: string
    expectedSha256?: string
    licenseTextPath?: string
    licenseTextSha256?: string
    note: string
  }>
  reasons: string[]
}

type LocalizedName = Record<string, string | undefined>

interface OpenTypeNamePlatform {
  copyright?: LocalizedName
  trademark?: LocalizedName
  manufacturer?: LocalizedName
  license?: LocalizedName
  licenseURL?: LocalizedName
}

interface LicenseFont {
  names?: Record<string, OpenTypeNamePlatform>
  tables?: { os2?: { fsType?: number } }
}

const embeddedMetadataCache = new WeakMap<ArrayBuffer, EmbeddedFontLicenseMetadata | null>()
const digestCache = new WeakMap<ArrayBuffer, Promise<string | null>>()

function licenseFont(value: unknown): LicenseFont {
  return typeof value === 'object' && value !== null ? (value as LicenseFont) : {}
}

function cleanMetadata(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined
  const withoutControls = Array.from(value)
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)
    })
    .join('')
  const cleaned = withoutControls.replace(/\s+/g, ' ').trim()
  return cleaned ? cleaned.slice(0, maxLength) : undefined
}

function localizedValue(
  names: Record<string, OpenTypeNamePlatform>,
  key: keyof OpenTypeNamePlatform
) {
  for (const platform of ['windows', 'unicode', 'macintosh']) {
    const values = names[platform]?.[key]
    if (!values) continue
    const value = values.en ?? Object.values(values).find((item) => !!item)
    if (value) return value
  }
  return undefined
}

function candidateLicenseId(
  description: string | undefined,
  url: string | undefined
): EmbeddedFontLicenseMetadata['candidateLicenseId'] {
  const evidence = `${description ?? ''} ${url ?? ''}`.toLocaleLowerCase()
  if (
    evidence.includes('sil open font license') ||
    evidence.includes('openfontlicense.org') ||
    evidence.includes('scripts.sil.org/ofl')
  ) {
    return 'OFL-1.1'
  }
  if (evidence.includes('apache license') && evidence.includes('2.0')) return 'Apache-2.0'
  return undefined
}

function embeddingMetadata(fsType: number | undefined): EmbeddedFontLicenseMetadata['embedding'] {
  if (fsType === undefined) {
    return {
      installable: null,
      restricted: null,
      previewPrint: null,
      editable: null,
      noSubsetting: null,
      bitmapOnly: null
    }
  }
  return {
    installable: fsType === 0,
    restricted: (fsType & 0x0002) !== 0,
    previewPrint: (fsType & 0x0004) !== 0,
    editable: (fsType & 0x0008) !== 0,
    noSubsetting: (fsType & 0x0100) !== 0,
    bitmapOnly: (fsType & 0x0200) !== 0
  }
}

export function embeddedFontLicenseMetadata(
  bytes: ArrayBuffer
): EmbeddedFontLicenseMetadata | null {
  const cached = embeddedMetadataCache.get(bytes)
  if (cached !== undefined) return cached

  try {
    const font = licenseFont(OpenTypeSync.parse(bytes))
    const names = font.names ?? {}
    const copyright = cleanMetadata(localizedValue(names, 'copyright'), 500)
    const trademark = cleanMetadata(localizedValue(names, 'trademark'), 300)
    const manufacturer = cleanMetadata(localizedValue(names, 'manufacturer'), 200)
    const licenseDescription = cleanMetadata(localizedValue(names, 'license'), 500)
    const licenseURL = cleanMetadata(localizedValue(names, 'licenseURL'), 300)
    const reportedLicenseId = candidateLicenseId(licenseDescription, licenseURL)
    const metadata: EmbeddedFontLicenseMetadata = {
      ...(copyright ? { copyright } : {}),
      ...(trademark ? { trademark } : {}),
      ...(manufacturer ? { manufacturer } : {}),
      ...(licenseDescription ? { licenseDescription } : {}),
      ...(licenseURL ? { licenseUrl: licenseURL } : {}),
      ...(reportedLicenseId ? { candidateLicenseId: reportedLicenseId } : {}),
      ...(font.tables?.os2?.fsType === undefined ? {} : { fsType: font.tables.os2.fsType }),
      embedding: embeddingMetadata(font.tables?.os2?.fsType)
    }
    embeddedMetadataCache.set(bytes, metadata)
    return metadata
  } catch {
    embeddedMetadataCache.set(bytes, null)
    return null
  }
}

async function sha256(bytes: ArrayBuffer): Promise<string | null> {
  let digest = digestCache.get(bytes)
  if (!digest) {
    digest = (async () => {
      const hash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))
      return Array.from(hash, (value) => value.toString(16).padStart(2, '0')).join('')
    })()
    digestCache.set(bytes, digest)
  }
  return digest
}

function explicitlyRestricted(metadata: EmbeddedFontLicenseMetadata | null): boolean {
  const description = metadata?.licenseDescription?.toLocaleLowerCase() ?? ''
  return (
    metadata?.embedding.restricted === true ||
    description.includes('personal use only') ||
    description.includes('non-commercial use only') ||
    description.includes('commercial license required')
  )
}

function bundledEvidenceNote(matched: boolean, loaded: boolean): string {
  if (matched) return 'The loaded font bytes match the reviewed bundled-font manifest.'
  if (loaded) return 'A reviewed bundled face exists, but the loaded bytes do not match it.'
  return 'A reviewed bundled face exists, but no loaded bytes are available to verify it.'
}

function buildEvidence(
  loaded: boolean,
  actualSha256: string | null,
  manifestFace: BundledFontFace | undefined,
  manifestLicense: BundledFontLicense | undefined,
  manifestMatched: boolean,
  embeddedMetadata: EmbeddedFontLicenseMetadata | null
): FontLicenseAssessment['evidence'] {
  const evidence: FontLicenseAssessment['evidence'] = []
  if (manifestFace) {
    evidence.push({
      kind: manifestMatched ? 'bundled_digest' : 'bundled_manifest_candidate',
      strength: manifestMatched ? 'verified' : 'candidate',
      ...(actualSha256 ? { sha256: actualSha256 } : {}),
      expectedSha256: manifestFace.sha256,
      ...(manifestLicense
        ? {
            licenseTextPath: manifestLicense.textPath,
            licenseTextSha256: manifestLicense.textSha256
          }
        : {}),
      note: bundledEvidenceNote(manifestMatched, loaded)
    })
  }
  if (embeddedMetadata?.licenseDescription || embeddedMetadata?.licenseUrl) {
    evidence.push({
      kind: 'embedded_name_table',
      strength: 'self_reported',
      ...(actualSha256 ? { sha256: actualSha256 } : {}),
      note: 'The font file reports license metadata in its OpenType name table; this is a hint, not independent proof.'
    })
  }
  if (embeddedMetadata?.embedding.restricted === true) {
    evidence.push({
      kind: 'embedded_os2',
      strength: 'self_reported',
      ...(actualSha256 ? { sha256: actualSha256 } : {}),
      note: `OpenType OS/2 fsType ${embeddedMetadata.fsType ?? 0x0002} marks font embedding as restricted.`
    })
  }
  return evidence
}

function buildReasons(
  loaded: boolean,
  manifestFace: BundledFontFace | undefined,
  manifestMatched: boolean,
  embeddedMetadata: EmbeddedFontLicenseMetadata | null
): string[] {
  const reasons: string[] = []
  if (!loaded) reasons.push('The exact font face is not loaded, so its binary cannot be audited.')
  if (embeddedMetadata?.embedding.restricted === true) {
    reasons.push(
      `OpenType OS/2 fsType ${embeddedMetadata.fsType ?? 0x0002} explicitly restricts embedding this font.`
    )
  }
  if (manifestFace && loaded && !manifestMatched) {
    reasons.push('The loaded binary does not match the reviewed bundled font digest.')
  }
  if (!manifestMatched && embeddedMetadata?.candidateLicenseId) {
    reasons.push(
      `${embeddedMetadata.candidateLicenseId} is self-reported by the font file and requires review.`
    )
  }
  if (!manifestMatched && !embeddedMetadata?.candidateLicenseId) {
    reasons.push('No verified repository manifest matches this exact loaded font binary.')
  }
  return reasons
}

function verifiedLicense(
  face: BundledFontFace,
  license: BundledFontLicense
): NonNullable<FontLicenseAssessment['license']> {
  return {
    id: face.licenseId,
    name: license.name,
    url: license.url,
    copyright: face.copyright,
    upstreamLicenseUrl: face.upstreamLicenseUrl,
    permissions: license.permissions,
    conditions: license.conditions
  }
}

function classificationFor(
  verified: boolean,
  embeddedMetadata: EmbeddedFontLicenseMetadata | null
): FontLicenseClassification {
  if (explicitlyRestricted(embeddedMetadata)) return 'restricted'
  return verified ? 'verified_open' : 'unknown'
}

function verifiedManifest(
  face: BundledFontFace | undefined,
  license: BundledFontLicense | undefined,
  actualSha256: string | null
): { face: BundledFontFace; license: BundledFontLicense } | null {
  if (!face || !license || !actualSha256) return null
  return actualSha256.toLocaleLowerCase() === face.sha256 ? { face, license } : null
}

async function assessFontLicenseData(
  family: string,
  style: string,
  bytes: ArrayBuffer | null
): Promise<FontLicenseAssessment> {
  const manifestFace = bundledFontFace(family, style)
  const manifestLicense = manifestFace ? bundledFontLicense(manifestFace) : undefined
  const embeddedMetadata = bytes ? embeddedFontLicenseMetadata(bytes) : null
  const actualSha256 = bytes ? await sha256(bytes) : null
  const verified = verifiedManifest(manifestFace, manifestLicense, actualSha256)
  const manifestMatched = verified !== null
  const classification = classificationFor(!!verified, embeddedMetadata)

  return {
    family,
    style,
    loaded: !!bytes,
    classification,
    license: verified ? verifiedLicense(verified.face, verified.license) : null,
    embeddedMetadata,
    evidence: buildEvidence(
      !!bytes,
      actualSha256,
      manifestFace,
      manifestLicense,
      manifestMatched,
      embeddedMetadata
    ),
    reasons: buildReasons(!!bytes, manifestFace, manifestMatched, embeddedMetadata)
  }
}

/** Audits caller-owned font bytes without registering them in the renderer. */
export function assessFontLicenseBytes(
  family: string,
  style: string,
  bytes: ArrayBuffer
): Promise<FontLicenseAssessment> {
  return assessFontLicenseData(family, style, bytes.byteLength > 0 ? bytes : null)
}

export function assessLoadedFontLicense(
  family: string,
  style: string
): Promise<FontLicenseAssessment> {
  return assessFontLicenseData(family, style, fontManager.loadedData(family, style))
}
