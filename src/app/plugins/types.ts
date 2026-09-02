import type { InstalledPluginStateV1 } from '@open-pencil/core/plugins'
import type {
  DeclarativeCommandContributionV1,
  DeclarativeCommandContributionV2,
  DeclarativeExporterContributionV1,
  DeclarativeExporterContributionV2,
  DeclarativeModuleContributionV1,
  PluginBackendProviderContributionV1,
  PluginConnectorContractV1,
  PluginManifest,
  PluginManifestPayload,
  PluginStorageProviderContributionV2,
  TrustedPluginKeyringV1,
  VerifiedPluginPackage
} from '@open-pencil/plugin-contracts'

export const APP_PLUGIN_STATE_SCHEMA_VERSION = 3 as const
export const APP_PLUGIN_STATE_PREVIOUS_SCHEMA_VERSION = 2 as const
export const APP_PLUGIN_STATE_LEGACY_SCHEMA_VERSION = 1 as const
// Keep a bounded catalog while leaving room beyond the app-bundled integrations for signed
// marketplace entries. The reviewed service rollout brings the built-in catalog close to 64.
export const MAX_APP_PLUGINS = 128

export type AppPluginTrustSource = 'app-bundle' | 'publisher-signature'

export type AppPluginActivationCompatibility =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason: string }>

export type AppPluginActivationCompatibilityPolicy = (
  manifest: PluginManifestPayload
) => AppPluginActivationCompatibility

export type AppBundlePluginCatalogEntry = Readonly<{
  trustSource: 'app-bundle'
  manifest: PluginManifestPayload
  installedByDefault?: boolean
  enabledByDefault?: boolean
}>

export type PublisherSignedPluginCatalogEntry = Readonly<{
  trustSource: 'publisher-signature'
  manifest: PluginManifest
  /** @deprecated Store trust is resolved from TrustedPluginKeyringV1, never from this adapter field. */
  trustedPublicKey: CryptoKey
  expectedPluginId: string
  expectedPublisherId: string
  expectedKeyId: string
  remoteCatalog?: AppPluginRemoteCatalogMetadata
  installedByDefault?: boolean
  enabledByDefault?: boolean
}>

export type AppPluginCatalogEntry = AppBundlePluginCatalogEntry | PublisherSignedPluginCatalogEntry

export type AppPluginMarketplaceAuthority = Readonly<{
  sourceId: string
  trustDomainId: string
  sourceGeneration: number
  rootKeySpkiSha256: string
}>

const MARKETPLACE_AUTHORITY_ID = /^[A-Za-z0-9._:-]{1,128}$/u
const MARKETPLACE_ROOT_FINGERPRINT = /^sha256-[A-Za-z0-9_-]{43}$/u
const MARKETPLACE_AUTHORITY_KEYS = new Set([
  'sourceId',
  'trustDomainId',
  'sourceGeneration',
  'rootKeySpkiSha256'
])

interface MarketplaceAuthorityRecord {
  [key: string]: unknown
}

function strictAuthorityRecord(value: unknown): MarketplaceAuthorityRecord {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError('Marketplace plugin authority must be an object')
  }
  const ownKeys = Reflect.ownKeys(value)
  if (
    ownKeys.length !== MARKETPLACE_AUTHORITY_KEYS.size ||
    ownKeys.some((key) => typeof key !== 'string' || !MARKETPLACE_AUTHORITY_KEYS.has(key))
  ) {
    throw new TypeError('Marketplace plugin authority contains unexpected fields')
  }
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw new TypeError('Marketplace plugin authority must contain plain data fields')
    }
  }
  return value as MarketplaceAuthorityRecord
}

export function parseAppPluginMarketplaceAuthority(value: unknown): AppPluginMarketplaceAuthority {
  const source = strictAuthorityRecord(value)
  if (typeof source.sourceId !== 'string' || !MARKETPLACE_AUTHORITY_ID.test(source.sourceId)) {
    throw new TypeError('Marketplace plugin authority sourceId is invalid')
  }
  if (
    typeof source.trustDomainId !== 'string' ||
    !MARKETPLACE_AUTHORITY_ID.test(source.trustDomainId)
  ) {
    throw new TypeError('Marketplace plugin authority trustDomainId is invalid')
  }
  if (!Number.isSafeInteger(source.sourceGeneration) || (source.sourceGeneration as number) < 1) {
    throw new TypeError('Marketplace plugin authority sourceGeneration is invalid')
  }
  if (
    typeof source.rootKeySpkiSha256 !== 'string' ||
    !MARKETPLACE_ROOT_FINGERPRINT.test(source.rootKeySpkiSha256)
  ) {
    throw new TypeError('Marketplace plugin authority rootKeySpkiSha256 is invalid')
  }
  return Object.freeze({
    sourceId: source.sourceId,
    trustDomainId: source.trustDomainId,
    sourceGeneration: source.sourceGeneration as number,
    rootKeySpkiSha256: source.rootKeySpkiSha256
  })
}

export function sameAppPluginMarketplaceAuthority(
  left: AppPluginMarketplaceAuthority | null | undefined,
  right: AppPluginMarketplaceAuthority | null | undefined
): boolean {
  if (!left || !right) return !left && !right
  return (
    left.sourceId === right.sourceId &&
    left.trustDomainId === right.trustDomainId &&
    left.sourceGeneration === right.sourceGeneration &&
    left.rootKeySpkiSha256 === right.rootKeySpkiSha256
  )
}

/**
 * The root-signed marketplace authorization lease for one atomic catalog/keyring load.
 * The store treats this as a live authorization boundary, not just display metadata.
 */
export type AppPluginMarketplaceTrustLease = Readonly<{
  authority: AppPluginMarketplaceAuthority
  marketplaceId: string
  snapshotVersion: string
  snapshotSequence: number
  snapshotDigest: string
  snapshotExpiresAt: string
}>

/**
 * Publisher catalog entries and their keyring must come from the same verified marketplace snapshot.
 */
export type AppPluginMarketplaceTrustBundle = Readonly<{
  catalog: readonly PublisherSignedPluginCatalogEntry[]
  trustedKeyring: TrustedPluginKeyringV1
  lease: AppPluginMarketplaceTrustLease
}>

export type AppPluginRemoteCatalogMetadata = Readonly<{
  catalogId: string
  catalogVersion: string
  catalogDigest: string
  catalogExpiresAt: string
  source: 'network' | 'cache'
}>

export type ResolvedPluginPackage = Readonly<{
  trustSource: AppPluginTrustSource
  manifest: PluginManifestPayload
  digest: string
  verifiedPackage?: VerifiedPluginPackage
  remoteCatalog?: AppPluginRemoteCatalogMetadata
  /** Exact marketplace authority, or null/undefined for legacy direct and app-bundled packages. */
  marketplaceAuthority?: AppPluginMarketplaceAuthority | null
}>

export type InstalledAppPlugin = Readonly<{
  package: ResolvedPluginPackage
  enabled: boolean
  pinnedDigest: string | null
  installedState?: InstalledPluginStateV1
  blockedReason?: string
}>

export type AppPluginCatalogItem = Readonly<{
  package: ResolvedPluginPackage
  installed: boolean
}>

export type AppPluginPinnedDigestMismatch = Readonly<{
  pluginId: string
  previousDigest: string
  catalogDigest: string
}>

export type AppPluginRecordIssueKind = 'invalid-record' | 'unsupported-schema'

export type AppPluginRecordIssue = Readonly<{
  pluginId: string | null
  kind: AppPluginRecordIssueKind
}>

export type AppPluginStoreSnapshot = Readonly<{
  ready: boolean
  catalog: readonly AppPluginCatalogItem[]
  installed: readonly InstalledAppPlugin[]
  pinnedDigestMismatches: readonly AppPluginPinnedDigestMismatch[]
  recordIssues: readonly AppPluginRecordIssue[]
  error: Error | null
}>

export type PersistedAppPluginStateV1 = Readonly<{
  schemaVersion: typeof APP_PLUGIN_STATE_LEGACY_SCHEMA_VERSION
  pluginId: string
  trustSource: AppPluginTrustSource
  activeDigest: string
  installed: boolean
  enabled: boolean
  pinnedDigest: string | null
}>

export type PersistedAppPluginStateV2 = Readonly<{
  schemaVersion: typeof APP_PLUGIN_STATE_PREVIOUS_SCHEMA_VERSION
  pluginId: string
  trustSource: AppPluginTrustSource
  activeDigest: string
  installed: boolean
  enabled: boolean
  pinnedDigest: string | null
  installedState: InstalledPluginStateV1 | null
}>

export type PersistedAppPluginStateV3 = Readonly<{
  schemaVersion: typeof APP_PLUGIN_STATE_SCHEMA_VERSION
  pluginId: string
  trustSource: AppPluginTrustSource
  activeDigest: string
  installed: boolean
  enabled: boolean
  pinnedDigest: string | null
  installedState: InstalledPluginStateV1 | null
  marketplaceAuthority: AppPluginMarketplaceAuthority | null
}>

export type PersistedAppPluginState =
  | PersistedAppPluginStateV1
  | PersistedAppPluginStateV2
  | PersistedAppPluginStateV3

export type InstalledPluginModule = Readonly<{
  plugin: InstalledAppPlugin
  contribution: DeclarativeModuleContributionV1
}>

export type AppPluginCommandContribution =
  | DeclarativeCommandContributionV1
  | DeclarativeCommandContributionV2

export type AppPluginExporterContribution =
  | DeclarativeExporterContributionV1
  | DeclarativeExporterContributionV2

export type InstalledPluginCommand = Readonly<{
  plugin: InstalledAppPlugin
  contribution: AppPluginCommandContribution
}>

export type InstalledPluginExporter = Readonly<{
  plugin: InstalledAppPlugin
  contribution: AppPluginExporterContribution
}>

export type InstalledPluginConnector = Readonly<{
  plugin: InstalledAppPlugin
  contribution: PluginConnectorContractV1
}>

export type InstalledPluginStorageProvider = Readonly<{
  plugin: InstalledAppPlugin
  contribution: PluginStorageProviderContributionV2
}>

export type InstalledPluginBackendProvider = Readonly<{
  plugin: InstalledAppPlugin
  contribution: PluginBackendProviderContributionV1
}>
