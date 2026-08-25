import type {
  StorageDocumentAuthority,
  StorageRemoteRevision,
  StorageTransferProgress
} from '../types'

export type OneDriveOAuthToken = Readonly<{
  accessToken: string
  authority: StorageDocumentAuthority
}>

export interface OneDriveTokenSource {
  getAccessToken(signal?: AbortSignal): Promise<OneDriveOAuthToken>
}

export type OneDriveTransport = (input: string, init?: RequestInit) => Promise<Response>
export type OneDriveSleep = (delayMs: number, signal?: AbortSignal) => Promise<void>

export type OneDriveClientLimits = Readonly<{
  maxDownloadBytes?: number
  maxErrorBytes?: number
  maxJsonBytes?: number
  maxListPages?: number
  maxListItems?: number
  maxRequestAttempts?: number
  maxUploadAttempts?: number
  maxUploadSessionRestarts?: number
}>

export type OneDriveClientOptions = Readonly<{
  tokenSource: OneDriveTokenSource
  transport?: OneDriveTransport
  sleep?: OneDriveSleep
  limits?: OneDriveClientLimits
  uploadChunkBytes?: number
}>

export type OneDriveParentReference = Readonly<{
  driveId: string
  id: string
}>

export type OneDriveItem = Readonly<{
  id: string
  name: string
  size: number | null
  lastModifiedDateTime: string
  eTag: string | null
  cTag: string | null
  parentReference: OneDriveParentReference | null
  file: boolean
  folder: boolean
  deleted: boolean
  remoteItem: boolean
  downloadUrl: string | null
}>

export type OneDriveNamespace = Readonly<{
  driveId: string
  appRootId: string
  documentsFolderId: string
}>

export type OneDriveDocumentFile = Readonly<{
  documentId: string
  folder: OneDriveItem
  file: OneDriveItem
}>

export type OneDriveUploadOptions = Readonly<{
  documentId: string
  itemId?: string
  expectedEtag?: string
  name: string
  bytes: Uint8Array
  signal?: AbortSignal
  expectedAuthority?: StorageDocumentAuthority
  onProgress?: (progress: StorageTransferProgress) => void
}>

export type OneDriveUploadResult = Readonly<{
  item: OneDriveItem
  remoteRevision: StorageRemoteRevision
}>
