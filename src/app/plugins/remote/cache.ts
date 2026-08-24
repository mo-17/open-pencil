import { openIdb, runIdbReadonlyRequest, txDone } from '@/app/storage/idb'

import { REMOTE_PLUGIN_TRANSPORT_LIMITS, type RemotePluginCacheValidators } from './transport'

export const REMOTE_PLUGIN_CACHE_SCHEMA_VERSION = 1 as const
export const REMOTE_PLUGIN_CACHE_DATABASE_NAME = 'open-pencil-plugin-catalog-cache'
export const REMOTE_PLUGIN_CACHE_LIMITS = Object.freeze({
  maxEntries: 256,
  maxValidatorLength: 512
})

export type RemotePluginCacheKind =
  | 'catalog'
  | 'manifest'
  | 'marketplace'
  | 'runtime-index'
  | 'runtime-package'

export interface RemotePluginCacheRecordV1 {
  schemaVersion: typeof REMOTE_PLUGIN_CACHE_SCHEMA_VERSION
  cacheKey: string
  kind: RemotePluginCacheKind
  sourceUrl: string
  rawJson: string
  etag: string | null
  lastModified: string | null
  fetchedAt: number
  verifiedAt: number
  expiresAt: number | null
}

export interface RemotePluginCacheStorage {
  get(cacheKey: string): Promise<unknown>
  list(): Promise<unknown[]>
  put(record: unknown): Promise<void>
  delete(cacheKey: string): Promise<void>
}

export function remotePluginCacheValidators(
  record: RemotePluginCacheRecordV1 | null
): RemotePluginCacheValidators {
  return record
    ? {
        ...(record.etag ? { etag: record.etag } : {}),
        ...(record.lastModified ? { lastModified: record.lastModified } : {})
      }
    : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function timestamp(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer`)
  }
  return value as number
}

function optionalTimestamp(value: unknown, path: string): number | null {
  return value === null ? null : timestamp(value, path)
}

function validator(value: unknown, path: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || value.length > REMOTE_PLUGIN_CACHE_LIMITS.maxValidatorLength) {
    throw new TypeError(`${path} must be a bounded string or null`)
  }
  return value
}

export function parseRemotePluginCacheRecord(value: unknown): RemotePluginCacheRecordV1 {
  if (!isRecord(value)) throw new TypeError('Remote plugin cache record must be an object')
  const keys = new Set([
    'schemaVersion',
    'cacheKey',
    'kind',
    'sourceUrl',
    'rawJson',
    'etag',
    'lastModified',
    'fetchedAt',
    'verifiedAt',
    'expiresAt'
  ])
  if (Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !keys.has(key))) {
    throw new TypeError('Remote plugin cache record contains unexpected fields')
  }
  if (Object.keys(value).length !== keys.size) {
    throw new TypeError('Remote plugin cache record is missing required fields')
  }
  if (value.schemaVersion !== REMOTE_PLUGIN_CACHE_SCHEMA_VERSION) {
    throw new TypeError('Remote plugin cache record has an unsupported schema version')
  }
  if (
    typeof value.cacheKey !== 'string' ||
    value.cacheKey.length === 0 ||
    value.cacheKey.length > REMOTE_PLUGIN_TRANSPORT_LIMITS.maxUrlLength ||
    typeof value.sourceUrl !== 'string' ||
    value.sourceUrl.length === 0 ||
    value.sourceUrl.length > REMOTE_PLUGIN_TRANSPORT_LIMITS.maxUrlLength ||
    (value.kind !== 'catalog' &&
      value.kind !== 'manifest' &&
      value.kind !== 'marketplace' &&
      value.kind !== 'runtime-index' &&
      value.kind !== 'runtime-package') ||
    typeof value.rawJson !== 'string'
  ) {
    throw new TypeError('Remote plugin cache record identity or payload is invalid')
  }
  const maxBytes = {
    catalog: REMOTE_PLUGIN_TRANSPORT_LIMITS.maxCatalogBytes,
    manifest: REMOTE_PLUGIN_TRANSPORT_LIMITS.maxManifestBytes,
    marketplace: REMOTE_PLUGIN_TRANSPORT_LIMITS.maxMarketplaceBytes,
    'runtime-index': REMOTE_PLUGIN_TRANSPORT_LIMITS.maxRuntimeIndexBytes,
    'runtime-package': REMOTE_PLUGIN_TRANSPORT_LIMITS.maxRuntimePackageBytes
  }[value.kind]
  if (new TextEncoder().encode(value.rawJson).byteLength > maxBytes) {
    throw new TypeError('Remote plugin cache payload exceeds its size limit')
  }
  const fetchedAt = timestamp(value.fetchedAt, 'remotePluginCache.fetchedAt')
  const verifiedAt = timestamp(value.verifiedAt, 'remotePluginCache.verifiedAt')
  const expiresAt = optionalTimestamp(value.expiresAt, 'remotePluginCache.expiresAt')
  if (verifiedAt < fetchedAt) {
    throw new TypeError('Remote plugin cache verification cannot predate its fetch')
  }
  return {
    schemaVersion: REMOTE_PLUGIN_CACHE_SCHEMA_VERSION,
    cacheKey: value.cacheKey,
    kind: value.kind,
    sourceUrl: value.sourceUrl,
    rawJson: value.rawJson,
    etag: validator(value.etag, 'remotePluginCache.etag'),
    lastModified: validator(value.lastModified, 'remotePluginCache.lastModified'),
    fetchedAt,
    verifiedAt,
    expiresAt
  }
}

export function createMemoryRemotePluginCacheStorage(
  initial: readonly unknown[] = []
): RemotePluginCacheStorage {
  const records = new Map(
    initial.map((value) => {
      const parsed = parseRemotePluginCacheRecord(value)
      return [parsed.cacheKey, parsed] as const
    })
  )
  return {
    async get(cacheKey) {
      const value = records.get(cacheKey)
      return value ? structuredClone(value) : null
    },
    async list() {
      return [...records.values()].map((value) => structuredClone(value))
    },
    async put(value) {
      const parsed = parseRemotePluginCacheRecord(value)
      records.set(parsed.cacheKey, structuredClone(parsed))
    },
    async delete(cacheKey) {
      records.delete(cacheKey)
    }
  }
}

export function createIdbRemotePluginCacheStorage(
  databaseName = REMOTE_PLUGIN_CACHE_DATABASE_NAME
): RemotePluginCacheStorage {
  const storeName = 'verifiedResponses'
  let databasePromise: Promise<IDBDatabase> | null = null
  function database(): Promise<IDBDatabase> {
    databasePromise ??= openIdb(databaseName, 1, (db) => {
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName, { keyPath: 'cacheKey' })
      }
    })
    return databasePromise
  }
  return {
    async get(cacheKey) {
      const db = await database()
      const value = await runIdbReadonlyRequest(db, storeName, (store) => store.get(cacheKey))
      return value ?? null
    },
    async list() {
      const db = await database()
      return runIdbReadonlyRequest(db, storeName, (store) => store.getAll())
    },
    async put(value) {
      const parsed = parseRemotePluginCacheRecord(value)
      const db = await database()
      const transaction = db.transaction(storeName, 'readwrite')
      transaction.objectStore(storeName).put(parsed)
      await txDone(transaction)
    },
    async delete(cacheKey) {
      const db = await database()
      const transaction = db.transaction(storeName, 'readwrite')
      transaction.objectStore(storeName).delete(cacheKey)
      await txDone(transaction)
    }
  }
}

export async function pruneRemotePluginCache(storage: RemotePluginCacheStorage): Promise<void> {
  const parsed: RemotePluginCacheRecordV1[] = []
  for (const value of await storage.list()) {
    try {
      parsed.push(parseRemotePluginCacheRecord(value))
    } catch {
      if (isRecord(value) && typeof value.cacheKey === 'string') {
        await storage.delete(value.cacheKey)
      }
    }
  }
  const surplus = parsed
    .sort((left, right) => right.verifiedAt - left.verifiedAt)
    .slice(REMOTE_PLUGIN_CACHE_LIMITS.maxEntries)
  await Promise.all(surplus.map((record) => storage.delete(record.cacheKey)))
}
