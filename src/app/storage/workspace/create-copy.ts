import {
  GOOGLE_DRIVE_STORAGE_PROVIDER_ID,
  createActiveStorageAdapter,
  storageDocumentAuthoritiesEqual,
  storageDocumentAuthorityMatches,
  type StorageAdapter,
  type StorageDocumentAuthority,
  type StorageDocumentBinding
} from '@/app/integrations/storage'
import { assertCloudStorageDurability } from '@/app/storage/durability'
import {
  getLocalCanvasStore,
  type LocalCanvasMeta,
  type LocalCanvasStore
} from '@/app/storage/local-store'
import {
  withStorageProfileMutationLease,
  type StorageProfileMutationLease
} from '@/app/storage/mutation-drain'
import {
  kickSyncEngine,
  persistStorageCanvasLocally,
  type PersistStorageCanvasOptions
} from '@/app/storage/sync'
import { emitStorageWorkspaceEvent } from '@/app/storage/workspace/events'

export type GoogleDriveDocumentCopyInput = Readonly<{
  profileId: string
  authority: StorageDocumentAuthority
  name: string
  figBytes: Uint8Array
  signal?: AbortSignal
}>

export type StorageDocumentCopyInput = GoogleDriveDocumentCopyInput &
  Readonly<{ providerId: string }>

export type GoogleDriveDocumentCopyResult = Readonly<{
  binding: StorageDocumentBinding
  revision: number
  queueState: 'queued' | 'recovery-pending'
}>

export type StorageDocumentCopyResult = GoogleDriveDocumentCopyResult

export type GoogleDriveDocumentCopyErrorCode =
  | 'authorization-changed'
  | 'id-collision'
  | 'reservation-unsupported'

export type StorageDocumentCopyErrorCode = GoogleDriveDocumentCopyErrorCode

function copyErrorMessage(code: StorageDocumentCopyErrorCode): string {
  switch (code) {
    case 'authorization-changed':
      return 'Storage authorization changed before the copy could be queued'
    case 'id-collision':
      return 'The storage provider returned a document ID that is already present locally'
    case 'reservation-unsupported':
      return 'The storage provider cannot reserve a document ID in this build'
  }
  throw new TypeError(`Unknown storage copy error code: ${String(code)}`)
}

export class StorageDocumentCopyError extends Error {
  constructor(readonly code: StorageDocumentCopyErrorCode) {
    super(copyErrorMessage(code))
    this.name = 'StorageDocumentCopyError'
  }
}

/** @deprecated Use StorageDocumentCopyError for provider-neutral copy flows. */
export { StorageDocumentCopyError as GoogleDriveDocumentCopyError }

export type GoogleDriveDocumentCopyDependencies = Readonly<{
  assertDurability(): Promise<void>
  createAdapter(profileId: string, providerId?: string): StorageAdapter
  store: Pick<LocalCanvasStore, 'getMeta'>
  persist(options: PersistStorageCanvasOptions): Promise<{ revision: number }>
  withLease<T>(
    scope: { providerId: string; profileId: string },
    operation: (lease: StorageProfileMutationLease) => Promise<T>
  ): Promise<T>
  recover(): void
  emit(binding: StorageDocumentBinding): void
  warn(reason: unknown): void
}>

export type StorageDocumentCopyDependencies = GoogleDriveDocumentCopyDependencies

function defaultDependencies(): StorageDocumentCopyDependencies {
  return {
    assertDurability: assertCloudStorageDurability,
    createAdapter(profileId, providerId = GOOGLE_DRIVE_STORAGE_PROVIDER_ID) {
      return createActiveStorageAdapter(providerId, profileId)
    },
    store: getLocalCanvasStore(),
    persist: persistStorageCanvasLocally,
    withLease: withStorageProfileMutationLease,
    recover() {
      void kickSyncEngine()
    },
    emit(binding) {
      emitStorageWorkspaceEvent({
        providerId: binding.providerId,
        documentId: binding.documentId,
        kind: 'changed'
      })
    },
    warn(reason) {
      console.warn('[Storage] Cloud copy was saved locally but its outbox enqueue failed:', reason)
    }
  }
}

function committedCopy(
  metadata: LocalCanvasMeta | null,
  binding: StorageDocumentBinding,
  name: string
): metadata is LocalCanvasMeta {
  return (
    metadata !== null &&
    metadata.id === binding.documentId &&
    metadata.providerId === binding.providerId &&
    metadata.profileId === binding.profileId &&
    storageDocumentAuthoritiesEqual(metadata.authority, binding.authority) &&
    metadata.name === name &&
    metadata.hasFig &&
    !metadata.tombstoned &&
    metadata.syncStatus === 'pending'
  )
}

function normalizedDocumentName(name: string): string {
  return name.trim() || 'Untitled'
}

/**
 * Save a new cloud document to the durable local mirror, then queue its background upload.
 * Returning `queued` does not claim that the remote provider has already received the bytes.
 */
export async function queueStorageDocumentCopy(
  input: StorageDocumentCopyInput,
  dependencies?: StorageDocumentCopyDependencies
): Promise<StorageDocumentCopyResult> {
  const runtime = dependencies ?? defaultDependencies()
  await runtime.assertDurability()
  const scope = {
    providerId: input.providerId,
    profileId: input.profileId
  }
  const name = normalizedDocumentName(input.name)

  return runtime.withLease(scope, async (lease) => {
    input.signal?.throwIfAborted()
    const adapter = runtime.createAdapter(input.profileId, input.providerId)
    const currentAuthority = (await adapter.getAuthority?.({ signal: input.signal })) ?? null
    if (!storageDocumentAuthorityMatches(input.authority, currentAuthority)) {
      throw new StorageDocumentCopyError('authorization-changed')
    }
    if (!adapter.reserveDocumentId) {
      throw new StorageDocumentCopyError('reservation-unsupported')
    }

    const documentId = await adapter.reserveDocumentId({
      signal: input.signal,
      expectedAuthority: input.authority
    })
    const binding: StorageDocumentBinding = {
      providerId: input.providerId,
      profileId: input.profileId,
      documentId,
      authority: input.authority
    }
    if (await runtime.store.getMeta(binding)) {
      throw new StorageDocumentCopyError('id-collision')
    }

    // This is the final cancellation point. Once the local row is committed, report its
    // recoverable state even if the caller changes tabs, profiles, or aborts the UI operation.
    input.signal?.throwIfAborted()
    try {
      const persisted = await runtime.persist({
        providerId: binding.providerId,
        profileId: binding.profileId,
        authority: binding.authority,
        canvasId: binding.documentId,
        name,
        figBytes: input.figBytes,
        mutationLease: lease
      })
      return { binding, revision: persisted.revision, queueState: 'queued' }
    } catch (reason) {
      let metadata: LocalCanvasMeta | null = null
      try {
        metadata = await runtime.store.getMeta(binding)
      } catch (inspectionError) {
        console.warn('[Storage] Could not inspect the cloud copy commit state:', inspectionError)
      }
      if (!committedCopy(metadata, binding, name)) throw reason
      runtime.warn(reason)
      runtime.emit(binding)
      runtime.recover()
      return { binding, revision: metadata.revision, queueState: 'recovery-pending' }
    }
  })
}

export async function queueGoogleDriveDocumentCopy(
  input: GoogleDriveDocumentCopyInput,
  dependencies?: GoogleDriveDocumentCopyDependencies
): Promise<GoogleDriveDocumentCopyResult> {
  return queueStorageDocumentCopy(
    { ...input, providerId: GOOGLE_DRIVE_STORAGE_PROVIDER_ID },
    dependencies
  )
}
