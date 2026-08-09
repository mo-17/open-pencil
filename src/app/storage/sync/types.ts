import {
  storageDocumentKey,
  type StorageDocumentBinding,
  type StorageDocumentBindingInput,
  type StorageRemoteRevision
} from '@/app/integrations/storage/types'

export type OutboxJobType = 'putCanvas' | 'putThumb' | 'deleteCanvas'

export type OutboxJob = {
  id: string
  binding: StorageDocumentBinding
  type: OutboxJobType
  /** Local revision for putCanvas; used to supersede older puts. */
  revision: number
  createdAt: number
  attempts: number
  nextAttemptAt: number
  /** Remote version observed before this local mutation; null means unsupported/new. */
  expectedRemoteRevision: StorageRemoteRevision | null
}

export type SyncUiState = 'idle' | 'syncing' | 'offline' | 'error'

/** Pure helper: drop older putCanvas jobs for same canvas when a newer revision is enqueued. */
export function supersedePutCanvasJobs(
  jobs: OutboxJob[],
  binding: StorageDocumentBindingInput,
  revision: number
): OutboxJob[] {
  const key = storageDocumentKey(binding)
  return jobs.filter((job) => {
    if (storageDocumentKey(job.binding) !== key || job.type !== 'putCanvas') return true
    return job.revision >= revision
  })
}

export function makeJobId(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}
