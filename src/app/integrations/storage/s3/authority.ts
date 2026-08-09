import { useLocalStorage } from '@vueuse/core'

import { credentialRef } from '@/app/settings/credentials/reference'
import type { CredentialManager } from '@/app/settings/credentials/types'

import {
  requireStorageProfileID,
  storageDocumentAuthoritiesEqual,
  type StorageDocumentAuthority
} from '../types'
import {
  assertS3LegacyMigrationComplete,
  markS3LegacyMigrationComplete,
  s3LegacyMigrationStateStore
} from './legacy-migration-state'

export const S3_COMPATIBLE_STORAGE_PROVIDER_ID = 's3-compatible'

export type S3CredentialField = 'access-key-id' | 'secret-access-key'

type StoredS3Authority = Readonly<{
  accountId: string
  authorizationVersion: string
}>

const storedAuthorities = useLocalStorage<Partial<Record<string, StoredS3Authority>>>(
  'open-pencil:storage:s3-authorities:v1',
  {}
)

const ACCOUNT_ID_PATTERN = /^s3-profile-[a-f0-9]{32}$/
const AUTHORIZATION_VERSION_PATTERN = /^[a-f0-9]{32}$/
const S3_CREDENTIAL_FIELDS = new Set<S3CredentialField>(['access-key-id', 'secret-access-key'])

function randomHex(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function authorityMap(): Partial<Record<string, StoredS3Authority>> {
  const value: unknown = storedAuthorities.value
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Stored S3 profile authorizations are invalid')
  }
  return value as Partial<Record<string, StoredS3Authority>>
}

function parseStoredAuthority(value: unknown): StorageDocumentAuthority {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !('accountId' in value) ||
    !('authorizationVersion' in value) ||
    typeof value.accountId !== 'string' ||
    typeof value.authorizationVersion !== 'string' ||
    !ACCOUNT_ID_PATTERN.test(value.accountId) ||
    !AUTHORIZATION_VERSION_PATTERN.test(value.authorizationVersion) ||
    Object.keys(value).length !== 2
  ) {
    throw new Error('Stored S3 profile authorization is invalid')
  }
  return {
    accountId: value.accountId,
    authorizationVersion: value.authorizationVersion
  }
}

function writeAuthority(profileId: string, authority: StorageDocumentAuthority): void {
  storedAuthorities.value = {
    ...authorityMap(),
    [profileId]: { ...authority }
  }
}

/**
 * Initializes an explicit authority boundary for pre-generation S3 profiles.
 * Legacy authority-less local rows/jobs remain authority-less and are rejected by sync.
 */
export function ensureS3StorageAuthority(profileId: string): StorageDocumentAuthority {
  const id = requireStorageProfileID(profileId)
  const stored: unknown = authorityMap()[id]
  if (stored !== undefined) return parseStoredAuthority(stored)
  const authority = {
    accountId: `s3-profile-${randomHex()}`,
    authorizationVersion: randomHex()
  }
  writeAuthority(id, authority)
  return authority
}

/** Rotate before mutating configuration so a crash can only strand old work, never misroute it. */
export function rotateS3StorageAuthorization(profileId: string): StorageDocumentAuthority {
  const id = requireStorageProfileID(profileId)
  const current = ensureS3StorageAuthority(id)
  assertS3LegacyMigrationComplete(id, current)
  const authority = {
    accountId: current.accountId,
    authorizationVersion: randomHex()
  }
  writeAuthority(id, authority)
  return authority
}

export function removeS3StorageAuthority(profileId: string): void {
  const id = requireStorageProfileID(profileId)
  storedAuthorities.value = Object.fromEntries(
    Object.entries(authorityMap()).filter(([candidate]) => candidate !== id)
  )
  s3LegacyMigrationStateStore.remove(id)
}

/** New profiles cannot contain pre-generation work, so establish their completed checkpoint. */
export function markNewS3StorageProfile(profileId: string): StorageDocumentAuthority {
  const authority = ensureS3StorageAuthority(profileId)
  markS3LegacyMigrationComplete(profileId, authority)
  return authority
}

export function assertS3StorageAuthority(
  profileId: string,
  expected: StorageDocumentAuthority | undefined,
  required = false
): StorageDocumentAuthority {
  const current = ensureS3StorageAuthority(profileId)
  if (required) assertS3LegacyMigrationComplete(profileId, current)
  if (required && !expected) {
    throw new Error('S3 storage mutation requires an exact profile authorization')
  }
  if (expected && !storageDocumentAuthoritiesEqual(expected, current)) {
    throw new Error('S3 storage profile configuration changed during the operation')
  }
  return current
}

function requireCredentialField(field: S3CredentialField): S3CredentialField {
  if (!S3_CREDENTIAL_FIELDS.has(field)) throw new Error(`Unknown S3 credential field: ${field}`)
  return field
}

/** Replacing a secret is intentionally treated as a new grant without ever reading it back. */
export async function setS3StorageCredential(
  manager: CredentialManager,
  profileId: string,
  field: S3CredentialField,
  value: string
): Promise<void> {
  const id = requireStorageProfileID(profileId)
  const normalizedField = requireCredentialField(field)
  rotateS3StorageAuthorization(id)
  await manager.set(credentialRef(S3_COMPATIBLE_STORAGE_PROVIDER_ID, normalizedField, id), value)
}

export async function clearS3StorageCredential(
  manager: CredentialManager,
  profileId: string,
  field: S3CredentialField
): Promise<void> {
  const id = requireStorageProfileID(profileId)
  const normalizedField = requireCredentialField(field)
  const reference = credentialRef(S3_COMPATIBLE_STORAGE_PROVIDER_ID, normalizedField, id)
  if ((await manager.status(reference)) !== 'configured') return
  rotateS3StorageAuthorization(id)
  await manager.clear(reference)
}
