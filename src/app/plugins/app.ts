import { shallowRef } from 'vue'

import { IS_BROWSER } from '@open-pencil/core/constants'

import { getActiveEditorStoreOrNull, type EditorStore } from '@/app/editor/active-store'

import { createThirdPartyPluginAIGrantManager } from './ai-authorization'
import { createBundledPluginCatalog } from './catalog'
import {
  appConnectorAuthorization,
  appConnectorHostAdapters,
  reconcileConnectorAuthorizations
} from './connectors/app'
import { inspectConnectorManifestCompatibility } from './connectors/registry'
import { inspectPluginHostContributionsCompatibility } from './host'
import {
  createBrowserMarketplaceSourceStorage,
  createMarketplaceSourceManager,
  createMarketplaceSourceRuntime,
  createMemoryMarketplaceSourceStorage,
  type MarketplaceSourceReview,
  type MarketplaceSnapshotLoadResult,
  type MarketplaceSourceManagerSnapshot
} from './marketplace'
import {
  inspectPluginModuleContributionsCompatibility,
  isInstalledPluginModuleAutomationCallable
} from './modules'
import {
  createIdbRemotePluginCacheStorage,
  createMemoryRemotePluginCacheStorage,
  createRemotePluginCatalogClient,
  parseRemotePluginTrustConfigJSON,
  remotePluginCatalogEntries,
  type RemotePluginCatalogLoadResult,
  type ResolvedRemotePluginTrustConfig
} from './remote'
import {
  createIdbPluginRuntimePolicyStorage,
  createMemoryPluginRuntimePolicyStorage,
  createPluginRuntimeClient,
  createPluginRuntimeManager,
  preparePluginRuntimeInput
} from './runtime'
import { createIdbAppPluginStateStorage, createMemoryAppPluginStateStorage } from './storage'
import { createAppPluginStore } from './store'
import type {
  AppPluginActivationCompatibilityPolicy,
  AppPluginMarketplaceTrustBundle
} from './types'

const usesBrowserIndexedDB = IS_BROWSER && typeof indexedDB !== 'undefined'
const storage =
  usesBrowserIndexedDB ? createIdbAppPluginStateStorage() : createMemoryAppPluginStateStorage()

const remoteTrustConfigJSON = import.meta.env.VITE_OPENPENCIL_PLUGIN_TRUST_CONFIG?.trim() ?? ''
const managedMarketplaceTrustConfigJSON = import.meta.env.VITE_OPENPENCIL_MARKETPLACE_TRUST_CONFIG
export const appPluginMarketplaceConfigured = managedMarketplaceTrustConfigJSON !== undefined
export const appPluginRemoteCatalogConfigured =
  remoteTrustConfigJSON.length > 0 || appPluginMarketplaceConfigured
export const appPluginRemoteCatalogSnapshot = shallowRef<RemotePluginCatalogLoadResult | null>(null)
export const appPluginMarketplaceSnapshot = shallowRef<MarketplaceSnapshotLoadResult | null>(null)
const remoteCache =
  usesBrowserIndexedDB ? createIdbRemotePluginCacheStorage() : createMemoryRemotePluginCacheStorage()
const marketplaceSourceStorage =
  usesBrowserIndexedDB
    ? createBrowserMarketplaceSourceStorage()
    : createMemoryMarketplaceSourceStorage()
const pluginEngineVersion =
  typeof __OPENPENCIL_APP_VERSION__ === 'string' ? __OPENPENCIL_APP_VERSION__ : '0.0.0'
let appPluginTrustLastSeen = Date.now()
let publisherPrivilegeTail: Promise<void> = Promise.resolve()
const PUBLISHER_PRIVILEGE_LOCK_NAME = 'open-pencil:publisher-plugin-privilege'

function withLocalPublisherPrivilegeLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = publisherPrivilegeTail.then(operation, operation)
  publisherPrivilegeTail = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

function withAppPluginPublisherPrivilegeLock<T>(operation: () => Promise<T>): Promise<T> {
  const browserNavigator = Reflect.get(globalThis, 'navigator') as Navigator | undefined
  const browserLocks = browserNavigator?.locks
  if (browserLocks) {
    return browserLocks.request(PUBLISHER_PRIVILEGE_LOCK_NAME, { mode: 'exclusive' }, operation)
  }
  if (usesBrowserIndexedDB) {
    throw new TypeError('Cross-window plugin authority locking is unavailable in this browser')
  }
  return withLocalPublisherPrivilegeLock(operation)
}

function sessionPluginTrustNow(): number {
  appPluginTrustLastSeen = Math.max(appPluginTrustLastSeen, Date.now())
  return appPluginTrustLastSeen
}
const appPluginMarketplaceSourceManager = createMarketplaceSourceManager({
  storage: marketplaceSourceStorage,
  now: sessionPluginTrustNow,
  ...(managedMarketplaceTrustConfigJSON === undefined
    ? {}
    : { managedConfigJSON: managedMarketplaceTrustConfigJSON })
})
export const appPluginMarketplaceSourceSnapshot = shallowRef(
  appPluginMarketplaceSourceManager.snapshot()
)
const marketplaceSourceRuntime = createMarketplaceSourceRuntime({
  manager: appPluginMarketplaceSourceManager,
  cache: remoteCache,
  engineVersion: pluginEngineVersion,
  onMarketplaceResult(result) {
    appPluginMarketplaceSnapshot.value = result
  },
  onCatalogResult(result) {
    appPluginRemoteCatalogSnapshot.value = result
  }
})

function appPluginTrustNow(): number {
  const persisted = appPluginMarketplaceSourceManager.snapshot().active?.highWater
  const persistedTime = persisted ? Date.parse(persisted.lastSeenWallTime) : 0
  appPluginTrustLastSeen = Math.max(appPluginTrustLastSeen, Date.now(), persistedTime)
  return appPluginTrustLastSeen
}
let remoteConfigPromise: Promise<ResolvedRemotePluginTrustConfig | null> | null = null
let remoteClient: ReturnType<typeof createRemotePluginCatalogClient> | null = null
let runtimeClient: ReturnType<typeof createPluginRuntimeClient> | null = null
let marketplaceSourceAuthorityKey: string | null = null

appPluginMarketplaceSourceManager.subscribe((snapshot) => {
  appPluginMarketplaceSourceSnapshot.value = snapshot
  const active = snapshot.active
  const nextAuthorityKey = active
    ? `${active.sourceId}\0${active.sourceGeneration}\0${active.rootKeySpkiSha256}`
    : null
  if (nextAuthorityKey === marketplaceSourceAuthorityKey) return
  marketplaceSourceAuthorityKey = nextAuthorityKey
  marketplaceSourceRuntime.reset()
  runtimeClient = null
})

interface PluginRuntimeInputContext {
  editor: EditorStore | null
  graph: EditorStore['graph'] | null
}

function capturePluginRuntimeInputContext(): PluginRuntimeInputContext {
  const editor = getActiveEditorStoreOrNull()
  return { editor, graph: editor?.graph ?? null }
}

function prepareCapturedPluginRuntimeInput(
  capabilities: Parameters<typeof preparePluginRuntimeInput>[0],
  input: Parameters<typeof preparePluginRuntimeInput>[1],
  captured: unknown
) {
  const context = captured as PluginRuntimeInputContext
  const current = getActiveEditorStoreOrNull()
  if (capabilities.length > 0 && (current !== context.editor || current?.graph !== context.graph)) {
    throw new Error('The active document changed while the plugin runtime was loading')
  }
  return preparePluginRuntimeInput(capabilities, input, context.editor)
}

function remoteConfig(): Promise<ResolvedRemotePluginTrustConfig | null> {
  remoteConfigPromise ??= remoteTrustConfigJSON
    ? parseRemotePluginTrustConfigJSON(remoteTrustConfigJSON)
    : Promise.resolve(null)
  return remoteConfigPromise
}

function unavailableRemoteCatalog(cause: unknown): RemotePluginCatalogLoadResult {
  return {
    status: 'unavailable',
    catalog: null,
    packages: [],
    diagnostics: [],
    issues: [],
    refreshError: cause instanceof Error ? cause : new Error(String(cause))
  }
}

function unavailableMarketplace(cause: unknown): MarketplaceSnapshotLoadResult {
  return {
    status: 'unavailable',
    snapshot: null,
    source: null,
    refreshError: cause instanceof Error ? cause : new Error(String(cause))
  }
}

async function loadMarketplaceTrustBundle(): Promise<
  AppPluginMarketplaceTrustBundle | null | undefined
> {
  try {
    return await marketplaceSourceRuntime.loadActiveTrustBundle()
  } catch (cause) {
    appPluginRemoteCatalogSnapshot.value = unavailableRemoteCatalog(cause)
    appPluginMarketplaceSnapshot.value = unavailableMarketplace(cause)
    return null
  }
}

async function loadRemoteCatalog() {
  try {
    const config = await remoteConfig()
    if (!config) return []
    remoteClient ??= createRemotePluginCatalogClient({
      ...config,
      engineVersion:
        typeof __OPENPENCIL_APP_VERSION__ === 'string' ? __OPENPENCIL_APP_VERSION__ : '0.0.0',
      cache: remoteCache
    })
    const result = await remoteClient.load()
    appPluginRemoteCatalogSnapshot.value = result
    return remotePluginCatalogEntries(result)
  } catch (cause) {
    appPluginRemoteCatalogSnapshot.value = unavailableRemoteCatalog(cause)
    return []
  }
}

async function loadRemoteKeyring() {
  try {
    return (await remoteConfig())?.publisherKeyring
  } catch (cause) {
    appPluginRemoteCatalogSnapshot.value = unavailableRemoteCatalog(cause)
    return undefined
  }
}

const activationCompatibilityPolicy: AppPluginActivationCompatibilityPolicy = (manifest) => {
  const moduleFailures = inspectPluginModuleContributionsCompatibility(
    manifest.plugin.id,
    manifest.contributions.modules
  )
  const hostFailures = inspectPluginHostContributionsCompatibility(
    manifest.plugin.id,
    manifest.contributions
  )
  const connectorCompatibility = inspectConnectorManifestCompatibility(
    manifest,
    appConnectorHostAdapters
  )
  const failures = [
    ...moduleFailures.map(({ moduleType, reason }) => `${moduleType}: ${reason}`),
    ...hostFailures.map(
      ({ kind, contributionId, reason }) => `${kind} ${contributionId}: ${reason}`
    ),
    ...(connectorCompatibility.ok ? [] : [`connector: ${connectorCompatibility.reason}`])
  ]
  return failures.length === 0
    ? { ok: true }
    : {
        ok: false,
        reason: failures.join('; ')
      }
}

function appPluginTrustLoaders() {
  return {
    marketplaceTrustBundleLoader: loadMarketplaceTrustBundle,
    ...(remoteTrustConfigJSON
      ? {
          catalogLoader: loadRemoteCatalog,
          trustedKeyringLoader: loadRemoteKeyring
        }
      : {})
  }
}

export const appPluginStore = createAppPluginStore({
  storage,
  catalog: createBundledPluginCatalog(),
  activationCompatibilityPolicy,
  ...appPluginTrustLoaders(),
  publisherMutationLock: withAppPluginPublisherPrivilegeLock,
  publisherTrustClockCheckpoint: checkpointAppPluginMarketplaceSourceClockUnlocked,
  now: appPluginTrustNow,
  engineVersion: pluginEngineVersion
})

export const appPluginStoreSnapshot = shallowRef(appPluginStore.snapshot())

export const appPluginAIAuthorization = createThirdPartyPluginAIGrantManager({
  resolveInstalledPlugin(pluginId) {
    const snapshot = appPluginStore.snapshot()
    if (!snapshot.ready) return undefined
    return snapshot.installed.find(({ package: value }) => value.manifest.plugin.id === pluginId)
  }
})

export const appPluginAIAuthorizationSnapshot = shallowRef(appPluginAIAuthorization.snapshot())

appPluginStore.subscribe((snapshot) => {
  appPluginStoreSnapshot.value = snapshot
  reconcileConnectorAuthorizations(snapshot.installed)
  appPluginAIAuthorization.reconcile()
  appPluginAIAuthorizationSnapshot.value = appPluginAIAuthorization.snapshot()
})

appPluginAIAuthorization.subscribe((snapshot) => {
  appPluginAIAuthorizationSnapshot.value = snapshot
})

appConnectorAuthorization.subscribe(() => {
  for (const grant of appPluginAIAuthorization.snapshot()) {
    if (grant.kind === 'connector') appPluginAIAuthorization.revoke(grant)
  }
})

const appPluginMarketplaceSourceReady = appPluginMarketplaceSourceManager.load()
export const appPluginStoreReady = appPluginMarketplaceSourceReady.then(() => appPluginStore.load())

const runtimePolicyStorage =
  usesBrowserIndexedDB
    ? createIdbPluginRuntimePolicyStorage()
    : createMemoryPluginRuntimePolicyStorage()

export const appPluginRuntimeManager = createPluginRuntimeManager({
  storage: runtimePolicyStorage,
  publisherPrivilegeLock: withAppPluginPublisherPrivilegeLock,
  checkpointPublisherTrust: checkpointAppPluginMarketplacePrivilegeClockUnlocked,
  resolveInstalledPlugin(pluginId) {
    const snapshot = appPluginStore.snapshot()
    if (!snapshot.ready) return undefined
    return snapshot.installed.find(({ package: value }) => value.manifest.plugin.id === pluginId)
  },
  async loadRuntime(declarativePackage) {
    const bundle = await loadMarketplaceTrustBundle()
    const marketplace = appPluginMarketplaceSnapshot.value
    if (!bundle || !marketplace?.snapshot) {
      throw new Error('A verified marketplace snapshot is required for executable plugins')
    }
    runtimeClient ??= createPluginRuntimeClient({
      cache: remoteCache
    })
    return runtimeClient.load({
      marketplace: marketplace.snapshot,
      declarativePackage
    })
  },
  captureInputContext: capturePluginRuntimeInputContext,
  prepareInput: prepareCapturedPluginRuntimeInput
})

export const appPluginRuntimeSnapshot = shallowRef(appPluginRuntimeManager.snapshot())

appPluginRuntimeManager.subscribe((snapshot) => {
  appPluginRuntimeSnapshot.value = snapshot
})

export const appPluginRuntimeReady = appPluginStoreReady.then(() => appPluginRuntimeManager.load())

export function reviewAppPluginMarketplaceSource(value: unknown): Promise<MarketplaceSourceReview> {
  return marketplaceSourceRuntime.reviewUserSource(value)
}

/**
 * Durably checkpoints monotonic Marketplace time before entering a publisher
 * privilege boundary. Callers must await this before granting or exercising
 * privileges derived from Marketplace authority.
 */
async function checkpointAppPluginMarketplaceSourceClockUnlocked(): Promise<number> {
  await appPluginMarketplaceSourceReady
  return appPluginMarketplaceSourceManager.checkpointActivePrivilegeClock()
}

async function checkpointAppPluginMarketplacePrivilegeClockUnlocked(): Promise<number> {
  const checkpoint = await checkpointAppPluginMarketplaceSourceClockUnlocked()
  await appPluginStore.assertPublisherStateCurrent()
  return checkpoint
}

export function checkpointAppPluginMarketplacePrivilegeClock(): Promise<number> {
  return withAppPluginPublisherPrivilegeLock(checkpointAppPluginMarketplacePrivilegeClockUnlocked)
}

export function withAppPluginPublisherPrivilege<T>(operation: () => Promise<T>): Promise<T> {
  return withAppPluginPublisherPrivilegeLock(async () => {
    await checkpointAppPluginMarketplacePrivilegeClockUnlocked()
    return operation()
  })
}

export function activateAppPluginMarketplaceSource(
  stageId: string,
  confirmedRootFingerprint: string
): Promise<MarketplaceSourceManagerSnapshot> {
  return appPluginStore.transitionPublisherTrust(() =>
    marketplaceSourceRuntime.activateReviewedSource(stageId, confirmedRootFingerprint)
  )
}

export function clearAppPluginMarketplaceSource(): Promise<MarketplaceSourceManagerSnapshot> {
  return appPluginStore.transitionPublisherTrust(async () => {
    marketplaceSourceRuntime.reset()
    runtimeClient = null
    return appPluginMarketplaceSourceManager.clearUserSource()
  })
}

export function refreshAppPluginCatalog() {
  return appPluginStore.refreshCatalog()
}

export async function uninstallAppPlugin(pluginId: string): Promise<void> {
  await appPluginRuntimeReady
  const installed = appPluginStore
    .snapshot()
    .installed.find(({ package: value }) => value.manifest.plugin.id === pluginId)
  if (installed?.package.trustSource === 'publisher-signature') {
    await appPluginStore.uninstallWithPublisherCleanup(pluginId, () =>
      appPluginRuntimeManager.uninstallWhilePublisherLocked(pluginId, async () => undefined)
    )
    return
  }
  await appPluginRuntimeManager.uninstall(pluginId, () => appPluginStore.uninstall(pluginId))
}

export async function resetAppPluginLocalState(pluginId: string) {
  await appPluginRuntimeReady
  return appPluginStore.resetLocalStateWithPublisherCleanup(pluginId, () =>
    appPluginRuntimeManager.uninstallWhilePublisherLocked(pluginId, async () => undefined)
  )
}

export function canCreatePluginModule(pluginId: string, moduleType: string): boolean {
  const module = appPluginStore.module(pluginId, moduleType)
  return module ? isInstalledPluginModuleAutomationCallable(module) : false
}
