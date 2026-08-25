import {
  resolveStorageDocumentBinding,
  storageDocumentAuthoritiesEqual,
  storageDocumentKey,
  type StorageDocumentAuthority,
  type StorageProviderID
} from '@/app/integrations/storage/types'
import { APP_DATABASE_NAMES, openIdb, reqToPromise, txDone } from '@/app/storage/idb'
import { legacyLocalCanvasBinding } from '@/app/storage/local-store/identity'
import { makeJobId, supersedePutCanvasJobs, type OutboxJob } from '@/app/storage/sync/types'

const DB_NAME = APP_DATABASE_NAMES.outbox
const DB_VERSION = 2
const STORE = 'jobs'
export type OutboxEnqueueInput = Omit<
  OutboxJob,
  'id' | 'createdAt' | 'attempts' | 'nextAttemptAt' | 'expectedRemoteRevision'
> & {
  id?: string
  attempts?: number
  nextAttemptAt?: number
  expectedRemoteRevision?: OutboxJob['expectedRemoteRevision']
}

export type Outbox = {
  list(): Promise<OutboxJob[]>
  enqueue(job: OutboxEnqueueInput): Promise<OutboxJob>
  update(job: OutboxJob): Promise<void>
  /** Atomically defer every existing job for one provider without creating new jobs. */
  deferProvider(providerId: StorageProviderID, notBefore: number): Promise<number>
  replaceAuthority(replacement: OutboxAuthorityReplacement): Promise<number>
  /** Atomically replace pre-generation S3 jobs with jobs bound to the first generation. */
  replaceLegacyAuthority(replacement: OutboxLegacyAuthorityReplacement): Promise<number>
  remove(id: string): Promise<void>
  clear(): Promise<void>
}

export type OutboxAuthorityReplacement = {
  providerId: StorageProviderID
  profileId: string
  expectedAuthority: StorageDocumentAuthority
  nextAuthority: StorageDocumentAuthority
}

export type OutboxLegacyAuthorityReplacement = {
  providerId: StorageProviderID
  profileId: string
  nextAuthority: StorageDocumentAuthority
}

function migrateLegacyJobs(transaction: IDBTransaction): void {
  const store = transaction.objectStore(STORE)
  const request = store.openCursor()
  request.onsuccess = () => {
    const cursor = request.result
    if (!cursor) return
    const legacy = cursor.value as Partial<OutboxJob> & { canvasId?: unknown }
    if (!legacy.binding && typeof legacy.canvasId === 'string' && legacy.canvasId) {
      store.put({
        ...legacy,
        binding: legacyLocalCanvasBinding(legacy.canvasId),
        expectedRemoteRevision: null
      } as OutboxJob)
    }
    cursor.continue()
  }
}

function openDb(databaseName: string): Promise<IDBDatabase> {
  return openIdb(databaseName, DB_VERSION, (db, oldVersion, transaction) => {
    if (!db.objectStoreNames.contains(STORE)) {
      db.createObjectStore(STORE, { keyPath: 'id' })
    }
    if (oldVersion === 1) migrateLegacyJobs(transaction)
  })
}

function buildJob(partial: OutboxEnqueueInput): OutboxJob {
  return {
    id: partial.id ?? makeJobId(),
    binding: resolveStorageDocumentBinding(partial.binding),
    type: partial.type,
    revision: partial.revision,
    createdAt: Date.now(),
    attempts: partial.attempts ?? 0,
    nextAttemptAt: partial.nextAttemptAt ?? Date.now(),
    expectedRemoteRevision: partial.expectedRemoteRevision ?? null
  }
}

/**
 * Queue with the new job applied: putCanvas supersedes older revisions,
 * and only one putThumb/delete per canvas survives (latest wins).
 */
function withJobQueued(queue: OutboxJob[], job: OutboxJob): OutboxJob[] {
  let next = queue
  const key = storageDocumentKey(job.binding)
  if (job.type === 'putCanvas') {
    next = supersedePutCanvasJobs(next, job.binding, job.revision)
  }
  if (job.type === 'deleteCanvas') {
    next = next.filter(
      (queued) =>
        storageDocumentKey(queued.binding) !== key ||
        (queued.type !== 'putCanvas' && queued.type !== 'putThumb')
    )
  }
  next = next.filter(
    (queued) =>
      !(
        storageDocumentKey(queued.binding) === key &&
        queued.type === job.type &&
        queued.type !== 'putCanvas'
      )
  )
  return [...next, job]
}

function withAuthorityReplacementQueued(
  jobs: OutboxJob[],
  candidate: OutboxJob,
  nextAuthority: StorageDocumentAuthority
): OutboxJob[] {
  return withJobQueued(
    jobs,
    buildJob({
      binding: { ...candidate.binding, authority: nextAuthority },
      type: candidate.type,
      revision: candidate.revision,
      expectedRemoteRevision: candidate.expectedRemoteRevision
    })
  )
}

function jobMatchesAuthority(job: OutboxJob, replacement: OutboxAuthorityReplacement): boolean {
  return (
    job.binding.providerId === replacement.providerId &&
    job.binding.profileId === replacement.profileId &&
    storageDocumentAuthoritiesEqual(job.binding.authority, replacement.expectedAuthority)
  )
}

function withAuthorityReplaced(
  queue: OutboxJob[],
  replacement: OutboxAuthorityReplacement
): { jobs: OutboxJob[]; replaced: number } {
  if (
    replacement.expectedAuthority.accountId !== replacement.nextAuthority.accountId ||
    replacement.expectedAuthority.authorizationVersion ===
      replacement.nextAuthority.authorizationVersion
  ) {
    throw new Error('Storage authorization adoption requires a new grant for the same account')
  }
  const candidates = queue.filter((job) => jobMatchesAuthority(job, replacement))
  let jobs = queue.filter((job) => !jobMatchesAuthority(job, replacement))
  // Delete is terminal for a document, so apply it after any legacy upload jobs.
  const ordered = [...candidates].sort(
    (left, right) => Number(left.type === 'deleteCanvas') - Number(right.type === 'deleteCanvas')
  )
  for (const candidate of ordered) {
    const key = storageDocumentKey(candidate.binding)
    const replacementAlreadySuperseded = jobs.some(
      (queued) =>
        storageDocumentKey(queued.binding) === key &&
        (queued.type === 'deleteCanvas' ||
          (queued.type === candidate.type && queued.revision >= candidate.revision))
    )
    if (candidate.type !== 'deleteCanvas' && replacementAlreadySuperseded) continue
    jobs = withAuthorityReplacementQueued(jobs, candidate, replacement.nextAuthority)
  }
  return { jobs, replaced: candidates.length }
}

function jobMatchesLegacyAuthority(
  job: OutboxJob,
  replacement: OutboxLegacyAuthorityReplacement
): boolean {
  return (
    job.binding.providerId === replacement.providerId &&
    job.binding.profileId === replacement.profileId &&
    !job.binding.authority
  )
}

function withLegacyAuthorityReplaced(
  queue: OutboxJob[],
  replacement: OutboxLegacyAuthorityReplacement
): { jobs: OutboxJob[]; replaced: number } {
  const candidates = queue.filter((job) => jobMatchesLegacyAuthority(job, replacement))
  if (candidates.length === 0) return { jobs: queue, replaced: 0 }

  const candidateDocumentIDs = new Set(candidates.map((job) => job.binding.documentId))
  const existingTargetJobs = queue.filter(
    (job) =>
      !jobMatchesLegacyAuthority(job, replacement) &&
      job.binding.providerId === replacement.providerId &&
      job.binding.profileId === replacement.profileId &&
      candidateDocumentIDs.has(job.binding.documentId)
  )
  if (
    existingTargetJobs.some(
      (job) => !storageDocumentAuthoritiesEqual(job.binding.authority, replacement.nextAuthority)
    )
  ) {
    throw new Error('Legacy storage outbox migration found another authorization generation')
  }

  let jobs = queue.filter((job) => !jobMatchesLegacyAuthority(job, replacement))
  const ordered = [...candidates].sort(
    (left, right) => Number(left.type === 'deleteCanvas') - Number(right.type === 'deleteCanvas')
  )
  for (const candidate of ordered) {
    const targetJobs = existingTargetJobs.filter(
      (job) => job.binding.documentId === candidate.binding.documentId
    )
    if (targetJobs.some((job) => job.type === 'deleteCanvas')) continue
    const sameType = targetJobs.filter((job) => job.type === candidate.type)
    if (sameType.length > 0) {
      if (sameType.some((job) => job.revision >= candidate.revision)) continue
      throw new Error('Legacy storage outbox migration target has an older revision')
    }
    if (candidate.type === 'deleteCanvas' && targetJobs.length > 0) {
      throw new Error('Legacy storage delete conflicts with recovered upload work')
    }
    jobs = withAuthorityReplacementQueued(jobs, candidate, replacement.nextAuthority)
  }
  return { jobs, replaced: candidates.length }
}

function withProviderDeferred(
  queue: OutboxJob[],
  providerId: StorageProviderID,
  notBefore: number
): { jobs: OutboxJob[]; replaced: number } {
  if (!providerId || !Number.isSafeInteger(notBefore) || notBefore < 0) {
    throw new Error('Storage retry cooldown is invalid')
  }
  let replaced = 0
  const jobs = queue.map((job) => {
    if (job.binding.providerId !== providerId || job.nextAttemptAt >= notBefore) return job
    replaced++
    return { ...job, nextAttemptAt: notBefore }
  })
  return { jobs, replaced }
}

export function createMemoryOutbox(): Outbox {
  let jobs: OutboxJob[] = []

  return {
    async list() {
      return [...jobs].sort((a, b) => a.createdAt - b.createdAt)
    },
    async enqueue(partial) {
      const job = buildJob(partial)
      jobs = withJobQueued(jobs, job)
      return job
    },
    async update(job) {
      jobs = jobs.map((j) => (j.id === job.id ? job : j))
    },
    async deferProvider(providerId, notBefore) {
      const result = withProviderDeferred(jobs, providerId, notBefore)
      jobs = result.jobs
      return result.replaced
    },
    async replaceAuthority(replacement) {
      const result = withAuthorityReplaced(jobs, replacement)
      jobs = result.jobs
      return result.replaced
    },
    async replaceLegacyAuthority(replacement) {
      const result = withLegacyAuthorityReplaced(jobs, replacement)
      jobs = result.jobs
      return result.replaced
    },
    async remove(id) {
      jobs = jobs.filter((j) => j.id !== id)
    },
    async clear() {
      jobs = []
    }
  }
}

export function createIdbOutbox(databaseName = DB_NAME): Outbox {
  let dbPromise: Promise<IDBDatabase> | null = null
  function db() {
    if (!dbPromise) dbPromise = openDb(databaseName)
    return dbPromise
  }

  async function replaceJobs(
    replacement: (existing: OutboxJob[]) => { jobs: OutboxJob[]; replaced: number }
  ): Promise<number> {
    const database = await db()
    const tx = database.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const existing = (await reqToPromise(store.getAll())) as OutboxJob[]
    const result = replacement(existing)
    const nextIDs = new Set(result.jobs.map((job) => job.id))
    for (const job of existing) {
      if (!nextIDs.has(job.id)) store.delete(job.id)
    }
    for (const job of result.jobs) store.put(job)
    await txDone(tx)
    return result.replaced
  }

  return {
    async list() {
      const database = await db()
      const tx = database.transaction(STORE, 'readonly')
      const all = (await reqToPromise(tx.objectStore(STORE).getAll())) as OutboxJob[]
      await txDone(tx)
      return all.sort((a, b) => a.createdAt - b.createdAt)
    },

    async enqueue(partial) {
      const job = buildJob(partial)
      // Read and write in ONE transaction so concurrent enqueues can't compute
      // supersession from the same stale snapshot (duplicate/stale jobs).
      const database = await db()
      const tx = database.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      const existing = (await reqToPromise(store.getAll())) as OutboxJob[]
      const next = withJobQueued(existing, job)
      for (const j of existing) {
        if (!next.some((n) => n.id === j.id)) store.delete(j.id)
      }
      store.put(job)
      await txDone(tx)
      return job
    },

    async update(job) {
      const database = await db()
      const tx = database.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      const existing = await reqToPromise(store.get(job.id))
      // `update` is not an upsert: an in-flight job can be superseded and
      // deleted while its provider request is still settling.
      if (existing !== undefined) store.put(job)
      await txDone(tx)
    },

    async deferProvider(providerId, notBefore) {
      return replaceJobs((existing) => withProviderDeferred(existing, providerId, notBefore))
    },

    async replaceAuthority(replacement) {
      return replaceJobs((existing) => withAuthorityReplaced(existing, replacement))
    },

    async replaceLegacyAuthority(replacement) {
      return replaceJobs((existing) => withLegacyAuthorityReplaced(existing, replacement))
    },

    async remove(id) {
      const database = await db()
      const tx = database.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(id)
      await txDone(tx)
    },

    async clear() {
      const database = await db()
      const tx = database.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).clear()
      await txDone(tx)
    }
  }
}

let outboxSingleton: Outbox | null = null
let usingMemoryFallback = false

export function resetOutboxForTests(outbox?: Outbox) {
  outboxSingleton = outbox ?? null
  usingMemoryFallback = false
}

/** Test-injected outboxes count as durable; only the production memory fallback is unavailable. */
export function isOutboxDurable(): boolean {
  getOutbox()
  return !usingMemoryFallback
}

export function getOutbox(): Outbox {
  if (outboxSingleton) return outboxSingleton
  try {
    if (typeof indexedDB !== 'undefined') {
      outboxSingleton = createIdbOutbox()
      usingMemoryFallback = false
      return outboxSingleton
    }
  } catch (error) {
    console.warn('[Storage] Outbox IDB unavailable, using memory:', error)
  }
  outboxSingleton = createMemoryOutbox()
  usingMemoryFallback = true
  return outboxSingleton
}
