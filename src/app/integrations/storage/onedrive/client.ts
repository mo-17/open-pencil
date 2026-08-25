/* oxlint-disable eslint/max-lines -- One client owns Graph origin policy, hierarchy validation, bounded transfer, and grant-bound resumable upload. */

import type {
  StorageDocumentAuthority,
  StorageGetDocumentResult,
  StorageRemoteRevision,
  StorageTransferOptions
} from '../types'
import {
  ONEDRIVE_APP_DOCUMENTS_FOLDER,
  ONEDRIVE_GRAPH_BASE,
  ONEDRIVE_GRAPH_ORIGIN,
  ONEDRIVE_MAX_UPLOAD_CHUNK_BYTES,
  ONEDRIVE_UPLOAD_CHUNK_BYTES,
  ONEDRIVE_UPLOAD_GRANULARITY_BYTES
} from './config'
import {
  isOneDriveAbortError,
  isRetryableOneDriveStatus,
  OneDriveError,
  oneDriveErrorCodeForStatus,
  parseOneDriveRetryAfter,
  throwIfOneDriveAborted
} from './errors'
import type {
  OneDriveClientLimits,
  OneDriveClientOptions,
  OneDriveDocumentFile,
  OneDriveItem,
  OneDriveNamespace,
  OneDriveOAuthToken,
  OneDriveSleep,
  OneDriveTransport,
  OneDriveUploadOptions,
  OneDriveUploadResult
} from './types'

const DOCUMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const MAX_IDENTIFIER_LENGTH = 512
const DEFAULT_MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024
const DEFAULT_MAX_ERROR_BYTES = 32 * 1024
const DEFAULT_MAX_JSON_BYTES = 1024 * 1024
const DEFAULT_MAX_LIST_PAGES = 32
const DEFAULT_MAX_LIST_ITEMS = 2_000
const DEFAULT_MAX_REQUEST_ATTEMPTS = 3
const DEFAULT_MAX_UPLOAD_ATTEMPTS = 4
const DEFAULT_MAX_UPLOAD_SESSION_RESTARTS = 1
const MAX_BACKOFF_MS = 30_000

type ResolvedLimits = Required<OneDriveClientLimits>

type RequestOptions = Readonly<{
  signal?: AbortSignal
  expectedAuthority?: StorageDocumentAuthority
  retry?: boolean
}>

type DocumentLookupOptions = Readonly<{
  itemId?: string
  signal?: AbortSignal
  expectedAuthority?: StorageDocumentAuthority
}>

type UploadSession = Readonly<{
  uploadUrl: string
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown, field: string, max = MAX_IDENTIFIER_LENGTH): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new OneDriveError('invalid-response', `OneDrive returned an invalid ${field}`)
  }
  return value
}

function optionalString(value: unknown, max = MAX_IDENTIFIER_LENGTH): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null
}

function boundedPositiveInteger(
  value: number | undefined,
  fallback: number,
  field: string,
  maximum: number
): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > maximum) {
    throw new OneDriveError('invalid-input', `${field} is invalid`)
  }
  return resolved
}

function resolveLimits(limits: OneDriveClientLimits | undefined): ResolvedLimits {
  return {
    maxDownloadBytes: boundedPositiveInteger(
      limits?.maxDownloadBytes,
      DEFAULT_MAX_DOWNLOAD_BYTES,
      'OneDrive download byte limit',
      2 * 1024 * 1024 * 1024
    ),
    maxErrorBytes: boundedPositiveInteger(
      limits?.maxErrorBytes,
      DEFAULT_MAX_ERROR_BYTES,
      'OneDrive error byte limit',
      1024 * 1024
    ),
    maxJsonBytes: boundedPositiveInteger(
      limits?.maxJsonBytes,
      DEFAULT_MAX_JSON_BYTES,
      'OneDrive JSON byte limit',
      16 * 1024 * 1024
    ),
    maxListPages: boundedPositiveInteger(
      limits?.maxListPages,
      DEFAULT_MAX_LIST_PAGES,
      'OneDrive list page limit',
      1_000
    ),
    maxListItems: boundedPositiveInteger(
      limits?.maxListItems,
      DEFAULT_MAX_LIST_ITEMS,
      'OneDrive list item limit',
      100_000
    ),
    maxRequestAttempts: boundedPositiveInteger(
      limits?.maxRequestAttempts,
      DEFAULT_MAX_REQUEST_ATTEMPTS,
      'OneDrive request attempt limit',
      10
    ),
    maxUploadAttempts: boundedPositiveInteger(
      limits?.maxUploadAttempts,
      DEFAULT_MAX_UPLOAD_ATTEMPTS,
      'OneDrive upload attempt limit',
      10
    ),
    maxUploadSessionRestarts:
      boundedPositiveInteger(
        limits?.maxUploadSessionRestarts === undefined
          ? undefined
          : limits.maxUploadSessionRestarts + 1,
        DEFAULT_MAX_UPLOAD_SESSION_RESTARTS + 1,
        'OneDrive upload session restart limit',
        4
      ) - 1
  }
}

function validateUploadChunkBytes(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < ONEDRIVE_UPLOAD_GRANULARITY_BYTES ||
    value > ONEDRIVE_MAX_UPLOAD_CHUNK_BYTES ||
    value % ONEDRIVE_UPLOAD_GRANULARITY_BYTES !== 0
  ) {
    throw new OneDriveError(
      'invalid-input',
      'OneDrive upload chunks must be a multiple of 320 KiB and at most 10 MiB'
    )
  }
  return value
}

function validateDocumentId(value: string): string {
  if (!DOCUMENT_ID_PATTERN.test(value)) {
    throw new OneDriveError('invalid-input', 'OneDrive document ID must be a canonical UUID v4')
  }
  return value
}

function validateItemId(value: string): string {
  if (
    value !== value.trim() ||
    value.length === 0 ||
    value.length > MAX_IDENTIFIER_LENGTH ||
    hasControlCharacter(value)
  ) {
    throw new OneDriveError('invalid-input', 'OneDrive item ID is invalid')
  }
  return value
}

function validateEtag(value: string): string {
  if (
    value !== value.trim() ||
    value.length === 0 ||
    value.length > 1_024 ||
    /[\r\n]/.test(value)
  ) {
    throw new OneDriveError('invalid-input', 'OneDrive ETag is invalid')
  }
  return value
}

function validateFigName(value: string): string {
  if (
    value !== value.trim() ||
    value.length < 5 ||
    value.length > 255 ||
    !value.toLocaleLowerCase().endsWith('.fig') ||
    hasControlCharacter(value) ||
    /["*/:<>?\\|#%]/.test(value) ||
    value.startsWith('~') ||
    /[. ]$/.test(value)
  ) {
    throw new OneDriveError('invalid-input', 'OneDrive document name is invalid')
  }
  return value
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127
  })
}

function authoritiesEqual(
  left: StorageDocumentAuthority,
  right: StorageDocumentAuthority
): boolean {
  return (
    left.accountId === right.accountId && left.authorizationVersion === right.authorizationVersion
  )
}

function validateAuthority(value: StorageDocumentAuthority): StorageDocumentAuthority {
  const accountId = value.accountId.trim()
  const authorizationVersion = value.authorizationVersion.trim()
  if (
    !accountId ||
    !authorizationVersion ||
    accountId.length > 512 ||
    authorizationVersion.length > 512
  ) {
    throw new OneDriveError('auth', 'OneDrive authorization identity is invalid')
  }
  return { accountId, authorizationVersion }
}

function validateToken(value: OneDriveOAuthToken): OneDriveOAuthToken {
  const accessToken = value.accessToken.trim()
  if (!accessToken || accessToken.length > 32_768 || /[\r\n]/.test(accessToken)) {
    throw new OneDriveError('auth', 'OneDrive access token is unavailable')
  }
  return { accessToken, authority: validateAuthority(value.authority) }
}

function graphURL(path: string): string {
  return `${ONEDRIVE_GRAPH_BASE}${path}`
}

function validateGraphURL(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch (error) {
    throw new OneDriveError('invalid-response', 'OneDrive returned an invalid Graph URL', {
      cause: error
    })
  }
  if (
    url.origin !== ONEDRIVE_GRAPH_ORIGIN ||
    (url.pathname !== '/v1.0' && !url.pathname.startsWith('/v1.0/')) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new OneDriveError('invalid-response', 'OneDrive returned an untrusted Graph URL')
  }
  return url.toString()
}

type CapabilityKind = 'download' | 'upload-session'

function isMicrosoftCapabilityHost(hostname: string, kind: CapabilityKind): boolean {
  const host = hostname.toLocaleLowerCase()
  const suffixes =
    kind === 'upload-session'
      ? ['up.1drv.com', 'sharepoint.com']
      : ['files.1drv.com', 'sharepoint.com', 'sharepoint-df.com']
  return suffixes.some((suffix) => host.length > suffix.length + 1 && host.endsWith(`.${suffix}`))
}

function validateCapabilityURL(value: string, kind: CapabilityKind): string {
  let url: URL
  try {
    url = new URL(value)
  } catch (error) {
    throw new OneDriveError('invalid-response', 'OneDrive returned an invalid capability URL', {
      cause: error
    })
  }
  if (
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    !isMicrosoftCapabilityHost(url.hostname, kind)
  ) {
    throw new OneDriveError('invalid-response', 'OneDrive returned an untrusted capability URL')
  }
  return url.toString()
}

function parseSize(value: unknown): number | null {
  if (value === undefined || value === null) return null
  const size = typeof value === 'string' ? Number(value) : value
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) {
    throw new OneDriveError('invalid-response', 'OneDrive returned an invalid item size')
  }
  return size
}

function parseItem(value: unknown): OneDriveItem {
  if (!isRecord(value)) {
    throw new OneDriveError('invalid-response', 'OneDrive returned an invalid drive item')
  }
  const lastModifiedDateTime = requiredString(
    value.lastModifiedDateTime,
    'drive item modification time',
    128
  )
  if (!Number.isFinite(Date.parse(lastModifiedDateTime))) {
    throw new OneDriveError('invalid-response', 'OneDrive returned an invalid modification time')
  }
  const parent = value.parentReference
  const parentReference = isRecord(parent)
    ? {
        driveId: requiredString(parent.driveId, 'parent drive ID'),
        id: requiredString(parent.id, 'parent item ID')
      }
    : null
  return {
    id: requiredString(value.id, 'drive item ID'),
    name: requiredString(value.name, 'drive item name', 1_024),
    size: parseSize(value.size),
    lastModifiedDateTime,
    eTag: optionalString(value.eTag, 1_024),
    cTag: optionalString(value.cTag, 1_024),
    parentReference,
    file: isRecord(value.file),
    folder: isRecord(value.folder),
    deleted: isRecord(value.deleted),
    remoteItem: isRecord(value.remoteItem),
    downloadUrl: optionalString(value['@microsoft.graph.downloadUrl'], 16_384)
  }
}

function remoteRevisionFor(item: OneDriveItem): StorageRemoteRevision {
  if (!item.file || !item.eTag) {
    throw new OneDriveError('invalid-response', 'OneDrive file is missing a whole-item ETag')
  }
  return { itemId: item.id, etag: item.eTag }
}

function retryDelay(response: Response | null, attempt: number): number {
  const retryAfter = response ? parseOneDriveRetryAfter(response.headers.get('retry-after')) : null
  if (retryAfter !== null) return retryAfter
  return Math.min(250 * 2 ** Math.max(0, attempt - 1), MAX_BACKOFF_MS)
}

const defaultSleep: OneDriveSleep = async (delayMs, signal) => {
  throwIfOneDriveAborted(signal)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs)
    const abort = () => {
      clearTimeout(timer)
      reject(
        new OneDriveError('aborted', 'OneDrive operation was cancelled', {
          cause: signal?.reason
        })
      )
    }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
}

async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined)
}

export class OneDriveClient {
  readonly #tokenSource: OneDriveClientOptions['tokenSource']
  readonly #transport: OneDriveTransport
  readonly #sleep: OneDriveSleep
  readonly #limits: ResolvedLimits
  readonly #uploadChunkBytes: number

  constructor(options: OneDriveClientOptions) {
    this.#tokenSource = options.tokenSource
    this.#transport = options.transport ?? ((input, init) => fetch(input, init))
    this.#sleep = options.sleep ?? defaultSleep
    this.#limits = resolveLimits(options.limits)
    this.#uploadChunkBytes = validateUploadChunkBytes(
      options.uploadChunkBytes ?? ONEDRIVE_UPLOAD_CHUNK_BYTES
    )
  }

  async #resolveToken(
    signal?: AbortSignal,
    expectedAuthority?: StorageDocumentAuthority
  ): Promise<OneDriveOAuthToken> {
    throwIfOneDriveAborted(signal)
    const token = validateToken(await this.#tokenSource.getAccessToken(signal))
    if (
      expectedAuthority &&
      !authoritiesEqual(token.authority, validateAuthority(expectedAuthority))
    ) {
      throw new OneDriveError(
        'authorization-changed',
        'OneDrive authorization changed during the operation'
      )
    }
    return token
  }

  async getAuthority(signal?: AbortSignal): Promise<StorageDocumentAuthority> {
    return (await this.#resolveToken(signal)).authority
  }

  async #readBytes(
    response: Response,
    limit: number,
    onProgress?: StorageTransferOptions['onProgress']
  ): Promise<Uint8Array> {
    const declaredValue = response.headers.get('content-length')
    const declared = declaredValue === null ? null : Number(declaredValue)
    if (declared !== null && (!Number.isSafeInteger(declared) || declared < 0)) {
      await discard(response)
      throw new OneDriveError('invalid-response', 'OneDrive returned an invalid content length')
    }
    if (declared !== null && declared > limit) {
      await discard(response)
      throw new OneDriveError('resource-limit', 'OneDrive response exceeded the byte limit')
    }
    if (!response.body) return new Uint8Array()
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > limit) {
        await reader.cancel().catch(() => undefined)
        throw new OneDriveError('resource-limit', 'OneDrive response exceeded the byte limit')
      }
      chunks.push(value)
      onProgress?.({ transferredBytes: received, totalBytes: declared })
    }
    if (declared !== null && received !== declared) {
      throw new OneDriveError(
        'invalid-response',
        'OneDrive response length did not match its header'
      )
    }
    const output = new Uint8Array(received)
    let offset = 0
    for (const chunk of chunks) {
      output.set(chunk, offset)
      offset += chunk.byteLength
    }
    return output
  }

  async #readJson(response: Response): Promise<unknown> {
    const bytes = await this.#readBytes(response, this.#limits.maxJsonBytes)
    if (bytes.byteLength === 0) {
      throw new OneDriveError('invalid-response', 'OneDrive returned an empty JSON response')
    }
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown
    } catch (error) {
      throw new OneDriveError('invalid-response', 'OneDrive returned invalid JSON', {
        cause: error
      })
    }
  }

  async #responseError(response: Response): Promise<OneDriveError> {
    let message = `OneDrive request failed (${response.status})`
    let reason: string | null = null
    try {
      const bytes = await this.#readBytes(response, this.#limits.maxErrorBytes)
      const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown
      if (isRecord(value) && isRecord(value.error)) {
        const candidate = optionalString(value.error.message, 2_048)
        if (candidate) message = candidate
        reason = optionalString(value.error.code, 256)
      }
    } catch (error) {
      void error
      // The bounded status fallback is intentionally retained for malformed error bodies.
    }
    return new OneDriveError(oneDriveErrorCodeForStatus(response.status), message, {
      status: response.status,
      reason,
      retryable: isRetryableOneDriveStatus(response.status),
      retryAfterMs: parseOneDriveRetryAfter(response.headers.get('retry-after'))
    })
  }

  async #graphRequest(
    input: string,
    init: RequestInit = {},
    options: RequestOptions = {}
  ): Promise<Response> {
    const url = validateGraphURL(input)
    const attempts = options.retry === false ? 1 : this.#limits.maxRequestAttempts
    for (let attempt = 1; attempt <= attempts; attempt++) {
      throwIfOneDriveAborted(options.signal)
      const token = await this.#resolveToken(options.signal, options.expectedAuthority)
      const headers = new Headers(init.headers)
      headers.set('Authorization', `Bearer ${token.accessToken}`)
      headers.set('Accept', 'application/json')
      try {
        const response = await this.#transport(url, {
          ...init,
          headers,
          signal: options.signal,
          credentials: 'omit',
          redirect: 'error'
        })
        if (attempt === attempts || !isRetryableOneDriveStatus(response.status)) return response
        const delayMs = retryDelay(response, attempt)
        await discard(response)
        await this.#sleep(delayMs, options.signal)
      } catch (error) {
        if (isOneDriveAbortError(error) || options.signal?.aborted) {
          throw new OneDriveError('aborted', 'OneDrive operation was cancelled', { cause: error })
        }
        if (attempt === attempts) {
          throw new OneDriveError('network', 'OneDrive network request failed', {
            retryable: true,
            cause: error
          })
        }
        await this.#sleep(retryDelay(null, attempt), options.signal)
      }
    }
    throw new OneDriveError('network', 'OneDrive request retry limit was reached')
  }

  async #expect(response: Response, statuses: readonly number[]): Promise<Response> {
    if (!statuses.includes(response.status)) throw await this.#responseError(response)
    return response
  }

  async #getItem(
    driveId: string,
    itemId: string,
    signal?: AbortSignal,
    expectedAuthority?: StorageDocumentAuthority
  ): Promise<OneDriveItem | null> {
    const response = await this.#graphRequest(
      graphURL(
        `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(validateItemId(itemId))}`
      ),
      { method: 'GET' },
      { signal, expectedAuthority }
    )
    if (response.status === 404) {
      await discard(response)
      return null
    }
    await this.#expect(response, [200])
    return parseItem(await this.#readJson(response))
  }

  async #listChildren(
    driveId: string,
    parentId: string,
    signal?: AbortSignal,
    expectedAuthority?: StorageDocumentAuthority
  ): Promise<OneDriveItem[]> {
    const initial = new URL(
      graphURL(
        `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(validateItemId(parentId))}/children`
      )
    )
    initial.searchParams.set('$top', '200')
    let next: string | null = initial.toString()
    const items: OneDriveItem[] = []
    for (let page = 0; next && page < this.#limits.maxListPages; page++) {
      const response = await this.#graphRequest(
        next,
        { method: 'GET' },
        { signal, expectedAuthority }
      )
      await this.#expect(response, [200])
      const value = await this.#readJson(response)
      if (!isRecord(value) || !Array.isArray(value.value)) {
        throw new OneDriveError('invalid-response', 'OneDrive returned an invalid children page')
      }
      for (const raw of value.value) {
        items.push(parseItem(raw))
        if (items.length > this.#limits.maxListItems) {
          throw new OneDriveError('resource-limit', 'OneDrive children exceeded the item limit')
        }
      }
      const candidate = value['@odata.nextLink']
      next =
        candidate === undefined
          ? null
          : validateGraphURL(requiredString(candidate, 'next link', 16_384))
    }
    if (next) {
      throw new OneDriveError('resource-limit', 'OneDrive children exceeded the page limit')
    }
    return items
  }

  #validateDirectChild(
    item: OneDriveItem,
    driveId: string,
    parentId: string,
    kind: 'file' | 'folder'
  ): void {
    const hasKind = kind === 'file' ? item.file && !item.folder : item.folder && !item.file
    if (
      !hasKind ||
      item.deleted ||
      item.remoteItem ||
      item.parentReference?.driveId !== driveId ||
      item.parentReference.id !== parentId
    ) {
      throw new OneDriveError('foreign-file', 'OneDrive item is outside the OpenPencil folder')
    }
  }

  async #createFolder(
    driveId: string,
    parentId: string,
    name: string,
    signal?: AbortSignal,
    expectedAuthority?: StorageDocumentAuthority
  ): Promise<OneDriveItem> {
    const response = await this.#graphRequest(
      graphURL(
        `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(validateItemId(parentId))}/children`
      ),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          folder: {},
          '@microsoft.graph.conflictBehavior': 'fail'
        })
      },
      { signal, expectedAuthority }
    )
    await this.#expect(response, [200, 201])
    const folder = parseItem(await this.#readJson(response))
    this.#validateDirectChild(folder, driveId, parentId, 'folder')
    if (folder.name !== name) {
      throw new OneDriveError('invalid-response', 'OneDrive created an unexpected folder name')
    }
    return folder
  }

  async #findNamedFolder(
    driveId: string,
    parentId: string,
    name: string,
    signal?: AbortSignal,
    expectedAuthority?: StorageDocumentAuthority
  ): Promise<OneDriveItem | null> {
    const matches = (await this.#listChildren(driveId, parentId, signal, expectedAuthority)).filter(
      (item) => item.name === name && !item.deleted && !item.remoteItem
    )
    if (matches.length === 0) return null
    if (matches.length !== 1) {
      throw new OneDriveError('foreign-file', 'OneDrive contains ambiguous OpenPencil folders')
    }
    this.#validateDirectChild(matches[0], driveId, parentId, 'folder')
    return matches[0]
  }

  async #ensureNamedFolder(
    driveId: string,
    parentId: string,
    name: string,
    signal?: AbortSignal,
    expectedAuthority?: StorageDocumentAuthority
  ): Promise<OneDriveItem> {
    const existing = await this.#findNamedFolder(driveId, parentId, name, signal, expectedAuthority)
    if (existing) return existing
    try {
      return await this.#createFolder(driveId, parentId, name, signal, expectedAuthority)
    } catch (error) {
      if (!(error instanceof OneDriveError) || error.code !== 'conflict') throw error
      const raced = await this.#findNamedFolder(driveId, parentId, name, signal, expectedAuthority)
      if (!raced) throw error
      return raced
    }
  }

  async #namespace(
    signal?: AbortSignal,
    expectedAuthority?: StorageDocumentAuthority
  ): Promise<OneDriveNamespace> {
    const appRootResponse = await this.#graphRequest(
      graphURL('/me/drive/special/approot'),
      { method: 'GET' },
      { signal, expectedAuthority }
    )
    await this.#expect(appRootResponse, [200])
    const appRoot = parseItem(await this.#readJson(appRootResponse))
    if (appRoot.deleted || appRoot.remoteItem || !appRoot.folder) {
      throw new OneDriveError('foreign-file', 'OneDrive app root is invalid')
    }
    const driveId = requiredString(appRoot.parentReference?.driveId, 'app root drive ID')
    const documents = await this.#ensureNamedFolder(
      driveId,
      appRoot.id,
      ONEDRIVE_APP_DOCUMENTS_FOLDER,
      signal,
      expectedAuthority
    )
    return { driveId, appRootId: appRoot.id, documentsFolderId: documents.id }
  }

  async testConnection(signal?: AbortSignal): Promise<void> {
    await this.#namespace(signal)
  }

  async #findDocumentFolder(
    namespace: OneDriveNamespace,
    documentId: string,
    signal?: AbortSignal,
    expectedAuthority?: StorageDocumentAuthority
  ): Promise<OneDriveItem | null> {
    return this.#findNamedFolder(
      namespace.driveId,
      namespace.documentsFolderId,
      validateDocumentId(documentId),
      signal,
      expectedAuthority
    )
  }

  async #fileInFolder(
    namespace: OneDriveNamespace,
    folder: OneDriveItem,
    options: DocumentLookupOptions,
    strict: boolean
  ): Promise<OneDriveItem | null> {
    const candidates = options.itemId
      ? [
          await this.#getItem(
            namespace.driveId,
            options.itemId,
            options.signal,
            options.expectedAuthority
          )
        ].filter((item): item is OneDriveItem => item !== null)
      : await this.#listChildren(
          namespace.driveId,
          folder.id,
          options.signal,
          options.expectedAuthority
        )
    const files = candidates.filter(
      (item) =>
        item.file &&
        !item.folder &&
        !item.deleted &&
        !item.remoteItem &&
        item.name.toLocaleLowerCase().endsWith('.fig')
    )
    if (files.length === 0) return null
    if (files.length !== 1) {
      if (!strict) return null
      throw new OneDriveError('foreign-file', 'OneDrive document folder is ambiguous')
    }
    const file = files[0]
    try {
      this.#validateDirectChild(file, namespace.driveId, folder.id, 'file')
      remoteRevisionFor(file)
      return file
    } catch (error) {
      if (!strict && error instanceof OneDriveError) return null
      throw error
    }
  }

  async listDocuments(signal?: AbortSignal): Promise<OneDriveDocumentFile[]> {
    const namespace = await this.#namespace(signal)
    const children = await this.#listChildren(
      namespace.driveId,
      namespace.documentsFolderId,
      signal
    )
    const documents: OneDriveDocumentFile[] = []
    for (const folder of children) {
      if (!DOCUMENT_ID_PATTERN.test(folder.name)) continue
      try {
        this.#validateDirectChild(folder, namespace.driveId, namespace.documentsFolderId, 'folder')
        const file = await this.#fileInFolder(namespace, folder, { signal }, false)
        if (file) documents.push({ documentId: folder.name, folder, file })
      } catch (error) {
        if (!(error instanceof OneDriveError) || error.code !== 'foreign-file') throw error
        // A user-created lookalike folder never becomes an OpenPencil binding. Transport,
        // authorization, cancellation, quota, and response-bound failures remain observable.
      }
    }
    return documents
  }

  async getDocumentFile(
    documentId: string,
    options: DocumentLookupOptions = {}
  ): Promise<OneDriveDocumentFile | null> {
    const id = validateDocumentId(documentId)
    const namespace = await this.#namespace(options.signal, options.expectedAuthority)
    const folder = await this.#findDocumentFolder(
      namespace,
      id,
      options.signal,
      options.expectedAuthority
    )
    if (!folder) return null
    const file = await this.#fileInFolder(namespace, folder, options, true)
    return file ? { documentId: id, folder, file } : null
  }

  async downloadDocument(
    documentId: string,
    options: StorageTransferOptions = {}
  ): Promise<StorageGetDocumentResult> {
    const located = await this.getDocumentFile(documentId, options)
    if (!located) throw new OneDriveError('not-found', 'OneDrive document was not found')
    const namespace = await this.#namespace(options.signal, options.expectedAuthority)
    const fresh = await this.#getItem(
      namespace.driveId,
      located.file.id,
      options.signal,
      options.expectedAuthority
    )
    if (!fresh) throw new OneDriveError('not-found', 'OneDrive document was not found')
    this.#validateDirectChild(fresh, namespace.driveId, located.folder.id, 'file')
    const downloadURL = validateCapabilityURL(
      fresh.downloadUrl ??
        (() => {
          throw new OneDriveError('invalid-response', 'OneDrive file is missing a download URL')
        })(),
      'download'
    )
    await this.#resolveToken(options.signal, options.expectedAuthority)
    let response: Response
    try {
      response = await this.#transport(downloadURL, {
        method: 'GET',
        signal: options.signal,
        credentials: 'omit',
        redirect: 'error'
      })
    } catch (error) {
      if (isOneDriveAbortError(error) || options.signal?.aborted) {
        throw new OneDriveError('aborted', 'OneDrive download was cancelled', { cause: error })
      }
      throw new OneDriveError('network', 'OneDrive download failed', {
        retryable: true,
        cause: error
      })
    }
    await this.#expect(response, [200])
    const bytes = await this.#readBytes(response, this.#limits.maxDownloadBytes, options.onProgress)
    if (fresh.size !== null && bytes.byteLength !== fresh.size) {
      throw new OneDriveError('invalid-response', 'OneDrive download size did not match metadata')
    }
    return {
      bytes,
      metadata: { name: fresh.name, updatedAt: fresh.lastModifiedDateTime },
      remoteRevision: remoteRevisionFor(fresh)
    }
  }

  async #createUploadSession(
    namespace: OneDriveNamespace,
    folderId: string,
    options: OneDriveUploadOptions
  ): Promise<UploadSession> {
    const updateItemId = options.itemId
    const isUpdate = updateItemId !== undefined
    const endpoint = updateItemId
      ? `/drives/${encodeURIComponent(namespace.driveId)}/items/${encodeURIComponent(validateItemId(updateItemId))}/createUploadSession`
      : `/drives/${encodeURIComponent(namespace.driveId)}/items/${encodeURIComponent(validateItemId(folderId))}:/${encodeURIComponent(validateFigName(options.name))}:/createUploadSession`
    const headers = new Headers({ 'Content-Type': 'application/json' })
    if (isUpdate) headers.set('If-Match', validateEtag(options.expectedEtag ?? ''))
    const response = await this.#graphRequest(
      graphURL(endpoint),
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          item: {
            name: validateFigName(options.name),
            '@microsoft.graph.conflictBehavior': isUpdate ? 'replace' : 'fail'
          }
        })
      },
      {
        signal: options.signal,
        expectedAuthority: options.expectedAuthority,
        retry: false
      }
    )
    await this.#expect(response, [200, 201])
    const value = await this.#readJson(response)
    if (!isRecord(value)) {
      throw new OneDriveError('invalid-response', 'OneDrive returned an invalid upload session')
    }
    return {
      uploadUrl: validateCapabilityURL(
        requiredString(value.uploadUrl, 'upload URL', 16_384),
        'upload-session'
      )
    }
  }

  async #capabilityRequest(
    url: string,
    init: RequestInit,
    options: OneDriveUploadOptions,
    attempts: number
  ): Promise<Response> {
    const safeURL = validateCapabilityURL(url, 'upload-session')
    for (let attempt = 1; attempt <= attempts; attempt++) {
      throwIfOneDriveAborted(options.signal)
      // Upload URLs are preauthenticated. Resolve only to enforce the grant lease.
      await this.#resolveToken(options.signal, options.expectedAuthority)
      try {
        const response = await this.#transport(safeURL, {
          ...init,
          signal: options.signal,
          credentials: 'omit',
          redirect: 'error'
        })
        if (attempt === attempts || !isRetryableOneDriveStatus(response.status)) return response
        const delayMs = retryDelay(response, attempt)
        await discard(response)
        await this.#sleep(delayMs, options.signal)
      } catch (error) {
        if (isOneDriveAbortError(error) || options.signal?.aborted) {
          throw new OneDriveError('aborted', 'OneDrive upload was cancelled', { cause: error })
        }
        if (attempt === attempts) {
          throw new OneDriveError('network', 'OneDrive upload failed', {
            retryable: true,
            cause: error
          })
        }
        await this.#sleep(retryDelay(null, attempt), options.signal)
      }
    }
    throw new OneDriveError('network', 'OneDrive upload retry limit was reached')
  }

  async #uploadSession(
    session: UploadSession,
    options: OneDriveUploadOptions
  ): Promise<OneDriveItem> {
    const total = options.bytes.byteLength
    if (total === 0) {
      throw new OneDriveError('invalid-input', 'OneDrive refuses an empty .fig upload')
    }
    let offset = 0
    options.onProgress?.({ transferredBytes: 0, totalBytes: total })
    while (offset < total) {
      const endExclusive = Math.min(offset + this.#uploadChunkBytes, total)
      const body = options.bytes.slice(offset, endExclusive)
      const response = await this.#capabilityRequest(
        session.uploadUrl,
        {
          method: 'PUT',
          headers: {
            'Content-Length': String(body.byteLength),
            'Content-Range': `bytes ${offset}-${endExclusive - 1}/${total}`,
            'Content-Type': 'application/octet-stream'
          },
          body
        },
        options,
        this.#limits.maxUploadAttempts
      )
      if (response.status === 404) {
        await discard(response)
        throw new OneDriveError('upload-session-expired', 'OneDrive upload session expired', {
          status: 404,
          retryable: true
        })
      }
      if (response.status === 200 || response.status === 201) {
        const item = parseItem(await this.#readJson(response))
        options.onProgress?.({ transferredBytes: total, totalBytes: total })
        return item
      }
      if (response.status === 416) {
        await discard(response)
        const statusResponse = await this.#capabilityRequest(
          session.uploadUrl,
          { method: 'GET', headers: { Accept: 'application/json' } },
          options,
          this.#limits.maxUploadAttempts
        )
        if (statusResponse.status === 404) {
          await discard(statusResponse)
          throw new OneDriveError('upload-session-expired', 'OneDrive upload session expired', {
            status: 404,
            retryable: true
          })
        }
        await this.#expect(statusResponse, [200])
        offset = await this.#nextUploadOffset(statusResponse, offset, total)
        options.onProgress?.({ transferredBytes: offset, totalBytes: total })
        continue
      }
      if (response.status !== 202) throw await this.#responseError(response)
      offset = await this.#nextUploadOffset(response, offset, total)
      options.onProgress?.({ transferredBytes: offset, totalBytes: total })
    }
    throw new OneDriveError('invalid-response', 'OneDrive upload ended without a drive item')
  }

  async #nextUploadOffset(response: Response, current: number, total: number): Promise<number> {
    const value = await this.#readJson(response)
    if (!isRecord(value) || !Array.isArray(value.nextExpectedRanges)) {
      throw new OneDriveError('invalid-response', 'OneDrive returned invalid upload ranges')
    }
    const first = value.nextExpectedRanges[0]
    if (typeof first !== 'string') {
      throw new OneDriveError('invalid-response', 'OneDrive returned no next upload range')
    }
    const match = /^(\d+)(?:-|$)/.exec(first)
    const nextOffset = match ? Number(match[1]) : Number.NaN
    if (!Number.isSafeInteger(nextOffset) || nextOffset <= current || nextOffset > total) {
      throw new OneDriveError('invalid-response', 'OneDrive returned an invalid next upload range')
    }
    return nextOffset
  }

  async #uploadWithRestart(
    createSession: () => Promise<UploadSession>,
    options: OneDriveUploadOptions
  ): Promise<OneDriveUploadResult> {
    const sessions = this.#limits.maxUploadSessionRestarts + 1
    for (let attempt = 0; attempt < sessions; attempt++) {
      const session = await createSession()
      try {
        const item = await this.#uploadSession(session, options)
        return { item, remoteRevision: remoteRevisionFor(item) }
      } catch (error) {
        if (
          !(error instanceof OneDriveError) ||
          error.code !== 'upload-session-expired' ||
          attempt === sessions - 1
        ) {
          throw error
        }
      }
    }
    throw new OneDriveError('upload-session-expired', 'OneDrive upload session restart failed')
  }

  async createDocument(options: OneDriveUploadOptions): Promise<OneDriveUploadResult> {
    const documentId = validateDocumentId(options.documentId)
    validateFigName(options.name)
    if (options.itemId !== undefined || options.expectedEtag !== undefined) {
      throw new OneDriveError(
        'invalid-input',
        'OneDrive create cannot include an existing revision'
      )
    }
    const namespace = await this.#namespace(options.signal, options.expectedAuthority)
    const existingFolder = await this.#findDocumentFolder(
      namespace,
      documentId,
      options.signal,
      options.expectedAuthority
    )
    const folder = existingFolder
      ? existingFolder
      : await this.#createFolder(
          namespace.driveId,
          namespace.documentsFolderId,
          documentId,
          options.signal,
          options.expectedAuthority
        )
    const children = await this.#listChildren(
      namespace.driveId,
      folder.id,
      options.signal,
      options.expectedAuthority
    )
    if (children.length !== 0) {
      throw new OneDriveError('conflict', 'OneDrive document folder already contains content')
    }
    return this.#uploadWithRestart(
      () => this.#createUploadSession(namespace, folder.id, options),
      options
    )
  }

  async updateDocument(options: OneDriveUploadOptions): Promise<OneDriveUploadResult> {
    const documentId = validateDocumentId(options.documentId)
    const itemId = validateItemId(options.itemId ?? '')
    const expectedEtag = validateEtag(options.expectedEtag ?? '')
    validateFigName(options.name)
    const namespace = await this.#namespace(options.signal, options.expectedAuthority)
    const folder = await this.#findDocumentFolder(
      namespace,
      documentId,
      options.signal,
      options.expectedAuthority
    )
    if (!folder) throw new OneDriveError('not-found', 'OneDrive document was not found')
    const current = await this.#fileInFolder(
      namespace,
      folder,
      {
        itemId,
        signal: options.signal,
        expectedAuthority: options.expectedAuthority
      },
      true
    )
    if (!current) throw new OneDriveError('not-found', 'OneDrive document was not found')
    if (current.eTag !== expectedEtag) {
      throw new OneDriveError('precondition', 'OneDrive document changed before upload', {
        status: 412
      })
    }
    return this.#uploadWithRestart(
      () => this.#createUploadSession(namespace, folder.id, options),
      options
    )
  }

  async deleteDocumentFile(
    documentId: string,
    signal?: AbortSignal,
    expectedAuthority?: StorageDocumentAuthority
  ): Promise<void> {
    const namespace = await this.#namespace(signal, expectedAuthority)
    const folder = await this.#findDocumentFolder(
      namespace,
      validateDocumentId(documentId),
      signal,
      expectedAuthority
    )
    if (!folder) return
    const file = await this.#fileInFolder(namespace, folder, { signal, expectedAuthority }, true)
    if (!file) return
    const etag = validateEtag(file.eTag ?? '')
    const response = await this.#graphRequest(
      graphURL(
        `/drives/${encodeURIComponent(namespace.driveId)}/items/${encodeURIComponent(file.id)}`
      ),
      { method: 'DELETE', headers: { 'If-Match': etag } },
      { signal, expectedAuthority, retry: false }
    )
    if (response.status === 404) {
      await discard(response)
      return
    }
    await this.#expect(response, [204])
    await discard(response)
  }
}
