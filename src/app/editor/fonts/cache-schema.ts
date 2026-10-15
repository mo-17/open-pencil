import * as v from 'valibot'

import { WEB_FONT_PROVIDER_IDS, type FontFamilyLicenseDisplay } from '@open-pencil/core/text'

const licenseScope = v.picklist(['catalog_source', 'loaded_faces'])
const licenseIds = v.array(v.string())
const cachedLicenseDisplay = v.union([
  v.object({
    status: v.literal('free'),
    scope: licenseScope,
    evidence: v.literal('reviewed_bundled_manifest'),
    licenseIds,
    hasConditions: v.boolean()
  }),
  v.object({
    status: v.literal('free'),
    scope: v.literal('catalog_source'),
    evidence: v.literal('provider_policy'),
    provider: v.picklist(WEB_FONT_PROVIDER_IDS),
    policyUrl: v.string(),
    policyCheckedAt: v.string(),
    licenseIds,
    hasConditions: v.literal(true)
  }),
  v.object({
    status: v.literal('declared_open'),
    scope: v.literal('loaded_faces'),
    evidence: v.literal('embedded_name_table'),
    licenseIds,
    hasConditions: v.literal(true)
  }),
  v.object({
    status: v.literal('requires_license'),
    scope: licenseScope,
    evidence: v.literal('explicit_restriction'),
    restriction: v.picklist(['commercial', 'general', 'embedding'])
  }),
  v.object({
    status: v.literal('unknown'),
    scope: licenseScope,
    evidence: v.literal('insufficient')
  })
]) satisfies v.GenericSchema<unknown, FontFamilyLicenseDisplay>

const cachedFontEntry = v.object({
  family: v.string(),
  style: v.string(),
  file: v.string(),
  byteLength: v.number(),
  sha256: v.string(),
  updatedAt: v.number(),
  source: v.optional(v.picklist(['remote', 'imported'])),
  format: v.optional(v.picklist(['truetype', 'opentype', 'woff'])),
  characters: v.optional(v.string()),
  fullFace: v.optional(v.boolean()),
  licenseDisplay: v.optional(cachedLicenseDisplay)
})

export const CachedFontManifest = v.object({
  version: v.literal(1),
  entries: v.record(v.string(), cachedFontEntry)
})

export type FontCacheEntry = v.InferOutput<typeof cachedFontEntry>
type ParsedFontManifest = v.InferOutput<typeof CachedFontManifest>
export type FontCacheManifest = Omit<ParsedFontManifest, 'entries'> & {
  entries: Partial<ParsedFontManifest['entries']>
}
