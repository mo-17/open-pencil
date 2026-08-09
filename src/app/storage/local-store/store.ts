import type { StorageDocumentAuthority } from '@/app/integrations/storage/types'
import { createIdbLocalCanvasStore } from '@/app/storage/local-store/idb'
import type { LocalCanvasLocator } from '@/app/storage/local-store/identity'
import { createMemoryLocalCanvasStore } from '@/app/storage/local-store/memory'
import type {
  AdoptLocalCanvasAuthorityOptions,
  LocalCanvasConflictCopyInput,
  LocalCanvasConflictCopyRecord,
  LocalCanvasIndexInput,
  LocalCanvasMeta,
  LocalCanvasWriteInput,
  MigrateLegacyLocalCanvasAuthorityOptions,
  UpdateLocalCanvasMetaOptions
} from '@/app/storage/local-store/types'

export type { UpdateLocalCanvasMetaOptions } from '@/app/storage/local-store/types'

export type LocalCanvasStore = {
  listMetas(includeTombstones?: boolean): Promise<LocalCanvasMeta[]>
  getMeta(locator: LocalCanvasLocator): Promise<LocalCanvasMeta | null>
  readFig(locator: LocalCanvasLocator): Promise<Uint8Array | null>
  readThumb(locator: LocalCanvasLocator): Promise<Uint8Array | null>
  writeCanvas(input: LocalCanvasWriteInput): Promise<LocalCanvasMeta>
  /** Index-only row for remote canvases not yet downloaded (no fig body). */
  upsertIndexMeta(meta: LocalCanvasIndexInput): Promise<LocalCanvasMeta>
  /** Record a provider-created copy without fabricating local .fig bytes. */
  recordConflictCopy(
    original: LocalCanvasLocator,
    input: LocalCanvasConflictCopyInput,
    options?: UpdateLocalCanvasMetaOptions
  ): Promise<LocalCanvasConflictCopyRecord | null>
  writeThumb(locator: LocalCanvasLocator, thumbBytes: Uint8Array): Promise<LocalCanvasMeta | null>
  updateMeta(
    locator: LocalCanvasLocator,
    patch: Partial<LocalCanvasMeta>,
    options?: UpdateLocalCanvasMetaOptions
  ): Promise<LocalCanvasMeta | null>
  /** Explicitly rebind one same-account row to a newly confirmed authorization grant. */
  adoptAuthority(
    locator: LocalCanvasLocator,
    nextAuthority: StorageDocumentAuthority,
    options: AdoptLocalCanvasAuthorityOptions
  ): Promise<LocalCanvasMeta | null>
  /** Atomically move one authority-less row and its blobs into an S3 generation key. */
  migrateLegacyAuthority(
    locator: LocalCanvasLocator,
    nextAuthority: StorageDocumentAuthority,
    options: MigrateLegacyLocalCanvasAuthorityOptions
  ): Promise<LocalCanvasMeta | null>
  tombstone(locator: LocalCanvasLocator): Promise<LocalCanvasMeta | null>
  /** Drop only the cached fig blob (eviction) — meta and thumb stay. */
  clearFig(locator: LocalCanvasLocator): Promise<LocalCanvasMeta | null>
  remove(locator: LocalCanvasLocator): Promise<void>
  clearAll(): Promise<void>
}

let singleton: LocalCanvasStore | null = null
let usingMemoryFallback = false

export function isLocalCanvasStoreMemoryFallback(): boolean {
  return usingMemoryFallback
}

/** Test-injected stores count as durable; only the production memory fallback is unavailable. */
export function isLocalCanvasStoreDurable(): boolean {
  getLocalCanvasStore()
  return !usingMemoryFallback
}

/** Reset singleton (tests). */
export function resetLocalCanvasStoreForTests(store?: LocalCanvasStore) {
  singleton = store ?? null
  usingMemoryFallback = false
}

/**
 * Process-wide local canvas store.
 * Prefers IndexedDB; falls back to memory (logged) if IDB is unavailable.
 */
export function getLocalCanvasStore(): LocalCanvasStore {
  if (singleton) return singleton
  try {
    if (typeof indexedDB !== 'undefined') {
      singleton = createIdbLocalCanvasStore()
      usingMemoryFallback = false
      return singleton
    }
  } catch (error) {
    console.warn('[Storage] IndexedDB local store unavailable, using memory:', error)
  }
  singleton = createMemoryLocalCanvasStore()
  usingMemoryFallback = true
  return singleton
}
