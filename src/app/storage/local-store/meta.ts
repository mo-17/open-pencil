import {
  storageDocumentAuthoritiesEqual,
  storageDocumentKey,
  type StorageDocumentBinding
} from '@/app/integrations/storage/types'
import { localCanvasBinding } from '@/app/storage/local-store/identity'
import type {
  LocalCanvasConflictCopyInput,
  LocalCanvasConflictCopyRecord,
  LocalCanvasIndexInput,
  LocalCanvasMeta,
  LocalCanvasWriteInput,
  AdoptLocalCanvasAuthorityOptions,
  UpdateLocalCanvasMetaOptions
} from '@/app/storage/local-store/types'

export function localCanvasMetaMatchesUpdateOptions(
  meta: LocalCanvasMeta | null | undefined,
  options?: UpdateLocalCanvasMetaOptions
): meta is LocalCanvasMeta {
  return Boolean(
    meta &&
    (options?.expectedRevision == null || meta.revision === options.expectedRevision) &&
    (options?.expectedAuthority === undefined ||
      storageDocumentAuthoritiesEqual(options.expectedAuthority, meta.authority))
  )
}

export function buildAdoptedAuthorityMeta(
  existing: LocalCanvasMeta | null | undefined,
  nextAuthority: StorageDocumentBinding['authority'],
  options: AdoptLocalCanvasAuthorityOptions
): LocalCanvasMeta | null {
  if (
    !nextAuthority ||
    nextAuthority.accountId !== options.expectedAuthority.accountId ||
    nextAuthority.authorizationVersion === options.expectedAuthority.authorizationVersion ||
    !localCanvasMetaMatchesUpdateOptions(existing, options)
  ) {
    return null
  }
  return { ...existing, authority: { ...nextAuthority } }
}

function baseMeta(input: LocalCanvasWriteInput | LocalCanvasIndexInput) {
  const binding = localCanvasBinding(input)
  return {
    key: storageDocumentKey(binding),
    id: input.id,
    providerId: binding.providerId,
    profileId: binding.profileId,
    authority: binding.authority ?? null,
    name: input.name
  }
}

export function buildConflictCopyMetas(
  originalBinding: StorageDocumentBinding,
  input: LocalCanvasConflictCopyInput,
  existingOriginal: LocalCanvasMeta | null,
  existingCopy: LocalCanvasMeta | null
): LocalCanvasConflictCopyRecord {
  const copy = buildIndexMeta(
    {
      ...input.copy,
      providerId: originalBinding.providerId,
      profileId: originalBinding.profileId,
      authority: originalBinding.authority ?? null,
      conflictCopyDocumentId: undefined,
      conflictOfDocumentId: originalBinding.documentId,
      // A replayed terminal result must not hide bytes downloaded after the first record.
      hasFig: existingCopy?.hasFig ?? false
    },
    existingCopy
  )
  const original = existingOriginal
    ? {
        ...existingOriginal,
        syncStatus: 'conflict' as const,
        remoteRevision: input.originalRemoteRevision,
        lastSyncError: input.originalLastSyncError,
        conflictCopyDocumentId: copy.id
      }
    : null
  return { original, copy }
}

/** Newest-first, tombstones hidden unless asked for. */
export function sortAndFilterMetas(
  all: LocalCanvasMeta[],
  includeTombstones: boolean
): LocalCanvasMeta[] {
  const filtered = includeTombstones ? all : all.filter((m) => !m.tombstoned)
  return filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** Meta row for a full canvas write (fig bytes present). */
export function buildWriteMeta(
  input: LocalCanvasWriteInput,
  existing: LocalCanvasMeta | null,
  hasThumb: boolean
): LocalCanvasMeta {
  return {
    ...baseMeta(input),
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    revision: input.revision ?? (existing ? existing.revision + 1 : 1),
    syncStatus: input.syncStatus ?? 'pending',
    lastSyncedAt: existing?.lastSyncedAt ?? null,
    lastSyncError: input.syncStatus === 'synced' ? null : (existing?.lastSyncError ?? null),
    remoteRevision:
      input.remoteRevision === undefined
        ? (existing?.remoteRevision ?? null)
        : input.remoteRevision,
    // A deleted canvas stays deleted — an in-flight autosave must not resurrect it
    tombstoned: existing?.tombstoned ?? false,
    hasFig: true,
    hasThumb,
    figSize: input.figBytes.byteLength,
    lastOpenedAt: existing?.lastOpenedAt,
    conflictCopyDocumentId: existing?.conflictCopyDocumentId,
    conflictOfDocumentId: existing?.conflictOfDocumentId
  }
}

/** Meta row for an index-only upsert (remote canvas, no local fig). */
export function buildIndexMeta(
  input: LocalCanvasIndexInput,
  existing: LocalCanvasMeta | null
): LocalCanvasMeta {
  return {
    ...baseMeta(input),
    updatedAt: input.updatedAt,
    revision: input.revision ?? existing?.revision ?? 1,
    syncStatus: input.syncStatus,
    lastSyncedAt: input.lastSyncedAt,
    lastSyncError: input.lastSyncError,
    remoteRevision:
      input.remoteRevision === undefined
        ? (existing?.remoteRevision ?? null)
        : input.remoteRevision,
    tombstoned: false,
    hasFig: input.hasFig ?? existing?.hasFig ?? false,
    hasThumb: input.hasThumb ?? existing?.hasThumb ?? false,
    conflictCopyDocumentId: input.conflictCopyDocumentId ?? existing?.conflictCopyDocumentId,
    conflictOfDocumentId: input.conflictOfDocumentId ?? existing?.conflictOfDocumentId
  }
}
