import {
  GOOGLE_DRIVE_STORAGE_PROVIDER_ID,
  readActiveStorageProfileID,
  readStoredStorageAuthority,
  storageCredentialStatuses,
  storagePreferencesComplete,
  storageProviderPluginEnabled,
  storageProviderRegistry,
  type StorageDocumentAuthority
} from '@/app/integrations/storage'
import {
  queueStorageDocumentCopy,
  queueGoogleDriveDocumentCopy,
  type StorageDocumentCopyInput,
  type StorageDocumentCopyResult,
  type GoogleDriveDocumentCopyInput,
  type GoogleDriveDocumentCopyResult
} from '@/app/storage/workspace/create-copy'

export type GoogleDriveCopySource = Readonly<{
  state: { documentName: string }
  buildFigFileSnapshot(): Promise<{ data: Uint8Array; sceneVersion: number }>
}>

export type GoogleDriveCopyTarget = Readonly<{
  profileId: string
  authority: StorageDocumentAuthority
}>

export type StorageCopyTarget = GoogleDriveCopyTarget & Readonly<{ providerId: string }>

export type GoogleDriveEditorCopyErrorCode = 'in-progress' | 'not-connected'

export class GoogleDriveEditorCopyError extends Error {
  constructor(readonly code: GoogleDriveEditorCopyErrorCode) {
    super(
      code === 'in-progress'
        ? 'A Google Drive copy is already being prepared'
        : 'Google Drive is not connected'
    )
    this.name = 'GoogleDriveEditorCopyError'
  }
}

export class StorageEditorCopyError extends Error {
  constructor(
    readonly code: GoogleDriveEditorCopyErrorCode,
    readonly providerLabel: string
  ) {
    super(
      code === 'in-progress'
        ? `A ${providerLabel} copy is already being prepared`
        : `${providerLabel} is not connected`
    )
    this.name = 'StorageEditorCopyError'
  }
}

export type GoogleDriveEditorCopyDependencies = Readonly<{
  resolveTarget(): Promise<GoogleDriveCopyTarget>
  queue(input: GoogleDriveDocumentCopyInput): Promise<GoogleDriveDocumentCopyResult>
}>

const copiesInProgress = new WeakSet<object>()

async function resolveStorageCopyTarget(providerId: string): Promise<StorageCopyTarget> {
  const profileId = readActiveStorageProfileID(providerId)
  const registration = storageProviderRegistry.get(providerId)
  if (
    !storageProviderPluginEnabled(providerId) ||
    !storagePreferencesComplete(providerId, profileId)
  ) {
    throw new StorageEditorCopyError('not-connected', registration.label)
  }
  const statuses = await storageCredentialStatuses(providerId, profileId)
  const credentialsReady = registration.credentialFields.every(
    (field) => !field.required || statuses[field.id] === 'configured'
  )
  if (!credentialsReady) throw new StorageEditorCopyError('not-connected', registration.label)
  const authority = await readStoredStorageAuthority(providerId, profileId)
  if (registration.authorityMode === 'account-grant' && !authority) {
    throw new StorageEditorCopyError('not-connected', registration.label)
  }
  if (!authority) throw new StorageEditorCopyError('not-connected', registration.label)
  return { providerId, profileId, authority }
}

async function resolveGoogleDriveCopyTarget(): Promise<GoogleDriveCopyTarget> {
  const profileId = readActiveStorageProfileID(GOOGLE_DRIVE_STORAGE_PROVIDER_ID)
  if (
    !storageProviderPluginEnabled(GOOGLE_DRIVE_STORAGE_PROVIDER_ID) ||
    !storagePreferencesComplete(GOOGLE_DRIVE_STORAGE_PROVIDER_ID, profileId)
  ) {
    throw new GoogleDriveEditorCopyError('not-connected')
  }
  const registration = storageProviderRegistry.get(GOOGLE_DRIVE_STORAGE_PROVIDER_ID)
  const statuses = await storageCredentialStatuses(GOOGLE_DRIVE_STORAGE_PROVIDER_ID, profileId)
  const credentialsReady = registration.credentialFields.every(
    (field) => !field.required || statuses[field.id] === 'configured'
  )
  if (!credentialsReady) throw new GoogleDriveEditorCopyError('not-connected')
  const authority = await readStoredStorageAuthority(GOOGLE_DRIVE_STORAGE_PROVIDER_ID, profileId)
  if (!authority) throw new GoogleDriveEditorCopyError('not-connected')
  return { profileId, authority }
}

export type StorageEditorCopyDependencies = Readonly<{
  resolveTarget(providerId: string): Promise<StorageCopyTarget>
  queue(input: StorageDocumentCopyInput): Promise<StorageDocumentCopyResult>
}>

function defaultStorageDependencies(): StorageEditorCopyDependencies {
  return {
    resolveTarget: resolveStorageCopyTarget,
    queue: queueStorageDocumentCopy
  }
}

/** Build and queue an independent cloud copy without changing the editor source identity. */
export async function queueEditorDocumentCopyToStorage(
  source: GoogleDriveCopySource,
  providerId: string,
  dependencies?: StorageEditorCopyDependencies
): Promise<StorageDocumentCopyResult> {
  const providerLabel = storageProviderRegistry.get(providerId).label
  if (copiesInProgress.has(source)) throw new StorageEditorCopyError('in-progress', providerLabel)
  copiesInProgress.add(source)
  try {
    const runtime = dependencies ?? defaultStorageDependencies()
    const target = await runtime.resolveTarget(providerId)
    const snapshot = await source.buildFigFileSnapshot()
    return await runtime.queue({
      providerId,
      profileId: target.profileId,
      authority: target.authority,
      name: source.state.documentName,
      figBytes: snapshot.data
    })
  } finally {
    copiesInProgress.delete(source)
  }
}

function defaultDependencies(): GoogleDriveEditorCopyDependencies {
  return {
    resolveTarget: resolveGoogleDriveCopyTarget,
    queue: queueGoogleDriveDocumentCopy
  }
}

/** Build and queue an independent Drive copy without changing the editor's source identity. */
export async function queueEditorDocumentCopyToGoogleDrive(
  source: GoogleDriveCopySource,
  dependencies?: GoogleDriveEditorCopyDependencies
): Promise<GoogleDriveDocumentCopyResult> {
  if (copiesInProgress.has(source)) throw new GoogleDriveEditorCopyError('in-progress')
  copiesInProgress.add(source)
  try {
    const runtime = dependencies ?? defaultDependencies()
    const name = source.state.documentName
    const target = await runtime.resolveTarget()
    const snapshot = await source.buildFigFileSnapshot()
    return await runtime.queue({
      profileId: target.profileId,
      authority: target.authority,
      name,
      figBytes: snapshot.data
    })
  } finally {
    copiesInProgress.delete(source)
  }
}
