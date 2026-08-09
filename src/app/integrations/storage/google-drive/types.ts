import type {
  StorageDocumentAuthority,
  StorageGetDocumentResult,
  StorageRemoteRevision,
  StorageTransferOptions
} from '../types'

export const GOOGLE_DRIVE_API_ORIGIN = 'https://www.googleapis.com'
export const GOOGLE_DRIVE_API_BASE = `${GOOGLE_DRIVE_API_ORIGIN}/drive/v3`
export const GOOGLE_DRIVE_UPLOAD_BASE = `${GOOGLE_DRIVE_API_ORIGIN}/upload/drive/v3`
export const GOOGLE_DRIVE_FIG_MIME_TYPE = 'application/octet-stream'
export const GOOGLE_DRIVE_APP_PROPERTY = 'openPencil'
export const GOOGLE_DRIVE_APP_PROPERTY_VALUE = 'document-v1'
export const GOOGLE_DRIVE_CONFLICT_PROPERTY = 'openPencilConflictOf'
export const GOOGLE_DRIVE_UPLOAD_CHUNK_BYTES = 256 * 1024
export const GOOGLE_DRIVE_MAX_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024

export type GoogleDriveOAuthToken = {
  accessToken: string
  expiresAt?: number
  authorizationVersion: string
  /** Stable OIDC `sub`. `subject` is accepted while the native OAuth bridge is landing. */
  accountId?: string
  subject?: string
}

export interface GoogleDriveTokenSource {
  getAccessToken(signal?: AbortSignal): Promise<GoogleDriveOAuthToken>
}

export type GoogleDriveTokenResolver =
  | GoogleDriveTokenSource
  | ((signal?: AbortSignal) => Promise<GoogleDriveOAuthToken>)

export type GoogleDriveTransport = (input: string, init?: RequestInit) => Promise<Response>

export type GoogleDriveSleep = (delayMs: number, signal?: AbortSignal) => Promise<void>

export type GoogleDriveClientLimits = {
  maxDownloadBytes?: number
  maxErrorBytes?: number
  maxJsonBytes?: number
  maxListPages?: number
  maxListItems?: number
  maxChangePages?: number
  maxChanges?: number
  maxRequestAttempts?: number
  maxUploadAttempts?: number
  maxUploadSessionRestarts?: number
}

export type GoogleDriveClientOptions = {
  tokenSource: GoogleDriveTokenResolver
  transport?: GoogleDriveTransport
  sleep?: GoogleDriveSleep
  limits?: GoogleDriveClientLimits
  uploadChunkBytes?: number
}

export type GoogleDriveFile = {
  id: string
  name: string
  mimeType: string
  modifiedTime: string
  size: number | null
  version?: string
  md5Checksum?: string
  headRevisionId?: string
  trashed: boolean
  appProperties: Readonly<Record<string, string>>
  remoteRevision: StorageRemoteRevision | null
}

export type GoogleDriveDownloadResult = StorageGetDocumentResult

export type GoogleDriveUploadMetadata = {
  name: string
  appProperties?: Readonly<Record<string, string>>
}

export type GoogleDriveUploadResult = {
  file: GoogleDriveFile
  remoteRevision: StorageRemoteRevision | null
}

export type GoogleDriveChange = {
  fileId: string
  removed: boolean
  time: string | null
  file: GoogleDriveFile | null
}

export type GoogleDriveChangesResult = {
  changes: GoogleDriveChange[]
  newStartPageToken: string
}

export type GoogleDriveRequestContext = {
  authority: StorageDocumentAuthority
  signal?: AbortSignal
}

export type GoogleDriveUploadOptions = StorageTransferOptions & {
  id: string
  bytes: Uint8Array
  metadata: GoogleDriveUploadMetadata
  expectedEtag?: string
}
