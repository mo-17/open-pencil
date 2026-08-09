import {
  storageDocumentAuthoritiesEqual,
  type StorageDocumentBinding
} from '@/app/integrations/storage'
import type { LocalCanvasMeta, LocalCanvasStore } from '@/app/storage/local-store'
import type { OutboxJob } from '@/app/storage/sync/types'

export function storageSyncMetaHasExactAuthority(
  meta: LocalCanvasMeta,
  binding: StorageDocumentBinding
): boolean {
  return storageDocumentAuthoritiesEqual(meta.authority, binding.authority)
}

export function storageSyncMetaMatchesJob(
  meta: LocalCanvasMeta | null,
  job: OutboxJob
): meta is LocalCanvasMeta {
  return Boolean(
    meta && meta.revision === job.revision && storageSyncMetaHasExactAuthority(meta, job.binding)
  )
}

export type StorageSyncPutSnapshot = Readonly<{
  meta: LocalCanvasMeta
  fig: Uint8Array
}>

/** Read a byte snapshot only while metadata still belongs to this exact job/grant. */
export async function readStorageSyncPutSnapshot(
  store: LocalCanvasStore,
  job: OutboxJob
): Promise<StorageSyncPutSnapshot | null> {
  const before = await store.getMeta(job.binding)
  if (!storageSyncMetaMatchesJob(before, job) || before.tombstoned || !before.hasFig) return null
  const fig = await store.readFig(job.binding)
  const after = await store.getMeta(job.binding)
  if (!storageSyncMetaMatchesJob(after, job) || after.tombstoned || !after.hasFig) return null
  if (!fig || fig.byteLength === 0) throw new Error('Local document missing for sync')
  return { meta: after, fig }
}

export async function currentStorageSyncJobMeta(
  store: LocalCanvasStore,
  job: OutboxJob
): Promise<LocalCanvasMeta | null> {
  const meta = await store.getMeta(job.binding)
  return storageSyncMetaMatchesJob(meta, job) ? meta : null
}

export async function updateStorageSyncMetaForJob(
  store: LocalCanvasStore,
  job: OutboxJob,
  patch: Partial<LocalCanvasMeta>
): Promise<LocalCanvasMeta | null> {
  const current = await store.getMeta(job.binding)
  if (!current || !storageSyncMetaHasExactAuthority(current, job.binding)) return null
  if (job.type !== 'deleteCanvas' && current.revision !== job.revision) return null
  if (job.type === 'deleteCanvas' && !current.tombstoned) return null
  return store.updateMeta(job.binding, patch, {
    expectedRevision: current.revision,
    expectedAuthority: job.binding.authority ?? null
  })
}

export function storageSyncAuthorityOptions(binding: StorageDocumentBinding) {
  return binding.authority ? { expectedAuthority: binding.authority } : {}
}
