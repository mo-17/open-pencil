import { describe, expect, test } from 'bun:test'

import {
  REMOTE_PLUGIN_CACHE_LIMITS,
  createMemoryRemotePluginCacheStorage,
  parseRemotePluginCacheRecord,
  pruneRemotePluginCache
} from '@/app/plugins'

function record(index: number) {
  return {
    schemaVersion: 1,
    cacheKey: `https://plugins.example/${index}.json`,
    kind: 'manifest' as const,
    sourceUrl: `https://plugins.example/${index}.json`,
    rawJson: '{}',
    etag: null,
    lastModified: null,
    fetchedAt: index,
    verifiedAt: index,
    expiresAt: null
  }
}

describe('remote plugin cache', () => {
  test('strictly parses cache records and keeps verified JSON inert', async () => {
    const parsed = parseRemotePluginCacheRecord(record(1))
    expect(parsed.kind).toBe('manifest')
    expect(parsed.rawJson).toBe('{}')
    expect(() => parseRemotePluginCacheRecord({ ...record(1), executable: 'alert(1)' })).toThrow(
      'unexpected fields'
    )
    expect(() => parseRemotePluginCacheRecord({ ...record(1), verifiedAt: 0 })).toThrow(
      'cannot predate'
    )

    const storage = createMemoryRemotePluginCacheStorage([parsed])
    const loaded = await storage.get(parsed.cacheKey)
    expect(loaded).toEqual(parsed)
    expect(loaded).not.toBe(parsed)
  })

  test('prunes invalid and oldest surplus records', async () => {
    const entries = Array.from({ length: REMOTE_PLUGIN_CACHE_LIMITS.maxEntries + 2 }, (_, index) =>
      record(index)
    )
    const storage = createMemoryRemotePluginCacheStorage(entries)
    await pruneRemotePluginCache(storage)

    const remaining = await storage.list()
    expect(remaining).toHaveLength(REMOTE_PLUGIN_CACHE_LIMITS.maxEntries)
    expect(await storage.get(record(0).cacheKey)).toBeNull()
    expect(await storage.get(record(1).cacheKey)).toBeNull()
    expect(await storage.get(record(entries.length - 1).cacheKey)).not.toBeNull()
  })
})
