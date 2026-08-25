import { IS_BROWSER } from '@open-pencil/core/constants'

import {
  describeDiagnosticError,
  recordStorageFailure,
  storageOperationForJob
} from '@/app/diagnostics'
import {
  createActiveStorageAdapter,
  ensureS3StorageAuthority,
  S3_COMPATIBLE_STORAGE_PROVIDER_ID,
  storageCredentialStatuses,
  storageDocumentAuthorityMatches,
  storagePreferencesComplete,
  storageProviderRegistry,
  type StorageAdapter,
  type StorageDocumentBinding,
  type StoragePutDocumentResult,
  type StorageRemoteRevision
} from '@/app/integrations/storage'
import { assertS3LegacyMigrationComplete } from '@/app/integrations/storage/s3/legacy-migration-state'
import { evictLocalFigCache } from '@/app/storage/cache-eviction'
import {
  getLocalCanvasStore,
  localCanvasBinding,
  localCanvasKey,
  resolveLocalCanvasLocator,
  type LocalCanvasLocator,
  type LocalCanvasMeta,
  type LocalCanvasStore
} from '@/app/storage/local-store'
import {
  storageSyncErrorPolicy,
  storageSyncFailureIsPermanent
} from '@/app/storage/sync/error-policy'
import {
  currentStorageSyncJobMeta,
  readStorageSyncPutSnapshot,
  storageSyncAuthorityOptions,
  storageSyncMetaHasExactAuthority,
  updateStorageSyncMetaForJob
} from '@/app/storage/sync/job-guard'
import { getOutbox } from '@/app/storage/sync/outbox'
import { setUploadProgress } from '@/app/storage/sync/progress'
import { setPendingSyncCount, setSyncUI } from '@/app/storage/sync/status'
import type { OutboxJob, OutboxJobType } from '@/app/storage/sync/types'
import { emitStorageWorkspaceEvent } from '@/app/storage/workspace/events'

const MAX_ATTEMPTS = 8
const BASE_BACKOFF_MS = 1500
const MAX_BACKOFF_MS = 60_000
const MAX_CONFLICT_COPY_NAME_BYTES = 512
const CONFLICT_COPY_NAME_SUFFIX = ' (preserved conflict copy).fig'

class StorageSyncBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StorageSyncBlockedError'
  }
}

class StorageSyncConflictError extends Error {
  constructor(readonly remoteRevision: StorageRemoteRevision | null) {
    super('The remote document changed. Resolve the storage conflict before retrying.')
    this.name = 'StorageSyncConflictError'
  }
}

let pumping = false
let wakeTimer: ReturnType<typeof setTimeout> | null = null
let onlineBound = false
const providerRetryNotBefore = new Map<string, number>()

function isOnline(): boolean {
  if (typeof navigator === 'undefined') return true
  return navigator.onLine
}

function backoffMs(attempts: number): number {
  const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1))
  const jitter = Math.floor(exp * 0.2 * ((crypto.getRandomValues(new Uint8Array(1))[0] ?? 0) / 255))
  return exp + jitter
}

function truncateUtf8(value: string, maxBytes: number): string {
  const encoder = new TextEncoder()
  let output = ''
  let usedBytes = 0
  for (const character of value) {
    const size = encoder.encode(character).byteLength
    if (usedBytes + size > maxBytes) break
    output += character
    usedBytes += size
  }
  return output
}

/** Bounded local label used until Drive reconciliation supplies the provider-owned name. */
export function conflictCopyIndexName(originalName: string): string {
  const cleaned = Array.from(originalName.trim(), (character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127 || character === '/' || character === '\\' ? '' : character
  }).join('')
  const base = (cleaned || 'Untitled').replace(/\.fig$/i, '') || 'Untitled'
  const suffixBytes = new TextEncoder().encode(CONFLICT_COPY_NAME_SUFFIX).byteLength
  return `${truncateUtf8(base, MAX_CONFLICT_COPY_NAME_BYTES - suffixBytes)}${CONFLICT_COPY_NAME_SUFFIX}`
}

type ConflictCopyResult = Extract<StoragePutDocumentResult, { outcome: 'conflict-copy' }>

export async function recordStorageConflictCopy(
  store: LocalCanvasStore,
  binding: StorageDocumentBinding,
  original: Pick<LocalCanvasMeta, 'name'>,
  result: ConflictCopyResult,
  now = new Date(),
  expectedRevision?: number
): Promise<boolean> {
  const updatedAt = now.toISOString()
  const record = await store.recordConflictCopy(
    binding,
    {
      copy: {
        id: result.conflictDocumentId,
        providerId: binding.providerId,
        profileId: binding.profileId,
        authority: binding.authority ?? null,
        name: conflictCopyIndexName(original.name),
        updatedAt,
        syncStatus: 'synced',
        lastSyncedAt: updatedAt,
        lastSyncError: null,
        remoteRevision: result.conflictCopyRevision ?? null,
        hasFig: false
      },
      originalRemoteRevision: result.remoteRevision,
      originalLastSyncError: `Remote conflict preserved as ${result.conflictDocumentId}`
    },
    expectedRevision === undefined
      ? undefined
      : {
          expectedRevision,
          expectedAuthority: binding.authority ?? null
        }
  )
  return record !== null
}

export function nextSyncWakeDelay(jobs: OutboxJob[], now = Date.now()): number | null {
  if (jobs.length === 0) return null
  const nextAt = Math.min(...jobs.map((job) => job.nextAttemptAt))
  return nextAt === Number.MAX_SAFE_INTEGER ? null : Math.max(250, nextAt - now)
}

function providerRetryAt(providerId: string, now: number): number {
  const retryAt = providerRetryNotBefore.get(providerId) ?? 0
  if (retryAt <= now) {
    providerRetryNotBefore.delete(providerId)
    return 0
  }
  return retryAt
}

function retryAwareJobTime(job: OutboxJob, now: number): number {
  return Math.max(job.nextAttemptAt, providerRetryAt(job.binding.providerId, now))
}

function retryAwareWakeDelay(jobs: OutboxJob[], now: number): number | null {
  return nextSyncWakeDelay(
    jobs.map((job) => ({ ...job, nextAttemptAt: retryAwareJobTime(job, now) })),
    now
  )
}

function rememberProviderRetry(providerId: string, retryAt: number): void {
  providerRetryNotBefore.set(
    providerId,
    Math.max(providerRetryNotBefore.get(providerId) ?? 0, retryAt)
  )
}

function retryAwareEnqueueTime(providerId: string, now = Date.now()): number {
  return Math.max(now, providerRetryAt(providerId, now))
}

async function createAuthorizedStorageAdapter(
  binding: StorageDocumentBinding
): Promise<StorageAdapter> {
  const providerID = binding.providerId
  if (providerID === S3_COMPATIBLE_STORAGE_PROVIDER_ID) {
    try {
      assertS3LegacyMigrationComplete(
        binding.profileId,
        ensureS3StorageAuthority(binding.profileId)
      )
    } catch (error) {
      throw new StorageSyncBlockedError(
        error instanceof Error ? error.message : 'Legacy S3 storage migration is required'
      )
    }
  }
  if (!storagePreferencesComplete(providerID, binding.profileId)) {
    throw new StorageSyncBlockedError('Storage is not configured')
  }
  const provider = storageProviderRegistry.get(providerID)
  const statuses = await storageCredentialStatuses(providerID, binding.profileId)
  const missingCredential = provider.credentialFields.some(
    (field) => field.required && statuses[field.id] !== 'configured'
  )
  if (missingCredential) {
    throw new StorageSyncBlockedError('Storage credentials are unavailable')
  }
  const adapter = createActiveStorageAdapter(providerID, binding.profileId)
  if (!adapter.getAuthority) {
    if (!binding.authority) return adapter
    throw new StorageSyncBlockedError('Storage provider cannot verify document authorization')
  }
  const currentAuthority = await adapter.getAuthority()
  if (!binding.authority) {
    if (!currentAuthority) return adapter
    throw new StorageSyncBlockedError(
      'Legacy storage work is not bound to the current profile authorization.'
    )
  }
  if (!storageDocumentAuthorityMatches(binding.authority, currentAuthority)) {
    throw new StorageSyncBlockedError(
      'Storage authorization changed. Reconnect the original account before syncing.'
    )
  }
  return adapter
}

async function runDeleteJob(store: LocalCanvasStore, job: OutboxJob): Promise<void> {
  const binding = job.binding
  const before = await store.getMeta(binding)
  if (before && (!before.tombstoned || !storageSyncMetaHasExactAuthority(before, binding))) return
  const adapter = await createAuthorizedStorageAdapter(binding)
  const current = await store.getMeta(binding)
  if (
    before &&
    (!current ||
      !current.tombstoned ||
      current.revision !== before.revision ||
      !storageSyncMetaHasExactAuthority(current, binding))
  ) {
    return
  }
  if (!before && current) return
  await adapter.deleteDocument(binding.documentId, storageSyncAuthorityOptions(binding))
  // Keep the tombstoned row until reconcile confirms the remote object is gone.
  if (!before) return
  await store.updateMeta(
    binding,
    { syncStatus: 'synced', lastSyncError: null },
    {
      expectedRevision: before.revision,
      expectedAuthority: binding.authority ?? null
    }
  )
}

async function runPutCanvasJob(store: LocalCanvasStore, job: OutboxJob): Promise<void> {
  const binding = job.binding
  const snapshot = await readStorageSyncPutSnapshot(store, job)
  if (!snapshot) return
  const adapter = await createAuthorizedStorageAdapter(binding)
  const current = await currentStorageSyncJobMeta(store, job)
  if (!current || current.tombstoned || !current.hasFig) return
  const progressKey = localCanvasKey(binding)
  setUploadProgress(progressKey, 0)
  try {
    const result = await adapter.putDocument(
      binding.documentId,
      snapshot.fig,
      {
        name: snapshot.meta.name,
        updatedAt: snapshot.meta.updatedAt
      },
      {
        expectedRemoteRevision: job.expectedRemoteRevision,
        ...storageSyncAuthorityOptions(binding),
        onProgress: ({ transferredBytes, totalBytes }) => {
          if (totalBytes) setUploadProgress(progressKey, transferredBytes / totalBytes)
        }
      }
    )
    if (result.outcome === 'conflict') {
      throw new StorageSyncConflictError(result.remoteRevision)
    }
    if (result.outcome === 'conflict-copy') {
      await recordStorageConflictCopy(
        store,
        binding,
        snapshot.meta,
        result,
        new Date(),
        job.revision
      )
      return
    }

    const updated = await store.updateMeta(
      binding,
      {
        syncStatus: 'synced',
        lastSyncedAt: new Date().toISOString(),
        lastSyncError: null,
        remoteRevision: result.remoteRevision
      },
      {
        expectedRevision: job.revision,
        expectedAuthority: binding.authority ?? null
      }
    )
    if (updated && !updated.tombstoned) {
      await evictLocalFigCache(new Set([progressKey]))
      emitStorageWorkspaceEvent({
        providerId: binding.providerId,
        documentId: binding.documentId,
        kind: 'synced'
      })
    }
  } finally {
    setUploadProgress(progressKey, null)
  }
}

async function runPutThumbJob(store: LocalCanvasStore, job: OutboxJob): Promise<void> {
  const binding = job.binding
  const before = await currentStorageSyncJobMeta(store, job)
  if (!before || before.tombstoned || !before.hasThumb) return
  const thumb = await store.readThumb(binding)
  const after = await currentStorageSyncJobMeta(store, job)
  if (!thumb || !after || after.tombstoned || !after.hasThumb) return
  const adapter = await createAuthorizedStorageAdapter(binding)
  const current = await currentStorageSyncJobMeta(store, job)
  if (!current || current.tombstoned || !current.hasThumb || !adapter.putThumbnail) return
  await adapter.putThumbnail(binding.documentId, thumb, storageSyncAuthorityOptions(binding))
}

async function runJob(job: OutboxJob): Promise<void> {
  const store = getLocalCanvasStore()
  if (job.type === 'deleteCanvas') return runDeleteJob(store, job)
  if (job.type === 'putCanvas') return runPutCanvasJob(store, job)
  return runPutThumbJob(store, job)
}

async function handleJobFailure(job: OutboxJob, error: unknown): Promise<void> {
  const outbox = getOutbox()
  const { errorName, errorCode, retryable } = describeDiagnosticError(error)
  recordStorageFailure({
    operation: storageOperationForJob(job.type),
    errorName,
    errorCode,
    retryable
  })
  const message = error instanceof Error ? error.message : String(error)
  // A newer enqueue may have superseded this in-flight job. Never resurrect
  // its durable record or let its late result mutate the replacement row.
  if (!(await outbox.list()).some((queued) => queued.id === job.id)) {
    const remaining = await outbox.list()
    setPendingSyncCount(remaining.length)
    if (remaining.length > 0) scheduleWake(50)
    else setSyncUI('idle')
    return
  }
  if (error instanceof StorageSyncConflictError) {
    await updateStorageSyncMetaForJob(getLocalCanvasStore(), job, {
      syncStatus: 'conflict',
      remoteRevision: error.remoteRevision,
      lastSyncError: message
    })
    await outbox.update({ ...job, nextAttemptAt: Number.MAX_SAFE_INTEGER })
    setSyncUI('error', message)
    return
  }
  if (error instanceof StorageSyncBlockedError) {
    await outbox.update({
      ...job,
      nextAttemptAt: Number.MAX_SAFE_INTEGER
    })
    setSyncUI('error', message)
    return
  }

  const policy = storageSyncErrorPolicy(error)
  const attempts = Math.min(job.attempts + 1, MAX_ATTEMPTS)
  const permanent = storageSyncFailureIsPermanent(policy, attempts, MAX_ATTEMPTS)
  console.warn('[Storage sync] job failed:', job.type, job.binding.documentId, message)

  if (permanent) {
    // A failed thumbnail upload must not poison the document's sync status —
    // only canvas/delete jobs reflect into the meta row.
    if (job.type !== 'putThumb') {
      await updateStorageSyncMetaForJob(getLocalCanvasStore(), job, {
        syncStatus: 'error',
        lastSyncError: message
      })
      setSyncUI('error', message.slice(0, 120))
    } else {
      // Keep a record without touching syncStatus so the stale remote
      // thumbnail is at least diagnosable.
      await updateStorageSyncMetaForJob(getLocalCanvasStore(), job, { lastSyncError: message })
    }
    if (job.type === 'putThumb') {
      await outbox.remove(job.id)
      const remaining = await outbox.list()
      setPendingSyncCount(remaining.length)
      if (remaining.length > 0) scheduleWake(1000)
      else setSyncUI('idle')
    } else {
      // Never discard a document mutation. Keep it durable until the user
      // repairs credentials/permissions and explicitly wakes synchronization.
      await outbox.update({
        ...job,
        attempts,
        nextAttemptAt: Number.MAX_SAFE_INTEGER
      })
    }
    return
  }

  const retryAt = Date.now() + Math.max(backoffMs(attempts), policy.retryAfterMs ?? 0)
  if (policy.retryScope === 'provider') {
    rememberProviderRetry(job.binding.providerId, retryAt)
  }
  await outbox.update({
    ...job,
    attempts,
    nextAttemptAt: retryAt
  })
  if (policy.retryScope === 'provider') {
    await outbox.deferProvider(job.binding.providerId, retryAt)
  }
  if (job.type !== 'putThumb') {
    await updateStorageSyncMetaForJob(getLocalCanvasStore(), job, {
      syncStatus: 'pending',
      lastSyncError: message
    })
  }
  // Wake for the next ready job across the whole queue — not this job's
  // full backoff, which starved other jobs that were ready sooner.
  const all = await outbox.list()
  const delay = retryAwareWakeDelay(all, Date.now())
  if (delay !== null) scheduleWake(delay)
}

async function pumpOnce(): Promise<void> {
  const outbox = getOutbox()
  const jobs = await outbox.list()
  setPendingSyncCount(jobs.length)

  if (jobs.length === 0) {
    if (isOnline()) setSyncUI('idle')
    return
  }

  if (!isOnline()) {
    setSyncUI('offline')
    scheduleWake(5000)
    return
  }

  setSyncUI('syncing')
  const now = Date.now()
  // Single-flight globally for simplicity (large figs)
  const job = jobs.find((candidate) => retryAwareJobTime(candidate, now) <= now)
  if (!job) {
    const delay = retryAwareWakeDelay(jobs, now)
    if (delay != null) scheduleWake(delay)
    return
  }

  try {
    await runJob(job)
    await outbox.remove(job.id)
    const remaining = await outbox.list()
    setPendingSyncCount(remaining.length)
    if (remaining.length === 0) setSyncUI('idle')
    else scheduleWake(50)
  } catch (error) {
    await handleJobFailure(job, error)
  }
}

function scheduleWake(ms: number) {
  if (wakeTimer != null) clearTimeout(wakeTimer)
  wakeTimer = setTimeout(() => {
    wakeTimer = null
    void kickSyncEngine()
  }, ms)
}

function ensureOnlineListeners() {
  if (onlineBound || !IS_BROWSER) return
  onlineBound = true
  window.addEventListener('online', () => {
    setSyncUI('syncing')
    void kickSyncEngine()
  })
  window.addEventListener('offline', () => {
    setSyncUI('offline')
  })
}

/** Repair non-atomic v1 local-write/outbox gaps without discarding document mutations. */
export async function recoverStorageSyncJobs(): Promise<number> {
  const store = getLocalCanvasStore()
  const outbox = getOutbox()
  const [metas, jobs] = await Promise.all([store.listMetas(true), outbox.list()])
  const queued = new Set(jobs.map((job) => recoveryJobKey(job.binding, job.type)))
  let recovered = 0

  for (const meta of metas) {
    const binding = localCanvasBinding(meta)
    const type = recoveryJobType(meta)
    const key = type ? recoveryJobKey(binding, type) : null
    if (!type || !key || queued.has(key)) continue
    await outbox.enqueue({
      binding,
      type,
      revision: type === 'putCanvas' ? meta.revision : 0,
      nextAttemptAt: retryAwareEnqueueTime(binding.providerId),
      expectedRemoteRevision: meta.remoteRevision
    })
    queued.add(key)
    recovered++
  }

  if (recovered > 0) setPendingSyncCount((await outbox.list()).length)
  return recovered
}

function recoveryJobType(meta: LocalCanvasMeta): OutboxJobType | null {
  if (meta.tombstoned) return 'deleteCanvas'
  if (meta.syncStatus === 'pending' && meta.hasFig) return 'putCanvas'
  return null
}

function recoveryJobKey(binding: StorageDocumentBinding, type: OutboxJobType): string {
  return JSON.stringify([
    localCanvasKey(binding),
    binding.authority?.authorizationVersion ?? null,
    type
  ])
}

/** Start or continue draining the outbox. Safe to call often. */
export async function kickSyncEngine(): Promise<void> {
  ensureOnlineListeners()
  if (pumping) return
  pumping = true
  let pumpFailed = false
  try {
    // Re-scan on every kick: an enqueue failure can leave new pending/tombstone
    // work after a previous successful recovery pass in the same process.
    await recoverStorageSyncJobs()
    // Drain a few jobs per kick to avoid long tight loops blocking the tab.
    for (let i = 0; i < 3; i++) {
      const before = (await getOutbox().list()).length
      await pumpOnce()
      const after = (await getOutbox().list()).length
      if (after === 0 || after >= before) break
    }
  } catch (error) {
    // Never let an escaped rejection strand the queue — retry shortly.
    pumpFailed = true
    console.warn('[Storage sync] pump failed:', error)
    scheduleWake(5000)
  } finally {
    pumping = false
  }
  // A job enqueued mid-pump can slip past the loop's exit check while its
  // kick was swallowed by the pumping guard — re-wake if work is already due.
  // (Skip offline — pumpOnce owns those wakes — and errors, which keep their
  // 5s backoff; re-waking would clobber it into a tight retry loop.)
  if (pumpFailed || !isOnline()) return
  const jobs = await getOutbox().list()
  const now = Date.now()
  if (jobs.some((job) => retryAwareJobTime(job, now) <= now)) scheduleWake(250)
}

export async function enqueuePutCanvas(
  locator: LocalCanvasLocator,
  revision: number,
  expectedRemoteRevision: StorageRemoteRevision | null = null
): Promise<void> {
  const binding = resolveLocalCanvasLocator(locator)
  await getOutbox().enqueue({
    binding,
    type: 'putCanvas',
    revision,
    nextAttemptAt: retryAwareEnqueueTime(binding.providerId),
    expectedRemoteRevision
  })
  void kickSyncEngine()
}

export async function enqueuePutThumb(
  locator: LocalCanvasLocator,
  revision: number
): Promise<void> {
  const binding = resolveLocalCanvasLocator(locator)
  await getOutbox().enqueue({
    binding,
    type: 'putThumb',
    revision,
    nextAttemptAt: retryAwareEnqueueTime(binding.providerId)
  })
  void kickSyncEngine()
}

export async function enqueueDeleteCanvas(locator: LocalCanvasLocator): Promise<void> {
  const binding = resolveLocalCanvasLocator(locator)
  await getOutbox().enqueue({
    binding,
    type: 'deleteCanvas',
    revision: 0,
    nextAttemptAt: retryAwareEnqueueTime(binding.providerId)
  })
  void kickSyncEngine()
}

/** Retry durable work immediately after storage settings or credentials change. */
export async function resumeStorageSync(): Promise<void> {
  await recoverStorageSyncJobs()
  const outbox = getOutbox()
  const jobs = await outbox.list()
  const now = Date.now()
  await Promise.all(
    jobs.map((job) =>
      outbox.update({ ...job, nextAttemptAt: retryAwareEnqueueTime(job.binding.providerId, now) })
    )
  )
  if (jobs.length > 0) setSyncUI('syncing')
  void kickSyncEngine()
}

/** After credentials cleared — drop local mirror + outbox (optional safety). */
export async function clearStorageLocalMirror(): Promise<void> {
  await getLocalCanvasStore().clearAll()
  await getOutbox().clear()
  setPendingSyncCount(0)
  setSyncUI('idle')
}
