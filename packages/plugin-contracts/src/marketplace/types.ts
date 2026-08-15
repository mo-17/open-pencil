import type { SignedManifestIntegrity } from '@open-pencil/scene-graph'

import type { VerifiedPluginCatalog } from '../catalog'
import type { TrustedPluginKeyringV1 } from '../keyring'

export const MARKETPLACE_SNAPSHOT_FORMAT = 'openpencil-marketplace-snapshot' as const
export const MARKETPLACE_SNAPSHOT_SCHEMA_VERSION = 1 as const

export const MARKETPLACE_RELEASE_CHANNELS = ['stable', 'beta'] as const
export type MarketplaceReleaseChannelV1 = (typeof MARKETPLACE_RELEASE_CHANNELS)[number]

export const MARKETPLACE_SNAPSHOT_LIMITS = Object.freeze({
  maxJsonBytes: 4 * 1024 * 1024,
  maxPublishers: 512,
  maxKeysPerPublisher: 16,
  maxOwnerships: 2_048,
  maxCatalogs: MARKETPLACE_RELEASE_CHANNELS.length,
  maxListings: 2_048,
  maxCategoriesPerListing: 8,
  maxKeywordsPerListing: 16,
  maxReleasesPerListing: MARKETPLACE_RELEASE_CHANNELS.length,
  maxNameLength: 128,
  maxSummaryLength: 512,
  maxCategoryLength: 64,
  maxKeywordLength: 64,
  maxReasonLength: 512,
  maxUrlLength: 2_048,
  maxPemBytes: 8 * 1024,
  maxValidityMilliseconds: 7 * 24 * 60 * 60 * 1_000,
  defaultClockSkewMilliseconds: 5 * 60 * 1_000,
  maxClockSkewMilliseconds: 60 * 60 * 1_000,
  expiringSoonMilliseconds: 6 * 60 * 60 * 1_000,
  maxSearchQueryLength: 256,
  maxSearchResults: 100
})

export interface MarketplacePublisherKeyV1 {
  keyId: string
  publicKeyPem: string
  notBefore: string
  notAfter: string
  predecessorKeyId?: string
  revokedAt?: string
  revocationReason?: string
}

export interface MarketplacePublisherV1 {
  publisherId: string
  name: string
  status: 'active' | 'suspended'
  keys: readonly MarketplacePublisherKeyV1[]
}

export interface MarketplacePluginOwnershipV1 {
  pluginId: string
  publisherId: string
  status: 'active' | 'revoked'
  grantedAt: string
  revokedAt?: string
  revocationReason?: string
}

export interface MarketplacePublisherDirectoryV1 {
  publishers: readonly MarketplacePublisherV1[]
  ownerships: readonly MarketplacePluginOwnershipV1[]
}

export interface MarketplaceCatalogReferenceV1 {
  channel: MarketplaceReleaseChannelV1
  catalogId: string
  keyId: string
  url: string
  digest: string
}

export interface MarketplaceListingReleaseV1 {
  channel: MarketplaceReleaseChannelV1
  version: string
  digest: string
}

export interface MarketplacePluginListingV1 {
  pluginId: string
  publisherId: string
  name: string
  summary: string
  categories: readonly string[]
  keywords: readonly string[]
  releases: readonly MarketplaceListingReleaseV1[]
}

export interface MarketplaceAuditHeadV1 {
  sequence: number
  headDigest: string
  url: string
}

/**
 * A generic, root-bound coordinate for a separately signed runtime index.
 * The snapshot deliberately does not know or execute the index's runtime schema.
 */
export interface MarketplaceRuntimeIndexReferenceV1 {
  url: string
  indexId: string
  keyId: string
  digest: string
}

export interface MarketplaceSnapshotPayloadV1 {
  format: typeof MARKETPLACE_SNAPSHOT_FORMAT
  schemaVersion: typeof MARKETPLACE_SNAPSHOT_SCHEMA_VERSION
  marketplaceId: string
  version: string
  sequence: number
  generatedAt: string
  expiresAt: string
  publisherDirectory: MarketplacePublisherDirectoryV1
  catalogs: readonly MarketplaceCatalogReferenceV1[]
  listings: readonly MarketplacePluginListingV1[]
  auditHead: MarketplaceAuditHeadV1
  runtimeIndex?: MarketplaceRuntimeIndexReferenceV1
}

export interface SignedMarketplaceSnapshotV1 extends MarketplaceSnapshotPayloadV1 {
  integrity: SignedManifestIntegrity
}

export type MarketplaceSnapshotValidationResult =
  | { ok: true; value: SignedMarketplaceSnapshotV1 }
  | { ok: false; reason: string }

export interface MarketplaceSnapshotSigningOptions {
  keyId?: string
}

export interface MarketplaceSnapshotVerificationOptions {
  expectedMarketplaceId?: string
  expectedKeyId?: string
  now?: Date | string | number
  maxClockSkewMilliseconds?: number
}

export interface MarketplaceSnapshotDiagnostic {
  code: 'marketplace-snapshot-expiring-soon'
  message: string
  subjectId: string
}

export interface VerifiedMarketplaceSnapshot {
  snapshot: SignedMarketplaceSnapshotV1
  verifiedDigest: string
  verifiedKeyId: string
  verifiedAt: string
  publisherKeyring: TrustedPluginKeyringV1
  diagnostics: readonly MarketplaceSnapshotDiagnostic[]
}

export interface MarketplaceCatalogVerificationOptions {
  snapshot: VerifiedMarketplaceSnapshot
  channel: MarketplaceReleaseChannelV1
  now?: Date | string | number
  maxClockSkewMilliseconds?: number
}

export interface MarketplaceRuntimeIndexVerificationOptions {
  snapshot: VerifiedMarketplaceSnapshot
  now?: Date | string | number
  maxClockSkewMilliseconds?: number
}

export interface VerifiedMarketplaceCatalog {
  reference: MarketplaceCatalogReferenceV1
  catalog: VerifiedPluginCatalog
}

export interface MarketplaceListingSearchOptions {
  query?: string
  category?: string
  channel?: MarketplaceReleaseChannelV1
  limit?: number
}
