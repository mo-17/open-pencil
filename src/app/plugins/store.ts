/* eslint-disable max-lines -- Plugin trust, persistence, and lifecycle transitions form one state machine. */
import {
  acceptPluginUpdate,
  createInstalledPluginState,
  parseInstalledPluginState,
  rejectPluginUpdate,
  reviewPluginUpdate,
  rollbackPlugin,
  setPluginEnabled,
  type InstalledPluginStateV1,
  type InstalledPluginTrustOptions
} from '@open-pencil/core/plugins'
import {
  parseVersionedPluginManifestPayload,
  parsePluginTrustTimestamp,
  parseTrustedPluginKeyring,
  resolveTrustedPluginKey,
  verifyVersionedPluginPackage,
  type PluginManifestPayload,
  type TrustedPluginKeyringV1,
  type VerifiedPluginPackage
} from '@open-pencil/plugin-contracts'
import {
  canonicalManifestJSON,
  compareStableSemver,
  digestCanonicalManifest,
  parseSha256Base64URL,
  parseStableSemver,
  satisfiesStableEngineRange,
  stableSemverParts,
  validateModuleIdentity
} from '@open-pencil/scene-graph'

import {
  sameReviewedInstalledPublisherAuthority,
  sameReviewedPublisherPackage,
  type ReviewedInstalledPublisherAuthority
} from './review-authority'
import type { AppPluginStateStorage } from './storage'
import {
  APP_PLUGIN_STATE_SCHEMA_VERSION,
  APP_PLUGIN_STATE_LEGACY_SCHEMA_VERSION,
  APP_PLUGIN_STATE_PREVIOUS_SCHEMA_VERSION,
  MAX_APP_PLUGINS,
  parseAppPluginMarketplaceAuthority,
  sameAppPluginMarketplaceAuthority,
  type AppPluginActivationCompatibilityPolicy,
  type AppPluginCatalogEntry,
  type AppPluginMarketplaceAuthority,
  type AppPluginMarketplaceTrustBundle,
  type AppPluginMarketplaceTrustLease,
  type AppPluginPinnedDigestMismatch,
  type AppPluginRecordIssue,
  type AppPluginRecordIssueKind,
  type AppPluginStoreSnapshot,
  type InstalledAppPlugin,
  type InstalledPluginCommand,
  type InstalledPluginConnector,
  type InstalledPluginExporter,
  type InstalledPluginModule,
  type InstalledPluginStorageProvider,
  type PersistedAppPluginState,
  type PersistedAppPluginStateV1,
  type PersistedAppPluginStateV2,
  type PersistedAppPluginStateV3,
  type PublisherSignedPluginCatalogEntry,
  type ResolvedPluginPackage
} from './types'

export interface CreateAppPluginStoreOptions {
  storage: AppPluginStateStorage
  activationCompatibilityPolicy: AppPluginActivationCompatibilityPolicy
  /**
   * Publisher entry keys are adapter metadata only. The store resolves the authoritative key from
   * the configured keyring and cryptographically re-verifies every signed manifest on load.
   */
  catalog: readonly AppPluginCatalogEntry[]
  catalogLoader?: () => Promise<readonly PublisherSignedPluginCatalogEntry[]>
  trustedKeyring?: TrustedPluginKeyringV1
  trustedKeyringLoader?: () => Promise<TrustedPluginKeyringV1 | undefined>
  /** undefined means no Marketplace source and permits the legacy direct trust loader fallback. */
  marketplaceTrustBundleLoader?: () => Promise<AppPluginMarketplaceTrustBundle | null | undefined>
  /** Cross-window exclusive lock for publisher authority mutations and source transitions. */
  publisherMutationLock?: <T>(operation: () => Promise<T>) => Promise<T>
  /** Durable source-clock checkpoint, invoked while publisherMutationLock is held. */
  publisherTrustClockCheckpoint?: () => Promise<unknown>
  now?: () => number
  engineVersion: string
}

type StoreListener = (snapshot: AppPluginStoreSnapshot) => void

export class PublisherPluginTransitionBlockedError extends Error {
  readonly pluginIds: readonly string[]

  constructor(pluginIds: readonly string[]) {
    super(`Uninstall publisher plugins before changing Marketplace source: ${pluginIds.join(', ')}`)
    this.name = 'PublisherPluginTransitionBlockedError'
    this.pluginIds = Object.freeze([...pluginIds])
  }
}
type PluginRecordError = Readonly<{
  pluginId: string | null
  error: Error
  publisherSnapshotRecord: boolean
  issue?: AppPluginRecordIssue
}>
type CatalogLoadResult = Readonly<{
  packages: Map<string, ResolvedPluginPackage>
  publicKeys: Map<string, CryptoKey>
  failures: Map<string, Error>
  errors: readonly Error[]
}>
type InstalledPluginLoadResult = {
  nextInstalled: Map<string, InstalledAppPlugin>
  storedPluginIds: Set<string>
  recordsToPersist: PersistedAppPluginStateV3[]
  nextRecordErrors: PluginRecordError[]
  nextPinnedDigestMismatches: Map<string, AppPluginPinnedDigestMismatch>
}
type StoredCandidateMetadata = Readonly<{
  candidatePluginId: string | null
  resettablePluginId: string | null
  publisherSnapshotRecord: boolean
}>

const MAX_STORED_PLUGIN_RECORDS = MAX_APP_PLUGINS * 16
const PERSISTED_STATE_COMMON_KEYS = [
  'schemaVersion',
  'pluginId',
  'trustSource',
  'activeDigest',
  'installed',
  'enabled',
  'pinnedDigest'
] as const
const PERSISTED_STATE_LEGACY_KEYS = new Set<string>(PERSISTED_STATE_COMMON_KEYS)
const PERSISTED_STATE_PREVIOUS_KEYS = new Set<string>([
  ...PERSISTED_STATE_COMMON_KEYS,
  'installedState'
])
const PERSISTED_STATE_CURRENT_KEYS = new Set<string>([
  ...PERSISTED_STATE_PREVIOUS_KEYS,
  'marketplaceAuthority'
])

type PersistedPluginCommonState = Omit<
  PersistedAppPluginStateV3,
  'schemaVersion' | 'installedState' | 'marketplaceAuthority'
>
type PersistedPluginSchemaVersion =
  | typeof APP_PLUGIN_STATE_LEGACY_SCHEMA_VERSION
  | typeof APP_PLUGIN_STATE_PREVIOUS_SCHEMA_VERSION
  | typeof APP_PLUGIN_STATE_SCHEMA_VERSION

class StoredPluginStateValidationError extends Error {
  constructor(
    readonly kind: AppPluginRecordIssueKind,
    message: string
  ) {
    super(message)
    this.name = 'StoredPluginStateValidationError'
  }
}

class StoredPluginSignatureVerificationError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause })
    this.name = 'StoredPluginSignatureVerificationError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false
  }
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== 'string') return false
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return Boolean(descriptor?.enumerable && 'value' in descriptor)
  })
}

function safeCandidatePluginId(value: unknown): string | null {
  if (!isRecord(value) || typeof value.pluginId !== 'string') return null
  return validateModuleIdentity(value.pluginId, 'stored plugin id') === null ? value.pluginId : null
}

function parseMarketplaceTrustLease(value: unknown): AppPluginMarketplaceTrustLease {
  if (!isRecord(value)) throw new TypeError('Marketplace plugin trust lease must be an object')
  const expectedKeys = new Set([
    'authority',
    'marketplaceId',
    'snapshotVersion',
    'snapshotSequence',
    'snapshotDigest',
    'snapshotExpiresAt'
  ])
  const keys = Object.keys(value)
  if (keys.length !== expectedKeys.size || keys.some((key) => !expectedKeys.has(key))) {
    throw new TypeError('Marketplace plugin trust lease contains unexpected fields')
  }
  if (
    typeof value.marketplaceId !== 'string' ||
    validateModuleIdentity(value.marketplaceId, 'marketplace trust lease id') !== null
  ) {
    throw new TypeError('Marketplace plugin trust lease id is invalid')
  }
  if (!Number.isSafeInteger(value.snapshotSequence) || (value.snapshotSequence as number) < 1) {
    throw new TypeError('Marketplace plugin trust lease sequence must be a positive integer')
  }
  return Object.freeze({
    authority: parseAppPluginMarketplaceAuthority(value.authority),
    marketplaceId: value.marketplaceId,
    snapshotVersion: parseStableSemver(
      value.snapshotVersion,
      'marketplace trust lease snapshot version'
    ),
    snapshotSequence: value.snapshotSequence as number,
    snapshotDigest: parseSha256Base64URL(
      value.snapshotDigest,
      'marketplace trust lease snapshot digest'
    ),
    snapshotExpiresAt: parsePluginTrustTimestamp(
      value.snapshotExpiresAt,
      'marketplace trust lease snapshot expiry'
    )
  })
}

function invalidStoredPluginState(kind: AppPluginRecordIssueKind, message: string): never {
  throw new StoredPluginStateValidationError(kind, message)
}

function storedPluginRecordIssue(
  cause: unknown,
  pluginId: string | null,
  publisherSnapshotRecord: boolean
): AppPluginRecordIssue | undefined {
  if (cause instanceof StoredPluginStateValidationError) {
    return { pluginId, kind: cause.kind }
  }
  return pluginId && publisherSnapshotRecord ? { pluginId, kind: 'invalid-record' } : undefined
}

async function appBundleDigest(manifest: PluginManifestPayload): Promise<string> {
  return `app-bundle-sha256:${await digestCanonicalManifest(manifest)}`
}

async function resolveCatalogEntry(
  entry: AppPluginCatalogEntry,
  engineVersion: string,
  trustedKeyring: TrustedPluginKeyringV1 | undefined,
  now: number,
  marketplaceAuthority: AppPluginMarketplaceAuthority | null
): Promise<{ package: ResolvedPluginPackage; trustedPublicKey?: CryptoKey }> {
  if (entry.trustSource === 'publisher-signature') {
    if (!trustedKeyring) throw new Error('Publisher trust keyring is unavailable')
    const keyTrust = resolveTrustedPluginKey(trustedKeyring, {
      pluginId: entry.expectedPluginId,
      publisherId: entry.expectedPublisherId,
      keyId: entry.expectedKeyId,
      now
    })
    const verifiedPackage = await verifyVersionedPluginPackage(
      entry.manifest,
      keyTrust.key.publicKey,
      {
        engineVersion,
        expectedKeyId: entry.expectedKeyId
      }
    )
    const { manifest, verifiedDigest } = verifiedPackage
    if (manifest.plugin.id !== entry.expectedPluginId) {
      throw new Error('Plugin id is not owned by the trusted catalog entry')
    }
    if (manifest.publisher.id !== entry.expectedPublisherId) {
      throw new Error('Plugin publisher is not owned by the trusted catalog entry')
    }
    return {
      package: {
        trustSource: entry.trustSource,
        manifest,
        digest: verifiedDigest,
        verifiedPackage,
        marketplaceAuthority: marketplaceAuthority ? structuredClone(marketplaceAuthority) : null,
        ...(entry.remoteCatalog ? { remoteCatalog: structuredClone(entry.remoteCatalog) } : {})
      },
      trustedPublicKey: keyTrust.key.publicKey
    }
  }
  const manifest = parseVersionedPluginManifestPayload(entry.manifest)
  if (!satisfiesStableEngineRange(engineVersion, manifest.engineRange)) {
    throw new Error(`Plugin ${manifest.plugin.id} requires OpenPencil ${manifest.engineRange}`)
  }
  return {
    package: {
      trustSource: entry.trustSource,
      manifest,
      digest: await appBundleDigest(manifest)
    }
  }
}

function parsePersistedSchemaVersion(value: Record<string, unknown>): PersistedPluginSchemaVersion {
  if (value.schemaVersion === APP_PLUGIN_STATE_LEGACY_SCHEMA_VERSION) {
    return APP_PLUGIN_STATE_LEGACY_SCHEMA_VERSION
  }
  if (value.schemaVersion === APP_PLUGIN_STATE_PREVIOUS_SCHEMA_VERSION) {
    return APP_PLUGIN_STATE_PREVIOUS_SCHEMA_VERSION
  }
  if (value.schemaVersion === APP_PLUGIN_STATE_SCHEMA_VERSION) {
    return APP_PLUGIN_STATE_SCHEMA_VERSION
  }
  return invalidStoredPluginState(
    'unsupported-schema',
    'Stored plugin state has an unsupported schema version'
  )
}

function requireExactPersistedStateKeys(
  value: Record<string, unknown>,
  schemaVersion: PersistedPluginSchemaVersion
): void {
  let expected = PERSISTED_STATE_LEGACY_KEYS
  if (schemaVersion === APP_PLUGIN_STATE_PREVIOUS_SCHEMA_VERSION) {
    expected = PERSISTED_STATE_PREVIOUS_KEYS
  } else if (schemaVersion === APP_PLUGIN_STATE_SCHEMA_VERSION) {
    expected = PERSISTED_STATE_CURRENT_KEYS
  }
  const keys = Object.keys(value)
  if (keys.length !== expected.size || keys.some((key) => !expected.has(key))) {
    invalidStoredPluginState('invalid-record', 'Stored plugin state contains unexpected fields')
  }
}

function parsePersistedCommonState(value: Record<string, unknown>): PersistedPluginCommonState {
  const { pluginId, trustSource, activeDigest, installed, enabled, pinnedDigest } = value
  if (
    typeof pluginId !== 'string' ||
    typeof activeDigest !== 'string' ||
    (trustSource !== 'app-bundle' && trustSource !== 'publisher-signature') ||
    typeof installed !== 'boolean' ||
    typeof enabled !== 'boolean' ||
    (pinnedDigest !== null && typeof pinnedDigest !== 'string')
  ) {
    invalidStoredPluginState('invalid-record', 'Stored plugin state is invalid')
  }
  if (validateModuleIdentity(pluginId, 'stored plugin id') !== null) {
    invalidStoredPluginState('invalid-record', 'Stored plugin state has an invalid plugin id')
  }
  if (!installed && enabled) {
    invalidStoredPluginState('invalid-record', 'An uninstalled plugin cannot be enabled')
  }
  if (pinnedDigest !== null && pinnedDigest !== activeDigest) {
    invalidStoredPluginState(
      'invalid-record',
      'Stored plugin pin must match the exact active digest'
    )
  }
  return { pluginId, trustSource, activeDigest, installed, enabled, pinnedDigest }
}

function parsePersistedInstalledState(
  value: Record<string, unknown>,
  common: PersistedPluginCommonState,
  trustOptions: InstalledPluginTrustOptions
): InstalledPluginStateV1 | null {
  const installedState =
    value.installedState === null
      ? null
      : parseInstalledPluginState(value.installedState, trustOptions)
  if (common.trustSource === 'app-bundle' && installedState !== null) {
    invalidStoredPluginState('invalid-record', 'App-bundle state cannot contain a signed snapshot')
  }
  if (common.trustSource === 'publisher-signature' && common.installed && !installedState) {
    invalidStoredPluginState('invalid-record', 'Publisher plugin state requires a signed snapshot')
  }
  if (!common.installed && installedState !== null) {
    invalidStoredPluginState('invalid-record', 'Uninstalled plugin state cannot retain snapshots')
  }
  if (
    installedState &&
    (installedState.accepted.manifest.plugin.id !== common.pluginId ||
      installedState.accepted.verifiedDigest !== common.activeDigest ||
      installedState.enabled !== common.enabled)
  ) {
    invalidStoredPluginState(
      'invalid-record',
      'Stored plugin state does not match its accepted signed snapshot'
    )
  }
  return installedState
}

function parsePersistedState(
  value: unknown,
  trustOptions: InstalledPluginTrustOptions
): PersistedAppPluginState {
  if (!isRecord(value)) {
    invalidStoredPluginState('invalid-record', 'Stored plugin state must be an object')
  }
  const schemaVersion = parsePersistedSchemaVersion(value)
  requireExactPersistedStateKeys(value, schemaVersion)
  const common = parsePersistedCommonState(value)
  if (schemaVersion === APP_PLUGIN_STATE_LEGACY_SCHEMA_VERSION) {
    return { schemaVersion: APP_PLUGIN_STATE_LEGACY_SCHEMA_VERSION, ...common }
  }
  const installedState = parsePersistedInstalledState(value, common, trustOptions)
  if (schemaVersion === APP_PLUGIN_STATE_PREVIOUS_SCHEMA_VERSION) {
    return {
      schemaVersion: APP_PLUGIN_STATE_PREVIOUS_SCHEMA_VERSION,
      ...common,
      installedState
    }
  }
  const marketplaceAuthority =
    value.marketplaceAuthority === null
      ? null
      : parseAppPluginMarketplaceAuthority(value.marketplaceAuthority)
  if (common.trustSource === 'app-bundle' && marketplaceAuthority !== null) {
    invalidStoredPluginState(
      'invalid-record',
      'App-bundle state cannot contain marketplace authority'
    )
  }
  return {
    schemaVersion: APP_PLUGIN_STATE_SCHEMA_VERSION,
    ...common,
    installedState,
    marketplaceAuthority
  }
}

function installedStateFor(
  pluginPackage: ResolvedPluginPackage,
  enabled: boolean
): InstalledPluginStateV1 | undefined {
  return pluginPackage.verifiedPackage
    ? createInstalledPluginState(pluginPackage.verifiedPackage, { enabled })
    : undefined
}

function resolvedFromSnapshot(
  trustSource: ResolvedPluginPackage['trustSource'],
  snapshot: VerifiedPluginPackage,
  marketplaceAuthority: AppPluginMarketplaceAuthority | null,
  remoteCatalog?: ResolvedPluginPackage['remoteCatalog']
): ResolvedPluginPackage {
  return {
    trustSource,
    manifest: snapshot.manifest,
    digest: snapshot.verifiedDigest,
    verifiedPackage: snapshot,
    marketplaceAuthority: marketplaceAuthority ? structuredClone(marketplaceAuthority) : null,
    ...(remoteCatalog ? { remoteCatalog: structuredClone(remoteCatalog) } : {})
  }
}

function remoteCatalogForSnapshot(
  snapshot: VerifiedPluginPackage,
  candidates: readonly (ResolvedPluginPackage | undefined)[]
): ResolvedPluginPackage['remoteCatalog'] | undefined {
  const matching = candidates.find(
    (candidate) => candidate?.verifiedPackage?.verifiedDigest === snapshot.verifiedDigest
  )
  return matching?.remoteCatalog ? structuredClone(matching.remoteCatalog) : undefined
}

async function verifyStoredSnapshot(
  snapshot: VerifiedPluginPackage,
  options: {
    trustedKeyring?: TrustedPluginKeyringV1
    fallbackPublicKey?: CryptoKey
    engineVersion?: string
  }
): Promise<VerifiedPluginPackage> {
  let publicKey = options.fallbackPublicKey
  if (options.trustedKeyring) {
    const trusted = options.trustedKeyring.keys.find(
      (key) =>
        key.keyId === snapshot.verifiedKeyId &&
        key.publisherId === snapshot.manifest.publisher.id &&
        key.pluginIds.includes(snapshot.manifest.plugin.id)
    )
    if (!trusted) throw new Error(`Stored plugin key is not trusted: ${snapshot.verifiedKeyId}`)
    publicKey = trusted.publicKey
  }
  if (!publicKey) throw new Error(`Stored plugin key is unavailable: ${snapshot.verifiedKeyId}`)
  let verified: VerifiedPluginPackage
  try {
    verified = await verifyVersionedPluginPackage(snapshot.manifest, publicKey, {
      expectedKeyId: snapshot.verifiedKeyId
    })
  } catch (cause) {
    throw new StoredPluginSignatureVerificationError(
      `Stored plugin signature verification failed: ${snapshot.manifest.plugin.id}`,
      cause
    )
  }
  if (verified.verifiedDigest !== snapshot.verifiedDigest) {
    throw new StoredPluginSignatureVerificationError(
      'Stored plugin snapshot digest verification failed'
    )
  }
  if (
    options.engineVersion &&
    !satisfiesStableEngineRange(options.engineVersion, verified.manifest.engineRange)
  ) {
    throw new Error(
      `Plugin ${verified.manifest.plugin.id} requires OpenPencil ${verified.manifest.engineRange}`
    )
  }
  return verified
}

async function verifyActiveStoredSnapshot(
  snapshot: VerifiedPluginPackage,
  options: {
    trustedKeyring?: TrustedPluginKeyringV1
    fallbackPublicKey?: CryptoKey
    engineVersion: string
    now: number
  }
): Promise<VerifiedPluginPackage> {
  if (!options.trustedKeyring) throw new Error('Publisher trust keyring is unavailable')
  resolveTrustedPluginKey(options.trustedKeyring, {
    pluginId: snapshot.manifest.plugin.id,
    publisherId: snapshot.manifest.publisher.id,
    keyId: snapshot.verifiedKeyId,
    now: options.now
  })
  return verifyStoredSnapshot(snapshot, options)
}

async function verifyStoredInstalledState(
  value: InstalledPluginStateV1,
  options: {
    trustedKeyring?: TrustedPluginKeyringV1
    fallbackPublicKey?: CryptoKey
    engineVersion: string
    now: number
  }
): Promise<{ state: InstalledPluginStateV1; blockedReason?: string }> {
  const trustOptions = { trustedKeyring: options.trustedKeyring, now: options.now }
  const state = parseInstalledPluginState(value, trustOptions)
  await verifyStoredSnapshot(state.accepted, {
    trustedKeyring: options.trustedKeyring,
    fallbackPublicKey: options.fallbackPublicKey,
    engineVersion: options.engineVersion
  })
  for (const snapshot of state.history) {
    await verifyStoredSnapshot(snapshot, {
      trustedKeyring: options.trustedKeyring,
      fallbackPublicKey: options.fallbackPublicKey
    })
  }
  if (state.pending) {
    await verifyStoredSnapshot(state.pending.candidate, {
      trustedKeyring: options.trustedKeyring,
      fallbackPublicKey: options.fallbackPublicKey,
      engineVersion: options.engineVersion
    })
  }
  if (!options.trustedKeyring) {
    return { state, blockedReason: 'Publisher trust keyring is unavailable' }
  }
  try {
    resolveTrustedPluginKey(options.trustedKeyring, {
      pluginId: state.accepted.manifest.plugin.id,
      publisherId: state.accepted.manifest.publisher.id,
      keyId: state.accepted.verifiedKeyId,
      now: options.now
    })
    return { state }
  } catch (cause) {
    return {
      state,
      blockedReason: cause instanceof Error ? cause.message : String(cause)
    }
  }
}

export function createAppPluginStore(options: CreateAppPluginStoreOptions) {
  const configuredTrustedKeyring = options.trustedKeyring
    ? parseTrustedPluginKeyring(options.trustedKeyring)
    : undefined
  let trustedKeyring = configuredTrustedKeyring
  let marketplaceTrustLease: AppPluginMarketplaceTrustLease | undefined
  let marketplaceTrustRequired = false
  const wallNow = options.now ?? Date.now
  let lastObservedTime = Number.NEGATIVE_INFINITY
  const now = () => {
    const observed = wallNow()
    if (!Number.isFinite(observed)) throw new TypeError('Plugin trust clock must be finite')
    lastObservedTime = Math.max(lastObservedTime, observed)
    return lastObservedTime
  }
  const listeners = new Set<StoreListener>()
  const catalogDefaults = new Map(
    [
      ...options.catalog.filter((entry) => entry.trustSource === 'publisher-signature'),
      ...options.catalog.filter((entry) => entry.trustSource === 'app-bundle')
    ].map((entry) => [
      entry.trustSource === 'publisher-signature'
        ? entry.expectedPluginId
        : entry.manifest.plugin.id,
      {
        installed: entry.installedByDefault === true,
        enabled: entry.enabledByDefault === true
      }
    ])
  )
  let catalog = new Map<string, ResolvedPluginPackage>()
  let catalogPublicKeys = new Map<string, CryptoKey>()
  let catalogFailures = new Map<string, Error>()
  let installed = new Map<string, InstalledAppPlugin>()
  let pinnedDigestMismatches = new Map<string, AppPluginPinnedDigestMismatch>()
  let ready = false
  let fatalError: Error | null = null
  let recordErrors: PluginRecordError[] = []
  let activeLoad: Promise<AppPluginStoreSnapshot> | null = null
  let mutationTail: Promise<void> = Promise.resolve()
  let loadedStorageRevision: number | null = null
  let publisherAuthorityInvalidated = false

  function activationCompatibilityBlockReason(manifest: PluginManifestPayload): string | undefined {
    try {
      const compatibility = options.activationCompatibilityPolicy(manifest)
      return compatibility.ok
        ? undefined
        : `Plugin activation is incompatible: ${compatibility.reason}`
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause)
      return `Plugin activation compatibility check failed: ${reason}`
    }
  }

  function requireActivationCompatibility(manifest: PluginManifestPayload): void {
    const blockedReason = activationCompatibilityBlockReason(manifest)
    if (blockedReason) throw new Error(blockedReason)
  }

  function requireFreshCatalogForMutation(
    pluginPackage: ResolvedPluginPackage,
    operationNow: number
  ): void {
    const remoteCatalog = pluginPackage.remoteCatalog
    if (!remoteCatalog) return
    const expiresAt = Date.parse(remoteCatalog.catalogExpiresAt)
    if (!Number.isFinite(expiresAt) || operationNow >= expiresAt) {
      throw new Error(
        `Remote plugin catalog expired for ${pluginPackage.manifest.plugin.id}; refresh the catalog before continuing`
      )
    }
  }

  function marketplaceTrustBlockReason(operationNow: number): string | undefined {
    if (!marketplaceTrustRequired) return undefined
    if (!marketplaceTrustLease) return 'Verified marketplace trust bundle is unavailable'
    const expiresAt = Date.parse(marketplaceTrustLease.snapshotExpiresAt)
    return operationNow >= expiresAt
      ? `Marketplace trust snapshot expired at ${marketplaceTrustLease.snapshotExpiresAt}`
      : undefined
  }

  function publisherPackageTrustBlockReason(
    pluginPackage: ResolvedPluginPackage,
    operationNow: number
  ): string | undefined {
    const marketplaceReason = marketplaceTrustBlockReason(operationNow)
    if (marketplaceReason) return marketplaceReason
    const expectedAuthority = marketplaceTrustLease?.authority ?? null
    if (!sameAppPluginMarketplaceAuthority(pluginPackage.marketplaceAuthority, expectedAuthority)) {
      return 'Marketplace source authority changed; uninstall and review the plugin again'
    }
    if (!trustedKeyring) return 'Publisher trust keyring is unavailable'
    const snapshot = pluginPackage.verifiedPackage
    if (!snapshot) return 'Signed plugin snapshot is unavailable'
    try {
      resolveTrustedPluginKey(trustedKeyring, {
        pluginId: snapshot.manifest.plugin.id,
        publisherId: snapshot.manifest.publisher.id,
        keyId: snapshot.verifiedKeyId,
        now: operationNow
      })
      return undefined
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause)
    }
  }

  function requireCatalogPackageActivation(
    pluginPackage: ResolvedPluginPackage,
    operationNow: number
  ): void {
    if (pluginPackage.trustSource === 'publisher-signature') {
      if (!pluginPackage.verifiedPackage) {
        throw new Error(
          `Publisher plugin ${pluginPackage.manifest.plugin.id} requires a current verified catalog entry`
        )
      }
      requireFreshCatalogForMutation(pluginPackage, operationNow)
      const blockedReason = publisherPackageTrustBlockReason(pluginPackage, operationNow)
      if (blockedReason) throw new Error(`Plugin trust is blocked: ${blockedReason}`)
    }
    requireActivationCompatibility(pluginPackage.manifest)
  }

  function requireCurrentCatalogCandidate(
    pluginId: string,
    candidate: VerifiedPluginPackage,
    operationNow: number
  ): ResolvedPluginPackage {
    const catalogEntry = catalog.get(pluginId)
    if (
      catalogEntry?.trustSource !== 'publisher-signature' ||
      catalogEntry.verifiedPackage?.verifiedDigest !== candidate.verifiedDigest
    ) {
      throw new Error(
        `Pending plugin update for ${pluginId} is not the current verified catalog package; refresh the catalog before accepting`
      )
    }
    requireFreshCatalogForMutation(catalogEntry, operationNow)
    const blockedReason = publisherPackageTrustBlockReason(catalogEntry, operationNow)
    if (blockedReason) throw new Error(`Plugin trust is blocked: ${blockedReason}`)
    return catalogEntry
  }

  function currentTrustBlockReason(
    plugin: InstalledAppPlugin,
    trustNow = now()
  ): string | undefined {
    if (plugin.package.trustSource !== 'publisher-signature') return undefined
    const accepted = plugin.installedState?.accepted ?? plugin.package.verifiedPackage
    if (!accepted) return 'Signed plugin snapshot is unavailable'
    if (
      accepted.verifiedDigest !== plugin.package.digest ||
      accepted.manifest.plugin.id !== plugin.package.manifest.plugin.id
    ) {
      return 'Signed plugin snapshot does not match the active package'
    }
    if (!satisfiesStableEngineRange(options.engineVersion, accepted.manifest.engineRange)) {
      return `Plugin ${accepted.manifest.plugin.id} requires OpenPencil ${accepted.manifest.engineRange}`
    }
    return publisherPackageTrustBlockReason(plugin.package, trustNow)
  }

  function currentPluginBlockReason(
    plugin: InstalledAppPlugin,
    operationNow = now()
  ): string | undefined {
    return (
      currentTrustBlockReason(plugin, operationNow) ??
      activationCompatibilityBlockReason(plugin.package.manifest)
    )
  }

  function runtimePluginState(plugin: InstalledAppPlugin): InstalledAppPlugin {
    const blockedReason = currentPluginBlockReason(plugin)
    const { blockedReason: _staleReason, ...current } = plugin
    return blockedReason ? { ...current, enabled: false, blockedReason } : current
  }

  function snapshot(): AppPluginStoreSnapshot {
    const catalogItems = [...catalog.values()]
      .map((pluginPackage) => ({
        package: structuredClone(pluginPackage),
        installed: installed.has(pluginPackage.manifest.plugin.id)
      }))
      .sort((left, right) =>
        left.package.manifest.plugin.name.localeCompare(right.package.manifest.plugin.name)
      )
    return {
      ready,
      catalog: catalogItems,
      installed: [...installed.values()]
        .map((plugin) => structuredClone(runtimePluginState(plugin)))
        .sort((left, right) =>
          left.package.manifest.plugin.name.localeCompare(right.package.manifest.plugin.name)
        ),
      pinnedDigestMismatches: [...pinnedDigestMismatches.values()].map((issue) => ({ ...issue })),
      recordIssues: recordErrors.flatMap(({ issue }) => (issue ? [{ ...issue }] : [])),
      error: fatalError ?? recordErrors.at(0)?.error ?? null
    }
  }

  function notify(): void {
    const value = snapshot()
    for (const listener of listeners) listener(value)
  }

  function requireReady(): void {
    if (!ready) throw new Error('Plugins are still loading')
  }

  function catalogPackage(pluginId: string): ResolvedPluginPackage {
    const pluginPackage = catalog.get(pluginId)
    if (!pluginPackage) {
      const failure = catalogFailures.get(pluginId)
      if (failure) {
        throw new Error(`Plugin ${pluginId} is unavailable: ${failure.message}`, { cause: failure })
      }
      throw new Error(`Unknown plugin: ${pluginId}`)
    }
    return pluginPackage
  }

  function installedPlugin(pluginId: string): InstalledAppPlugin {
    const plugin = installed.get(pluginId)
    if (!plugin) throw new Error(`Plugin is not installed: ${pluginId}`)
    return plugin
  }

  function persistedState(
    pluginPackage: ResolvedPluginPackage,
    values: {
      installed: boolean
      enabled: boolean
      pinnedDigest: string | null
      installedState?: InstalledPluginStateV1
    }
  ): PersistedAppPluginStateV3 {
    const installedState = values.installed
      ? (values.installedState ?? installedStateFor(pluginPackage, values.enabled) ?? null)
      : null
    return {
      schemaVersion: APP_PLUGIN_STATE_SCHEMA_VERSION,
      pluginId: pluginPackage.manifest.plugin.id,
      trustSource: pluginPackage.trustSource,
      activeDigest: pluginPackage.digest,
      installed: values.installed,
      enabled: values.enabled,
      pinnedDigest: values.pinnedDigest,
      installedState,
      marketplaceAuthority:
        pluginPackage.trustSource === 'publisher-signature' && pluginPackage.marketplaceAuthority
          ? structuredClone(pluginPackage.marketplaceAuthority)
          : null
    }
  }

  function runMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = mutationTail.then(operation, operation)
    mutationTail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  function withPublisherMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    return options.publisherMutationLock ? options.publisherMutationLock(operation) : operation()
  }

  async function mutateStoredState(operation: () => Promise<void>): Promise<void> {
    const revisionBefore = await options.storage.revision()
    if (loadedStorageRevision !== null && revisionBefore !== loadedStorageRevision) {
      publisherAuthorityInvalidated = true
    }
    await operation()
    const revisionAfter = await options.storage.revision()
    if (revisionAfter !== revisionBefore + 1) publisherAuthorityInvalidated = true
    loadedStorageRevision = revisionAfter
  }

  function putStoredState(record: unknown): Promise<void> {
    return mutateStoredState(() => options.storage.put(record))
  }

  function deleteStoredState(pluginId: string): Promise<void> {
    return mutateStoredState(() => options.storage.delete(pluginId))
  }

  async function assertStorageRevisionCurrent(): Promise<void> {
    const current = await options.storage.revision()
    if (loadedStorageRevision === null || current !== loadedStorageRevision) {
      throw new Error('Publisher plugin state changed in another window; reload plugins')
    }
  }

  async function assertPublisherStateCurrent(): Promise<void> {
    requireReady()
    if (publisherAuthorityInvalidated) {
      throw new Error(
        'Publisher plugin authority changed in another window; restart OpenPencil before using publisher plugins'
      )
    }
    await assertStorageRevisionCurrent()
    const stored = await options.storage.list()
    if (stored.length > MAX_STORED_PLUGIN_RECORDS) {
      throw new Error(`Stored plugin state exceeds the ${MAX_STORED_PLUGIN_RECORDS} record limit`)
    }
    const publisherRecords = new Map<string, unknown>()
    for (const candidate of stored) {
      if (!isRecord(candidate) || candidate.trustSource !== 'publisher-signature') continue
      const pluginId = safeCandidatePluginId(candidate)
      if (!pluginId || publisherRecords.has(pluginId)) {
        throw new Error('Publisher plugin state changed in another window; reload plugins')
      }
      publisherRecords.set(pluginId, candidate)
    }
    for (const current of installed.values()) {
      if (current.package.trustSource !== 'publisher-signature') continue
      const pluginId = current.package.manifest.plugin.id
      const candidate = publisherRecords.get(pluginId)
      if (!isRecord(candidate) || candidate.installed !== true) {
        throw new Error('Publisher plugin state changed in another window; reload plugins')
      }
      const expected = persistedState(current.package, {
        installed: true,
        enabled: current.enabled,
        pinnedDigest: current.pinnedDigest,
        ...(current.installedState ? { installedState: current.installedState } : {})
      })
      try {
        if (canonicalManifestJSON(candidate) !== canonicalManifestJSON(expected)) {
          throw new Error('Publisher plugin state changed in another window; reload plugins')
        }
      } catch (cause) {
        if (cause instanceof Error && cause.message.includes('changed in another window')) {
          throw cause
        }
        throw new Error('Publisher plugin state changed in another window; reload plugins', {
          cause
        })
      }
      publisherRecords.delete(pluginId)
    }
    for (const candidate of publisherRecords.values()) {
      if (isRecord(candidate) && candidate.installed === true) {
        throw new Error('Publisher plugin state changed in another window; reload plugins')
      }
    }
    await assertStorageRevisionCurrent()
  }

  async function checkpointPublisherTrust(): Promise<void> {
    await options.publisherTrustClockCheckpoint?.()
    await assertPublisherStateCurrent()
  }

  async function publisherPluginIdsForTransition(): Promise<string[]> {
    const pluginIds = new Set(
      [...installed.values()]
        .filter(({ package: value }) => value.trustSource === 'publisher-signature')
        .map(({ package: value }) => value.manifest.plugin.id)
    )
    const stored = await options.storage.list()
    if (stored.length > MAX_STORED_PLUGIN_RECORDS) {
      throw new Error(`Stored plugin state exceeds the ${MAX_STORED_PLUGIN_RECORDS} record limit`)
    }
    for (const candidate of stored) {
      if (
        !isRecord(candidate) ||
        candidate.trustSource !== 'publisher-signature' ||
        candidate.installed !== true
      ) {
        continue
      }
      pluginIds.add(safeCandidatePluginId(candidate) ?? '<invalid-publisher-record>')
    }
    return [...pluginIds].sort()
  }

  async function loadPublisherTrust(): Promise<{
    entries: readonly PublisherSignedPluginCatalogEntry[]
    keyring: TrustedPluginKeyringV1 | undefined
    lease: AppPluginMarketplaceTrustLease | undefined
    marketplaceRequired: boolean
    unavailableError?: Error
  }> {
    if (options.marketplaceTrustBundleLoader) {
      const bundle = await options.marketplaceTrustBundleLoader()
      if (bundle !== undefined) {
        if (!bundle) {
          return {
            entries: [],
            keyring: undefined,
            lease: undefined,
            marketplaceRequired: true,
            unavailableError: new Error('Verified marketplace trust bundle is unavailable')
          }
        }
        if (!Array.isArray(bundle.catalog)) {
          throw new TypeError('Marketplace plugin trust bundle catalog must be an array')
        }
        return {
          entries: bundle.catalog,
          keyring: parseTrustedPluginKeyring(bundle.trustedKeyring),
          lease: parseMarketplaceTrustLease(bundle.lease),
          marketplaceRequired: true
        }
      }
    }
    const keyring = options.trustedKeyringLoader
      ? await options.trustedKeyringLoader()
      : configuredTrustedKeyring
    return {
      entries: options.catalogLoader ? await options.catalogLoader() : [],
      keyring: keyring ? parseTrustedPluginKeyring(keyring) : undefined,
      lease: undefined,
      marketplaceRequired: false
    }
  }

  async function loadCatalog(
    publisherEntries: readonly PublisherSignedPluginCatalogEntry[],
    nextTrustedKeyring: TrustedPluginKeyringV1 | undefined,
    loadNow: number,
    marketplaceAuthority: AppPluginMarketplaceAuthority | null
  ): Promise<CatalogLoadResult> {
    const appBundleEntries = options.catalog.filter((entry) => entry.trustSource === 'app-bundle')
    const allPublisherEntries = [
      ...options.catalog.filter(
        (entry): entry is PublisherSignedPluginCatalogEntry =>
          entry.trustSource === 'publisher-signature'
      ),
      ...publisherEntries
    ]
    if (appBundleEntries.length + allPublisherEntries.length > MAX_APP_PLUGINS) {
      throw new Error(`Plugin catalog exceeds the ${MAX_APP_PLUGINS} plugin limit`)
    }

    const resolvedAppBundles = await Promise.all(
      appBundleEntries.map((entry) =>
        resolveCatalogEntry(entry, options.engineVersion, nextTrustedKeyring, loadNow, null)
      )
    )
    const nextCatalog = new Map<string, ResolvedPluginPackage>()
    const nextPublicKeys = new Map<string, CryptoKey>()
    const failures = new Map<string, Error>()
    const errors: Error[] = []
    const appBundlePluginIds = new Set<string>()
    for (const resolvedEntry of resolvedAppBundles) {
      const resolved = resolvedEntry.package
      const pluginId = resolved.manifest.plugin.id
      if (nextCatalog.has(pluginId)) throw new Error(`Duplicate plugin in catalog: ${pluginId}`)
      nextCatalog.set(pluginId, resolved)
      appBundlePluginIds.add(pluginId)
    }

    const resolvedPublishers = await Promise.all(
      allPublisherEntries.map(async (entry) => {
        try {
          return {
            ok: true as const,
            entry,
            resolved: await resolveCatalogEntry(
              entry,
              options.engineVersion,
              nextTrustedKeyring,
              loadNow,
              marketplaceAuthority
            )
          }
        } catch (cause) {
          return {
            ok: false as const,
            entry,
            error: cause instanceof Error ? cause : new Error(String(cause))
          }
        }
      })
    )
    const seenPublisherPluginIds = new Set<string>()
    function recordPublisherFailure(pluginId: string, error: Error): void {
      if (validateModuleIdentity(pluginId, 'publisher catalog plugin id') === null) {
        failures.set(pluginId, failures.get(pluginId) ?? error)
        if (!appBundlePluginIds.has(pluginId)) {
          nextCatalog.delete(pluginId)
          nextPublicKeys.delete(pluginId)
        }
      }
      errors.push(error)
    }
    for (const result of resolvedPublishers) {
      const pluginId = result.entry.expectedPluginId
      const duplicatePublisher = seenPublisherPluginIds.has(pluginId)
      seenPublisherPluginIds.add(pluginId)
      if (!result.ok) {
        recordPublisherFailure(pluginId, result.error)
        continue
      }
      if (appBundlePluginIds.has(pluginId)) {
        recordPublisherFailure(
          pluginId,
          new Error(`Publisher plugin conflicts with app-bundle plugin: ${pluginId}`)
        )
        continue
      }
      if (duplicatePublisher) {
        recordPublisherFailure(
          pluginId,
          new Error(`Duplicate publisher plugin in catalog: ${pluginId}`)
        )
        continue
      }
      nextCatalog.set(pluginId, result.resolved.package)
      if (result.resolved.trustedPublicKey) {
        nextPublicKeys.set(pluginId, result.resolved.trustedPublicKey)
      }
    }
    return { packages: nextCatalog, publicKeys: nextPublicKeys, failures, errors }
  }

  function createInstalledPluginLoadResult(): InstalledPluginLoadResult {
    return {
      nextInstalled: new Map(),
      storedPluginIds: new Set(),
      recordsToPersist: [],
      nextRecordErrors: [],
      nextPinnedDigestMismatches: new Map()
    }
  }

  function storedCandidateMetadata(
    candidate: unknown,
    nextCatalog: ReadonlyMap<string, ResolvedPluginPackage>
  ): StoredCandidateMetadata {
    const candidatePluginId = safeCandidatePluginId(candidate)
    const catalogPackage = candidatePluginId ? nextCatalog.get(candidatePluginId) : undefined
    const publisherSnapshotRecord = Boolean(
      isRecord(candidate) &&
      (candidate.trustSource === 'publisher-signature' ||
        candidate.installedState != null ||
        candidate.marketplaceAuthority != null ||
        catalogPackage?.trustSource === 'publisher-signature')
    )
    const resettablePluginId =
      candidatePluginId && (nextCatalog.has(candidatePluginId) || publisherSnapshotRecord)
        ? candidatePluginId
        : null
    return {
      candidatePluginId,
      resettablePluginId,
      publisherSnapshotRecord
    }
  }

  function failPinnedBundleDigest(
    persisted: PersistedAppPluginStateV1 | PersistedAppPluginStateV2 | PersistedAppPluginStateV3,
    catalogEntry: ResolvedPluginPackage,
    result: InstalledPluginLoadResult
  ): never {
    result.nextPinnedDigestMismatches.set(persisted.pluginId, {
      pluginId: persisted.pluginId,
      previousDigest: persisted.pinnedDigest as string,
      catalogDigest: catalogEntry.digest
    })
    throw new Error(
      `Stored plugin ${persisted.pluginId} is pinned to a different app-bundle digest`
    )
  }

  function restoreLegacyPersistedPlugin(
    persisted: PersistedAppPluginStateV1,
    catalogEntry: ResolvedPluginPackage | undefined,
    result: InstalledPluginLoadResult
  ): void {
    if (persisted.trustSource === 'publisher-signature' && persisted.installed) {
      invalidStoredPluginState(
        'invalid-record',
        `Stored publisher plugin ${persisted.pluginId} predates marketplace authority binding`
      )
    }
    if (!catalogEntry) return
    if (catalogEntry.digest !== persisted.activeDigest) {
      if (catalogEntry.trustSource === 'app-bundle' && persisted.pinnedDigest !== null) {
        failPinnedBundleDigest(persisted, catalogEntry, result)
      }
      if (catalogEntry.trustSource !== 'app-bundle') {
        throw new Error(`Stored plugin ${persisted.pluginId} does not match the trusted catalog`)
      }
    }
    if (!persisted.installed) {
      result.recordsToPersist.push(
        persistedState(catalogEntry, {
          installed: false,
          enabled: false,
          pinnedDigest: null
        })
      )
      return
    }
    const installedState = installedStateFor(catalogEntry, persisted.enabled)
    result.nextInstalled.set(persisted.pluginId, {
      package: catalogEntry,
      enabled: persisted.enabled,
      pinnedDigest: persisted.pinnedDigest,
      ...(installedState ? { installedState } : {})
    })
    result.recordsToPersist.push(
      persistedState(catalogEntry, {
        installed: true,
        enabled: persisted.enabled,
        pinnedDigest:
          catalogEntry.digest === persisted.activeDigest ? persisted.pinnedDigest : null,
        ...(installedState ? { installedState } : {})
      })
    )
  }

  function restoreAppBundlePersistedPlugin(
    persisted: PersistedAppPluginStateV2 | PersistedAppPluginStateV3,
    catalogEntry: ResolvedPluginPackage | undefined,
    result: InstalledPluginLoadResult
  ): void {
    if (!catalogEntry) return
    const digestChanged = catalogEntry.digest !== persisted.activeDigest
    if (digestChanged && persisted.pinnedDigest !== null) {
      failPinnedBundleDigest(persisted, catalogEntry, result)
    }
    if (persisted.schemaVersion !== APP_PLUGIN_STATE_SCHEMA_VERSION || digestChanged) {
      result.recordsToPersist.push(
        persistedState(catalogEntry, {
          installed: persisted.installed,
          enabled: persisted.enabled,
          pinnedDigest: digestChanged ? null : persisted.pinnedDigest
        })
      )
    }
    if (!persisted.installed) return
    result.nextInstalled.set(persisted.pluginId, {
      package: catalogEntry,
      enabled: persisted.enabled,
      pinnedDigest: persisted.pinnedDigest
    })
  }

  function reviewCatalogPluginUpdate(
    installedState: InstalledPluginStateV1,
    catalogEntry: ResolvedPluginPackage | undefined,
    persisted: PersistedAppPluginStateV3,
    loadNow: number,
    result: InstalledPluginLoadResult
  ): InstalledPluginStateV1 {
    const candidatePackage = catalogEntry?.verifiedPackage
    if (
      !candidatePackage ||
      candidatePackage.verifiedDigest === installedState.accepted.verifiedDigest
    ) {
      return installedState
    }
    const versionComparison = compareStableSemver(
      stableSemverParts(candidatePackage.manifest.plugin.version),
      stableSemverParts(installedState.accepted.manifest.plugin.version)
    )
    if (versionComparison === 0) throw new Error('Plugin content changed without a version bump')
    if (
      versionComparison < 0 ||
      installedState.pending?.candidate.verifiedDigest === candidatePackage.verifiedDigest
    ) {
      return installedState
    }
    const reviewed = reviewPluginUpdate(installedState, candidatePackage, {
      trustedKeyring,
      now: loadNow
    })
    result.recordsToPersist.push(
      persistedState(
        resolvedFromSnapshot(
          'publisher-signature',
          reviewed.accepted,
          persisted.marketplaceAuthority,
          remoteCatalogForSnapshot(reviewed.accepted, [catalogEntry])
        ),
        {
          installed: true,
          enabled: reviewed.enabled,
          pinnedDigest: persisted.pinnedDigest,
          installedState: reviewed
        }
      )
    )
    return reviewed
  }

  async function restorePublisherPersistedPlugin(
    persisted: PersistedAppPluginStateV3,
    catalogEntry: ResolvedPluginPackage | undefined,
    nextPublicKeys: ReadonlyMap<string, CryptoKey>,
    loadNow: number,
    result: InstalledPluginLoadResult
  ): Promise<void> {
    if (!persisted.installed || !persisted.installedState) return
    if (marketplaceTrustRequired && !marketplaceTrustLease) {
      invalidStoredPluginState(
        'invalid-record',
        `Stored publisher plugin ${persisted.pluginId} has no current marketplace authority`
      )
    }
    const currentAuthority = marketplaceTrustLease?.authority ?? null
    if (
      !sameAppPluginMarketplaceAuthority(persisted.marketplaceAuthority, currentAuthority) ||
      (catalogEntry &&
        !sameAppPluginMarketplaceAuthority(
          catalogEntry.marketplaceAuthority,
          persisted.marketplaceAuthority
        ))
    ) {
      invalidStoredPluginState(
        'invalid-record',
        `Stored publisher plugin ${persisted.pluginId} marketplace authority changed`
      )
    }
    const verifiedStored = await verifyStoredInstalledState(persisted.installedState, {
      trustedKeyring,
      fallbackPublicKey: nextPublicKeys.get(persisted.pluginId),
      engineVersion: options.engineVersion,
      now: loadNow
    })
    const installedState = reviewCatalogPluginUpdate(
      verifiedStored.state,
      catalogEntry,
      persisted,
      loadNow,
      result
    )
    const pluginPackage = resolvedFromSnapshot(
      'publisher-signature',
      installedState.accepted,
      persisted.marketplaceAuthority,
      remoteCatalogForSnapshot(installedState.accepted, [catalogEntry])
    )
    result.nextInstalled.set(persisted.pluginId, {
      package: pluginPackage,
      enabled: installedState.enabled,
      pinnedDigest: persisted.pinnedDigest,
      installedState,
      ...(verifiedStored.blockedReason ? { blockedReason: verifiedStored.blockedReason } : {})
    })
  }

  async function restorePersistedPlugin(
    persisted: PersistedAppPluginState,
    nextCatalog: ReadonlyMap<string, ResolvedPluginPackage>,
    nextPublicKeys: ReadonlyMap<string, CryptoKey>,
    loadNow: number,
    result: InstalledPluginLoadResult
  ): Promise<void> {
    const catalogEntry = nextCatalog.get(persisted.pluginId)
    if (catalogEntry && catalogEntry.trustSource !== persisted.trustSource) {
      throw new Error(`Stored plugin ${persisted.pluginId} does not match the trusted catalog`)
    }
    if (persisted.schemaVersion === APP_PLUGIN_STATE_LEGACY_SCHEMA_VERSION) {
      restoreLegacyPersistedPlugin(persisted, catalogEntry, result)
      return
    }
    if (persisted.trustSource === 'app-bundle') {
      restoreAppBundlePersistedPlugin(persisted, catalogEntry, result)
      return
    }
    if (persisted.schemaVersion === APP_PLUGIN_STATE_PREVIOUS_SCHEMA_VERSION) {
      if (persisted.installed) {
        invalidStoredPluginState(
          'invalid-record',
          `Stored publisher plugin ${persisted.pluginId} predates marketplace authority binding`
        )
      }
      if (catalogEntry) {
        result.recordsToPersist.push(
          persistedState(catalogEntry, {
            installed: false,
            enabled: false,
            pinnedDigest: null
          })
        )
      }
      return
    }
    await restorePublisherPersistedPlugin(persisted, catalogEntry, nextPublicKeys, loadNow, result)
  }

  async function loadStoredPluginCandidate(
    candidate: unknown,
    nextCatalog: ReadonlyMap<string, ResolvedPluginPackage>,
    nextPublicKeys: ReadonlyMap<string, CryptoKey>,
    loadNow: number,
    result: InstalledPluginLoadResult
  ): Promise<void> {
    const metadata = storedCandidateMetadata(candidate, nextCatalog)
    if (metadata.candidatePluginId) result.storedPluginIds.add(metadata.candidatePluginId)
    try {
      const persisted = parsePersistedState(candidate, { trustedKeyring, now: loadNow })
      await restorePersistedPlugin(persisted, nextCatalog, nextPublicKeys, loadNow, result)
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      const issue = storedPluginRecordIssue(
        cause,
        metadata.resettablePluginId,
        metadata.publisherSnapshotRecord
      )
      result.nextRecordErrors.push({
        pluginId: metadata.resettablePluginId,
        error,
        publisherSnapshotRecord: metadata.publisherSnapshotRecord,
        ...(issue ? { issue } : {})
      })
    }
  }

  async function loadInstalled(
    nextCatalog: ReadonlyMap<string, ResolvedPluginPackage>,
    nextPublicKeys: ReadonlyMap<string, CryptoKey>,
    loadNow: number
  ): Promise<InstalledPluginLoadResult> {
    const result = createInstalledPluginLoadResult()
    const stored = await options.storage.list()
    if (stored.length > MAX_STORED_PLUGIN_RECORDS) {
      throw new Error(`Stored plugin state exceeds the ${MAX_STORED_PLUGIN_RECORDS} record limit`)
    }
    for (const candidate of stored) {
      await loadStoredPluginCandidate(candidate, nextCatalog, nextPublicKeys, loadNow, result)
    }
    return result
  }

  function installCatalogDefaults(
    nextCatalog: ReadonlyMap<string, ResolvedPluginPackage>,
    nextInstalled: Map<string, InstalledAppPlugin>,
    storedPluginIds: ReadonlySet<string>,
    recordsToPersist: PersistedAppPluginStateV3[],
    loadNow: number
  ): void {
    for (const [pluginId, pluginPackage] of nextCatalog) {
      const defaults = catalogDefaults.get(pluginId)
      if (!defaults?.installed || storedPluginIds.has(pluginId)) continue
      requireCatalogPackageActivation(pluginPackage, loadNow)
      const enabled = defaults.enabled
      nextInstalled.set(pluginId, {
        package: pluginPackage,
        enabled,
        pinnedDigest: null,
        ...(pluginPackage.verifiedPackage
          ? { installedState: installedStateFor(pluginPackage, enabled) }
          : {})
      })
      recordsToPersist.push(
        persistedState(pluginPackage, { installed: true, enabled, pinnedDigest: null })
      )
    }
  }

  async function performLoad(): Promise<AppPluginStoreSnapshot> {
    try {
      const startingStorageRevision = await options.storage.revision()
      if (loadedStorageRevision !== null && startingStorageRevision !== loadedStorageRevision) {
        publisherAuthorityInvalidated = true
      }
      loadedStorageRevision = startingStorageRevision
      const publisherTrust = await loadPublisherTrust()
      trustedKeyring = publisherTrust.keyring
      marketplaceTrustLease = publisherTrust.lease
      marketplaceTrustRequired = publisherTrust.marketplaceRequired
      const loadNow = now()
      const loadedCatalog = await loadCatalog(
        publisherTrust.entries,
        publisherTrust.keyring,
        loadNow,
        publisherTrust.lease?.authority ?? null
      )
      const nextCatalog = loadedCatalog.packages
      const {
        nextInstalled,
        storedPluginIds,
        recordsToPersist,
        nextRecordErrors,
        nextPinnedDigestMismatches
      } = await loadInstalled(nextCatalog, loadedCatalog.publicKeys, loadNow)
      installCatalogDefaults(nextCatalog, nextInstalled, storedPluginIds, recordsToPersist, loadNow)
      for (const record of recordsToPersist) await putStoredState(record)
      const endingStorageRevision = await options.storage.revision()
      if (endingStorageRevision !== loadedStorageRevision) publisherAuthorityInvalidated = true
      loadedStorageRevision = endingStorageRevision

      catalog = nextCatalog
      catalogPublicKeys = loadedCatalog.publicKeys
      catalogFailures = loadedCatalog.failures
      installed = nextInstalled
      pinnedDigestMismatches = nextPinnedDigestMismatches
      fatalError = publisherTrust.unavailableError ?? loadedCatalog.errors.at(0) ?? null
      recordErrors = nextRecordErrors
    } catch (cause) {
      trustedKeyring = options.marketplaceTrustBundleLoader ? undefined : configuredTrustedKeyring
      marketplaceTrustLease = undefined
      marketplaceTrustRequired = Boolean(options.marketplaceTrustBundleLoader)
      fatalError = cause instanceof Error ? cause : new Error(String(cause))
      recordErrors = []
      pinnedDigestMismatches = new Map()
      catalog = new Map()
      catalogPublicKeys = new Map()
      catalogFailures = new Map()
      installed = new Map()
      loadedStorageRevision = null
    }
    ready = true
    notify()
    return snapshot()
  }

  function load(): Promise<AppPluginStoreSnapshot> {
    if (activeLoad) return activeLoad
    const request = runMutation(() =>
      withPublisherMutationLock(() => {
        ready = false
        notify()
        return performLoad()
      })
    )
    activeLoad = request.finally(() => {
      activeLoad = null
    })
    return activeLoad
  }

  function transitionPublisherTrust<T>(operation: () => Promise<T>): Promise<T> {
    return runMutation(() =>
      withPublisherMutationLock(async () => {
        requireReady()
        await assertPublisherStateCurrent()
        const publisherPluginIds = await publisherPluginIdsForTransition()
        if (publisherPluginIds.length > 0) {
          throw new PublisherPluginTransitionBlockedError(publisherPluginIds)
        }
        ready = false
        notify()
        let result: T
        try {
          result = await operation()
        } catch (cause) {
          await performLoad()
          throw cause
        }
        const reloaded = await performLoad()
        if (reloaded.error) {
          throw new Error('Marketplace source changed but its plugin catalog could not be loaded', {
            cause: reloaded.error
          })
        }
        return result
      })
    )
  }

  async function performInstallation(pluginId: string): Promise<InstalledAppPlugin> {
    requireReady()
    const pluginPackage = catalogPackage(pluginId)
    requireCatalogPackageActivation(pluginPackage, now())
    const current = installed.get(pluginId)
    if (current) return structuredClone(current)
    const enabled = false
    const next: InstalledAppPlugin = {
      package: pluginPackage,
      enabled,
      pinnedDigest: null,
      ...(pluginPackage.verifiedPackage
        ? { installedState: installedStateFor(pluginPackage, enabled) }
        : {})
    }
    await putStoredState(
      persistedState(pluginPackage, { installed: true, enabled, pinnedDigest: null })
    )
    installed.set(pluginId, next)
    pinnedDigestMismatches.delete(pluginId)
    recordErrors = recordErrors.filter((failure) => failure.pluginId !== pluginId)
    notify()
    return structuredClone(next)
  }

  function install(pluginId: string): Promise<InstalledAppPlugin> {
    return runMutation(() => {
      if (pinnedDigestMismatches.has(pluginId)) {
        throw new Error(`Replacing pinned plugin ${pluginId} requires explicit confirmation`)
      }
      if (recordErrors.some((failure) => failure.pluginId === pluginId)) {
        throw new Error(`Stored plugin ${pluginId} must be resolved before installation`)
      }
      requireReady()
      if (catalogPackage(pluginId).trustSource === 'publisher-signature') {
        throw new Error(`Publisher plugin ${pluginId} requires explicit package review`)
      }
      return performInstallation(pluginId)
    })
  }

  function installReviewed(
    pluginId: string,
    expectedPackage: ResolvedPluginPackage
  ): Promise<InstalledAppPlugin> {
    const reviewedPackage = structuredClone(expectedPackage)
    return runMutation(() =>
      withPublisherMutationLock(async () => {
        if (pinnedDigestMismatches.has(pluginId)) {
          throw new Error(`Replacing pinned plugin ${pluginId} requires explicit confirmation`)
        }
        if (recordErrors.some((failure) => failure.pluginId === pluginId)) {
          throw new Error(`Stored plugin ${pluginId} must be resolved before installation`)
        }
        requireReady()
        await checkpointPublisherTrust()
        const currentPackage = catalogPackage(pluginId)
        if (!sameReviewedPublisherPackage(reviewedPackage, currentPackage)) {
          throw new Error(
            `Reviewed publisher package authority changed for ${pluginId}; review it again`
          )
        }
        return performInstallation(pluginId)
      })
    )
  }

  function replacePinnedDigest(
    pluginId: string,
    expectedPinnedDigest: string
  ): Promise<InstalledAppPlugin> {
    return runMutation(() =>
      withPublisherMutationLock(async () => {
        await assertStorageRevisionCurrent()
        const pinnedMismatch = pinnedDigestMismatches.get(pluginId)
        if (pinnedMismatch?.previousDigest !== expectedPinnedDigest) {
          throw new Error(`Replacing pinned plugin ${pluginId} requires explicit confirmation`)
        }
        return performInstallation(pluginId)
      })
    )
  }

  async function performResetLocalState(
    pluginId: string,
    publisherCleanup?: () => Promise<void>
  ): Promise<AppPluginStoreSnapshot> {
    requireReady()
    await assertStorageRevisionCurrent()
    const failure = recordErrors.find(({ issue }) => issue?.pluginId === pluginId)
    if (!failure) {
      throw new Error(`Plugin ${pluginId} does not have resettable local state`)
    }
    if (failure.publisherSnapshotRecord && !publisherCleanup) {
      throw new Error(`Publisher plugin ${pluginId} reset requires host privilege cleanup`)
    }
    if (publisherCleanup) await publisherCleanup()
    await deleteStoredState(pluginId)
    ready = false
    notify()
    return performLoad()
  }

  function resetLocalState(pluginId: string): Promise<AppPluginStoreSnapshot> {
    return runMutation(() => withPublisherMutationLock(() => performResetLocalState(pluginId)))
  }

  function resetLocalStateWithPublisherCleanup(
    pluginId: string,
    publisherCleanup: () => Promise<void>
  ): Promise<AppPluginStoreSnapshot> {
    return runMutation(() =>
      withPublisherMutationLock(() => performResetLocalState(pluginId, publisherCleanup))
    )
  }

  function setEnabled(pluginId: string, enabled: boolean): Promise<InstalledAppPlugin> {
    return runMutation(async () => {
      requireReady()
      const initial = installedPlugin(pluginId)
      const operation = async () => {
        if (initial.package.trustSource === 'publisher-signature') {
          await checkpointPublisherTrust()
        }
        const current = installedPlugin(pluginId)
        const mutationNow = now()
        const blockedReason = enabled ? currentPluginBlockReason(current, mutationNow) : undefined
        if (blockedReason) {
          throw new Error(`Plugin trust is blocked: ${blockedReason}`)
        }
        const { blockedReason: _staleReason, ...currentState } = current
        const next: InstalledAppPlugin = {
          ...currentState,
          enabled,
          ...(current.installedState
            ? {
                installedState: setPluginEnabled(current.installedState, enabled, {
                  trustedKeyring,
                  now: mutationNow
                })
              }
            : {})
        }
        await putStoredState(
          persistedState(current.package, {
            installed: true,
            enabled,
            pinnedDigest: current.pinnedDigest,
            ...(next.installedState ? { installedState: next.installedState } : {})
          })
        )
        installed.set(pluginId, next)
        notify()
        return structuredClone(next)
      }
      return initial.package.trustSource === 'publisher-signature'
        ? withPublisherMutationLock(operation)
        : operation()
    })
  }

  function setPinned(pluginId: string, pinned: boolean): Promise<InstalledAppPlugin> {
    return runMutation(async () => {
      requireReady()
      const initial = installedPlugin(pluginId)
      const operation = async () => {
        if (initial.package.trustSource === 'publisher-signature') {
          await checkpointPublisherTrust()
        }
        const current = installedPlugin(pluginId)
        const pinnedDigest = pinned ? current.package.digest : null
        const next: InstalledAppPlugin = { ...current, pinnedDigest }
        await putStoredState(
          persistedState(current.package, {
            installed: true,
            enabled: current.enabled,
            pinnedDigest,
            ...(current.installedState ? { installedState: current.installedState } : {})
          })
        )
        installed.set(pluginId, next)
        notify()
        return structuredClone(next)
      }
      return initial.package.trustSource === 'publisher-signature'
        ? withPublisherMutationLock(operation)
        : operation()
    })
  }

  async function persistInstalledReview(
    current: InstalledAppPlugin,
    installedState: InstalledPluginStateV1
  ): Promise<InstalledAppPlugin> {
    const pluginId = current.package.manifest.plugin.id
    const trustBlockedReason = publisherPackageTrustBlockReason(current.package, now())
    if (trustBlockedReason) throw new Error(`Plugin trust is blocked: ${trustBlockedReason}`)
    const latestCatalog = catalog.get(pluginId)
    const pluginPackage = resolvedFromSnapshot(
      'publisher-signature',
      installedState.accepted,
      current.package.marketplaceAuthority ?? null,
      remoteCatalogForSnapshot(installedState.accepted, [latestCatalog, current.package])
    )
    const next: InstalledAppPlugin = {
      package: pluginPackage,
      enabled: installedState.enabled,
      pinnedDigest: current.pinnedDigest,
      installedState
    }
    await putStoredState(
      persistedState(pluginPackage, {
        installed: true,
        enabled: installedState.enabled,
        pinnedDigest: current.pinnedDigest,
        installedState
      })
    )
    installed.set(pluginId, next)
    notify()
    return structuredClone(next)
  }

  async function performAcceptUpdate(
    pluginId: string,
    expected?: Readonly<{
      candidate: ResolvedPluginPackage
      current: ReviewedInstalledPublisherAuthority
    }>
  ): Promise<InstalledAppPlugin> {
    requireReady()
    const current = installedPlugin(pluginId)
    if (!current.installedState) throw new Error(`Plugin has no signed update state: ${pluginId}`)
    if (current.pinnedDigest) throw new Error(`Pinned plugin ${pluginId} must be unpinned first`)
    const candidate = current.installedState.pending?.candidate
    if (!candidate) throw new Error('No pending plugin update review')
    const acceptedAt = now()
    const catalogCandidate = requireCurrentCatalogCandidate(pluginId, candidate, acceptedAt)
    if (
      expected &&
      (!sameReviewedInstalledPublisherAuthority(expected.current, current.package) ||
        !sameReviewedPublisherPackage(expected.candidate, catalogCandidate))
    ) {
      throw new Error(
        `Reviewed publisher update authority changed for ${pluginId}; review it again`
      )
    }
    await verifyActiveStoredSnapshot(candidate, {
      trustedKeyring,
      fallbackPublicKey: catalogPublicKeys.get(pluginId),
      engineVersion: options.engineVersion,
      now: acceptedAt
    })
    requireActivationCompatibility(candidate.manifest)
    const nextState = acceptPluginUpdate(current.installedState, {
      trustedKeyring,
      now: acceptedAt
    })
    return persistInstalledReview(current, nextState)
  }

  function acceptUpdate(pluginId: string): Promise<InstalledAppPlugin> {
    return runMutation(async () => {
      requireReady()
      const current = installedPlugin(pluginId)
      if (current.package.trustSource === 'publisher-signature') {
        throw new Error(`Publisher plugin ${pluginId} update requires explicit package review`)
      }
      return performAcceptUpdate(pluginId)
    })
  }

  function acceptUpdateReviewed(
    pluginId: string,
    expectedCandidate: ResolvedPluginPackage,
    expectedCurrent: ReviewedInstalledPublisherAuthority
  ): Promise<InstalledAppPlugin> {
    const reviewedCandidate = structuredClone(expectedCandidate)
    const reviewedCurrent = structuredClone(expectedCurrent)
    return runMutation(() =>
      withPublisherMutationLock(async () => {
        await checkpointPublisherTrust()
        return performAcceptUpdate(pluginId, {
          candidate: reviewedCandidate,
          current: reviewedCurrent
        })
      })
    )
  }

  function rejectUpdate(pluginId: string): Promise<InstalledAppPlugin> {
    return runMutation(async () => {
      requireReady()
      const initial = installedPlugin(pluginId)
      const operation = async () => {
        if (initial.package.trustSource === 'publisher-signature') {
          await checkpointPublisherTrust()
        }
        const current = installedPlugin(pluginId)
        if (!current.installedState)
          throw new Error(`Plugin has no signed update state: ${pluginId}`)
        const nextState = rejectPluginUpdate(current.installedState, {
          trustedKeyring,
          now: now()
        })
        return persistInstalledReview(current, nextState)
      }
      return initial.package.trustSource === 'publisher-signature'
        ? withPublisherMutationLock(operation)
        : operation()
    })
  }

  function rollback(pluginId: string, targetVersionOrDigest: string): Promise<InstalledAppPlugin> {
    return runMutation(async () => {
      requireReady()
      const initial = installedPlugin(pluginId)
      const operation = async () => {
        if (initial.package.trustSource === 'publisher-signature') {
          await checkpointPublisherTrust()
        }
        const current = installedPlugin(pluginId)
        if (!current.installedState) throw new Error(`Plugin has no signed history: ${pluginId}`)
        if (current.pinnedDigest)
          throw new Error(`Pinned plugin ${pluginId} must be unpinned first`)
        const rollbackAt = now()
        const marketplaceReason = marketplaceTrustBlockReason(rollbackAt)
        if (marketplaceReason) throw new Error(`Plugin trust is blocked: ${marketplaceReason}`)
        if (!trustedKeyring) {
          throw new Error('Plugin trust is blocked: Publisher trust keyring is unavailable')
        }
        const nextState = rollbackPlugin(current.installedState, targetVersionOrDigest, {
          trustedKeyring,
          now: rollbackAt
        })
        requireActivationCompatibility(nextState.accepted.manifest)
        return persistInstalledReview(current, nextState)
      }
      return initial.package.trustSource === 'publisher-signature'
        ? withPublisherMutationLock(operation)
        : operation()
    })
  }

  async function performUninstall(pluginId: string): Promise<void> {
    const current = installedPlugin(pluginId)
    await putStoredState(
      persistedState(current.package, {
        installed: false,
        enabled: false,
        pinnedDigest: null
      })
    )
    installed.delete(pluginId)
    notify()
  }

  function uninstallWithPublisherCleanup(
    pluginId: string,
    cleanup: () => Promise<void>
  ): Promise<void> {
    return runMutation(() =>
      withPublisherMutationLock(async () => {
        requireReady()
        if (installedPlugin(pluginId).package.trustSource !== 'publisher-signature') {
          throw new Error(`Plugin is not publisher-signed: ${pluginId}`)
        }
        await checkpointPublisherTrust()
        await cleanup()
        return performUninstall(pluginId)
      })
    )
  }

  function uninstall(pluginId: string): Promise<void> {
    return runMutation(async () => {
      requireReady()
      const initial = installedPlugin(pluginId)
      if (initial.package.trustSource === 'publisher-signature') {
        throw new Error(`Publisher plugin ${pluginId} uninstall requires host privilege cleanup`)
      }
      return performUninstall(pluginId)
    })
  }

  function installedModules(): InstalledPluginModule[] {
    if (!ready) return []
    return [...installed.values()].flatMap((plugin) => {
      const runtimePlugin = runtimePluginState(plugin)
      return runtimePlugin.enabled
        ? runtimePlugin.package.manifest.contributions.modules.map((contribution) => ({
            plugin: structuredClone(runtimePlugin),
            contribution: structuredClone(contribution)
          }))
        : []
    })
  }

  function installedCommands(): InstalledPluginCommand[] {
    if (!ready) return []
    return [...installed.values()].flatMap((plugin) => {
      const runtimePlugin = runtimePluginState(plugin)
      return runtimePlugin.enabled
        ? (runtimePlugin.package.manifest.contributions.commands ?? []).map((contribution) => ({
            plugin: structuredClone(runtimePlugin),
            contribution: structuredClone(contribution)
          }))
        : []
    })
  }

  function installedExporters(): InstalledPluginExporter[] {
    if (!ready) return []
    return [...installed.values()].flatMap((plugin) => {
      const runtimePlugin = runtimePluginState(plugin)
      return runtimePlugin.enabled
        ? (runtimePlugin.package.manifest.contributions.exporters ?? []).map((contribution) => ({
            plugin: structuredClone(runtimePlugin),
            contribution: structuredClone(contribution)
          }))
        : []
    })
  }

  function installedConnectors(): InstalledPluginConnector[] {
    if (!ready) return []
    return [...installed.values()].flatMap((plugin) => {
      const runtimePlugin = runtimePluginState(plugin)
      if (!runtimePlugin.enabled || runtimePlugin.package.manifest.schemaVersion !== 2) return []
      return (runtimePlugin.package.manifest.contributions.connectors ?? []).map(
        (contribution) => ({
          plugin: structuredClone(runtimePlugin),
          contribution: structuredClone(contribution)
        })
      )
    })
  }

  function installedStorageProviders(): InstalledPluginStorageProvider[] {
    if (!ready) return []
    return [...installed.values()].flatMap((plugin) => {
      const runtimePlugin = runtimePluginState(plugin)
      if (!runtimePlugin.enabled || runtimePlugin.package.manifest.schemaVersion !== 2) return []
      return (runtimePlugin.package.manifest.contributions.storageProviders ?? []).map(
        (contribution) => ({
          plugin: structuredClone(runtimePlugin),
          contribution: structuredClone(contribution)
        })
      )
    })
  }

  function canCreateModule(pluginId: string, moduleType: string): boolean {
    return installedModules().some(
      ({ plugin, contribution }) =>
        plugin.package.manifest.plugin.id === pluginId && contribution.moduleType === moduleType
    )
  }

  function module(pluginId: string, moduleType: string): InstalledPluginModule | null {
    return (
      installedModules().find(
        ({ plugin, contribution }) =>
          plugin.package.manifest.plugin.id === pluginId && contribution.moduleType === moduleType
      ) ?? null
    )
  }

  function command(pluginId: string, commandId: string): InstalledPluginCommand | null {
    return (
      installedCommands().find(
        ({ plugin, contribution }) =>
          plugin.package.manifest.plugin.id === pluginId && contribution.commandId === commandId
      ) ?? null
    )
  }

  function exporter(pluginId: string, exporterId: string): InstalledPluginExporter | null {
    return (
      installedExporters().find(
        ({ plugin, contribution }) =>
          plugin.package.manifest.plugin.id === pluginId && contribution.exporterId === exporterId
      ) ?? null
    )
  }

  function connector(pluginId: string, connectorId: string): InstalledPluginConnector | null {
    return (
      installedConnectors().find(
        ({ plugin, contribution }) =>
          plugin.package.manifest.plugin.id === pluginId && contribution.connectorId === connectorId
      ) ?? null
    )
  }

  function storageProvider(
    pluginId: string,
    providerId: string
  ): InstalledPluginStorageProvider | null {
    return (
      installedStorageProviders().find(
        ({ plugin, contribution }) =>
          plugin.package.manifest.plugin.id === pluginId && contribution.providerId === providerId
      ) ?? null
    )
  }

  return {
    snapshot,
    assertPublisherStateCurrent,
    subscribe(listener: StoreListener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    load,
    refreshCatalog: load,
    transitionPublisherTrust,
    install,
    installReviewed,
    replacePinnedDigest,
    resetLocalState,
    resetLocalStateWithPublisherCleanup,
    setEnabled,
    setPinned,
    acceptUpdate,
    acceptUpdateReviewed,
    rejectUpdate,
    rollback,
    uninstall,
    uninstallWithPublisherCleanup,
    installedModules,
    installedCommands,
    installedExporters,
    installedConnectors,
    installedStorageProviders,
    canCreateModule,
    module,
    command,
    exporter,
    connector,
    storageProvider
  }
}
