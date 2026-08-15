import {
  verifyCatalogPluginPackage,
  verifyPluginCatalog,
  type PluginCatalogEntryV1,
  type PluginTrustDiagnostic,
  type TrustedPluginKeyringV1,
  type VerifiedCatalogPluginPackage,
  type VerifiedPluginCatalog
} from '@open-pencil/plugin-contracts'

import type { PublisherSignedPluginCatalogEntry } from '../types'
import {
  REMOTE_PLUGIN_CACHE_SCHEMA_VERSION,
  createMemoryRemotePluginCacheStorage,
  parseRemotePluginCacheRecord,
  pruneRemotePluginCache,
  remotePluginCacheValidators,
  type RemotePluginCacheRecordV1,
  type RemotePluginCacheStorage
} from './cache'
import {
  createRemotePluginTransport,
  type CreateRemotePluginTransportOptions,
  type RemotePluginJSONResponse
} from './transport'

export type RemotePluginCatalogLoadStatus = 'fresh' | 'cached' | 'stale' | 'unavailable'

export const REMOTE_PLUGIN_CLIENT_LIMITS = Object.freeze({
  maxPackages: 60,
  maxConcurrentManifestRequests: 4
})

export type RemotePluginCatalogPackage = Readonly<{
  verification: VerifiedCatalogPluginPackage
  source: 'network' | 'cache'
  refreshError: Error | null
}>

export type RemotePluginCatalogIssue = Readonly<{
  subjectId: string
  error: Error
}>

export type RemotePluginCatalogLoadResult = Readonly<{
  status: RemotePluginCatalogLoadStatus
  catalog: VerifiedPluginCatalog | null
  packages: readonly RemotePluginCatalogPackage[]
  diagnostics: readonly PluginTrustDiagnostic[]
  issues: readonly RemotePluginCatalogIssue[]
  refreshError: Error | null
}>

export interface CreateRemotePluginCatalogClientOptions {
  catalogUrl: string
  expectedCatalogId: string
  expectedCatalogKeyId: string
  catalogPublicKey: CryptoKey
  publisherKeyring: TrustedPluginKeyringV1
  engineVersion: string
  cache?: RemotePluginCacheStorage
  transport?: ReturnType<typeof createRemotePluginTransport>
  transportOptions?: CreateRemotePluginTransportOptions
  now?: () => number
  maxPackages?: number
}

export function remotePluginCatalogEntries(
  result: RemotePluginCatalogLoadResult
): readonly PublisherSignedPluginCatalogEntry[] {
  const catalog = result.catalog
  if (!catalog) return []
  return result.packages.map(({ verification, source }) => ({
    trustSource: 'publisher-signature',
    manifest: verification.verifiedPackage.manifest,
    trustedPublicKey: verification.keyTrust.key.publicKey,
    expectedPluginId: verification.entry.pluginId,
    expectedPublisherId: verification.entry.publisherId,
    expectedKeyId: verification.entry.keyId,
    remoteCatalog: {
      catalogId: verification.catalogId,
      catalogVersion: catalog.catalog.version,
      catalogDigest: verification.catalogDigest,
      catalogExpiresAt: catalog.catalog.expiresAt,
      source
    }
  }))
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function latestCatalogEntries(entries: readonly PluginCatalogEntryV1[]): PluginCatalogEntryV1[] {
  const seen = new Set<string>()
  return entries.filter((entry) => {
    if (seen.has(entry.pluginId)) return false
    seen.add(entry.pluginId)
    return true
  })
}

async function cached(
  storage: RemotePluginCacheStorage,
  cacheKey: string,
  kind: RemotePluginCacheRecordV1['kind']
): Promise<RemotePluginCacheRecordV1 | null> {
  const value = await storage.get(cacheKey)
  if (value === null) return null
  try {
    const parsed = parseRemotePluginCacheRecord(value)
    if (parsed.kind !== kind || parsed.sourceUrl !== cacheKey) {
      throw new TypeError('Remote plugin cache identity does not match its lookup key')
    }
    return parsed
  } catch (cause) {
    await storage.delete(cacheKey)
    throw cause
  }
}

function cachedJSON(record: RemotePluginCacheRecordV1): unknown {
  try {
    return JSON.parse(record.rawJson)
  } catch {
    throw new TypeError('Remote plugin cache contains invalid JSON')
  }
}

function cacheRecord(
  kind: RemotePluginCacheRecordV1['kind'],
  sourceURL: string,
  response: Extract<RemotePluginJSONResponse, { status: 'fresh' }>,
  now: number,
  expiresAt: number | null
): RemotePluginCacheRecordV1 {
  return {
    schemaVersion: REMOTE_PLUGIN_CACHE_SCHEMA_VERSION,
    cacheKey: sourceURL,
    kind,
    sourceUrl: sourceURL,
    rawJson: response.rawJson,
    etag: response.etag,
    lastModified: response.lastModified,
    fetchedAt: now,
    verifiedAt: now,
    expiresAt
  }
}

export function createRemotePluginCatalogClient(options: CreateRemotePluginCatalogClientOptions) {
  const storage = options.cache ?? createMemoryRemotePluginCacheStorage()
  const transport = options.transport ?? createRemotePluginTransport(options.transportOptions)
  const now = options.now ?? Date.now

  async function verifyCatalog(value: unknown, at: number): Promise<VerifiedPluginCatalog> {
    return verifyPluginCatalog(value, options.catalogPublicKey, {
      expectedCatalogId: options.expectedCatalogId,
      expectedKeyId: options.expectedCatalogKeyId,
      now: at
    })
  }

  async function loadCatalog(): Promise<{
    catalog: VerifiedPluginCatalog
    source: 'network' | 'cache'
    refreshError: Error | null
  }> {
    const at = now()
    let cache: RemotePluginCacheRecordV1 | null = null
    try {
      cache = await cached(storage, options.catalogUrl, 'catalog')
    } catch {
      cache = null
    }
    try {
      const response = await transport.loadCatalog(
        options.catalogUrl,
        remotePluginCacheValidators(cache)
      )
      if (response.status === 'not-modified') {
        if (!cache) throw new Error('Remote plugin catalog returned 304 without a cached catalog')
        return {
          catalog: await verifyCatalog(cachedJSON(cache), at),
          source: 'cache',
          refreshError: null
        }
      }
      const catalog = await verifyCatalog(response.json, at)
      await storage.put(
        cacheRecord(
          'catalog',
          options.catalogUrl,
          response,
          at,
          Date.parse(catalog.catalog.expiresAt)
        )
      )
      return { catalog, source: 'network', refreshError: null }
    } catch (cause) {
      if (!cache) throw cause
      const catalog = await verifyCatalog(cachedJSON(cache), at)
      return { catalog, source: 'cache', refreshError: asError(cause) }
    }
  }

  async function verifyEntry(
    entry: PluginCatalogEntryV1,
    value: unknown,
    at: number,
    catalog: VerifiedPluginCatalog
  ): Promise<VerifiedCatalogPluginPackage> {
    return verifyCatalogPluginPackage(entry, value, options.publisherKeyring, {
      catalog,
      engineVersion: options.engineVersion,
      now: at
    })
  }

  async function loadPackage(
    entry: PluginCatalogEntryV1,
    catalog: VerifiedPluginCatalog
  ): Promise<RemotePluginCatalogPackage> {
    const at = now()
    let cache: RemotePluginCacheRecordV1 | null = null
    try {
      cache = await cached(storage, entry.manifestUrl, 'manifest')
    } catch {
      cache = null
    }
    try {
      const response = await transport.loadManifest(
        entry.manifestUrl,
        remotePluginCacheValidators(cache)
      )
      if (response.status === 'not-modified') {
        if (!cache) throw new Error('Remote plugin manifest returned 304 without a cached manifest')
        return {
          verification: await verifyEntry(entry, cachedJSON(cache), at, catalog),
          source: 'cache',
          refreshError: null
        }
      }
      const verification = await verifyEntry(entry, response.json, at, catalog)
      await storage.put(
        cacheRecord(
          'manifest',
          entry.manifestUrl,
          response,
          at,
          Date.parse(verification.keyTrust.key.notAfter)
        )
      )
      return { verification, source: 'network', refreshError: null }
    } catch (cause) {
      if (!cache) throw cause
      return {
        verification: await verifyEntry(entry, cachedJSON(cache), at, catalog),
        source: 'cache',
        refreshError: asError(cause)
      }
    }
  }

  async function load(): Promise<RemotePluginCatalogLoadResult> {
    await pruneRemotePluginCache(storage)
    let loadedCatalog: Awaited<ReturnType<typeof loadCatalog>>
    try {
      loadedCatalog = await loadCatalog()
    } catch (cause) {
      const hasCache = (await storage.get(options.catalogUrl)) !== null
      return {
        status: hasCache ? 'stale' : 'unavailable',
        catalog: null,
        packages: [],
        diagnostics: [],
        issues: [],
        refreshError: asError(cause)
      }
    }
    const entries = latestCatalogEntries(loadedCatalog.catalog.catalog.entries)
    const maxPackages = options.maxPackages ?? REMOTE_PLUGIN_CLIENT_LIMITS.maxPackages
    if (!Number.isSafeInteger(maxPackages) || maxPackages < 0 || maxPackages > 64) {
      throw new TypeError('Remote plugin package limit must be an integer between 0 and 64')
    }
    if (entries.length > maxPackages) {
      return {
        status: loadedCatalog.source === 'cache' ? 'cached' : 'fresh',
        catalog: loadedCatalog.catalog,
        packages: [],
        diagnostics: loadedCatalog.catalog.diagnostics,
        issues: [
          {
            subjectId: loadedCatalog.catalog.catalog.catalogId,
            error: new Error(`Remote plugin catalog exceeds the ${maxPackages} package limit`)
          }
        ],
        refreshError: loadedCatalog.refreshError
      }
    }
    const indexedPackages: Array<{ index: number; value: RemotePluginCatalogPackage }> = []
    const issues: RemotePluginCatalogIssue[] = []
    let cursor = 0
    async function loadNextPackage(): Promise<void> {
      while (cursor < entries.length) {
        const index = cursor
        cursor += 1
        const entry = entries[index]
        try {
          indexedPackages.push({
            index,
            value: await loadPackage(entry, loadedCatalog.catalog)
          })
        } catch (cause) {
          issues.push({ subjectId: `${entry.pluginId}@${entry.version}`, error: asError(cause) })
        }
      }
    }
    await Promise.all(
      Array.from(
        {
          length: Math.min(
            entries.length,
            REMOTE_PLUGIN_CLIENT_LIMITS.maxConcurrentManifestRequests
          )
        },
        loadNextPackage
      )
    )
    const packages = indexedPackages
      .sort((left, right) => left.index - right.index)
      .map(({ value }) => value)
    const usedCache =
      loadedCatalog.source === 'cache' || packages.some((entry) => entry.source === 'cache')
    return {
      status: usedCache ? 'cached' : 'fresh',
      catalog: loadedCatalog.catalog,
      packages,
      diagnostics: [
        ...loadedCatalog.catalog.diagnostics,
        ...packages.flatMap(({ verification }) => verification.diagnostics)
      ],
      issues,
      refreshError:
        loadedCatalog.refreshError ??
        packages.find(({ refreshError }) => refreshError !== null)?.refreshError ??
        null
    }
  }

  return { load }
}
