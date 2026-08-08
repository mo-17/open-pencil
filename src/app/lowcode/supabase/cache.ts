import { readCacheText, removeCacheEntry, writeCacheText } from '@/app/cache'

import {
  type SupabaseSchemaCatalog,
  type SupabaseSchemaCatalogIdentity,
  validateSupabaseSchemaCatalog
} from './schema-catalog'

export const SUPABASE_SCHEMA_CACHE_TTL_MS = 15 * 60 * 1000
export const SUPABASE_SCHEMA_CACHE_MAX_BYTES = 512 * 1024

const SUPABASE_SCHEMA_CACHE_PREFIX = 'supabase/schema-catalog'
const SUPABASE_SCHEMA_CACHE_FORMAT = 'openpencil-supabase-schema-catalog-cache' as const
const SUPABASE_SCHEMA_CACHE_VERSION = 1 as const

interface SupabaseSchemaCacheEnvelope {
  format: typeof SUPABASE_SCHEMA_CACHE_FORMAT
  version: typeof SUPABASE_SCHEMA_CACHE_VERSION
  cachedAt: number
  catalog: SupabaseSchemaCatalog
}

export interface SupabaseSchemaCacheOptions {
  now?: () => number
  ttlMs?: number
}

export type SupabaseSchemaCacheReadResult =
  | { status: 'hit'; catalog: SupabaseSchemaCatalog; cachedAt: number }
  | { status: 'miss' | 'expired' | 'invalid' }

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

export function supabaseSchemaCacheKey(identity: SupabaseSchemaCatalogIdentity): string {
  return `${SUPABASE_SCHEMA_CACHE_PREFIX}/${encodeURIComponent(identity.projectRef)}/${encodeURIComponent(identity.schema)}`
}

async function removeEntryWithStatus(
  key: string,
  status: 'expired' | 'invalid'
): Promise<SupabaseSchemaCacheReadResult> {
  await removeCacheEntry(key)
  return { status }
}

export async function readSupabaseSchemaCatalogCacheState(
  identity: SupabaseSchemaCatalogIdentity,
  options: SupabaseSchemaCacheOptions = {}
): Promise<SupabaseSchemaCacheReadResult> {
  const key = supabaseSchemaCacheKey(identity)
  const raw = await readCacheText(key)
  if (!raw) return { status: 'miss' }
  if (byteLength(raw) > SUPABASE_SCHEMA_CACHE_MAX_BYTES) {
    return removeEntryWithStatus(key, 'invalid')
  }

  try {
    const envelope = JSON.parse(raw) as Partial<SupabaseSchemaCacheEnvelope>
    if (
      envelope.format !== SUPABASE_SCHEMA_CACHE_FORMAT ||
      envelope.version !== SUPABASE_SCHEMA_CACHE_VERSION ||
      typeof envelope.cachedAt !== 'number' ||
      !Number.isFinite(envelope.cachedAt)
    ) {
      return await removeEntryWithStatus(key, 'invalid')
    }
    const now = (options.now ?? Date.now)()
    const ttlMs = options.ttlMs ?? SUPABASE_SCHEMA_CACHE_TTL_MS
    if (envelope.cachedAt > now || now - envelope.cachedAt > ttlMs) {
      return await removeEntryWithStatus(key, 'expired')
    }
    const catalog = validateSupabaseSchemaCatalog(envelope.catalog, identity)
    if (catalog) return { status: 'hit', catalog, cachedAt: envelope.cachedAt }
    return await removeEntryWithStatus(key, 'invalid')
  } catch {
    return removeEntryWithStatus(key, 'invalid')
  }
}

export async function readCachedSupabaseSchemaCatalog(
  identity: SupabaseSchemaCatalogIdentity,
  options: SupabaseSchemaCacheOptions = {}
): Promise<SupabaseSchemaCatalog | null> {
  const result = await readSupabaseSchemaCatalogCacheState(identity, options)
  return result.status === 'hit' ? result.catalog : null
}

export async function writeCachedSupabaseSchemaCatalog(
  catalog: SupabaseSchemaCatalog,
  options: Pick<SupabaseSchemaCacheOptions, 'now'> = {}
): Promise<void> {
  const validated = validateSupabaseSchemaCatalog(catalog, catalog)
  if (!validated) {
    throw new Error('Only a valid normalized Supabase schema catalog can be cached.')
  }
  const envelope: SupabaseSchemaCacheEnvelope = {
    format: SUPABASE_SCHEMA_CACHE_FORMAT,
    version: SUPABASE_SCHEMA_CACHE_VERSION,
    cachedAt: (options.now ?? Date.now)(),
    catalog: validated
  }
  const serialized = JSON.stringify(envelope)
  if (byteLength(serialized) > SUPABASE_SCHEMA_CACHE_MAX_BYTES) {
    throw new Error('Supabase schema catalog exceeds the local cache size limit.')
  }
  await writeCacheText(supabaseSchemaCacheKey(catalog), serialized)
}

export function clearCachedSupabaseSchemaCatalog(
  identity: SupabaseSchemaCatalogIdentity
): Promise<void> {
  return removeCacheEntry(supabaseSchemaCacheKey(identity))
}
