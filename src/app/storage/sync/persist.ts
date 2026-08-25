import { extractFigThumbnailFromReader } from '@open-pencil/fig'

import { readStoredStorageAuthority } from '@/app/integrations/storage/runtime'
import {
  resolveStorageDocumentBinding,
  storageDocumentAuthorityMatches,
  type StorageDocumentAuthority,
  type StorageDocumentBinding,
  type StorageProviderID,
  type StorageRemoteRevision
} from '@/app/integrations/storage/types'
import { evictLocalFigCache } from '@/app/storage/cache-eviction'
import { assertCloudStorageDurability } from '@/app/storage/durability'
import {
  getLocalCanvasStore,
  localCanvasKey,
  type LocalCanvasLocator,
  type LocalCanvasStore
} from '@/app/storage/local-store'
import {
  withStorageProfileMutationLease,
  type StorageProfileMutationLease
} from '@/app/storage/mutation-drain'
import { enqueuePutCanvas } from '@/app/storage/sync/engine'
import { emitStorageWorkspaceEvent } from '@/app/storage/workspace/events'

export type StoragePersistenceDependencies = {
  store: LocalCanvasStore
  readCurrentAuthority?(binding: StorageDocumentBinding): Promise<StorageDocumentAuthority | null>
  enqueueCanvas(
    locator: LocalCanvasLocator,
    revision: number,
    expectedRemoteRevision: StorageRemoteRevision | null
  ): Promise<void>
}

async function readCurrentAuthority(
  binding: StorageDocumentBinding
): Promise<StorageDocumentAuthority | null> {
  return readStoredStorageAuthority(binding.providerId, binding.profileId)
}

export type PersistStorageCanvasOptions = {
  providerId: StorageProviderID
  profileId?: string
  authority?: StorageDocumentAuthority
  canvasId: string
  name: string
  figBytes: Uint8Array
  /** Initial provider revision, when document identity was reserved remotely. */
  remoteRevision?: StorageRemoteRevision | null
  mutationLease?: StorageProfileMutationLease
}

/** Write locally before scheduling remote synchronization. */
export async function persistStorageCanvasLocally(
  options: PersistStorageCanvasOptions,
  dependencies?: StoragePersistenceDependencies
): Promise<{ revision: number }> {
  // Supplying dependencies is an explicit test seam; production persistence must survive restart.
  if (!dependencies) await assertCloudStorageDurability()
  const runtime = dependencies ?? {
    store: getLocalCanvasStore(),
    enqueueCanvas: enqueuePutCanvas
  }
  const binding = resolveStorageDocumentBinding({
    providerId: options.providerId,
    profileId: options.profileId,
    documentId: options.canvasId,
    ...(options.authority ? { authority: options.authority } : {})
  })
  return withStorageProfileMutationLease(
    binding,
    async () => {
      if (binding.authority) {
        const currentAuthority = runtime.readCurrentAuthority
          ? await runtime.readCurrentAuthority(binding)
          : await readCurrentAuthority(binding)
        if (!storageDocumentAuthorityMatches(binding.authority, currentAuthority)) {
          throw new Error(
            'Storage authorization changed. Reopen the document before saving to this account.'
          )
        }
      }
      const thumbnailBytes = await extractFigThumbnailFromReader({
        size: options.figBytes.byteLength,
        async read(start: number, endExclusive: number) {
          return options.figBytes.subarray(start, endExclusive)
        }
      })
      const metadata = await runtime.store.writeCanvas({
        id: binding.documentId,
        providerId: binding.providerId,
        profileId: binding.profileId,
        authority: binding.authority,
        name: options.name,
        figBytes: options.figBytes,
        thumbBytes: thumbnailBytes,
        syncStatus: 'pending',
        remoteRevision: options.remoteRevision
      })
      await runtime.enqueueCanvas(binding, metadata.revision, metadata.remoteRevision)
      emitStorageWorkspaceEvent({
        providerId: binding.providerId,
        documentId: binding.documentId,
        kind: 'changed'
      })
      return { revision: metadata.revision }
    },
    options.mutationLease
  )
}

export type SeedStorageCanvasOptions = {
  providerId: StorageProviderID
  profileId?: string
  authority?: StorageDocumentAuthority
  canvasId: string
  name: string
  updatedAt: string
  figBytes: Uint8Array
  thumbnailBytes?: Uint8Array | null
  markSynced?: boolean
  remoteRevision?: StorageRemoteRevision | null
}

export async function seedStorageCanvasFromRemote(
  options: SeedStorageCanvasOptions
): Promise<void> {
  await assertCloudStorageDurability()
  const binding = resolveStorageDocumentBinding({
    providerId: options.providerId,
    profileId: options.profileId,
    documentId: options.canvasId,
    ...(options.authority ? { authority: options.authority } : {})
  })
  await getLocalCanvasStore().writeCanvas({
    id: binding.documentId,
    providerId: binding.providerId,
    profileId: binding.profileId,
    authority: binding.authority,
    name: options.name,
    updatedAt: options.updatedAt,
    figBytes: options.figBytes,
    thumbBytes: options.thumbnailBytes,
    syncStatus: options.markSynced === false ? 'pending' : 'synced',
    remoteRevision: options.remoteRevision ?? null
  })
  if (options.markSynced === false) return
  await getLocalCanvasStore().updateMeta(binding, {
    lastSyncedAt: options.updatedAt || new Date().toISOString(),
    syncStatus: 'synced',
    lastSyncError: null
  })
  await evictLocalFigCache(new Set([localCanvasKey(binding)]))
}
