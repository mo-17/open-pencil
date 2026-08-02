import {
  bundledFontFamilyFaces,
  bundledFontLicense,
  type BundledFontFace,
  type BundledFontLicense,
  type FontLicensePermission
} from '#core/text/bundled-fonts'
import type { WebFontProviderId } from '#core/text/web-fonts'

export type FontLicenseDisplayStatus = 'free' | 'declared_open' | 'requires_license' | 'unknown'

export type FontLicenseDisplayEvidence =
  | 'reviewed_bundled_manifest'
  | 'provider_policy'
  | 'embedded_name_table'
  | 'explicit_restriction'
  | 'insufficient'

export type FontLicenseDisplayScope = 'catalog_source' | 'loaded_faces'
export type FontLicenseRestriction = 'commercial' | 'general' | 'embedding'

export type FontFamilyLicenseDisplay =
  | {
      status: 'free'
      scope: FontLicenseDisplayScope
      evidence: 'reviewed_bundled_manifest'
      licenseIds: string[]
      hasConditions: boolean
    }
  | {
      status: 'free'
      scope: 'catalog_source'
      evidence: 'provider_policy'
      provider: WebFontProviderId
      policyUrl: string
      policyCheckedAt: string
      licenseIds: string[]
      hasConditions: true
    }
  | {
      status: 'declared_open'
      scope: 'loaded_faces'
      evidence: 'embedded_name_table'
      licenseIds: string[]
      hasConditions: true
    }
  | {
      status: 'requires_license'
      scope: FontLicenseDisplayScope
      evidence: 'explicit_restriction'
      restriction: FontLicenseRestriction
    }
  | {
      status: 'unknown'
      scope: FontLicenseDisplayScope
      evidence: 'insufficient'
    }

/**
 * Minimal input accepted from the loaded-byte font-license audit. A
 * `verified_open` classification is expected to mean an exact digest match,
 * not a self-reported OpenType name-table claim.
 */
export interface FontLicenseDisplayAssessment {
  classification: 'verified_open' | 'restricted' | 'unknown'
  license?: {
    id: string
    conditions?: readonly string[]
  } | null
  embeddedMetadata?: {
    candidateLicenseId?: string
  } | null
}

interface WebFontLicensePolicy {
  url: string
  checkedAt: string
}

/**
 * Catalog-wide statements published by the provider. These establish that a
 * family listed by that provider is free to use, but do not replace the
 * family-specific license when redistributing or modifying font software.
 */
export const WEB_FONT_LICENSE_POLICIES = {
  google: { url: 'https://developers.google.com/fonts/faq', checkedAt: '2026-07-31' },
  fontsource: {
    url: 'https://fontsource.org/docs/getting-started/introduction',
    checkedAt: '2026-07-31'
  },
  bunny: { url: 'https://fonts.bunny.net/faq', checkedAt: '2026-07-31' },
  fontshare: { url: 'https://www.fontshare.com/about', checkedAt: '2026-07-31' }
} as const satisfies Record<WebFontProviderId, WebFontLicensePolicy>

const SHA256_PATTERN = /^[a-f\d]{64}$/i

function unknownDisplay(scope: FontLicenseDisplayScope): FontFamilyLicenseDisplay {
  return {
    status: 'unknown',
    scope,
    evidence: 'insufficient'
  }
}

function restrictedDisplay(
  scope: FontLicenseDisplayScope,
  restriction: FontLicenseRestriction
): FontFamilyLicenseDisplay {
  return {
    status: 'requires_license',
    scope,
    evidence: 'explicit_restriction',
    restriction
  }
}

function freeDisplay(
  scope: FontLicenseDisplayScope,
  licenseIds: string[],
  hasConditions: boolean
): FontFamilyLicenseDisplay {
  return {
    status: 'free',
    scope,
    evidence: 'reviewed_bundled_manifest',
    licenseIds,
    hasConditions
  }
}

function providerPolicyDisplay(
  provider: WebFontProviderId,
  policy: WebFontLicensePolicy
): FontFamilyLicenseDisplay {
  return {
    status: 'free',
    scope: 'catalog_source',
    evidence: 'provider_policy',
    provider,
    policyUrl: policy.url,
    policyCheckedAt: policy.checkedAt,
    licenseIds: [],
    hasConditions: true
  }
}

function declaredOpenDisplay(licenseIds: string[]): FontFamilyLicenseDisplay {
  return {
    status: 'declared_open',
    scope: 'loaded_faces',
    evidence: 'embedded_name_table',
    licenseIds,
    hasConditions: true
  }
}

function uniqueLicenseIds(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => !!value))].sort((a, b) =>
    a.localeCompare(b)
  )
}

function reviewedPermission(permission: FontLicensePermission): boolean {
  return permission !== 'unknown'
}

function completeReviewedLicense(license: BundledFontLicense): boolean {
  const permissions = Object.values(license.permissions)
  return (
    !!license.name.trim() &&
    !!license.url.trim() &&
    !!license.textPath.trim() &&
    SHA256_PATTERN.test(license.textSha256) &&
    permissions.every(reviewedPermission) &&
    (!permissions.includes('allowed_with_conditions') || license.conditions.length > 0)
  )
}

function completeReviewedFace(face: BundledFontFace, license: BundledFontLicense): boolean {
  return (
    !!face.family.trim() &&
    !!face.style.trim() &&
    !!face.assetPath.trim() &&
    SHA256_PATTERN.test(face.sha256) &&
    !!face.licenseId.trim() &&
    !!face.copyright.trim() &&
    !!face.upstreamLicenseUrl.trim() &&
    completeReviewedLicense(license)
  )
}

/**
 * Returns conservative license metadata for a family as listed by a catalog.
 * Bundled families require a complete reviewed manifest. Web-provider entries
 * use the provider's official catalog-wide policy and retain that weaker
 * evidence level in the result. Local and fallback names alone prove nothing.
 */
export function fontFamilyLicenseDisplayForCatalog(
  family: string,
  source: string
): FontFamilyLicenseDisplay {
  const providerPolicy = (
    WEB_FONT_LICENSE_POLICIES as Partial<Record<string, WebFontLicensePolicy>>
  )[source]
  if (providerPolicy) {
    return providerPolicyDisplay(source as WebFontProviderId, providerPolicy)
  }
  if (source !== 'bundled') return unknownDisplay('catalog_source')

  const faces = bundledFontFamilyFaces(family)
  if (faces.length === 0) return unknownDisplay('catalog_source')

  const entries = faces.map((face) => ({ face, license: bundledFontLicense(face) }))
  const licenseIds = uniqueLicenseIds(entries.map(({ face }) => face.licenseId))
  if (entries.some(({ license }) => license?.permissions.commercialUse === 'restricted')) {
    return restrictedDisplay('catalog_source', 'commercial')
  }
  if (entries.some(({ face, license }) => !license || !completeReviewedFace(face, license))) {
    return unknownDisplay('catalog_source')
  }

  return freeDisplay(
    'catalog_source',
    licenseIds,
    entries.some(({ license }) => (license?.conditions.length ?? 0) > 0)
  )
}

/**
 * Reduces exact face-level audit results into a family-level display status
 * without loading fonts or performing network requests.
 */
export function fontFamilyLicenseDisplayFromAssessments(
  assessments: readonly FontLicenseDisplayAssessment[]
): FontFamilyLicenseDisplay {
  if (assessments.length === 0) return unknownDisplay('loaded_faces')

  const licenseIds = uniqueLicenseIds(assessments.map((assessment) => assessment.license?.id))
  if (assessments.some((assessment) => assessment.classification === 'restricted')) {
    return restrictedDisplay('loaded_faces', 'general')
  }
  if (
    assessments.every(
      (assessment) => assessment.classification === 'verified_open' && !!assessment.license?.id
    )
  ) {
    return freeDisplay(
      'loaded_faces',
      licenseIds,
      assessments.some((assessment) => (assessment.license?.conditions?.length ?? 0) > 0)
    )
  }

  const declaredLicenseIds = uniqueLicenseIds(
    assessments.map((assessment) => assessment.embeddedMetadata?.candidateLicenseId)
  )
  const hasOnlyReviewedOrDeclaredEvidence = assessments.every(
    (assessment) =>
      (assessment.classification === 'verified_open' && !!assessment.license?.id) ||
      (assessment.classification === 'unknown' && !!assessment.embeddedMetadata?.candidateLicenseId)
  )
  if (hasOnlyReviewedOrDeclaredEvidence && declaredLicenseIds.length > 0) {
    return declaredOpenDisplay(uniqueLicenseIds([...licenseIds, ...declaredLicenseIds]))
  }

  return unknownDisplay('loaded_faces')
}
