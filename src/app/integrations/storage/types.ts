import type { CredentialManager, CredentialResolver } from '@/app/settings/credentials/types'

export type StorageProviderID = string
export type StorageFieldID = string

export const DEFAULT_STORAGE_PROFILE_ID = 'default'
const STORAGE_PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/
const RESERVED_STORAGE_PROFILE_IDS = new Set(['constructor', 'prototype'])

export function isStorageProfileID(value: string): boolean {
  return (
    value === value.trim() &&
    STORAGE_PROFILE_ID_PATTERN.test(value) &&
    !RESERVED_STORAGE_PROFILE_IDS.has(value)
  )
}

export function requireStorageProfileID(value: string): string {
  if (!isStorageProfileID(value)) {
    throw new Error(
      'Storage profile ID must be 1-64 lowercase letters, numbers, dots, underscores, or hyphens and start with a letter or number'
    )
  }
  return value
}

export type StorageDocumentAuthority = {
  /** Stable provider account identity (for Google, the OIDC subject). */
  accountId: string
  /** Random version for the exact authorization grant that owns durable work. */
  authorizationVersion: string
}

export type StorageDocumentBinding = {
  providerId: StorageProviderID
  profileId: string
  documentId: string
  authority?: StorageDocumentAuthority
}

/** Compatibility input for call sites that predate provider credential profiles. */
export type StorageDocumentBindingInput = Omit<StorageDocumentBinding, 'profileId'> & {
  profileId?: string
}

export function resolveStorageDocumentBinding(
  binding: StorageDocumentBindingInput
): StorageDocumentBinding {
  const providerId = binding.providerId.trim()
  const profileId = requireStorageProfileID(binding.profileId ?? DEFAULT_STORAGE_PROFILE_ID)
  const documentId = binding.documentId.trim()
  const accountId = binding.authority?.accountId.trim()
  const authorizationVersion = binding.authority?.authorizationVersion.trim()
  if (!providerId || !documentId) throw new Error('Storage document binding is invalid')
  if (binding.authority && (!accountId || !authorizationVersion)) {
    throw new Error('Storage document authority is invalid')
  }
  return {
    providerId,
    profileId,
    documentId,
    ...(accountId && authorizationVersion ? { authority: { accountId, authorizationVersion } } : {})
  }
}

/** Collision-free, provider/profile-scoped identity for local mirrors and durable jobs. */
export function storageDocumentKey(binding: StorageDocumentBindingInput): string {
  const resolved = resolveStorageDocumentBinding(binding)
  // S3 configuration generations can represent entirely different endpoints/buckets while
  // retaining the same profile incarnation. Keep their cache/outbox keys generation-scoped.
  // Google Drive intentionally keeps the established account-scoped key so an explicitly
  // confirmed OAuth grant adoption can update the row in place.
  if (resolved.providerId === 's3-compatible' && resolved.authority) {
    return JSON.stringify([
      resolved.providerId,
      resolved.profileId,
      resolved.authority.accountId,
      resolved.authority.authorizationVersion,
      resolved.documentId
    ])
  }
  return JSON.stringify([
    resolved.providerId,
    resolved.profileId,
    resolved.authority?.accountId ?? null,
    resolved.documentId
  ])
}

/**
 * Authority-less bindings are reserved for legacy or explicitly authority-free providers.
 * Authority-aware adapters must reject them, and durable work must remain owned by the exact
 * account/configuration grant that queued it.
 */
export function storageDocumentAuthorityMatches(
  expected: StorageDocumentAuthority | undefined,
  current: StorageDocumentAuthority | null
): boolean {
  if (!expected) return true
  return (
    current?.accountId === expected.accountId &&
    current.authorizationVersion === expected.authorizationVersion
  )
}

/** Exact equality for persisted rows where an absent authority is meaningful. */
export function storageDocumentAuthoritiesEqual(
  expected: StorageDocumentAuthority | null | undefined,
  current: StorageDocumentAuthority | null | undefined
): boolean {
  if (!expected || !current) return expected == null && current == null
  return (
    expected.accountId === current.accountId &&
    expected.authorizationVersion === current.authorizationVersion
  )
}

export type StorageTransferProgress = {
  transferredBytes: number
  totalBytes: number | null
}

export type StorageDocumentMetadata = {
  name: string
  updatedAt: string
}

/** Provider-owned, structured-clone-safe version token. Missing provider fields stay omitted. */
export type StorageRemoteRevision = Readonly<Record<string, string>>

export type StorageDocument = StorageDocumentMetadata & {
  id: string
  remoteRevision?: StorageRemoteRevision | null
  thumbnailURL?: string | null
  metadataAuthoritative?: boolean
}

export type StorageTransferOptions = {
  signal?: AbortSignal
  onProgress?: (progress: StorageTransferProgress) => void
  /** Exact account/grant that must still own every provider request in this operation. */
  expectedAuthority?: StorageDocumentAuthority
}

export type StoragePutDocumentOptions = StorageTransferOptions & {
  expectedRemoteRevision?: StorageRemoteRevision | null
}

export type StorageGetDocumentResult = {
  bytes: Uint8Array
  metadata: StorageDocumentMetadata
  remoteRevision: StorageRemoteRevision | null
}

export type StoragePutDocumentResult =
  | {
      outcome: 'created' | 'updated'
      remoteRevision: StorageRemoteRevision | null
    }
  | {
      outcome: 'conflict'
      remoteRevision: StorageRemoteRevision | null
    }
  | {
      outcome: 'conflict-copy'
      /** Revision of the original bound document after conflict detection. */
      remoteRevision: StorageRemoteRevision | null
      conflictDocumentId: string
      /** Provider revision of the preserved copy, when available. */
      conflictCopyRevision?: StorageRemoteRevision | null
    }

export type StorageUsage = {
  bytesUsed: number
  objectCount: number
  documentCount: number
}

export type StorageConnectionResult = {
  ok: boolean
  message: string
}

export interface StorageAdapter {
  testConnection(options?: Pick<StorageTransferOptions, 'signal'>): Promise<StorageConnectionResult>
  listDocuments(options?: Pick<StorageTransferOptions, 'signal'>): Promise<StorageDocument[]>
  reserveDocumentId?(options?: Pick<StorageTransferOptions, 'signal'>): Promise<string>
  getAuthority?(
    options?: Pick<StorageTransferOptions, 'signal'>
  ): Promise<StorageDocumentAuthority | null>
  getDocument(id: string, options?: StorageTransferOptions): Promise<StorageGetDocumentResult>
  putDocument(
    id: string,
    bytes: Uint8Array,
    metadata: StorageDocumentMetadata,
    options?: StoragePutDocumentOptions
  ): Promise<StoragePutDocumentResult>
  deleteDocument(
    id: string,
    options?: Pick<StorageTransferOptions, 'signal' | 'expectedAuthority'>
  ): Promise<void>
  getDocumentMetadata?(
    id: string,
    options?: Pick<StorageTransferOptions, 'signal' | 'expectedAuthority'>
  ): Promise<(StorageDocumentMetadata & { remoteRevision: StorageRemoteRevision | null }) | null>
  getUsage(options?: Pick<StorageTransferOptions, 'signal'>): Promise<StorageUsage>
  getThumbnail?(
    id: string,
    options?: Pick<StorageTransferOptions, 'signal' | 'expectedAuthority'>
  ): Promise<Uint8Array | null>
  putThumbnail?(id: string, bytes: Uint8Array, options?: StorageTransferOptions): Promise<void>
}

export type StoragePreferenceField = {
  id: StorageFieldID
  label: string
  kind: 'text' | 'url'
  required?: boolean
  placeholder?: string
}

export type StorageCredentialField = {
  id: StorageFieldID
  label: string
  required?: boolean
  placeholder?: string
}

export type StorageProviderRuntime = {
  preferences: Readonly<Record<StorageFieldID, string>>
  profileId: string
  credentialManager: CredentialManager
  credentialResolver: CredentialResolver
  resolveCredential(field: StorageFieldID): Promise<string | null>
}

export type StorageProviderRegistration = {
  id: StorageProviderID
  label: string
  description: string
  preferenceFields: readonly StoragePreferenceField[]
  credentialFields: readonly StorageCredentialField[]
  createAdapter(runtime: StorageProviderRuntime): StorageAdapter
}

export type StorageAdapterContext = {
  preferences: Readonly<Record<StorageFieldID, string>>
  credentials: CredentialResolver
  credentialManager: CredentialManager
  profileId?: string
}
