import { afterEach, describe, expect, test } from 'bun:test'

import {
  readCachedSupabaseSchemaCatalog,
  readSupabaseSchemaCatalogCacheState,
  writeCachedSupabaseSchemaCatalog
} from '@/app/lowcode/supabase/cache'
import {
  SUPABASE_SCHEMA_CATALOG_LIMITS,
  type SupabaseSchemaCatalog
} from '@/app/lowcode/supabase/schema-catalog'

function installLocalStorage(): Map<string, string> {
  const data = new Map<string, string>()
  const storage = {
    get length() {
      return data.size
    },
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
    key: (index: number) => [...data.keys()][index] ?? null
  } satisfies Pick<Storage, 'length' | 'getItem' | 'setItem' | 'removeItem' | 'key'>
  const storageProp = ['local', 'Storage'].join('')
  Object.assign(globalThis, { window: Object.fromEntries([[storageProp, storage]]) })
  return data
}

const catalog: SupabaseSchemaCatalog = {
  version: 1,
  projectRef: 'project-ref',
  schema: 'public',
  tables: [
    {
      name: 'todos',
      required: ['id'],
      columns: [{ name: 'id', type: 'integer', required: true, nullable: false }],
      relations: []
    }
  ]
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
})

describe('Supabase schema catalog cache', () => {
  test('isolates project/schema entries and stores only the normalized catalog', async () => {
    const storage = installLocalStorage()
    await writeCachedSupabaseSchemaCatalog(catalog, { now: () => 1000 })

    await expect(
      readCachedSupabaseSchemaCatalog(
        { projectRef: 'project-ref', schema: 'public' },
        { now: () => 1001 }
      )
    ).resolves.toEqual(catalog)
    await expect(
      readCachedSupabaseSchemaCatalog(
        { projectRef: 'project-ref', schema: 'private' },
        { now: () => 1001 }
      )
    ).resolves.toBeNull()

    const stored = [...storage.values()].join('')
    expect(stored).toContain('"catalog"')
    expect(stored).not.toContain('personal-access-token')
    expect(stored).not.toContain('definitions')

    const catalogWithRawSpec = structuredClone(catalog) as SupabaseSchemaCatalog & {
      definitions: unknown
      tables: Array<SupabaseSchemaCatalog['tables'][number] & { rawOpenApi: unknown }>
    }
    catalogWithRawSpec.definitions = { should: 'be stripped' }
    catalogWithRawSpec.tables[0].rawOpenApi = { should: 'also be stripped' }
    await writeCachedSupabaseSchemaCatalog(catalogWithRawSpec, { now: () => 1002 })
    const sanitized = [...storage.values()].join('')
    expect(sanitized).not.toContain('definitions')
    expect(sanitized).not.toContain('rawOpenApi')
  })

  test('evicts expired entries', async () => {
    const storage = installLocalStorage()
    await writeCachedSupabaseSchemaCatalog(catalog, { now: () => 1000 })

    await expect(
      readSupabaseSchemaCatalogCacheState(
        { projectRef: 'project-ref', schema: 'public' },
        { now: () => 1101, ttlMs: 100 }
      )
    ).resolves.toEqual({ status: 'expired' })
    expect(storage.size).toBe(0)
  })

  test('rejects catalogs larger than the cache byte limit', async () => {
    installLocalStorage()
    const oversized: SupabaseSchemaCatalog = {
      ...catalog,
      tables: Array.from({ length: SUPABASE_SCHEMA_CATALOG_LIMITS.maxTables }, (_, index) => ({
        name: `table_${index}`,
        description: 'x'.repeat(SUPABASE_SCHEMA_CATALOG_LIMITS.maxTextLength),
        required: [],
        columns: [],
        relations: []
      }))
    }
    await expect(writeCachedSupabaseSchemaCatalog(oversized)).rejects.toThrow('cache size limit')
  })
})
