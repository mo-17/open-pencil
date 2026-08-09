import {
  resolveStorageDocumentBinding,
  storageDocumentAuthoritiesEqual,
  type StorageDocumentAuthority,
  type StorageProviderID
} from '@/app/integrations/storage/types'
import {
  getLocalCanvasStore,
  localCanvasBinding,
  type LocalCanvasMeta,
  type LocalCanvasStore
} from '@/app/storage/local-store'
import { recoverStorageSyncJobs } from '@/app/storage/sync/engine'
import { getOutbox, type Outbox } from '@/app/storage/sync/outbox'
import type { OutboxJob } from '@/app/storage/sync/types'

export type StorageAuthorizationWorkScope = {
  providerId: StorageProviderID
  profileId: string
  authority: StorageDocumentAuthority
}

export type StorageAuthorizationWorkInspection = {
  scope: StorageAuthorizationWorkScope
  documentCount: number
  unfinishedDocumentCount: number
  jobCount: number
  requiresConfirmation: boolean
}

export type AdoptStorageAuthorizationWorkInput = {
  providerId: StorageProviderID
  profileId: string
  previousAuthority: StorageDocumentAuthority
  nextAuthority: StorageDocumentAuthority
}

export type AdoptStorageAuthorizationWorkResult = {
  adoptedDocumentCount: number
  replacedJobCount: number
  recoveredJobCount: number
}

export type StorageAuthorizationWorkDependencies = {
  store: LocalCanvasStore
  outbox: Outbox
  recover?(): Promise<number>
}

function normalizedScope(scope: StorageAuthorizationWorkScope): StorageAuthorizationWorkScope {
  const binding = resolveStorageDocumentBinding({
    providerId: scope.providerId,
    profileId: scope.profileId,
    documentId: 'authorization-work',
    authority: scope.authority
  })
  if (!binding.authority) throw new Error('Storage authorization scope is invalid')
  return {
    providerId: binding.providerId,
    profileId: binding.profileId,
    authority: binding.authority
  }
}

function runtimeDependencies(
  dependencies?: StorageAuthorizationWorkDependencies
): StorageAuthorizationWorkDependencies {
  return dependencies ?? { store: getLocalCanvasStore(), outbox: getOutbox() }
}

function metaMatchesScope(meta: LocalCanvasMeta, scope: StorageAuthorizationWorkScope): boolean {
  return (
    meta.providerId === scope.providerId &&
    meta.profileId === scope.profileId &&
    storageDocumentAuthoritiesEqual(meta.authority, scope.authority)
  )
}

function jobMatchesScope(job: OutboxJob, scope: StorageAuthorizationWorkScope): boolean {
  return (
    job.binding.providerId === scope.providerId &&
    job.binding.profileId === scope.profileId &&
    storageDocumentAuthoritiesEqual(job.binding.authority, scope.authority)
  )
}

function unfinished(meta: LocalCanvasMeta): boolean {
  return (
    meta.tombstoned ||
    meta.syncStatus === 'pending' ||
    meta.syncStatus === 'error' ||
    meta.syncStatus === 'conflict'
  )
}

function inspectSnapshot(
  scope: StorageAuthorizationWorkScope,
  metas: LocalCanvasMeta[],
  jobs: OutboxJob[]
): StorageAuthorizationWorkInspection {
  const matchingMetas = metas.filter((meta) => metaMatchesScope(meta, scope))
  const unfinishedDocumentCount = matchingMetas.filter(unfinished).length
  const jobCount = jobs.filter((job) => jobMatchesScope(job, scope)).length
  return {
    scope,
    documentCount: matchingMetas.length,
    unfinishedDocumentCount,
    jobCount,
    requiresConfirmation: unfinishedDocumentCount > 0 || jobCount > 0
  }
}

/** Inspect one exact grant before disconnecting or starting replacement OAuth. */
export async function inspectStorageAuthorizationWork(
  input: StorageAuthorizationWorkScope,
  dependencies?: StorageAuthorizationWorkDependencies
): Promise<StorageAuthorizationWorkInspection> {
  const scope = normalizedScope(input)
  const runtime = runtimeDependencies(dependencies)
  const [metas, jobs] = await Promise.all([runtime.store.listMetas(true), runtime.outbox.list()])
  return inspectSnapshot(scope, metas, jobs)
}

/** Discover crash-gap grants for the connected account without trusting labels or document IDs. */
export async function listStaleStorageAuthorizationWork(
  input: StorageAuthorizationWorkScope,
  dependencies?: StorageAuthorizationWorkDependencies
): Promise<StorageAuthorizationWorkInspection[]> {
  const current = normalizedScope(input)
  const runtime = runtimeDependencies(dependencies)
  const [metas, jobs] = await Promise.all([runtime.store.listMetas(true), runtime.outbox.list()])
  const stale = new Map<string, StorageDocumentAuthority>()
  const collect = (authority: StorageDocumentAuthority | null | undefined) => {
    if (
      authority?.accountId === current.authority.accountId &&
      authority.authorizationVersion !== current.authority.authorizationVersion
    ) {
      stale.set(authority.authorizationVersion, authority)
    }
  }
  for (const meta of metas) {
    if (meta.providerId === current.providerId && meta.profileId === current.profileId) {
      collect(meta.authority)
    }
  }
  for (const job of jobs) {
    if (
      job.binding.providerId === current.providerId &&
      job.binding.profileId === current.profileId
    ) {
      collect(job.binding.authority)
    }
  }
  return [...stale.values()]
    .sort((left, right) => left.authorizationVersion.localeCompare(right.authorizationVersion))
    .map((authority) => inspectSnapshot({ ...current, authority }, metas, jobs))
}

/**
 * Explicitly adopts same-account local state after replacement OAuth. Metadata
 * moves first, then old jobs are atomically replaced with new IDs. Each step is
 * idempotent so a crash can be resumed via listStaleStorageAuthorizationWork.
 */
export async function adoptStorageAuthorizationWork(
  input: AdoptStorageAuthorizationWorkInput,
  dependencies?: StorageAuthorizationWorkDependencies
): Promise<AdoptStorageAuthorizationWorkResult> {
  // Only OAuth grants for the same Google account are safely adoptable. S3
  // generations can identify different endpoints or buckets; migrating an old
  // delete/upload job to a new S3 generation could mutate unrelated storage.
  if (input.providerId !== 'google-drive') {
    throw new Error('Storage authorization adoption only supports Google Drive OAuth grants')
  }
  const previous = normalizedScope({
    providerId: input.providerId,
    profileId: input.profileId,
    authority: input.previousAuthority
  })
  const next = normalizedScope({
    providerId: input.providerId,
    profileId: input.profileId,
    authority: input.nextAuthority
  })
  if (
    previous.authority.accountId !== next.authority.accountId ||
    previous.authority.authorizationVersion === next.authority.authorizationVersion
  ) {
    throw new Error('Storage authorization adoption requires a new grant for the same account')
  }

  const runtime = runtimeDependencies(dependencies)
  let adoptedDocumentCount = 0
  for (let pass = 0; pass < 3; pass++) {
    const candidates = (await runtime.store.listMetas(true)).filter((meta) =>
      metaMatchesScope(meta, previous)
    )
    if (candidates.length === 0) break
    for (const meta of candidates) {
      const adopted = await runtime.store.adoptAuthority(localCanvasBinding(meta), next.authority, {
        expectedAuthority: previous.authority,
        expectedRevision: meta.revision
      })
      if (adopted) adoptedDocumentCount++
    }
  }
  if ((await runtime.store.listMetas(true)).some((meta) => metaMatchesScope(meta, previous))) {
    throw new Error('Storage authorization work changed during adoption; retry is required')
  }

  const oldJobs = (await runtime.outbox.list()).filter((job) => jobMatchesScope(job, previous))
  for (const job of oldJobs) {
    const meta = await runtime.store.getMeta(job.binding)
    if (meta && !storageDocumentAuthoritiesEqual(meta.authority, next.authority)) {
      throw new Error('Storage authorization work changed during adoption; retry is required')
    }
  }
  const replacedJobCount = await runtime.outbox.replaceAuthority({
    providerId: previous.providerId,
    profileId: previous.profileId,
    expectedAuthority: previous.authority,
    nextAuthority: next.authority
  })
  const recoveredJobCount = dependencies
    ? await (runtime.recover?.() ?? Promise.resolve(0))
    : await recoverStorageSyncJobs()
  return { adoptedDocumentCount, replacedJobCount, recoveredJobCount }
}
