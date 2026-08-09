import { requireStorageProfileID, type StorageProviderID } from '@/app/integrations/storage/types'
import { getLocalCanvasStore } from '@/app/storage/local-store/store'
import type { LocalCanvasMeta } from '@/app/storage/local-store/types'
import { getOutbox } from '@/app/storage/sync/outbox'
import type { OutboxJob } from '@/app/storage/sync/types'

export class StorageProfileRemovalBlockedError extends Error {
  constructor() {
    super('Storage profile still owns unfinished authorization work')
    this.name = 'StorageProfileRemovalBlockedError'
  }
}

function belongsToProfile(
  providerId: StorageProviderID,
  profileId: string,
  candidate: { providerId: StorageProviderID; profileId: string }
): boolean {
  return candidate.providerId === providerId && candidate.profileId === profileId
}

/**
 * Deleting an identity that owns durable local work would make that work unreachable because
 * generated profile IDs are intentionally not reusable from the Settings UI.
 */
export function hasBlockingStorageProfileWork(
  providerId: StorageProviderID,
  profileId: string,
  metas: readonly LocalCanvasMeta[],
  jobs: readonly OutboxJob[]
): boolean {
  if (jobs.some((job) => belongsToProfile(providerId, profileId, job.binding))) return true
  return metas.some(
    (meta) =>
      belongsToProfile(providerId, profileId, meta) &&
      (meta.syncStatus !== 'synced' || meta.tombstoned)
  )
}

/** Read-only, fail-closed preflight. Call before removing credentials or profile preferences. */
export async function storageProfileRemovalBlocked(
  providerId: StorageProviderID,
  profileId: string
): Promise<boolean> {
  const id = requireStorageProfileID(profileId)
  const [metas, jobs] = await Promise.all([
    getLocalCanvasStore().listMetas(true),
    getOutbox().list()
  ])
  return hasBlockingStorageProfileWork(providerId, id, metas, jobs)
}
