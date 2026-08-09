import { openIdb, reqToPromise, txDone } from '@/app/storage/idb-util'
import {
  LEGACY_STORAGE_PROVIDER_ID,
  legacyAuthorityMigrationKeys,
  localCanvasKey,
  localCanvasBinding,
  legacyLocalCanvasBinding,
  resolveLocalCanvasLocator
} from '@/app/storage/local-store/identity'
import {
  buildAdoptedAuthorityMeta,
  buildConflictCopyMetas,
  buildIndexMeta,
  buildWriteMeta,
  localCanvasMetaMatchesUpdateOptions,
  sortAndFilterMetas
} from '@/app/storage/local-store/meta'
import type { LocalCanvasStore } from '@/app/storage/local-store/store'
import type { LocalCanvasMeta, LocalCanvasWriteInput } from '@/app/storage/local-store/types'

const DB_NAME = 'open-pencil-cloud-local'
const DB_VERSION = 2

const STORE_META = 'meta-v2'
const STORE_FIG = 'fig-v2'
const STORE_THUMB = 'thumb-v2'
const LEGACY_STORE_META = 'meta'
const LEGACY_STORE_FIG = 'fig'
const LEGACY_STORE_THUMB = 'thumb'

function createV2Stores(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(STORE_META)) {
    db.createObjectStore(STORE_META, { keyPath: 'key' })
  }
  if (!db.objectStoreNames.contains(STORE_FIG)) db.createObjectStore(STORE_FIG)
  if (!db.objectStoreNames.contains(STORE_THUMB)) db.createObjectStore(STORE_THUMB)
}

function migrateLegacyMeta(transaction: IDBTransaction): void {
  if (!transaction.db.objectStoreNames.contains(LEGACY_STORE_META)) return
  const target = transaction.objectStore(STORE_META)
  const request = transaction.objectStore(LEGACY_STORE_META).openCursor()
  request.onsuccess = () => {
    const cursor = request.result
    if (!cursor) return
    const legacy = cursor.value as Partial<LocalCanvasMeta> & { id?: unknown }
    if (typeof legacy.id === 'string' && legacy.id) {
      const binding = {
        ...legacyLocalCanvasBinding(legacy.id),
        providerId:
          typeof legacy.providerId === 'string' && legacy.providerId
            ? legacy.providerId
            : LEGACY_STORAGE_PROVIDER_ID
      }
      target.put({
        ...legacy,
        key: localCanvasKey(binding),
        id: binding.documentId,
        providerId: binding.providerId,
        profileId: binding.profileId,
        authority: null,
        remoteRevision: null
      } as LocalCanvasMeta)
    }
    cursor.continue()
  }
}

function migrateLegacyBlob(
  transaction: IDBTransaction,
  legacyStoreName: string,
  targetStoreName: string
): void {
  if (!transaction.db.objectStoreNames.contains(legacyStoreName)) return
  const target = transaction.objectStore(targetStoreName)
  const request = transaction.objectStore(legacyStoreName).openCursor()
  request.onsuccess = () => {
    const cursor = request.result
    if (!cursor) return
    if (typeof cursor.key === 'string') {
      target.put(cursor.value, localCanvasKey(legacyLocalCanvasBinding(cursor.key)))
    }
    cursor.continue()
  }
}

function openDb(databaseName: string): Promise<IDBDatabase> {
  return openIdb(databaseName, DB_VERSION, (db, oldVersion, transaction) => {
    createV2Stores(db)
    if (oldVersion !== 1) return
    migrateLegacyMeta(transaction)
    migrateLegacyBlob(transaction, LEGACY_STORE_FIG, STORE_FIG)
    migrateLegacyBlob(transaction, LEGACY_STORE_THUMB, STORE_THUMB)
  })
}

/** Stored rows may be ArrayBuffer, typed array, or Blob depending on writer/browser. */
async function rowToBytes(row: unknown): Promise<Uint8Array | null> {
  if (row == null) return null
  if (row instanceof ArrayBuffer) return new Uint8Array(row)
  if (row instanceof Uint8Array) return new Uint8Array(row)
  if (row instanceof Blob) return new Uint8Array(await row.arrayBuffer())
  return null
}

function bytesToBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

async function readMetaRow(store: IDBObjectStore, key: string): Promise<LocalCanvasMeta | null> {
  return ((await reqToPromise(store.get(key))) as LocalCanvasMeta | undefined) ?? null
}

/** IndexedDB-backed local canvas store (meta + fig/thumb blobs). */
export function createIdbLocalCanvasStore(databaseName = DB_NAME): LocalCanvasStore {
  let dbPromise: Promise<IDBDatabase> | null = null

  function db() {
    if (!dbPromise) dbPromise = openDb(databaseName)
    return dbPromise
  }

  async function readBlob(storeName: string, key: string): Promise<Uint8Array | null> {
    const database = await db()
    const tx = database.transaction(storeName, 'readonly')
    const row = await reqToPromise(tx.objectStore(storeName).get(key))
    await txDone(tx)
    return rowToBytes(row)
  }

  return {
    async listMetas(includeTombstones = false) {
      const database = await db()
      const tx = database.transaction(STORE_META, 'readonly')
      const all = (await reqToPromise(tx.objectStore(STORE_META).getAll())) as LocalCanvasMeta[]
      await txDone(tx)
      return sortAndFilterMetas(all, includeTombstones)
    },

    async getMeta(locator) {
      const key = localCanvasKey(locator)
      const database = await db()
      const tx = database.transaction(STORE_META, 'readonly')
      const row = (await reqToPromise(tx.objectStore(STORE_META).get(key))) as
        | LocalCanvasMeta
        | undefined
      await txDone(tx)
      return row ?? null
    },

    async readFig(locator) {
      return readBlob(STORE_FIG, localCanvasKey(locator))
    },

    async readThumb(locator) {
      return readBlob(STORE_THUMB, localCanvasKey(locator))
    },

    async writeCanvas(input: LocalCanvasWriteInput) {
      const key = localCanvasKey(localCanvasBinding(input))
      const database = await db()
      const tx = database.transaction([STORE_META, STORE_FIG, STORE_THUMB], 'readwrite')
      const figStore = tx.objectStore(STORE_FIG)
      const thumbStore = tx.objectStore(STORE_THUMB)
      const metaStore = tx.objectStore(STORE_META)
      const existing = await readMetaRow(metaStore, key)

      let hasThumb = existing?.hasThumb ?? false
      figStore.put(bytesToBuffer(input.figBytes), key)

      if (input.thumbBytes != null) {
        if (input.thumbBytes.byteLength > 0) {
          thumbStore.put(bytesToBuffer(input.thumbBytes), key)
          hasThumb = true
        } else {
          thumbStore.delete(key)
          hasThumb = false
        }
      }

      const meta = buildWriteMeta(input, existing, hasThumb)
      metaStore.put(meta)
      await txDone(tx)
      return meta
    },

    async upsertIndexMeta(input) {
      const key = localCanvasKey(localCanvasBinding(input))
      const database = await db()
      const tx = database.transaction(STORE_META, 'readwrite')
      const store = tx.objectStore(STORE_META)
      const existing = await readMetaRow(store, key)
      const meta = buildIndexMeta(input, existing)
      store.put(meta)
      await txDone(tx)
      return meta
    },

    async recordConflictCopy(originalLocator, input, options) {
      const originalBinding = resolveLocalCanvasLocator(originalLocator)
      const originalKey = localCanvasKey(originalBinding)
      const copyKey = localCanvasKey({ ...originalBinding, documentId: input.copy.id })
      const database = await db()
      const tx = database.transaction(STORE_META, 'readwrite')
      const store = tx.objectStore(STORE_META)
      const [existingOriginal, existingCopy] = await Promise.all([
        readMetaRow(store, originalKey),
        readMetaRow(store, copyKey)
      ])
      if (
        options !== undefined &&
        !localCanvasMetaMatchesUpdateOptions(existingOriginal, options)
      ) {
        await txDone(tx)
        return null
      }
      const record = buildConflictCopyMetas(originalBinding, input, existingOriginal, existingCopy)
      if (record.original) store.put(record.original)
      store.put(record.copy)
      await txDone(tx)
      return record
    },

    async writeThumb(locator, thumbBytes: Uint8Array) {
      const key = localCanvasKey(locator)
      const database = await db()
      const tx = database.transaction([STORE_META, STORE_THUMB], 'readwrite')
      const metaStore = tx.objectStore(STORE_META)
      const existing = await readMetaRow(metaStore, key)
      if (!existing) {
        await txDone(tx)
        return null
      }
      tx.objectStore(STORE_THUMB).put(bytesToBuffer(thumbBytes), key)
      // Thumb freshness is tracked by its own outbox job — never demote the
      // document's syncStatus here (it orphaned rows as 'pending' forever).
      const meta: LocalCanvasMeta = {
        ...existing,
        hasThumb: true
      }
      metaStore.put(meta)
      await txDone(tx)
      return meta
    },

    async updateMeta(locator, patch: Partial<LocalCanvasMeta>, options) {
      const key = localCanvasKey(locator)
      const database = await db()
      const tx = database.transaction(STORE_META, 'readwrite')
      const store = tx.objectStore(STORE_META)
      const existing = await readMetaRow(store, key)
      if (!localCanvasMetaMatchesUpdateOptions(existing, options)) {
        await txDone(tx)
        return null
      }
      const next = {
        ...existing,
        ...patch,
        key: existing.key,
        id: existing.id,
        providerId: existing.providerId,
        profileId: existing.profileId,
        authority: existing.authority
      }
      store.put(next)
      await txDone(tx)
      return next
    },

    async adoptAuthority(locator, nextAuthority, options) {
      const key = localCanvasKey(locator)
      const database = await db()
      const tx = database.transaction(STORE_META, 'readwrite')
      const store = tx.objectStore(STORE_META)
      const next = buildAdoptedAuthorityMeta(await readMetaRow(store, key), nextAuthority, options)
      if (next) store.put(next)
      await txDone(tx)
      return next
    },

    async migrateLegacyAuthority(locator, nextAuthority, options) {
      const { sourceKey, targetKey } = legacyAuthorityMigrationKeys(locator, nextAuthority)
      const database = await db()
      const tx = database.transaction([STORE_META, STORE_FIG, STORE_THUMB], 'readwrite')
      const metaStore = tx.objectStore(STORE_META)
      const figStore = tx.objectStore(STORE_FIG)
      const thumbStore = tx.objectStore(STORE_THUMB)
      const [existing, targetMeta, sourceFig, targetFig, sourceThumb, targetThumb] =
        await Promise.all([
          readMetaRow(metaStore, sourceKey),
          readMetaRow(metaStore, targetKey),
          reqToPromise(figStore.get(sourceKey)),
          reqToPromise(figStore.get(targetKey)),
          reqToPromise(thumbStore.get(sourceKey)),
          reqToPromise(thumbStore.get(targetKey))
        ])
      if (existing?.authority !== null || existing.revision !== options.expectedRevision) {
        await txDone(tx)
        return null
      }
      if (targetMeta || targetFig !== undefined || targetThumb !== undefined) {
        tx.abort()
        await txDone(tx).catch(() => undefined)
        throw new Error('Legacy storage migration target already exists')
      }

      const next: LocalCanvasMeta = {
        ...existing,
        key: targetKey,
        authority: { ...nextAuthority }
      }
      metaStore.put(next)
      if (sourceFig !== undefined) figStore.put(sourceFig, targetKey)
      if (sourceThumb !== undefined) thumbStore.put(sourceThumb, targetKey)
      metaStore.delete(sourceKey)
      figStore.delete(sourceKey)
      thumbStore.delete(sourceKey)
      await txDone(tx)
      return next
    },

    async tombstone(locator) {
      return this.updateMeta(locator, {
        tombstoned: true,
        syncStatus: 'pending',
        updatedAt: new Date().toISOString()
      })
    },

    async clearFig(locator) {
      const key = localCanvasKey(locator)
      const database = await db()
      const tx = database.transaction([STORE_META, STORE_FIG], 'readwrite')
      const metaStore = tx.objectStore(STORE_META)
      const existing = await readMetaRow(metaStore, key)
      if (!existing) {
        await txDone(tx)
        return null
      }
      tx.objectStore(STORE_FIG).delete(key)
      const meta: LocalCanvasMeta = { ...existing, hasFig: false, figSize: 0 }
      metaStore.put(meta)
      await txDone(tx)
      return meta
    },

    async remove(locator) {
      const key = localCanvasKey(locator)
      const database = await db()
      const tx = database.transaction([STORE_META, STORE_FIG, STORE_THUMB], 'readwrite')
      tx.objectStore(STORE_META).delete(key)
      tx.objectStore(STORE_FIG).delete(key)
      tx.objectStore(STORE_THUMB).delete(key)
      await txDone(tx)
    },

    async clearAll() {
      const database = await db()
      const tx = database.transaction([STORE_META, STORE_FIG, STORE_THUMB], 'readwrite')
      tx.objectStore(STORE_META).clear()
      tx.objectStore(STORE_FIG).clear()
      tx.objectStore(STORE_THUMB).clear()
      await txDone(tx)
    }
  }
}
