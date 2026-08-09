import { shallowRef } from 'vue'

import { getActiveEditorStoreOrNull, type EditorStore } from '@/app/editor/active-store'

import { createBundledPluginCatalog } from './catalog'
import { appConnectorHostAdapters, reconcileConnectorAuthorizations } from './connectors/app'
import { inspectConnectorManifestCompatibility } from './connectors/registry'
import { inspectPluginHostContributionsCompatibility } from './host'
import {
  createMarketplaceSnapshotClient,
  parseMarketplaceTrustConfigJson,
  type MarketplaceSnapshotLoadResult,
  type ResolvedMarketplaceTrustConfig
} from './marketplace'
import {
  inspectInstalledPluginModuleCompatibility,
  inspectPluginModuleContributionsCompatibility
} from './modules'
import {
  createIdbRemotePluginCacheStorage,
  createMemoryRemotePluginCacheStorage,
  createRemotePluginCatalogClient,
  parseRemotePluginTrustConfigJson,
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
import type { AppPluginActivationCompatibilityPolicy } from './types'

const storage =
  typeof indexedDB === 'undefined'
    ? createMemoryAppPluginStateStorage()
    : createIdbAppPluginStateStorage()

const remoteTrustConfigJson = import.meta.env.VITE_OPENPENCIL_PLUGIN_TRUST_CONFIG?.trim() ?? ''
const marketplaceTrustConfigJson =
  import.meta.env.VITE_OPENPENCIL_MARKETPLACE_TRUST_CONFIG?.trim() ?? ''
export const appPluginMarketplaceConfigured = marketplaceTrustConfigJson.length > 0
export const appPluginRemoteCatalogConfigured =
  remoteTrustConfigJson.length > 0 || appPluginMarketplaceConfigured
export const appPluginRemoteCatalogSnapshot = shallowRef<RemotePluginCatalogLoadResult | null>(null)
export const appPluginMarketplaceSnapshot = shallowRef<MarketplaceSnapshotLoadResult | null>(null)
const remoteCache =
  typeof indexedDB === 'undefined'
    ? createMemoryRemotePluginCacheStorage()
    : createIdbRemotePluginCacheStorage()
let remoteConfigPromise: Promise<ResolvedRemotePluginTrustConfig | null> | null = null
let remoteClient: ReturnType<typeof createRemotePluginCatalogClient> | null = null
let marketplaceConfigPromise: Promise<ResolvedMarketplaceTrustConfig | null> | null = null
let marketplaceClient: ReturnType<typeof createMarketplaceSnapshotClient> | null = null
let marketplaceLoadPromise: Promise<MarketplaceSnapshotLoadResult> | null = null
let marketplaceLoadedAt = 0
let runtimeClient: ReturnType<typeof createPluginRuntimeClient> | null = null

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

const MARKETPLACE_SNAPSHOT_REUSE_MILLISECONDS = 60_000

function remoteConfig(): Promise<ResolvedRemotePluginTrustConfig | null> {
  remoteConfigPromise ??= remoteTrustConfigJson
    ? parseRemotePluginTrustConfigJson(remoteTrustConfigJson)
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

function marketplaceConfig(): Promise<ResolvedMarketplaceTrustConfig | null> {
  marketplaceConfigPromise ??= marketplaceTrustConfigJson
    ? parseMarketplaceTrustConfigJson(marketplaceTrustConfigJson)
    : Promise.resolve(null)
  return marketplaceConfigPromise
}

function reusableMarketplaceSnapshot(at: number): MarketplaceSnapshotLoadResult | null {
  const current = appPluginMarketplaceSnapshot.value
  if (!current?.snapshot) return null
  const age = at - marketplaceLoadedAt
  if (
    age < 0 ||
    age >= MARKETPLACE_SNAPSHOT_REUSE_MILLISECONDS ||
    at >= Date.parse(current.snapshot.snapshot.expiresAt)
  ) {
    return null
  }
  return current
}

function loadMarketplace(forceRefresh = false): Promise<MarketplaceSnapshotLoadResult> {
  const at = Date.now()
  if (!forceRefresh) {
    const reusable = reusableMarketplaceSnapshot(at)
    if (reusable) return Promise.resolve(reusable)
  }
  if (marketplaceLoadPromise) return marketplaceLoadPromise
  const request = (async () => {
    try {
      const config = await marketplaceConfig()
      if (!config) return unavailableMarketplace(new Error('Marketplace is not configured'))
      marketplaceClient ??= createMarketplaceSnapshotClient({ ...config, cache: remoteCache })
      const result = await marketplaceClient.load()
      marketplaceLoadedAt = Date.now()
      appPluginMarketplaceSnapshot.value = result
      return result
    } catch (cause) {
      const result = unavailableMarketplace(cause)
      appPluginMarketplaceSnapshot.value = result
      return result
    }
  })()
  marketplaceLoadPromise = request
  void request.finally(() => {
    if (marketplaceLoadPromise === request) marketplaceLoadPromise = null
  })
  return request
}

async function loadMarketplaceRemoteCatalog() {
  const [config, marketplace] = await Promise.all([marketplaceConfig(), loadMarketplace(true)])
  if (!config || !marketplace.snapshot) return []
  const reference = marketplace.snapshot.snapshot.catalogs.find(
    (candidate) => candidate.channel === config.channel
  )
  if (!reference) throw new Error(`Marketplace ${config.channel} catalog is unavailable`)
  const client = createRemotePluginCatalogClient({
    catalogUrl: reference.url,
    expectedCatalogId: reference.catalogId,
    expectedCatalogKeyId: reference.keyId,
    catalogPublicKey: config.rootPublicKey,
    publisherKeyring: marketplace.snapshot.publisherKeyring,
    engineVersion:
      typeof __OPENPENCIL_APP_VERSION__ === 'string' ? __OPENPENCIL_APP_VERSION__ : '0.0.0',
    cache: remoteCache
  })
  const result = await client.load()
  if (result.catalog && result.catalog.verifiedDigest !== reference.digest) {
    throw new Error('Marketplace catalog digest does not match the signed marketplace snapshot')
  }
  appPluginRemoteCatalogSnapshot.value = result
  return remotePluginCatalogEntries(result)
}

async function loadRemoteCatalog() {
  try {
    if (appPluginMarketplaceConfigured) return await loadMarketplaceRemoteCatalog()
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
    if (appPluginMarketplaceConfigured) {
      return (await loadMarketplace()).snapshot?.publisherKeyring
    }
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

export const appPluginStore = createAppPluginStore({
  storage,
  catalog: createBundledPluginCatalog(),
  activationCompatibilityPolicy,
  ...(appPluginRemoteCatalogConfigured
    ? {
        catalogLoader: loadRemoteCatalog,
        trustedKeyringLoader: loadRemoteKeyring
      }
    : {}),
  engineVersion:
    typeof __OPENPENCIL_APP_VERSION__ === 'string' ? __OPENPENCIL_APP_VERSION__ : '0.0.0'
})

export const appPluginStoreSnapshot = shallowRef(appPluginStore.snapshot())

appPluginStore.subscribe((snapshot) => {
  appPluginStoreSnapshot.value = snapshot
  reconcileConnectorAuthorizations(snapshot.installed)
})

export const appPluginStoreReady = appPluginStore.load()

const runtimePolicyStorage =
  typeof indexedDB === 'undefined'
    ? createMemoryPluginRuntimePolicyStorage()
    : createIdbPluginRuntimePolicyStorage()

export const appPluginRuntimeManager = createPluginRuntimeManager({
  storage: runtimePolicyStorage,
  resolveInstalledPlugin(pluginId) {
    return appPluginStore
      .snapshot()
      .installed.find(({ package: value }) => value.manifest.plugin.id === pluginId)
  },
  async loadRuntime(declarativePackage) {
    const [config, marketplace] = await Promise.all([marketplaceConfig(), loadMarketplace(true)])
    if (!config || !marketplace.snapshot) {
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

export async function uninstallAppPlugin(pluginId: string): Promise<void> {
  await appPluginRuntimeReady
  await appPluginRuntimeManager.uninstall(pluginId, () => appPluginStore.uninstall(pluginId))
}

export function canCreatePluginModule(pluginId: string, moduleType: string): boolean {
  const module = appPluginStore.module(pluginId, moduleType)
  return module ? inspectInstalledPluginModuleCompatibility(module).ok : false
}
