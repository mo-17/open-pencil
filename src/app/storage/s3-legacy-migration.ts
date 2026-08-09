import { S3_COMPATIBLE_STORAGE_PROVIDER_ID } from '@/app/integrations/storage/s3/authority'
import {
  assertS3LegacyMigrationComplete,
  beginS3LegacyMigration,
  completeS3LegacyMigration,
  markS3LegacyMigrationComplete,
  markS3LegacyMigrationPending,
  s3LegacyConfigurationIdentity,
  s3LegacyMigrationStateStore,
  type S3LegacyMigrationStateStore
} from '@/app/integrations/storage/s3/legacy-migration-state'
import type { StorageDocumentAuthority } from '@/app/integrations/storage/types'
import {
  getLocalCanvasStore,
  localCanvasKey,
  type LocalCanvasMeta,
  type LocalCanvasStore
} from '@/app/storage/local-store'
import { getOutbox, type Outbox } from '@/app/storage/sync/outbox'
import type { OutboxJob } from '@/app/storage/sync/types'

export type S3LegacyMigrationPreferences = Readonly<{
  endpoint?: string
  bucket?: string
  region?: string
}>

export type S3LegacyMigrationInspection = Readonly<{
  profileId: string
  status: 'pending' | 'complete'
  legacyDocumentCount: number
  unfinishedDocumentCount: number
  deleteDocumentCount: number
  jobCount: number
  requiresConfirmation: boolean
  configurationIdentity: string
}>

export type S3LegacyMigrationDependencies = Readonly<{
  localStore?: LocalCanvasStore
  outbox?: Outbox
  stateStore?: S3LegacyMigrationStateStore
}>

type MigrationScope = Readonly<{
  profileId: string
  authority: StorageDocumentAuthority
  preferences: S3LegacyMigrationPreferences
}>

function dependencies(
  input: S3LegacyMigrationDependencies
): Required<S3LegacyMigrationDependencies> {
  return {
    localStore: input.localStore ?? getLocalCanvasStore(),
    outbox: input.outbox ?? getOutbox(),
    stateStore: input.stateStore ?? s3LegacyMigrationStateStore
  }
}

function isLegacyMeta(meta: LocalCanvasMeta, profileId: string): boolean {
  return (
    meta.providerId === S3_COMPATIBLE_STORAGE_PROVIDER_ID &&
    meta.profileId === profileId &&
    !meta.authority
  )
}

function isLegacyJob(job: OutboxJob, profileId: string): boolean {
  return (
    job.binding.providerId === S3_COMPATIBLE_STORAGE_PROVIDER_ID &&
    job.binding.profileId === profileId &&
    !job.binding.authority
  )
}

async function legacyWork(
  profileId: string,
  stores: Required<S3LegacyMigrationDependencies>
): Promise<{ metas: LocalCanvasMeta[]; jobs: OutboxJob[] }> {
  const [metas, jobs] = await Promise.all([stores.localStore.listMetas(true), stores.outbox.list()])
  return {
    metas: metas.filter((meta) => isLegacyMeta(meta, profileId)),
    jobs: jobs.filter((job) => isLegacyJob(job, profileId))
  }
}

function inspection(
  scope: MigrationScope,
  work: { metas: LocalCanvasMeta[]; jobs: OutboxJob[] },
  status: 'pending' | 'complete'
): S3LegacyMigrationInspection {
  return {
    profileId: scope.profileId,
    status,
    legacyDocumentCount: work.metas.length,
    unfinishedDocumentCount: work.metas.filter(
      (meta) => meta.tombstoned || meta.syncStatus !== 'synced'
    ).length,
    deleteDocumentCount: work.metas.filter((meta) => meta.tombstoned).length,
    jobCount: work.jobs.length,
    requiresConfirmation: status === 'pending',
    configurationIdentity: s3LegacyConfigurationIdentity(scope.preferences)
  }
}

/**
 * Discover pre-generation S3 work and persist a review checkpoint. Missing work can be
 * completed automatically; any legacy row/job requires a user-confirmed bucket identity.
 */
export async function prepareS3LegacyMigration(
  scope: MigrationScope,
  input: S3LegacyMigrationDependencies = {}
): Promise<S3LegacyMigrationInspection> {
  const stores = dependencies(input)
  const work = await legacyWork(scope.profileId, stores)
  const configurationIdentity = s3LegacyConfigurationIdentity(scope.preferences)
  if (work.metas.length === 0 && work.jobs.length === 0) {
    const state = stores.stateStore.read(scope.profileId)
    if (state?.status === 'pending') {
      completeS3LegacyMigration(
        scope.profileId,
        scope.authority,
        configurationIdentity,
        stores.stateStore
      )
    } else if (!state) {
      markS3LegacyMigrationComplete(scope.profileId, scope.authority, stores.stateStore)
    } else {
      assertS3LegacyMigrationComplete(scope.profileId, scope.authority, stores.stateStore)
    }
    return inspection(scope, work, 'complete')
  }

  markS3LegacyMigrationPending(
    scope.profileId,
    scope.authority,
    configurationIdentity,
    stores.stateStore
  )
  return inspection(scope, work, 'pending')
}

function assertNoKnownCollisions(
  scope: MigrationScope,
  allMetas: LocalCanvasMeta[],
  legacyMetas: LocalCanvasMeta[]
): void {
  const targetMetaKeys = new Set(
    legacyMetas.map((meta) =>
      localCanvasKey({
        providerId: S3_COMPATIBLE_STORAGE_PROVIDER_ID,
        profileId: scope.profileId,
        documentId: meta.id,
        authority: scope.authority
      })
    )
  )
  if (allMetas.some((meta) => meta.authority && targetMetaKeys.has(meta.key))) {
    throw new Error('Legacy storage migration target already exists')
  }
}

/** Explicit user confirmation that legacy work belongs to the displayed endpoint and bucket. */
export async function confirmS3LegacyMigration(
  scope: MigrationScope & { confirmedConfigurationIdentity: string },
  input: S3LegacyMigrationDependencies = {}
): Promise<S3LegacyMigrationInspection> {
  const stores = dependencies(input)
  const configurationIdentity = s3LegacyConfigurationIdentity(scope.preferences)
  if (scope.confirmedConfigurationIdentity !== configurationIdentity) {
    throw new Error('S3 legacy migration confirmation no longer matches the current configuration')
  }
  beginS3LegacyMigration(scope.profileId, scope.authority, configurationIdentity, stores.stateStore)

  const [allMetas, allJobs] = await Promise.all([
    stores.localStore.listMetas(true),
    stores.outbox.list()
  ])
  const work = {
    metas: allMetas.filter((meta) => isLegacyMeta(meta, scope.profileId)),
    jobs: allJobs.filter((job) => isLegacyJob(job, scope.profileId))
  }
  assertNoKnownCollisions(scope, allMetas, work.metas)

  for (const meta of work.metas) {
    const migrated = await stores.localStore.migrateLegacyAuthority(
      {
        providerId: S3_COMPATIBLE_STORAGE_PROVIDER_ID,
        profileId: scope.profileId,
        documentId: meta.id
      },
      scope.authority,
      { expectedRevision: meta.revision }
    )
    if (!migrated) throw new Error('Legacy storage work changed during migration')
  }
  await stores.outbox.replaceLegacyAuthority({
    providerId: S3_COMPATIBLE_STORAGE_PROVIDER_ID,
    profileId: scope.profileId,
    nextAuthority: scope.authority
  })

  const remaining = await legacyWork(scope.profileId, stores)
  if (remaining.metas.length > 0 || remaining.jobs.length > 0) {
    throw new Error('Legacy storage work remains after migration')
  }
  completeS3LegacyMigration(
    scope.profileId,
    scope.authority,
    configurationIdentity,
    stores.stateStore
  )
  return inspection(scope, remaining, 'complete')
}
