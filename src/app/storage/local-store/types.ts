import type {
  StorageDocumentAuthority,
  StorageProviderID,
  StorageRemoteRevision
} from '@/app/integrations/storage/types'

export type LocalSyncStatus = 'synced' | 'pending' | 'error' | 'conflict'

/** Metadata for a stored canvas cached on device (document bytes stored separately). */
export type LocalCanvasMeta = {
  /** Provider/profile/document composite key used by the local persistence layer. */
  key: string
  id: string
  providerId: StorageProviderID
  profileId: string
  authority: StorageDocumentAuthority | null
  name: string
  updatedAt: string
  /** Monotonic local revision; increments on each local write. */
  revision: number
  syncStatus: LocalSyncStatus
  lastSyncedAt: string | null
  lastSyncError: string | null
  /** Provider-owned revision returned by the last successful remote read/write. */
  remoteRevision: StorageRemoteRevision | null
  /** Soft-deleted; hidden from UI until remote delete completes. */
  tombstoned: boolean
  hasFig: boolean
  hasThumb: boolean
  /** Size of the cached fig blob in bytes (set on write; backfilled by eviction). */
  figSize?: number
  /** Last time this canvas was opened on this device (LRU eviction key). */
  lastOpenedAt?: string
  /** Latest provider-created preserved copy for this conflicted original. */
  conflictCopyDocumentId?: string
  /** Original document whose local edit was preserved in this provider-created copy. */
  conflictOfDocumentId?: string
}

export type UpdateLocalCanvasMetaOptions = {
  /** Apply only if the row still has this revision. */
  expectedRevision?: number
  /** Apply only while the same account/grant (or provider-managed null authority) owns the row. */
  expectedAuthority?: StorageDocumentAuthority | null
}

export type AdoptLocalCanvasAuthorityOptions = {
  expectedAuthority: StorageDocumentAuthority
  expectedRevision: number
}

export type MigrateLegacyLocalCanvasAuthorityOptions = {
  /** Prevent a migration from moving a row that changed after inspection. */
  expectedRevision: number
}

/** Index-only row for remote canvases not yet downloaded (no fig body). */
export type LocalCanvasIndexInput = Omit<
  LocalCanvasMeta,
  | 'key'
  | 'profileId'
  | 'authority'
  | 'remoteRevision'
  | 'hasFig'
  | 'hasThumb'
  | 'tombstoned'
  | 'revision'
> & {
  profileId?: string
  authority?: StorageDocumentAuthority | null
  remoteRevision?: StorageRemoteRevision | null
  revision?: number
  hasFig?: boolean
  hasThumb?: boolean
}

export type LocalCanvasWriteInput = {
  id: string
  providerId: StorageProviderID
  profileId?: string
  authority?: StorageDocumentAuthority | null
  name: string
  updatedAt?: string
  figBytes: Uint8Array
  thumbBytes?: Uint8Array | null
  /** If set, keep this revision; otherwise increment from existing. */
  revision?: number
  syncStatus?: LocalSyncStatus
  /** Omitted preserves the existing remote revision; null explicitly clears it. */
  remoteRevision?: StorageRemoteRevision | null
}

/** Atomically indexes a provider-created conflict copy and marks its original conflicted. */
export type LocalCanvasConflictCopyInput = {
  copy: LocalCanvasIndexInput
  originalRemoteRevision: StorageRemoteRevision | null
  originalLastSyncError: string
}

export type LocalCanvasConflictCopyRecord = {
  original: LocalCanvasMeta | null
  copy: LocalCanvasMeta
}
