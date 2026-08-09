/* eslint-disable max-lines -- Plugin trust, persistence, and lifecycle transitions form one state machine. */
import {
  acceptPluginUpdate,
  createInstalledPluginState,
  parseInstalledPluginState,
  parseVersionedPluginManifestPayload,
  parseTrustedPluginKeyring,
  rejectPluginUpdate,
  resolveTrustedPluginKey,
  reviewPluginUpdate,
  rollbackPlugin,
  setPluginEnabled,
  verifyVersionedPluginPackage,
  type InstalledPluginStateV1,
  type InstalledPluginTrustOptions,
  type PluginManifestPayload,
  type TrustedPluginKeyringV1,
  type VerifiedPluginPackage
} from '@open-pencil/core/plugins'
import {
  compareStableSemver,
  digestCanonicalManifest,
  satisfiesStableEngineRange,
  stableSemverParts,
  validateModuleIdentity
} from '@open-pencil/scene-graph'

import type { AppPluginStateStorage } from './storage'
import {
  APP_PLUGIN_STATE_SCHEMA_VERSION,
  APP_PLUGIN_STATE_LEGACY_SCHEMA_VERSION,
  MAX_APP_PLUGINS,
  type AppPluginActivationCompatibilityPolicy,
  type AppPluginCatalogEntry,
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
  type ResolvedPluginPackage
} from './types'

export interface CreateAppPluginStoreOptions {
  storage: AppPluginStateStorage
  activationCompatibilityPolicy: AppPluginActivationCompatibilityPolicy
  /**
   * Publisher entries carry a host-trusted key and independently configured identity bindings;
   * every signed manifest is cryptographically re-verified on load.
   */
  catalog: readonly AppPluginCatalogEntry[]
  catalogLoader?: () => Promise<readonly AppPluginCatalogEntry[]>
  trustedKeyring?: TrustedPluginKeyringV1
  trustedKeyringLoader?: () => Promise<TrustedPluginKeyringV1 | undefined>
  now?: () => number
  engineVersion: string
}

type StoreListener = (snapshot: AppPluginStoreSnapshot) => void
type PluginRecordError = Readonly<{
  pluginId: string | null
  error: Error
  issue?: AppPluginRecordIssue
}>
type InstalledPluginLoadResult = {
  nextInstalled: Map<string, InstalledAppPlugin>
  storedPluginIds: Set<string>
  recordsToPersist: PersistedAppPluginStateV2[]
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
const PERSISTED_STATE_CURRENT_KEYS = new Set<string>([
  ...PERSISTED_STATE_COMMON_KEYS,
  'installedState'
])

type PersistedPluginCommonState = Omit<
  PersistedAppPluginStateV2,
  'schemaVersion' | 'installedState'
>
type PersistedPluginSchemaVersion =
  | typeof APP_PLUGIN_STATE_LEGACY_SCHEMA_VERSION
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
  engineVersion: string
): Promise<ResolvedPluginPackage> {
  if (entry.trustSource === 'publisher-signature') {
    const verifiedPackage = await verifyVersionedPluginPackage(
      entry.manifest,
      entry.trustedPublicKey,
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
      trustSource: entry.trustSource,
      manifest,
      digest: verifiedDigest,
      verifiedPackage,
      ...(entry.remoteCatalog ? { remoteCatalog: structuredClone(entry.remoteCatalog) } : {})
    }
  }
  const manifest = parseVersionedPluginManifestPayload(entry.manifest)
  if (!satisfiesStableEngineRange(engineVersion, manifest.engineRange)) {
    throw new Error(`Plugin ${manifest.plugin.id} requires OpenPencil ${manifest.engineRange}`)
  }
  return {
    trustSource: entry.trustSource,
    manifest,
    digest: await appBundleDigest(manifest)
  }
}

function parsePersistedSchemaVersion(value: Record<string, unknown>): PersistedPluginSchemaVersion {
  if (value.schemaVersion === APP_PLUGIN_STATE_LEGACY_SCHEMA_VERSION) {
    return APP_PLUGIN_STATE_LEGACY_SCHEMA_VERSION
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
  const expected =
    schemaVersion === APP_PLUGIN_STATE_SCHEMA_VERSION
      ? PERSISTED_STATE_CURRENT_KEYS
      : PERSISTED_STATE_LEGACY_KEYS
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
  return {
    schemaVersion: APP_PLUGIN_STATE_SCHEMA_VERSION,
    ...common,
    installedState: parsePersistedInstalledState(value, common, trustOptions)
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
  remoteCatalog?: ResolvedPluginPackage['remoteCatalog']
): ResolvedPluginPackage {
  return {
    trustSource,
    manifest: snapshot.manifest,
    digest: snapshot.verifiedDigest,
    verifiedPackage: snapshot,
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
  if (options.trustedKeyring) {
    resolveTrustedPluginKey(options.trustedKeyring, {
      pluginId: snapshot.manifest.plugin.id,
      publisherId: snapshot.manifest.publisher.id,
      keyId: snapshot.verifiedKeyId,
      now: options.now
    })
  }
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
  if (!options.trustedKeyring) return { state }
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
  let trustedKeyring = options.trustedKeyring
    ? parseTrustedPluginKeyring(options.trustedKeyring)
    : undefined
  const now = options.now ?? Date.now
  const listeners = new Set<StoreListener>()
  const catalogDefaults = new Map(
    options.catalog.map((entry) => [
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
  let installed = new Map<string, InstalledAppPlugin>()
  let pinnedDigestMismatches = new Map<string, AppPluginPinnedDigestMismatch>()
  let ready = false
  let fatalError: Error | null = null
  let recordErrors: PluginRecordError[] = []
  let activeLoad: Promise<AppPluginStoreSnapshot> | null = null
  let mutationTail: Promise<void> = Promise.resolve()

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
    if (!trustedKeyring) return undefined
    try {
      resolveTrustedPluginKey(trustedKeyring, {
        pluginId: accepted.manifest.plugin.id,
        publisherId: accepted.manifest.publisher.id,
        keyId: accepted.verifiedKeyId,
        now: trustNow
      })
      return undefined
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause)
    }
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
    if (!pluginPackage) throw new Error(`Unknown plugin: ${pluginId}`)
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
  ): PersistedAppPluginStateV2 {
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
      installedState
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

  async function loadCatalog(): Promise<{
    packages: Map<string, ResolvedPluginPackage>
    publicKeys: Map<string, CryptoKey>
  }> {
    const entries = [
      ...options.catalog,
      ...(options.catalogLoader ? await options.catalogLoader() : [])
    ]
    const resolvedEntries = await Promise.all(
      entries.map((entry) => resolveCatalogEntry(entry, options.engineVersion))
    )
    if (resolvedEntries.length > MAX_APP_PLUGINS) {
      throw new Error(`Plugin catalog exceeds the ${MAX_APP_PLUGINS} plugin limit`)
    }
    const nextCatalog = new Map<string, ResolvedPluginPackage>()
    const nextPublicKeys = new Map<string, CryptoKey>()
    for (const [index, resolved] of resolvedEntries.entries()) {
      const pluginId = resolved.manifest.plugin.id
      if (nextCatalog.has(pluginId)) throw new Error(`Duplicate plugin in catalog: ${pluginId}`)
      nextCatalog.set(pluginId, resolved)
      const source = entries[index]
      if (source.trustSource === 'publisher-signature') {
        nextPublicKeys.set(pluginId, source.trustedPublicKey)
      }
    }
    return { packages: nextCatalog, publicKeys: nextPublicKeys }
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
    const resettablePluginId =
      candidatePluginId && nextCatalog.has(candidatePluginId) ? candidatePluginId : null
    const catalogEntry = resettablePluginId ? nextCatalog.get(resettablePluginId) : undefined
    return {
      candidatePluginId,
      resettablePluginId,
      publisherSnapshotRecord: Boolean(
        isRecord(candidate) &&
        candidate.trustSource === 'publisher-signature' &&
        catalogEntry?.trustSource === 'publisher-signature'
      )
    }
  }

  function failPinnedBundleDigest(
    persisted: PersistedAppPluginStateV1 | PersistedAppPluginStateV2,
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
    persisted: PersistedAppPluginStateV2,
    catalogEntry: ResolvedPluginPackage | undefined,
    result: InstalledPluginLoadResult
  ): void {
    if (!catalogEntry) return
    if (catalogEntry.digest !== persisted.activeDigest) {
      if (persisted.pinnedDigest !== null) {
        failPinnedBundleDigest(persisted, catalogEntry, result)
      }
      result.recordsToPersist.push(
        persistedState(catalogEntry, {
          installed: persisted.installed,
          enabled: persisted.enabled,
          pinnedDigest: null
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
    persisted: PersistedAppPluginStateV2,
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
    persisted: PersistedAppPluginStateV2,
    catalogEntry: ResolvedPluginPackage | undefined,
    nextPublicKeys: ReadonlyMap<string, CryptoKey>,
    loadNow: number,
    result: InstalledPluginLoadResult
  ): Promise<void> {
    if (!persisted.installed || !persisted.installedState) return
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
    recordsToPersist: PersistedAppPluginStateV2[],
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
      if (options.trustedKeyringLoader) {
        const loadedKeyring = await options.trustedKeyringLoader()
        trustedKeyring = loadedKeyring ? parseTrustedPluginKeyring(loadedKeyring) : undefined
      }
      const loadedCatalog = await loadCatalog()
      const nextCatalog = loadedCatalog.packages
      const loadNow = now()
      const {
        nextInstalled,
        storedPluginIds,
        recordsToPersist,
        nextRecordErrors,
        nextPinnedDigestMismatches
      } = await loadInstalled(nextCatalog, loadedCatalog.publicKeys, loadNow)
      installCatalogDefaults(nextCatalog, nextInstalled, storedPluginIds, recordsToPersist, loadNow)
      for (const record of recordsToPersist) await options.storage.put(record)

      catalog = nextCatalog
      catalogPublicKeys = loadedCatalog.publicKeys
      installed = nextInstalled
      pinnedDigestMismatches = nextPinnedDigestMismatches
      fatalError = null
      recordErrors = nextRecordErrors
    } catch (cause) {
      fatalError = cause instanceof Error ? cause : new Error(String(cause))
      recordErrors = []
      pinnedDigestMismatches = new Map()
      catalog = new Map()
      catalogPublicKeys = new Map()
      installed = new Map()
    }
    ready = true
    notify()
    return snapshot()
  }

  function load(): Promise<AppPluginStoreSnapshot> {
    if (activeLoad) return activeLoad
    ready = false
    notify()
    activeLoad = performLoad().finally(() => {
      activeLoad = null
    })
    return activeLoad
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
    await options.storage.put(
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
      return performInstallation(pluginId)
    })
  }

  function replacePinnedDigest(
    pluginId: string,
    expectedPinnedDigest: string
  ): Promise<InstalledAppPlugin> {
    return runMutation(() => {
      const pinnedMismatch = pinnedDigestMismatches.get(pluginId)
      if (pinnedMismatch?.previousDigest !== expectedPinnedDigest) {
        throw new Error(`Replacing pinned plugin ${pluginId} requires explicit confirmation`)
      }
      return performInstallation(pluginId)
    })
  }

  function resetLocalState(pluginId: string): Promise<AppPluginStoreSnapshot> {
    return runMutation(async () => {
      requireReady()
      if (!recordErrors.some(({ issue }) => issue?.pluginId === pluginId)) {
        throw new Error(`Plugin ${pluginId} does not have resettable local state`)
      }
      await options.storage.delete(pluginId)
      return load()
    })
  }

  function setEnabled(pluginId: string, enabled: boolean): Promise<InstalledAppPlugin> {
    return runMutation(async () => {
      requireReady()
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
      await options.storage.put(
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
    })
  }

  function setPinned(pluginId: string, pinned: boolean): Promise<InstalledAppPlugin> {
    return runMutation(async () => {
      requireReady()
      const current = installedPlugin(pluginId)
      const pinnedDigest = pinned ? current.package.digest : null
      const next: InstalledAppPlugin = { ...current, pinnedDigest }
      await options.storage.put(
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
    })
  }

  async function persistInstalledReview(
    current: InstalledAppPlugin,
    installedState: InstalledPluginStateV1
  ): Promise<InstalledAppPlugin> {
    const pluginId = current.package.manifest.plugin.id
    const latestCatalog = catalog.get(pluginId)
    const pluginPackage = resolvedFromSnapshot(
      'publisher-signature',
      installedState.accepted,
      remoteCatalogForSnapshot(installedState.accepted, [latestCatalog, current.package])
    )
    const next: InstalledAppPlugin = {
      package: pluginPackage,
      enabled: installedState.enabled,
      pinnedDigest: current.pinnedDigest,
      installedState
    }
    await options.storage.put(
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

  function acceptUpdate(pluginId: string): Promise<InstalledAppPlugin> {
    return runMutation(async () => {
      requireReady()
      const current = installedPlugin(pluginId)
      if (!current.installedState) throw new Error(`Plugin has no signed update state: ${pluginId}`)
      if (current.pinnedDigest) throw new Error(`Pinned plugin ${pluginId} must be unpinned first`)
      const candidate = current.installedState.pending?.candidate
      if (!candidate) throw new Error('No pending plugin update review')
      const acceptedAt = now()
      requireCurrentCatalogCandidate(pluginId, candidate, acceptedAt)
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
    })
  }

  function rejectUpdate(pluginId: string): Promise<InstalledAppPlugin> {
    return runMutation(async () => {
      requireReady()
      const current = installedPlugin(pluginId)
      if (!current.installedState) throw new Error(`Plugin has no signed update state: ${pluginId}`)
      const nextState = rejectPluginUpdate(current.installedState, {
        trustedKeyring,
        now: now()
      })
      return persistInstalledReview(current, nextState)
    })
  }

  function rollback(pluginId: string, targetVersionOrDigest: string): Promise<InstalledAppPlugin> {
    return runMutation(async () => {
      requireReady()
      const current = installedPlugin(pluginId)
      if (!current.installedState) throw new Error(`Plugin has no signed history: ${pluginId}`)
      if (current.pinnedDigest) throw new Error(`Pinned plugin ${pluginId} must be unpinned first`)
      const rollbackAt = now()
      const nextState = rollbackPlugin(current.installedState, targetVersionOrDigest, {
        trustedKeyring,
        now: rollbackAt
      })
      requireActivationCompatibility(nextState.accepted.manifest)
      return persistInstalledReview(current, nextState)
    })
  }

  function uninstall(pluginId: string): Promise<void> {
    return runMutation(async () => {
      requireReady()
      const current = installedPlugin(pluginId)
      await options.storage.put(
        persistedState(current.package, {
          installed: false,
          enabled: false,
          pinnedDigest: null
        })
      )
      installed.delete(pluginId)
      notify()
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
    subscribe(listener: StoreListener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    load,
    refreshCatalog: load,
    install,
    replacePinnedDigest,
    resetLocalState,
    setEnabled,
    setPinned,
    acceptUpdate,
    rejectUpdate,
    rollback,
    uninstall,
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
