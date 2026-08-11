import bundledFontLicenseManifest from '#core-assets/font-licenses.json'
import ofl11LicenseText from '#core-assets/licenses/OFL-1.1.txt?raw'

import type { NodeFontFace } from '#core/text/requirements'

export type FontLicensePermission = 'allowed' | 'allowed_with_conditions' | 'restricted' | 'unknown'

export interface BundledFontLicense {
  name: string
  url: string
  textPath: string
  textSha256: string
  permissions: {
    commercialUse: FontLicensePermission
    embedding: FontLicensePermission
    redistribution: FontLicensePermission
    modification: FontLicensePermission
  }
  conditions: string[]
}

export interface BundledFontFace {
  family: string
  style: string
  assetPath: string
  sha256: string
  licenseId: string
  copyright: string
  upstreamLicenseUrl: string
}

interface BundledFontLicenseManifest {
  schemaVersion: number
  licenses: Record<string, BundledFontLicense>
  fonts: BundledFontFace[]
}

export const BUNDLED_FONT_LICENSE_MANIFEST =
  bundledFontLicenseManifest as BundledFontLicenseManifest

const BUNDLED_FONT_LICENSE_TEXTS: Readonly<Record<string, string>> = Object.freeze({
  'OFL-1.1': ofl11LicenseText
})

function faceKey(family: string, style: string): string {
  return `${family.trim().toLocaleLowerCase()}\0${style.toLocaleLowerCase()}`
}

function familyKey(family: string): string {
  return family.trim().toLocaleLowerCase()
}

const bundledFacesByKey = new Map(
  BUNDLED_FONT_LICENSE_MANIFEST.fonts.map((face) => [faceKey(face.family, face.style), face])
)

const bundledFacesByFamily = new Map<string, BundledFontFace[]>()
for (const face of BUNDLED_FONT_LICENSE_MANIFEST.fonts) {
  const key = familyKey(face.family)
  const faces = bundledFacesByFamily.get(key) ?? []
  faces.push(face)
  bundledFacesByFamily.set(key, faces)
}

export const BUNDLED_FONT_URLS: Readonly<Record<string, string>> = Object.fromEntries(
  BUNDLED_FONT_LICENSE_MANIFEST.fonts.map((face) => [
    `${face.family}|${face.style}`,
    face.assetPath
  ])
)

export function bundledFontFace(family: string, style: string): BundledFontFace | undefined {
  return bundledFacesByKey.get(faceKey(family, style))
}

export function bundledFontFamilyFaces(family: string): readonly BundledFontFace[] {
  return bundledFacesByFamily.get(familyKey(family)) ?? []
}

export function bundledFontLicense(face: BundledFontFace): BundledFontLicense | undefined {
  return BUNDLED_FONT_LICENSE_MANIFEST.licenses[face.licenseId]
}

/** Full reviewed license text shipped with a bundled-font manifest entry. */
export function bundledFontLicenseText(licenseId: string): string | undefined {
  return BUNDLED_FONT_LICENSE_TEXTS[licenseId]
}

/**
 * Build the complete copyright + license notice required when exact reviewed
 * bundled font bytes are copied into an exported project. Callers must still
 * verify the bytes with `assessFontLicenseBytes()` before using this notice.
 */
export function buildBundledFontRedistributionNotice(
  requestedFaces: readonly NodeFontFace[]
): string | undefined {
  const faces = new Map<string, BundledFontFace>()
  for (const requested of requestedFaces) {
    const face = bundledFontFace(requested.family, requested.style)
    if (!face) return undefined
    faces.set(faceKey(face.family, face.style), face)
  }
  if (faces.size === 0) return undefined

  const licenses = new Map<string, { license: BundledFontLicense; text: string }>()
  for (const face of faces.values()) {
    const license = bundledFontLicense(face)
    const text = license && bundledFontLicenseText(face.licenseId)
    if (!license || !text) return undefined
    if (
      license.permissions.embedding === 'restricted' ||
      license.permissions.embedding === 'unknown' ||
      license.permissions.redistribution === 'restricted' ||
      license.permissions.redistribution === 'unknown'
    ) {
      return undefined
    }
    licenses.set(face.licenseId, { license, text })
  }

  const faceNotices = [...faces.values()]
    .map(
      (face) =>
        `${face.family} ${face.style}\n${face.copyright}\nLicense: ${face.licenseId} (${face.upstreamLicenseUrl})`
    )
    .join('\n\n')
  const licenseNotices = [...licenses]
    .map(
      ([licenseId, { license, text }]) =>
        `${license.name} (${licenseId})\n${license.url}\n\n${text.trim()}`
    )
    .join('\n\n')
  return `Bundled font notices\n====================\n\n${faceNotices}\n\n${licenseNotices}\n`
}
