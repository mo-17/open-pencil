import type {
  StorageDocumentAuthority,
  StorageGetDocumentResult,
  StorageRemoteRevision,
  StorageTransferProgress
} from '../types'

export type BaiduNetdiskAccessToken = Readonly<{
  accessToken: string
  authority: StorageDocumentAuthority
}>

export type BaiduNetdiskAccessTokenResolver = (
  signal?: AbortSignal
) => Promise<BaiduNetdiskAccessToken>

export type BaiduNetdiskCapabilityKind = 'download' | 'upload'

export type BaiduNetdiskTransport = ((
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>) & {
  /** Optional second boundary implemented by the Tauri transport. */
  registerCapability?: (kind: BaiduNetdiskCapabilityKind, url: string) => void
}

export type BaiduNetdiskClientLimits = Readonly<{
  maxDownloadBytes?: number
  maxErrorBytes?: number
  maxJsonBytes?: number
  maxListItems?: number
  maxListPages?: number
  maxRedirects?: number
}>

export type BaiduNetdiskClientOptions = Readonly<{
  resolveAccessToken: BaiduNetdiskAccessTokenResolver
  transport?: BaiduNetdiskTransport
  limits?: BaiduNetdiskClientLimits
}>

export type BaiduNetdiskItem = Readonly<{
  fsId: string
  path: string
  serverFilename: string
  size: number
  isDirectory: boolean
  serverMtime: number
  md5: string | null
}>

export type BaiduNetdiskDocumentFile = Readonly<{
  documentId: string
  name: string
  item: BaiduNetdiskItem
}>

export type BaiduNetdiskUploadOptions = Readonly<{
  documentId: string
  name: string
  bytes: Uint8Array
  updatedAt: string
  signal?: AbortSignal
  expectedAuthority?: StorageDocumentAuthority
  onProgress?: (progress: StorageTransferProgress) => void
}>

export type BaiduNetdiskUploadResult = Readonly<{
  document: BaiduNetdiskDocumentFile
  remoteRevision: StorageRemoteRevision
}>

export type BaiduNetdiskPromotionResult =
  | Readonly<{ outcome: 'promoted'; document: BaiduNetdiskDocumentFile }>
  | Readonly<{ outcome: 'preserved'; document: BaiduNetdiskDocumentFile }>

export interface BaiduNetdiskClientContract {
  getAuthority(signal?: AbortSignal): Promise<StorageDocumentAuthority>
  testConnection(signal?: AbortSignal): Promise<void>
  listDocuments(signal?: AbortSignal): Promise<BaiduNetdiskDocumentFile[]>
  getDocumentFile(
    documentId: string,
    options?: Readonly<{
      signal?: AbortSignal
      expectedAuthority?: StorageDocumentAuthority
    }>
  ): Promise<BaiduNetdiskDocumentFile | null>
  downloadDocument(
    documentId: string,
    options?: Readonly<{
      signal?: AbortSignal
      expectedAuthority?: StorageDocumentAuthority
      onProgress?: (progress: StorageTransferProgress) => void
    }>
  ): Promise<StorageGetDocumentResult>
  uploadDocument(options: BaiduNetdiskUploadOptions): Promise<BaiduNetdiskUploadResult>
  promoteDocumentFile(
    staged: BaiduNetdiskDocumentFile,
    documentId: string,
    name: string,
    options?: Readonly<{
      signal?: AbortSignal
      expectedAuthority?: StorageDocumentAuthority
    }>
  ): Promise<BaiduNetdiskPromotionResult>
  trashDocumentFile(
    document: BaiduNetdiskDocumentFile,
    expectedRevision: StorageRemoteRevision,
    options?: Readonly<{
      signal?: AbortSignal
      expectedAuthority?: StorageDocumentAuthority
    }>
  ): Promise<void>
}
