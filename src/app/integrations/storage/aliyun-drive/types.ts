import type {
  StorageDocumentAuthority,
  StorageRemoteRevision,
  StorageTransferProgress
} from '../types'

export type AliyunDriveOAuthToken = Readonly<{
  accessToken: string
  authority: StorageDocumentAuthority
}>

export type AliyunDriveAccessTokenResolver = (
  signal?: AbortSignal
) => Promise<AliyunDriveOAuthToken>

export type AliyunDriveTransport = (input: string, init?: RequestInit) => Promise<Response>
export type AliyunDriveSleep = (delayMs: number, signal?: AbortSignal) => Promise<void>

export type AliyunDriveClientLimits = Readonly<{
  maxDownloadBytes?: number
  maxErrorBytes?: number
  maxJsonBytes?: number
  maxListPages?: number
  maxListItems?: number
  maxRequestAttempts?: number
  maxUploadAttempts?: number
  maxAsyncTaskPolls?: number
}>

export type AliyunDriveClientOptions = Readonly<{
  resolveAccessToken: AliyunDriveAccessTokenResolver
  transport?: AliyunDriveTransport
  sleep?: AliyunDriveSleep
  limits?: AliyunDriveClientLimits
  uploadChunkBytes?: number
}>

export type AliyunDriveItem = Readonly<{
  driveId: string
  fileId: string
  parentFileId: string
  name: string
  type: 'file' | 'folder'
  size: number | null
  contentHash: string | null
  createdAt: string
  updatedAt: string
}>

export type AliyunDriveNamespace = Readonly<{
  driveId: string
  authorizedRootFolderId: string
  documentsFolderId: string
}>

export type AliyunDriveDocumentFile = Readonly<{
  documentId: string
  folder: AliyunDriveItem
  file: AliyunDriveItem
}>

export type AliyunDriveUploadOptions = Readonly<{
  documentId: string
  name: string
  bytes: Uint8Array
  signal?: AbortSignal
  expectedAuthority?: StorageDocumentAuthority
  onProgress?: (progress: StorageTransferProgress) => void
}>

export type AliyunDriveUploadResult = Readonly<{
  item: AliyunDriveItem
  remoteRevision: StorageRemoteRevision
}>

export type AliyunDriveReplacementOptions = AliyunDriveUploadOptions &
  Readonly<{
    current: AliyunDriveDocumentFile
    expectedRemoteRevision: StorageRemoteRevision
    conflictDocumentId: string
    conflictName: string
  }>

export type AliyunDriveReplacementResult =
  | Readonly<{
      outcome: 'updated'
      item: AliyunDriveItem
      remoteRevision: StorageRemoteRevision
    }>
  | Readonly<{
      outcome: 'conflict-copy'
      remoteRevision: StorageRemoteRevision | null
      conflictDocumentId: string
      conflictCopyRevision: StorageRemoteRevision
    }>
