import type {
  DeclarativeCommandContributionV1,
  DeclarativeExporterContributionV1,
  DeclarativeModuleContributionV1,
  InstalledPluginStateV1,
  PluginManifestV1,
  PluginManifestPayloadV1,
  VerifiedPluginPackage
} from '@open-pencil/core/plugins'

export const APP_PLUGIN_STATE_SCHEMA_VERSION = 2 as const
export const APP_PLUGIN_STATE_LEGACY_SCHEMA_VERSION = 1 as const
export const MAX_APP_PLUGINS = 64

export type AppPluginTrustSource = 'app-bundle' | 'publisher-signature'

export type AppPluginActivationCompatibility =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason: string }>

export type AppPluginActivationCompatibilityPolicy = (
  manifest: PluginManifestPayloadV1
) => AppPluginActivationCompatibility

export type AppBundlePluginCatalogEntry = Readonly<{
  trustSource: 'app-bundle'
  manifest: PluginManifestPayloadV1
  installedByDefault?: boolean
  enabledByDefault?: boolean
}>

export type PublisherSignedPluginCatalogEntry = Readonly<{
  trustSource: 'publisher-signature'
  manifest: PluginManifestV1
  trustedPublicKey: CryptoKey
  expectedPluginId: string
  expectedPublisherId: string
  expectedKeyId: string
  remoteCatalog?: AppPluginRemoteCatalogMetadata
  installedByDefault?: boolean
  enabledByDefault?: boolean
}>

export type AppPluginCatalogEntry = AppBundlePluginCatalogEntry | PublisherSignedPluginCatalogEntry

export type AppPluginRemoteCatalogMetadata = Readonly<{
  catalogId: string
  catalogVersion: string
  catalogDigest: string
  catalogExpiresAt: string
  source: 'network' | 'cache'
}>

export type ResolvedPluginPackage = Readonly<{
  trustSource: AppPluginTrustSource
  manifest: PluginManifestPayloadV1
  digest: string
  verifiedPackage?: VerifiedPluginPackage
  remoteCatalog?: AppPluginRemoteCatalogMetadata
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
  schemaVersion: typeof APP_PLUGIN_STATE_SCHEMA_VERSION
  pluginId: string
  trustSource: AppPluginTrustSource
  activeDigest: string
  installed: boolean
  enabled: boolean
  pinnedDigest: string | null
  installedState: InstalledPluginStateV1 | null
}>

export type PersistedAppPluginState = PersistedAppPluginStateV1 | PersistedAppPluginStateV2

export type InstalledPluginModule = Readonly<{
  plugin: InstalledAppPlugin
  contribution: DeclarativeModuleContributionV1
}>

export type InstalledPluginCommand = Readonly<{
  plugin: InstalledAppPlugin
  contribution: DeclarativeCommandContributionV1
}>

export type InstalledPluginExporter = Readonly<{
  plugin: InstalledAppPlugin
  contribution: DeclarativeExporterContributionV1
}>
