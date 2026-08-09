import { useLocalStorage } from '@vueuse/core'

import { requireStorageProfileID, type StorageDocumentAuthority } from '../types'

const STORAGE_KEY = 'open-pencil:storage:s3-legacy-migrations:v1'

export const S3_LEGACY_MIGRATION_REQUIRED_MESSAGE =
  'Legacy S3 storage work must be reviewed and migrated before this operation'

export type S3LegacyMigrationState =
  | Readonly<{
      status: 'pending'
      accountId: string
      authorizationVersion: string
      configurationIdentity: string
      updatedAt: string
    }>
  | Readonly<{
      status: 'complete'
      accountId: string
      updatedAt: string
    }>

export type S3LegacyMigrationStateStore = {
  read(profileId: string): S3LegacyMigrationState | null
  write(profileId: string, state: S3LegacyMigrationState): void
  remove(profileId: string): void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseState(value: unknown): S3LegacyMigrationState {
  if (
    !isRecord(value) ||
    (value.status !== 'pending' && value.status !== 'complete') ||
    typeof value.accountId !== 'string' ||
    !value.accountId ||
    typeof value.updatedAt !== 'string' ||
    !value.updatedAt
  ) {
    throw new Error('Stored S3 legacy migration state is invalid')
  }
  if (value.status === 'complete') {
    if (Object.keys(value).length !== 3) {
      throw new Error('Stored S3 legacy migration state is invalid')
    }
    return { status: 'complete', accountId: value.accountId, updatedAt: value.updatedAt }
  }
  if (
    typeof value.authorizationVersion !== 'string' ||
    !value.authorizationVersion ||
    typeof value.configurationIdentity !== 'string' ||
    !value.configurationIdentity ||
    Object.keys(value).length !== 5
  ) {
    throw new Error('Stored S3 legacy migration state is invalid')
  }
  return {
    status: 'pending',
    accountId: value.accountId,
    authorizationVersion: value.authorizationVersion,
    configurationIdentity: value.configurationIdentity,
    updatedAt: value.updatedAt
  }
}

export function createMemoryS3LegacyMigrationStateStore(): S3LegacyMigrationStateStore {
  const states = new Map<string, S3LegacyMigrationState>()
  return {
    read(profileId) {
      return states.get(requireStorageProfileID(profileId)) ?? null
    },
    write(profileId, state) {
      states.set(requireStorageProfileID(profileId), { ...state })
    },
    remove(profileId) {
      states.delete(requireStorageProfileID(profileId))
    }
  }
}

const storedStates = useLocalStorage<Partial<Record<string, unknown>>>(STORAGE_KEY, {})

export const s3LegacyMigrationStateStore: S3LegacyMigrationStateStore = {
  read(profileId) {
    const value: unknown = storedStates.value
    if (!isRecord(value)) throw new Error('Stored S3 legacy migration states are invalid')
    const stored = value[requireStorageProfileID(profileId)]
    return stored === undefined ? null : parseState(stored)
  },
  write(profileId, state) {
    const value: unknown = storedStates.value
    if (!isRecord(value)) throw new Error('Stored S3 legacy migration states are invalid')
    storedStates.value = { ...value, [requireStorageProfileID(profileId)]: { ...state } }
  },
  remove(profileId) {
    const id = requireStorageProfileID(profileId)
    const value: unknown = storedStates.value
    if (!isRecord(value)) throw new Error('Stored S3 legacy migration states are invalid')
    storedStates.value = Object.fromEntries(
      Object.entries(value).filter(([candidate]) => candidate !== id)
    )
  }
}

export function s3LegacyConfigurationIdentity(
  preferences: Readonly<Record<string, string | undefined>>
): string {
  return JSON.stringify({
    endpoint: preferences.endpoint?.trim() ?? '',
    bucket: preferences.bucket?.trim() ?? '',
    region: preferences.region?.trim() ?? ''
  })
}

function pendingStateMatches(
  state: S3LegacyMigrationState,
  authority: StorageDocumentAuthority,
  configurationIdentity: string
): state is Extract<S3LegacyMigrationState, { status: 'pending' }> {
  return (
    state.status === 'pending' &&
    state.accountId === authority.accountId &&
    state.authorizationVersion === authority.authorizationVersion &&
    state.configurationIdentity === configurationIdentity
  )
}

export function beginS3LegacyMigration(
  profileId: string,
  authority: StorageDocumentAuthority,
  configurationIdentity: string,
  store: S3LegacyMigrationStateStore = s3LegacyMigrationStateStore
): S3LegacyMigrationState {
  const id = requireStorageProfileID(profileId)
  const existing = store.read(id)
  if (existing?.status === 'complete' && existing.accountId === authority.accountId) return existing
  if (existing && !pendingStateMatches(existing, authority, configurationIdentity)) {
    throw new Error('S3 legacy migration state does not match the current profile configuration')
  }
  if (existing) return existing
  const pending: S3LegacyMigrationState = {
    status: 'pending',
    accountId: authority.accountId,
    authorizationVersion: authority.authorizationVersion,
    configurationIdentity,
    updatedAt: new Date().toISOString()
  }
  store.write(id, pending)
  return pending
}

export function markS3LegacyMigrationPending(
  profileId: string,
  authority: StorageDocumentAuthority,
  configurationIdentity: string,
  store: S3LegacyMigrationStateStore = s3LegacyMigrationStateStore
): S3LegacyMigrationState {
  const id = requireStorageProfileID(profileId)
  const existing = store.read(id)
  if (existing?.status === 'pending') {
    if (!pendingStateMatches(existing, authority, configurationIdentity)) {
      throw new Error('S3 legacy migration state does not match the current profile configuration')
    }
    return existing
  }
  if (existing && existing.accountId !== authority.accountId) {
    throw new Error('S3 legacy migration state belongs to a different profile incarnation')
  }
  const pending: S3LegacyMigrationState = {
    status: 'pending',
    accountId: authority.accountId,
    authorizationVersion: authority.authorizationVersion,
    configurationIdentity,
    updatedAt: new Date().toISOString()
  }
  store.write(id, pending)
  return pending
}

export function completeS3LegacyMigration(
  profileId: string,
  authority: StorageDocumentAuthority,
  configurationIdentity: string,
  store: S3LegacyMigrationStateStore = s3LegacyMigrationStateStore
): void {
  const id = requireStorageProfileID(profileId)
  const existing = store.read(id)
  if (existing?.status === 'complete' && existing.accountId === authority.accountId) return
  if (!existing || !pendingStateMatches(existing, authority, configurationIdentity)) {
    throw new Error('S3 legacy migration completion does not match the pending migration')
  }
  store.write(id, {
    status: 'complete',
    accountId: authority.accountId,
    updatedAt: new Date().toISOString()
  })
}

export function markS3LegacyMigrationComplete(
  profileId: string,
  authority: StorageDocumentAuthority,
  store: S3LegacyMigrationStateStore = s3LegacyMigrationStateStore
): void {
  store.write(requireStorageProfileID(profileId), {
    status: 'complete',
    accountId: authority.accountId,
    updatedAt: new Date().toISOString()
  })
}

export function assertS3LegacyMigrationComplete(
  profileId: string,
  authority: StorageDocumentAuthority,
  store: S3LegacyMigrationStateStore = s3LegacyMigrationStateStore
): void {
  const state = store.read(requireStorageProfileID(profileId))
  if (state?.status !== 'complete' || state.accountId !== authority.accountId) {
    throw new Error(S3_LEGACY_MIGRATION_REQUIRED_MESSAGE)
  }
}
