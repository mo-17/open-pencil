import bundledFontLicenseManifest from '#core-assets/font-licenses.json'

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
