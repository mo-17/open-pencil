import {
  storageDocumentAuthoritiesEqual,
  type StorageDocumentBinding
} from '@/app/integrations/storage'
import { assertCloudStorageDurability } from '@/app/storage/durability'
import {
  getLocalCanvasStore,
  type LocalCanvasMeta,
  type LocalCanvasStore
} from '@/app/storage/local-store'
import { withStorageProfileMutationLease } from '@/app/storage/mutation-drain'
import { enqueueDeleteCanvas } from '@/app/storage/sync'

export type StorageDocumentDeletionResult = Readonly<{
  metadata: LocalCanvasMeta
  queueState: 'queued' | 'recovery-pending'
}>

export class StorageDocumentDeletionError extends Error {
  constructor(readonly code: 'missing' | 'changed') {
    super(
      code === 'missing'
        ? 'The local storage document index is missing'
        : 'The storage document changed before deletion could be recorded'
    )
    this.name = 'StorageDocumentDeletionError'
  }
}

export type StorageDocumentDeletionDependencies = Readonly<{
  store: LocalCanvasStore
  enqueue(binding: StorageDocumentBinding): Promise<void>
  now(): Date
  warn(reason: unknown): void
}>

function defaultDependencies(): StorageDocumentDeletionDependencies {
  return {
    store: getLocalCanvasStore(),
    enqueue: enqueueDeleteCanvas,
    now: () => new Date(),
    warn(reason) {
      console.warn('[Storage] Delete was persisted locally but its outbox enqueue failed:', reason)
    }
  }
}

/**
 * Persist the delete intent before touching the provider. The tombstone remains
 * recoverable if the outbox write fails or the app closes in the small gap.
 */
export async function queueStorageDocumentDeletion(
  binding: StorageDocumentBinding,
  dependencies?: StorageDocumentDeletionDependencies
): Promise<StorageDocumentDeletionResult> {
  // Supplying dependencies is an explicit test seam; production tombstones must survive restart.
  if (dependencies === undefined) await assertCloudStorageDurability()
  const runtime = dependencies ?? defaultDependencies()
  return withStorageProfileMutationLease(binding, async () => {
    const existing = await runtime.store.getMeta(binding)
    if (!existing) throw new StorageDocumentDeletionError('missing')
    if (!storageDocumentAuthoritiesEqual(existing.authority, binding.authority)) {
      throw new StorageDocumentDeletionError('changed')
    }

    const metadata = existing.tombstoned
      ? existing
      : await runtime.store.updateMeta(
          binding,
          {
            tombstoned: true,
            syncStatus: 'pending',
            lastSyncError: null,
            updatedAt: runtime.now().toISOString()
          },
          {
            expectedRevision: existing.revision,
            expectedAuthority: binding.authority ?? null
          }
        )
    if (!metadata) throw new StorageDocumentDeletionError('changed')

    try {
      await runtime.enqueue(binding)
      return { metadata, queueState: 'queued' }
    } catch (reason) {
      runtime.warn(reason)
      return { metadata, queueState: 'recovery-pending' }
    }
  })
}
