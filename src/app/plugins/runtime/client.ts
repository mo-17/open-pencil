import {
  assertVerifiedMarketplaceSnapshotCurrent,
  verifyIndexedPluginRuntimePackage,
  verifyMarketplaceRuntimeIndex,
  type PluginRuntimeIndexEntryV1,
  type VerifiedIndexedPluginRuntimePackage,
  type VerifiedMarketplaceSnapshot,
  type VerifiedPluginPackage,
  type VerifiedPluginRuntimeIndex
} from '@open-pencil/core/plugins'

import {
  REMOTE_PLUGIN_CACHE_SCHEMA_VERSION,
  createMemoryRemotePluginCacheStorage,
  parseRemotePluginCacheRecord,
  pruneRemotePluginCache,
  remotePluginCacheValidators,
  type RemotePluginCacheKind,
  type RemotePluginCacheRecordV1,
  type RemotePluginCacheStorage
} from '../remote/cache'
import {
  createRemotePluginTransport,
  type CreateRemotePluginTransportOptions,
  type RemotePluginCacheValidators,
  type RemotePluginJsonResponse
} from '../remote/transport'

export interface CreatePluginRuntimeClientOptions {
  cache?: RemotePluginCacheStorage
  transport?: Pick<
    ReturnType<typeof createRemotePluginTransport>,
    'loadRuntimeIndex' | 'loadRuntimePackage'
  >
  transportOptions?: CreateRemotePluginTransportOptions
  now?: () => number
}

export interface LoadPluginRuntimeOptions {
  marketplace: VerifiedMarketplaceSnapshot
  declarativePackage: VerifiedPluginPackage
}

export type PluginRuntimeLoadSource = 'network' | 'cache'

export interface PluginRuntimeLoadResult {
  runtime: VerifiedIndexedPluginRuntimePackage
  index: VerifiedPluginRuntimeIndex
  source: PluginRuntimeLoadSource
  refreshError: Error | null
}

type FreshResponse = Extract<RemotePluginJsonResponse, { status: 'fresh' }>
type LoadVerifiedResult<T> = {
  value: T
  source: PluginRuntimeLoadSource
  refreshError: Error | null
}
function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function runtimeCacheRecord(
  kind: Extract<RemotePluginCacheKind, 'runtime-index' | 'runtime-package'>,
  url: string,
  response: FreshResponse,
  at: number,
  expiresAt: number
): RemotePluginCacheRecordV1 {
  return parseRemotePluginCacheRecord({
    schemaVersion: REMOTE_PLUGIN_CACHE_SCHEMA_VERSION,
    cacheKey: url,
    kind,
    sourceUrl: response.url,
    rawJson: response.rawJson,
    etag: response.etag,
    lastModified: response.lastModified,
    fetchedAt: at,
    verifiedAt: at,
    expiresAt
  })
}

async function cachedRecord(
  storage: RemotePluginCacheStorage,
  url: string,
  kind: RemotePluginCacheRecordV1['kind']
): Promise<RemotePluginCacheRecordV1 | null> {
  const value = await storage.get(url)
  if (!value) return null
  try {
    const record = parseRemotePluginCacheRecord(value)
    if (record.kind !== kind) return null
    return record
  } catch {
    await storage.delete(url)
    return null
  }
}

async function loadVerifiedJson<T>(options: {
  url: string
  kind: Extract<RemotePluginCacheKind, 'runtime-index' | 'runtime-package'>
  storage: RemotePluginCacheStorage
  now(): number
  load(validators: RemotePluginCacheValidators): Promise<RemotePluginJsonResponse>
  verify(value: unknown): Promise<T>
  expiresAt(value: T): number
}): Promise<LoadVerifiedResult<T>> {
  const cached = await cachedRecord(options.storage, options.url, options.kind)
  try {
    const response = await options.load(remotePluginCacheValidators(cached))
    if (response.status === 'not-modified') {
      if (!cached) throw new Error('Runtime source returned 304 without a verified cache')
      return {
        value: await options.verify(JSON.parse(cached.rawJson)),
        source: 'cache',
        refreshError: null
      }
    }
    const value = await options.verify(response.json)
    await options.storage.put(
      runtimeCacheRecord(
        options.kind,
        options.url,
        response,
        options.now(),
        options.expiresAt(value)
      )
    )
    return { value, source: 'network', refreshError: null }
  } catch (cause) {
    if (!cached) throw cause
    try {
      return {
        value: await options.verify(JSON.parse(cached.rawJson)),
        source: 'cache',
        refreshError: asError(cause)
      }
    } catch (cachedCause) {
      throw new AggregateError(
        [asError(cause), asError(cachedCause)],
        'Runtime network and cache verification failed'
      )
    }
  }
}

function runtimeEntry(
  index: VerifiedPluginRuntimeIndex,
  declarativePackage: VerifiedPluginPackage
): PluginRuntimeIndexEntryV1 {
  const entry = index.index.entries.find(
    (candidate) =>
      candidate.pluginId === declarativePackage.manifest.plugin.id &&
      candidate.version === declarativePackage.manifest.plugin.version &&
      candidate.declarativeManifestDigest === declarativePackage.verifiedDigest
  )
  if (!entry) throw new Error('No executable runtime matches the accepted plugin package')
  return entry
}

export function createPluginRuntimeClient(options: CreatePluginRuntimeClientOptions) {
  const storage = options.cache ?? createMemoryRemotePluginCacheStorage()
  const transport = options.transport ?? createRemotePluginTransport(options.transportOptions ?? {})
  const now = options.now ?? Date.now

  async function load(loadOptions: LoadPluginRuntimeOptions): Promise<PluginRuntimeLoadResult> {
    await pruneRemotePluginCache(storage)
    const marketplace = assertVerifiedMarketplaceSnapshotCurrent(loadOptions.marketplace, {
      now: now()
    })
    const reference = marketplace.snapshot.runtimeIndex
    if (!reference) throw new Error('Marketplace does not publish an executable runtime index')
    const indexResult = await loadVerifiedJson({
      url: reference.url,
      kind: 'runtime-index',
      storage,
      now,
      load: (cacheValidators) => transport.loadRuntimeIndex(reference.url, cacheValidators),
      verify: (value) =>
        verifyMarketplaceRuntimeIndex(value, {
          snapshot: marketplace,
          now: now()
        }),
      expiresAt: (value) =>
        Math.min(Date.parse(marketplace.snapshot.expiresAt), Date.parse(value.index.expiresAt))
    })
    const entry = runtimeEntry(indexResult.value, loadOptions.declarativePackage)
    const runtimeResult = await loadVerifiedJson({
      url: entry.runtimePackageUrl,
      kind: 'runtime-package',
      storage,
      now,
      load: (cacheValidators) =>
        transport.loadRuntimePackage(entry.runtimePackageUrl, cacheValidators),
      verify: (value) =>
        verifyIndexedPluginRuntimePackage(entry, value, marketplace.publisherKeyring, {
          index: indexResult.value,
          declarativePackage: loadOptions.declarativePackage,
          now: now()
        }),
      expiresAt: (value) =>
        Math.min(
          Date.parse(marketplace.snapshot.expiresAt),
          Date.parse(indexResult.value.index.expiresAt),
          Date.parse(value.keyTrust.key.notAfter)
        )
    })
    return {
      runtime: runtimeResult.value,
      index: indexResult.value,
      source:
        indexResult.source === 'network' && runtimeResult.source === 'network'
          ? 'network'
          : 'cache',
      refreshError: runtimeResult.refreshError ?? indexResult.refreshError
    }
  }

  return { load }
}
