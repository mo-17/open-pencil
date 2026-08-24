import {
  assertMarketplaceSnapshotAdvance,
  verifyMarketplaceSnapshot,
  type VerifiedMarketplaceSnapshot
} from '@open-pencil/plugin-contracts'

import {
  REMOTE_PLUGIN_CACHE_SCHEMA_VERSION,
  createMemoryRemotePluginCacheStorage,
  parseRemotePluginCacheRecord,
  pruneRemotePluginCache,
  remotePluginCacheValidators,
  type RemotePluginCacheRecordV1,
  type RemotePluginCacheStorage
} from '../remote/cache'
import {
  createRemotePluginTransport,
  parseRemotePluginURL,
  type CreateRemotePluginTransportOptions,
  type RemotePluginJSONResponse
} from '../remote/transport'

export type MarketplaceSnapshotLoadStatus = 'fresh' | 'cached' | 'stale' | 'unavailable'

export interface MarketplaceSnapshotLoadResult {
  status: MarketplaceSnapshotLoadStatus
  snapshot: VerifiedMarketplaceSnapshot | null
  source: 'network' | 'cache' | null
  refreshError: Error | null
}

export interface CreateMarketplaceSnapshotClientOptions {
  snapshotUrl: string
  expectedMarketplaceId: string
  expectedKeyId: string
  rootPublicKey: CryptoKey
  cache?: RemotePluginCacheStorage
  transport?: Pick<ReturnType<typeof createRemotePluginTransport>, 'loadMarketplace'>
  transportOptions?: CreateRemotePluginTransportOptions
  now?: () => number
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function cachedJSON(record: RemotePluginCacheRecordV1): unknown {
  return JSON.parse(record.rawJson)
}

function cacheRecord(
  cacheKey: string,
  sourceURL: string,
  response: Extract<RemotePluginJSONResponse, { status: 'fresh' }>,
  verifiedAt: number,
  expiresAt: number
): RemotePluginCacheRecordV1 {
  return parseRemotePluginCacheRecord({
    schemaVersion: REMOTE_PLUGIN_CACHE_SCHEMA_VERSION,
    cacheKey,
    kind: 'marketplace',
    sourceUrl: sourceURL,
    rawJson: response.rawJson,
    etag: response.etag,
    lastModified: response.lastModified,
    fetchedAt: verifiedAt,
    verifiedAt,
    expiresAt
  })
}

export function createMarketplaceSnapshotClient(options: CreateMarketplaceSnapshotClientOptions) {
  const storage = options.cache ?? createMemoryRemotePluginCacheStorage()
  const transport = options.transport ?? createRemotePluginTransport(options.transportOptions ?? {})
  const now = options.now ?? Date.now
  const urlOptions = { allowLoopbackHttp: options.transportOptions?.allowLoopbackHttp }
  const expectedSourceURL = parseRemotePluginURL(options.snapshotUrl, urlOptions).href

  function assertExpectedResponseURL(response: RemotePluginJSONResponse): void {
    const responseURL = parseRemotePluginURL(response.url, urlOptions).href
    if (responseURL !== expectedSourceURL) {
      throw new Error('Marketplace snapshot response URL does not match its requested source')
    }
  }

  async function verify(value: unknown, at: number): Promise<VerifiedMarketplaceSnapshot> {
    return verifyMarketplaceSnapshot(value, options.rootPublicKey, {
      expectedMarketplaceId: options.expectedMarketplaceId,
      expectedKeyId: options.expectedKeyId,
      now: at
    })
  }

  async function load(): Promise<MarketplaceSnapshotLoadResult> {
    await pruneRemotePluginCache(storage)
    const cachedValue = await storage.get(options.snapshotUrl)
    let cached: RemotePluginCacheRecordV1 | null = null
    try {
      cached =
        cachedValue === null || cachedValue === undefined
          ? null
          : parseRemotePluginCacheRecord(cachedValue)
      if (
        cached &&
        (cached.kind !== 'marketplace' ||
          cached.cacheKey !== options.snapshotUrl ||
          cached.sourceUrl !== expectedSourceURL)
      ) {
        throw new TypeError('Marketplace cache identity does not match its requested source')
      }
    } catch {
      await storage.delete(options.snapshotUrl)
      cached = null
    }
    const at = now()
    try {
      const response = await transport.loadMarketplace(
        options.snapshotUrl,
        remotePluginCacheValidators(cached)
      )
      assertExpectedResponseURL(response)
      if (response.status === 'not-modified') {
        if (!cached) throw new Error('Marketplace snapshot returned 304 without a verified cache')
        return {
          status: 'cached',
          snapshot: await verify(cachedJSON(cached), at),
          source: 'cache',
          refreshError: null
        }
      }
      const snapshot = await verify(response.json, at)
      if (cached) {
        const previous = await verify(cachedJSON(cached), cached.verifiedAt)
        if (previous.verifiedDigest !== snapshot.verifiedDigest) {
          assertMarketplaceSnapshotAdvance(previous, snapshot)
        }
      }
      await storage.put(
        cacheRecord(
          options.snapshotUrl,
          expectedSourceURL,
          response,
          at,
          Date.parse(snapshot.snapshot.expiresAt)
        )
      )
      return { status: 'fresh', snapshot, source: 'network', refreshError: null }
    } catch (cause) {
      if (!cached) {
        return { status: 'unavailable', snapshot: null, source: null, refreshError: asError(cause) }
      }
      try {
        return {
          status: 'cached',
          snapshot: await verify(cachedJSON(cached), at),
          source: 'cache',
          refreshError: asError(cause)
        }
      } catch (cachedCause) {
        return {
          status: 'stale',
          snapshot: null,
          source: null,
          refreshError: new AggregateError(
            [asError(cause), asError(cachedCause)],
            'Marketplace network and cache verification failed'
          )
        }
      }
    }
  }

  return { load }
}
