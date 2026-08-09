import {
  legacyAuthorityMigrationKeys,
  localCanvasBinding,
  localCanvasKey,
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

/** In-memory store for unit tests and environments without IndexedDB. */
export function createMemoryLocalCanvasStore(): LocalCanvasStore {
  const metas = new Map<string, LocalCanvasMeta>()
  const figs = new Map<string, Uint8Array>()
  const thumbs = new Map<string, Uint8Array>()

  return {
    async listMetas(includeTombstones = false) {
      return sortAndFilterMetas([...metas.values()], includeTombstones)
    },

    async getMeta(locator) {
      return metas.get(localCanvasKey(locator)) ?? null
    },

    async readFig(locator) {
      const bytes = figs.get(localCanvasKey(locator))
      return bytes ? new Uint8Array(bytes) : null
    },

    async readThumb(locator) {
      const bytes = thumbs.get(localCanvasKey(locator))
      return bytes ? new Uint8Array(bytes) : null
    },

    async writeCanvas(input: LocalCanvasWriteInput) {
      const key = localCanvasKey(localCanvasBinding(input))
      const existing = metas.get(key) ?? null
      figs.set(key, new Uint8Array(input.figBytes))

      let hasThumb = existing?.hasThumb ?? false
      if (input.thumbBytes != null) {
        if (input.thumbBytes.byteLength > 0) {
          thumbs.set(key, new Uint8Array(input.thumbBytes))
          hasThumb = true
        } else {
          thumbs.delete(key)
          hasThumb = false
        }
      }

      const meta = buildWriteMeta(input, existing, hasThumb)
      metas.set(key, meta)
      return meta
    },

    async upsertIndexMeta(input) {
      const key = localCanvasKey(localCanvasBinding(input))
      const meta = buildIndexMeta(input, metas.get(key) ?? null)
      metas.set(key, meta)
      return meta
    },

    async recordConflictCopy(originalLocator, input, options) {
      const originalBinding = resolveLocalCanvasLocator(originalLocator)
      const originalKey = localCanvasKey(originalBinding)
      const copyKey = localCanvasKey({ ...originalBinding, documentId: input.copy.id })
      const existingOriginal = metas.get(originalKey) ?? null
      if (
        options !== undefined &&
        !localCanvasMetaMatchesUpdateOptions(existingOriginal, options)
      ) {
        return null
      }
      const record = buildConflictCopyMetas(
        originalBinding,
        input,
        existingOriginal,
        metas.get(copyKey) ?? null
      )
      if (record.original) metas.set(originalKey, record.original)
      metas.set(copyKey, record.copy)
      return record
    },

    async writeThumb(locator, thumbBytes: Uint8Array) {
      const key = localCanvasKey(locator)
      const existing = metas.get(key)
      if (!existing) return null
      thumbs.set(key, new Uint8Array(thumbBytes))
      // Thumb freshness is tracked by its own outbox job — never demote the
      // document's syncStatus here (it orphaned rows as 'pending' forever).
      const meta: LocalCanvasMeta = {
        ...existing,
        hasThumb: true
      }
      metas.set(key, meta)
      return meta
    },

    async updateMeta(locator, patch: Partial<LocalCanvasMeta>, options) {
      const key = localCanvasKey(locator)
      const existing = metas.get(key)
      if (!localCanvasMetaMatchesUpdateOptions(existing, options)) {
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
      metas.set(key, next)
      return next
    },

    async adoptAuthority(locator, nextAuthority, options) {
      const key = localCanvasKey(locator)
      const next = buildAdoptedAuthorityMeta(metas.get(key), nextAuthority, options)
      if (!next) return null
      metas.set(key, next)
      return next
    },

    async migrateLegacyAuthority(locator, nextAuthority, options) {
      const { sourceKey, targetKey } = legacyAuthorityMigrationKeys(locator, nextAuthority)
      const existing = metas.get(sourceKey)
      if (existing?.authority !== null || existing.revision !== options.expectedRevision) {
        return null
      }
      if (metas.has(targetKey) || figs.has(targetKey) || thumbs.has(targetKey)) {
        throw new Error('Legacy storage migration target already exists')
      }

      const next: LocalCanvasMeta = {
        ...existing,
        key: targetKey,
        authority: { ...nextAuthority }
      }
      const fig = figs.get(sourceKey)
      const thumb = thumbs.get(sourceKey)
      metas.set(targetKey, next)
      if (fig) figs.set(targetKey, new Uint8Array(fig))
      if (thumb) thumbs.set(targetKey, new Uint8Array(thumb))
      metas.delete(sourceKey)
      figs.delete(sourceKey)
      thumbs.delete(sourceKey)
      return next
    },

    async tombstone(locator) {
      const key = localCanvasKey(locator)
      const existing = metas.get(key)
      if (!existing) return null
      const next: LocalCanvasMeta = {
        ...existing,
        tombstoned: true,
        syncStatus: 'pending',
        updatedAt: new Date().toISOString()
      }
      metas.set(key, next)
      return next
    },

    async clearFig(locator) {
      const key = localCanvasKey(locator)
      const existing = metas.get(key)
      if (!existing) return null
      figs.delete(key)
      const meta: LocalCanvasMeta = { ...existing, hasFig: false, figSize: 0 }
      metas.set(key, meta)
      return meta
    },

    async remove(locator) {
      const key = localCanvasKey(locator)
      metas.delete(key)
      figs.delete(key)
      thumbs.delete(key)
    },

    async clearAll() {
      metas.clear()
      figs.clear()
      thumbs.clear()
    }
  }
}
