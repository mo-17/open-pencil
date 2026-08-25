/* oxlint-disable eslint/max-lines -- One client owns Aliyun origin policy, folder-scope validation, bounded transfer, and conservative replacement. */

import type {
  StorageDocumentAuthority,
  StorageGetDocumentResult,
  StorageRemoteRevision,
  StorageTransferOptions
} from '../types'
import {
  ALIYUN_DRIVE_APP_DOCUMENTS_FOLDER,
  ALIYUN_DRIVE_MAX_UPLOAD_CHUNK_BYTES,
  ALIYUN_DRIVE_MAX_UPLOAD_PARTS,
  ALIYUN_DRIVE_MIN_UPLOAD_PART_BYTES,
  ALIYUN_DRIVE_OPENAPI_ORIGIN,
  ALIYUN_DRIVE_UPLOAD_CHUNK_BYTES
} from './config'
import {
  AliyunDriveError,
  aliyunDriveErrorCodeForStatus,
  isAliyunDriveAbortError,
  isRetryableAliyunDriveStatus,
  parseAliyunDriveRetryAfter,
  throwIfAliyunDriveAborted
} from './errors'
import type {
  AliyunDriveClientLimits,
  AliyunDriveClientOptions,
  AliyunDriveDocumentFile,
  AliyunDriveItem,
  AliyunDriveNamespace,
  AliyunDriveOAuthToken,
  AliyunDriveReplacementOptions,
  AliyunDriveReplacementResult,
  AliyunDriveSleep,
  AliyunDriveTransport,
  AliyunDriveUploadOptions,
  AliyunDriveUploadResult
} from './types'

const DOCUMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const MAX_IDENTIFIER_LENGTH = 512
const MAX_NAME_BYTES = 1_024
const DEFAULT_MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024
const DEFAULT_MAX_ERROR_BYTES = 32 * 1024
const DEFAULT_MAX_JSON_BYTES = 1024 * 1024
const DEFAULT_MAX_LIST_PAGES = 32
const DEFAULT_MAX_LIST_ITEMS = 2_000
const DEFAULT_MAX_REQUEST_ATTEMPTS = 3
const DEFAULT_MAX_UPLOAD_ATTEMPTS = 4
const DEFAULT_MAX_ASYNC_TASK_POLLS = 30
const MAX_BACKOFF_MS = 30_000
const LIST_PAGE_SIZE = 100
const MAX_REGISTERED_CAPABILITIES = ALIYUN_DRIVE_MAX_UPLOAD_PARTS + 16

const API_PATHS = {
  driveInfo: '/adrive/v1.0/user/getDriveInfo',
  list: '/adrive/v1.0/openFile/list',
  get: '/adrive/v1.0/openFile/get',
  create: '/adrive/v1.0/openFile/create',
  getUploadUrl: '/adrive/v1.0/openFile/getUploadUrl',
  complete: '/adrive/v1.0/openFile/complete',
  getDownloadUrl: '/adrive/v1.0/openFile/getDownloadUrl',
  trash: '/adrive/v1.0/recyclebin/trash',
  move: '/adrive/v1.0/openFile/move',
  asyncTask: '/adrive/v1.0/async_task/get'
} as const

type ResolvedLimits = Required<AliyunDriveClientLimits>

type RequestOptions = Readonly<{
  signal?: AbortSignal
  expectedAuthority?: StorageDocumentAuthority
  retry?: boolean
}>

type DocumentLookupOptions = Readonly<{
  signal?: AbortSignal
  expectedAuthority?: StorageDocumentAuthority
}>

type CapabilityKind = 'download' | 'upload'

type UploadSession = Readonly<{
  driveId: string
  fileId: string
  uploadId: string
  partURLs: ReadonlyMap<number, string>
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown, field: string, max = MAX_IDENTIFIER_LENGTH): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > max ||
    /[\r\n]/.test(value)
  ) {
    throw new AliyunDriveError('invalid-response', `Aliyun Drive returned an invalid ${field}`)
  }
  return value
}

function optionalString(value: unknown, max = MAX_IDENTIFIER_LENGTH): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\r\n]/.test(value)
    ? value
    : null
}

function boundedPositiveInteger(
  value: number | undefined,
  fallback: number,
  field: string,
  maximum: number
): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > maximum) {
    throw new AliyunDriveError('invalid-input', `${field} is invalid`)
  }
  return resolved
}

function resolveLimits(limits: AliyunDriveClientLimits | undefined): ResolvedLimits {
  return {
    maxDownloadBytes: boundedPositiveInteger(
      limits?.maxDownloadBytes,
      DEFAULT_MAX_DOWNLOAD_BYTES,
      'Aliyun Drive download byte limit',
      2 * 1024 * 1024 * 1024
    ),
    maxErrorBytes: boundedPositiveInteger(
      limits?.maxErrorBytes,
      DEFAULT_MAX_ERROR_BYTES,
      'Aliyun Drive error byte limit',
      1024 * 1024
    ),
    maxJsonBytes: boundedPositiveInteger(
      limits?.maxJsonBytes,
      DEFAULT_MAX_JSON_BYTES,
      'Aliyun Drive JSON byte limit',
      16 * 1024 * 1024
    ),
    maxListPages: boundedPositiveInteger(
      limits?.maxListPages,
      DEFAULT_MAX_LIST_PAGES,
      'Aliyun Drive list page limit',
      1_000
    ),
    maxListItems: boundedPositiveInteger(
      limits?.maxListItems,
      DEFAULT_MAX_LIST_ITEMS,
      'Aliyun Drive list item limit',
      100_000
    ),
    maxRequestAttempts: boundedPositiveInteger(
      limits?.maxRequestAttempts,
      DEFAULT_MAX_REQUEST_ATTEMPTS,
      'Aliyun Drive request attempt limit',
      10
    ),
    maxUploadAttempts: boundedPositiveInteger(
      limits?.maxUploadAttempts,
      DEFAULT_MAX_UPLOAD_ATTEMPTS,
      'Aliyun Drive upload attempt limit',
      10
    ),
    maxAsyncTaskPolls: boundedPositiveInteger(
      limits?.maxAsyncTaskPolls,
      DEFAULT_MAX_ASYNC_TASK_POLLS,
      'Aliyun Drive async task poll limit',
      300
    )
  }
}

function validateUploadChunkBytes(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < ALIYUN_DRIVE_MIN_UPLOAD_PART_BYTES ||
    value > ALIYUN_DRIVE_MAX_UPLOAD_CHUNK_BYTES
  ) {
    throw new AliyunDriveError(
      'invalid-input',
      'Aliyun Drive upload chunks must be between 100 KiB and 10 MiB'
    )
  }
  return value
}

function validateDocumentId(value: string): string {
  if (!DOCUMENT_ID_PATTERN.test(value)) {
    throw new AliyunDriveError(
      'invalid-input',
      'Aliyun Drive document ID must be a canonical UUID v4'
    )
  }
  return value
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127
  })
}

function validateIdentifier(value: string, field: string): string {
  if (
    value !== value.trim() ||
    value.length === 0 ||
    value.length > MAX_IDENTIFIER_LENGTH ||
    hasControlCharacter(value)
  ) {
    throw new AliyunDriveError('invalid-input', `Aliyun Drive ${field} is invalid`)
  }
  return value
}

function validateFigName(value: string): string {
  if (
    value !== value.trim() ||
    value.length < 5 ||
    new TextEncoder().encode(value).byteLength > MAX_NAME_BYTES ||
    !value.toLocaleLowerCase().endsWith('.fig') ||
    hasControlCharacter(value) ||
    value.includes('/') ||
    value.endsWith('.')
  ) {
    throw new AliyunDriveError('invalid-input', 'Aliyun Drive document name is invalid')
  }
  return value
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
    accountId.length > MAX_IDENTIFIER_LENGTH ||
    authorizationVersion.length > MAX_IDENTIFIER_LENGTH
  ) {
    throw new AliyunDriveError('auth', 'Aliyun Drive authorization identity is invalid')
  }
  return { accountId, authorizationVersion }
}

function validateToken(value: AliyunDriveOAuthToken): AliyunDriveOAuthToken {
  const accessToken = value.accessToken.trim()
  if (!accessToken || accessToken.length > 32_768 || /[\r\n]/.test(accessToken)) {
    throw new AliyunDriveError('auth', 'Aliyun Drive access token is unavailable')
  }
  return { accessToken, authority: validateAuthority(value.authority) }
}

function apiURL(path: string): string {
  if (!path.startsWith('/adrive/v1.0/')) {
    throw new AliyunDriveError('invalid-input', 'Aliyun Drive API path is invalid')
  }
  return `${ALIYUN_DRIVE_OPENAPI_ORIGIN}${path}`
}

function parseSize(value: unknown): number | null {
  if (value === undefined || value === null) return null
  const size = typeof value === 'string' ? Number(value) : value
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) {
    throw new AliyunDriveError('invalid-response', 'Aliyun Drive returned an invalid file size')
  }
  return size
}

function parseTimestamp(value: unknown, field: string): string {
  const timestamp = requiredString(value, field, 128)
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new AliyunDriveError('invalid-response', `Aliyun Drive returned an invalid ${field}`)
  }
  return timestamp
}

function parseItem(value: unknown): AliyunDriveItem {
  if (!isRecord(value)) {
    throw new AliyunDriveError('invalid-response', 'Aliyun Drive returned an invalid file item')
  }
  const type = value.type
  if (type !== 'file' && type !== 'folder') {
    throw new AliyunDriveError('invalid-response', 'Aliyun Drive returned an invalid file type')
  }
  const size = parseSize(value.size)
  const contentHash = optionalString(value.content_hash, 1_024)
  if (type === 'file' && (size === null || !contentHash)) {
    throw new AliyunDriveError(
      'invalid-response',
      'Aliyun Drive file is missing its size or content hash'
    )
  }
  return {
    driveId: requiredString(value.drive_id, 'drive ID'),
    fileId: requiredString(value.file_id, 'file ID'),
    parentFileId: requiredString(value.parent_file_id, 'parent file ID'),
    name: requiredString(value.name, 'file name', 4_096),
    type,
    size,
    contentHash,
    createdAt: parseTimestamp(value.created_at, 'creation time'),
    updatedAt: parseTimestamp(value.updated_at, 'modification time')
  }
}

export function aliyunDriveRemoteRevisionFor(item: AliyunDriveItem): StorageRemoteRevision {
  if (item.type !== 'file' || item.size === null || !item.contentHash) {
    throw new AliyunDriveError('invalid-response', 'Aliyun Drive file revision is incomplete')
  }
  return {
    fileId: item.fileId,
    contentHash: item.contentHash,
    updatedAt: item.updatedAt,
    size: String(item.size)
  }
}

function revisionsMatch(
  left: StorageRemoteRevision | null | undefined,
  right: StorageRemoteRevision | null | undefined
): boolean {
  if (!left || !right || Object.keys(left).length !== 4 || Object.keys(right).length !== 4) {
    return false
  }
  return (
    left.fileId === right.fileId &&
    left.contentHash === right.contentHash &&
    left.updatedAt === right.updatedAt &&
    left.size === right.size
  )
}

function containsExactItemPair(
  items: readonly AliyunDriveItem[],
  firstFileId: string,
  secondFileId: string
): boolean {
  if (items.length !== 2 || firstFileId === secondFileId) return false
  const ids = new Set(items.map((item) => item.fileId))
  return ids.size === 2 && ids.has(firstFileId) && ids.has(secondFileId)
}

function containsOnlyItem(items: readonly AliyunDriveItem[], fileId: string): boolean {
  return items.length === 1 && items[0]?.fileId === fileId
}

function retryDelay(response: Response | null, attempt: number): number {
  const retryAfter = response
    ? parseAliyunDriveRetryAfter(
        response.headers.get('retry-after'),
        response.headers.get('x-retry-after')
      )
    : null
  if (retryAfter !== null) return retryAfter
  return Math.min(250 * 2 ** Math.max(0, attempt - 1), MAX_BACKOFF_MS)
}

const defaultSleep: AliyunDriveSleep = async (delayMs, signal) => {
  throwIfAliyunDriveAborted(signal)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs)
    const abort = () => {
      clearTimeout(timer)
      reject(
        new AliyunDriveError('aborted', 'Aliyun Drive operation was cancelled', {
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

export class AliyunDriveClient {
  readonly #resolveAccessToken: AliyunDriveClientOptions['resolveAccessToken']
  readonly #transport: AliyunDriveTransport
  readonly #sleep: AliyunDriveSleep
  readonly #limits: ResolvedLimits
  readonly #uploadChunkBytes: number
  readonly #capabilities = new Map<string, CapabilityKind>()

  constructor(options: AliyunDriveClientOptions) {
    this.#resolveAccessToken = options.resolveAccessToken
    this.#transport = options.transport ?? ((input, init) => fetch(input, init))
    this.#sleep = options.sleep ?? defaultSleep
    this.#limits = resolveLimits(options.limits)
    this.#uploadChunkBytes = validateUploadChunkBytes(
      options.uploadChunkBytes ?? ALIYUN_DRIVE_UPLOAD_CHUNK_BYTES
    )
  }

  async #resolveToken(
    signal?: AbortSignal,
    expectedAuthority?: StorageDocumentAuthority
  ): Promise<AliyunDriveOAuthToken> {
    throwIfAliyunDriveAborted(signal)
    const token = validateToken(await this.#resolveAccessToken(signal))
    if (
      expectedAuthority &&
      !authoritiesEqual(token.authority, validateAuthority(expectedAuthority))
    ) {
      throw new AliyunDriveError(
        'authorization-changed',
        'Aliyun Drive authorization changed during the operation'
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
      throw new AliyunDriveError(
        'invalid-response',
        'Aliyun Drive returned an invalid content length'
      )
    }
    if (declared !== null && declared > limit) {
      await discard(response)
      throw new AliyunDriveError('resource-limit', 'Aliyun Drive response exceeded the byte limit')
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
        throw new AliyunDriveError(
          'resource-limit',
          'Aliyun Drive response exceeded the byte limit'
        )
      }
      chunks.push(value)
      onProgress?.({ transferredBytes: received, totalBytes: declared })
    }
    if (declared !== null && received !== declared) {
      throw new AliyunDriveError(
        'invalid-response',
        'Aliyun Drive response length did not match its header'
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
      throw new AliyunDriveError('invalid-response', 'Aliyun Drive returned an empty JSON response')
    }
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown
    } catch (error) {
      throw new AliyunDriveError('invalid-response', 'Aliyun Drive returned invalid JSON', {
        cause: error
      })
    }
  }

  async #responseError(response: Response): Promise<AliyunDriveError> {
    let message = `Aliyun Drive request failed (${response.status})`
    let reason: string | null = null
    try {
      const bytes = await this.#readBytes(response, this.#limits.maxErrorBytes)
      const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown
      if (isRecord(value)) {
        const candidate = optionalString(value.message, 2_048)
        if (candidate) message = candidate
        reason = optionalString(value.code, 256)
      }
    } catch (error) {
      void error
      // Keep the bounded status fallback when the provider returns malformed error JSON.
    }
    return new AliyunDriveError(aliyunDriveErrorCodeForStatus(response.status), message, {
      status: response.status,
      reason,
      retryable: isRetryableAliyunDriveStatus(response.status),
      retryAfterMs: parseAliyunDriveRetryAfter(
        response.headers.get('retry-after'),
        response.headers.get('x-retry-after')
      )
    })
  }

  async #apiRequest(
    path: string,
    body: Readonly<Record<string, unknown>>,
    options: RequestOptions = {}
  ): Promise<Response> {
    const url = apiURL(path)
    const attempts = options.retry === false ? 1 : this.#limits.maxRequestAttempts
    for (let attempt = 1; attempt <= attempts; attempt++) {
      throwIfAliyunDriveAborted(options.signal)
      const token = await this.#resolveToken(options.signal, options.expectedAuthority)
      try {
        const response = await this.#transport(url, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token.accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body),
          signal: options.signal,
          credentials: 'omit',
          redirect: 'error'
        })
        if (attempt === attempts || !isRetryableAliyunDriveStatus(response.status)) return response
        const delayMs = retryDelay(response, attempt)
        await discard(response)
        await this.#sleep(delayMs, options.signal)
      } catch (error) {
        if (isAliyunDriveAbortError(error) || options.signal?.aborted) {
          throw new AliyunDriveError('aborted', 'Aliyun Drive operation was cancelled', {
            cause: error
          })
        }
        if (attempt === attempts) {
          throw new AliyunDriveError('network', 'Aliyun Drive network request failed', {
            retryable: true,
            cause: error
          })
        }
        await this.#sleep(retryDelay(null, attempt), options.signal)
      }
    }
    throw new AliyunDriveError('network', 'Aliyun Drive request retry limit was reached')
  }

  async #expect(response: Response, statuses: readonly number[]): Promise<Response> {
    if (!statuses.includes(response.status)) throw await this.#responseError(response)
    return response
  }

  #registerCapabilityURL(value: unknown, kind: CapabilityKind): string {
    const raw = requiredString(value, `${kind} URL`, 16_384)
    let url: URL
    try {
      url = new URL(raw)
    } catch (error) {
      throw new AliyunDriveError('invalid-response', 'Aliyun Drive returned an invalid signed URL', {
        cause: error
      })
    }
    if (
      url.protocol !== 'https:' ||
      (url.port && url.port !== '443') ||
      url.username ||
      url.password ||
      url.hash ||
      !url.hostname
    ) {
      throw new AliyunDriveError('invalid-response', 'Aliyun Drive returned an unsafe signed URL')
    }
    if (this.#capabilities.size >= MAX_REGISTERED_CAPABILITIES && !this.#capabilities.has(raw)) {
      const oldest = this.#capabilities.keys().next().value
      if (typeof oldest === 'string') this.#capabilities.delete(oldest)
    }
    this.#capabilities.set(raw, kind)
    return raw
  }

  async #capabilityRequest(
    url: string,
    kind: CapabilityKind,
    init: RequestInit,
    options: RequestOptions,
    attempts: number
  ): Promise<Response> {
    if (this.#capabilities.get(url) !== kind) {
      throw new AliyunDriveError(
        'invalid-input',
        'Aliyun Drive signed URL was not registered by a trusted API response'
      )
    }
    for (let attempt = 1; attempt <= attempts; attempt++) {
      throwIfAliyunDriveAborted(options.signal)
      // Signed URLs are preauthenticated. Resolve only to enforce the grant lease.
      await this.#resolveToken(options.signal, options.expectedAuthority)
      const headers = new Headers(init.headers)
      headers.delete('authorization')
      try {
        const response = await this.#transport(url, {
          ...init,
          headers,
          signal: options.signal,
          credentials: 'omit',
          redirect: 'error'
        })
        if (attempt === attempts || !isRetryableAliyunDriveStatus(response.status)) return response
        const delayMs = retryDelay(response, attempt)
        await discard(response)
        await this.#sleep(delayMs, options.signal)
      } catch (error) {
        if (isAliyunDriveAbortError(error) || options.signal?.aborted) {
          throw new AliyunDriveError('aborted', `Aliyun Drive ${kind} was cancelled`, {
            cause: error
          })
        }
        if (attempt === attempts) {
          throw new AliyunDriveError('network', `Aliyun Drive ${kind} failed`, {
            retryable: true,
            cause: error
          })
        }
        await this.#sleep(retryDelay(null, attempt), options.signal)
      }
    }
    throw new AliyunDriveError('network', `Aliyun Drive ${kind} retry limit was reached`)
  }

  async #listChildren(
    driveId: string,
    parentFileId: string,
    options: DocumentLookupOptions = {}
  ): Promise<AliyunDriveItem[]> {
    validateIdentifier(driveId, 'drive ID')
    validateIdentifier(parentFileId, 'parent file ID')
    let marker = ''
    const seenMarkers = new Set<string>()
    const items: AliyunDriveItem[] = []
    for (let page = 0; page < this.#limits.maxListPages; page++) {
      const response = await this.#apiRequest(
        API_PATHS.list,
        {
          drive_id: driveId,
          parent_file_id: parentFileId,
          limit: LIST_PAGE_SIZE,
          marker,
          order_by: 'updated_at',
          order_direction: 'DESC'
        },
        { ...options, retry: true }
      )
      await this.#expect(response, [200])
      const value = await this.#readJson(response)
      if (!isRecord(value) || !Array.isArray(value.items)) {
        throw new AliyunDriveError('invalid-response', 'Aliyun Drive returned an invalid list page')
      }
      for (const raw of value.items) {
        const item = parseItem(raw)
        if (item.driveId !== driveId || item.parentFileId !== parentFileId) {
          throw new AliyunDriveError(
            'foreign-file',
            'Aliyun Drive listed an item outside the requested folder'
          )
        }
        items.push(item)
        if (items.length > this.#limits.maxListItems) {
          throw new AliyunDriveError(
            'resource-limit',
            'Aliyun Drive children exceeded the item limit'
          )
        }
      }
      const next = optionalString(value.next_marker, 4_096) ?? ''
      if (!next) return items
      if (seenMarkers.has(next)) {
        throw new AliyunDriveError('invalid-response', 'Aliyun Drive repeated a pagination marker')
      }
      seenMarkers.add(next)
      marker = next
    }
    throw new AliyunDriveError('resource-limit', 'Aliyun Drive children exceeded the page limit')
  }

  async #getItem(
    driveId: string,
    fileId: string,
    options: DocumentLookupOptions = {}
  ): Promise<AliyunDriveItem | null> {
    const response = await this.#apiRequest(
      API_PATHS.get,
      {
        drive_id: validateIdentifier(driveId, 'drive ID'),
        file_id: validateIdentifier(fileId, 'file ID')
      },
      { ...options, retry: true }
    )
    if (response.status === 404) {
      await discard(response)
      return null
    }
    await this.#expect(response, [200])
    const item = parseItem(await this.#readJson(response))
    if (item.driveId !== driveId || item.fileId !== fileId) {
      throw new AliyunDriveError(
        'foreign-file',
        'Aliyun Drive returned a different item than requested'
      )
    }
    return item
  }

  #validateDirectChild(
    item: AliyunDriveItem,
    driveId: string,
    parentFileId: string,
    kind: 'file' | 'folder'
  ): void {
    if (
      item.type !== kind ||
      item.driveId !== driveId ||
      item.parentFileId !== parentFileId
    ) {
      throw new AliyunDriveError(
        'foreign-file',
        'Aliyun Drive item is outside the OpenPencil folder'
      )
    }
  }

  async #findNamedFolder(
    driveId: string,
    parentFileId: string,
    name: string,
    options: DocumentLookupOptions = {}
  ): Promise<AliyunDriveItem | null> {
    const matches = (await this.#listChildren(driveId, parentFileId, options)).filter(
      (item) => item.name === name
    )
    if (matches.length === 0) return null
    if (matches.length !== 1) {
      throw new AliyunDriveError(
        'foreign-file',
        'Aliyun Drive contains ambiguous OpenPencil folders'
      )
    }
    this.#validateDirectChild(matches[0], driveId, parentFileId, 'folder')
    return matches[0]
  }

  async #createFolder(
    driveId: string,
    parentFileId: string,
    name: string,
    options: DocumentLookupOptions = {}
  ): Promise<AliyunDriveItem> {
    const response = await this.#apiRequest(
      API_PATHS.create,
      {
        drive_id: driveId,
        parent_file_id: parentFileId,
        name,
        type: 'folder',
        check_name_mode: 'refuse'
      },
      { ...options, retry: false }
    )
    await this.#expect(response, [200, 201])
    const value = await this.#readJson(response)
    if (!isRecord(value)) {
      throw new AliyunDriveError('invalid-response', 'Aliyun Drive returned an invalid folder')
    }
    const fileId = requiredString(value.file_id, 'created folder ID')
    const folder = await this.#getItem(driveId, fileId, options)
    if (!folder) {
      throw new AliyunDriveError('invalid-response', 'Aliyun Drive created folder disappeared')
    }
    this.#validateDirectChild(folder, driveId, parentFileId, 'folder')
    if (folder.name !== name) {
      throw new AliyunDriveError('invalid-response', 'Aliyun Drive created an unexpected folder')
    }
    return folder
  }

  async #ensureNamedFolder(
    driveId: string,
    parentFileId: string,
    name: string,
    options: DocumentLookupOptions = {}
  ): Promise<AliyunDriveItem> {
    const existing = await this.#findNamedFolder(driveId, parentFileId, name, options)
    if (existing) return existing
    try {
      return await this.#createFolder(driveId, parentFileId, name, options)
    } catch (error) {
      if (!(error instanceof AliyunDriveError) || error.code !== 'conflict') throw error
      const raced = await this.#findNamedFolder(driveId, parentFileId, name, options)
      if (!raced) throw error
      return raced
    }
  }

  async #namespace(
    signal?: AbortSignal,
    expectedAuthority?: StorageDocumentAuthority
  ): Promise<AliyunDriveNamespace> {
    const response = await this.#apiRequest(
      API_PATHS.driveInfo,
      {},
      { signal, expectedAuthority, retry: true }
    )
    await this.#expect(response, [200])
    const value = await this.#readJson(response)
    if (!isRecord(value)) {
      throw new AliyunDriveError('invalid-response', 'Aliyun Drive returned invalid drive info')
    }
    const authority = await this.#resolveToken(signal, expectedAuthority)
    const userId = requiredString(value.user_id, 'user ID')
    if (userId !== authority.authority.accountId) {
      throw new AliyunDriveError(
        'authorization-changed',
        'Aliyun Drive account identity changed during the operation'
      )
    }
    const driveId = requiredString(value.default_drive_id, 'default drive ID')
    const authorizedRootFolderId = requiredString(value.folder_id, 'authorized folder ID')
    const documents = await this.#ensureNamedFolder(
      driveId,
      authorizedRootFolderId,
      ALIYUN_DRIVE_APP_DOCUMENTS_FOLDER,
      { signal, expectedAuthority }
    )
    return {
      driveId,
      authorizedRootFolderId,
      documentsFolderId: documents.fileId
    }
  }

  async testConnection(signal?: AbortSignal): Promise<void> {
    await this.#namespace(signal)
  }

  async #findDocumentFolder(
    namespace: AliyunDriveNamespace,
    documentId: string,
    options: DocumentLookupOptions = {}
  ): Promise<AliyunDriveItem | null> {
    return this.#findNamedFolder(
      namespace.driveId,
      namespace.documentsFolderId,
      validateDocumentId(documentId),
      options
    )
  }

  async #fileInFolder(
    namespace: AliyunDriveNamespace,
    folder: AliyunDriveItem,
    options: DocumentLookupOptions,
    strict: boolean
  ): Promise<AliyunDriveItem | null> {
    const children = await this.#listChildren(namespace.driveId, folder.fileId, options)
    const files = children.filter(
      (item) => item.type === 'file' && item.name.toLocaleLowerCase().endsWith('.fig')
    )
    if (files.length === 0) return null
    if (files.length !== 1 || children.length !== 1) {
      if (!strict) return null
      throw new AliyunDriveError('foreign-file', 'Aliyun Drive document folder is ambiguous')
    }
    const file = files[0]
    try {
      this.#validateDirectChild(file, namespace.driveId, folder.fileId, 'file')
      aliyunDriveRemoteRevisionFor(file)
      return file
    } catch (error) {
      if (!strict && error instanceof AliyunDriveError) return null
      throw error
    }
  }

  async listDocuments(signal?: AbortSignal): Promise<AliyunDriveDocumentFile[]> {
    const namespace = await this.#namespace(signal)
    const children = await this.#listChildren(namespace.driveId, namespace.documentsFolderId, {
      signal
    })
    const documents: AliyunDriveDocumentFile[] = []
    for (const folder of children) {
      if (!DOCUMENT_ID_PATTERN.test(folder.name)) continue
      try {
        this.#validateDirectChild(
          folder,
          namespace.driveId,
          namespace.documentsFolderId,
          'folder'
        )
        const file = await this.#fileInFolder(namespace, folder, { signal }, false)
        if (file) documents.push({ documentId: folder.name, folder, file })
      } catch (error) {
        if (!(error instanceof AliyunDriveError) || error.code !== 'foreign-file') throw error
        // User-created lookalikes never become an OpenPencil binding.
      }
    }
    return documents
  }

  async getDocumentFile(
    documentId: string,
    options: DocumentLookupOptions = {}
  ): Promise<AliyunDriveDocumentFile | null> {
    const id = validateDocumentId(documentId)
    const namespace = await this.#namespace(options.signal, options.expectedAuthority)
    const folder = await this.#findDocumentFolder(namespace, id, options)
    if (!folder) return null
    const file = await this.#fileInFolder(namespace, folder, options, true)
    return file ? { documentId: id, folder, file } : null
  }

  async downloadDocument(
    documentId: string,
    options: StorageTransferOptions = {}
  ): Promise<StorageGetDocumentResult> {
    const located = await this.getDocumentFile(documentId, options)
    if (!located) throw new AliyunDriveError('not-found', 'Aliyun Drive document was not found')
    const namespace = await this.#namespace(options.signal, options.expectedAuthority)
    const fresh = await this.#getItem(namespace.driveId, located.file.fileId, options)
    if (!fresh) throw new AliyunDriveError('not-found', 'Aliyun Drive document was not found')
    this.#validateDirectChild(fresh, namespace.driveId, located.folder.fileId, 'file')
    const revision = aliyunDriveRemoteRevisionFor(fresh)
    const response = await this.#apiRequest(
      API_PATHS.getDownloadUrl,
      {
        drive_id: namespace.driveId,
        file_id: fresh.fileId,
        expire_sec: 900
      },
      { signal: options.signal, expectedAuthority: options.expectedAuthority, retry: true }
    )
    await this.#expect(response, [200])
    const value = await this.#readJson(response)
    if (!isRecord(value)) {
      throw new AliyunDriveError('invalid-response', 'Aliyun Drive returned an invalid download URL')
    }
    const downloadURL = this.#registerCapabilityURL(value.url, 'download')
    let download: Response
    try {
      download = await this.#capabilityRequest(
        downloadURL,
        'download',
        { method: 'GET' },
        { signal: options.signal, expectedAuthority: options.expectedAuthority },
        this.#limits.maxRequestAttempts
      )
    } finally {
      this.#capabilities.delete(downloadURL)
    }
    await this.#expect(download, [200])
    const bytes = await this.#readBytes(download, this.#limits.maxDownloadBytes, options.onProgress)
    if (fresh.size !== null && bytes.byteLength !== fresh.size) {
      throw new AliyunDriveError(
        'invalid-response',
        'Aliyun Drive download size did not match metadata'
      )
    }
    return {
      bytes,
      metadata: { name: fresh.name, updatedAt: fresh.updatedAt },
      remoteRevision: revision
    }
  }

  #partCount(size: number): number {
    if (!Number.isSafeInteger(size) || size <= 0) {
      throw new AliyunDriveError('invalid-input', 'Aliyun Drive refuses an empty .fig upload')
    }
    const count = Math.ceil(size / this.#uploadChunkBytes)
    if (count > ALIYUN_DRIVE_MAX_UPLOAD_PARTS) {
      throw new AliyunDriveError('resource-limit', 'Aliyun Drive upload exceeded the part limit')
    }
    return count
  }

  #parsePartURLs(value: unknown, expectedParts: readonly number[]): ReadonlyMap<number, string> {
    if (!Array.isArray(value) || value.length !== expectedParts.length) {
      throw new AliyunDriveError('invalid-response', 'Aliyun Drive returned invalid upload parts')
    }
    const expected = new Set(expectedParts)
    const urls = new Map<number, string>()
    for (const raw of value) {
      if (!isRecord(raw)) {
        throw new AliyunDriveError('invalid-response', 'Aliyun Drive returned an invalid upload part')
      }
      const partNumber = Number(raw.part_number)
      if (!Number.isSafeInteger(partNumber) || !expected.has(partNumber) || urls.has(partNumber)) {
        throw new AliyunDriveError(
          'invalid-response',
          'Aliyun Drive returned an unexpected upload part'
        )
      }
      urls.set(partNumber, this.#registerCapabilityURL(raw.upload_url, 'upload'))
    }
    return urls
  }

  async #createUploadSession(
    namespace: AliyunDriveNamespace,
    folderId: string,
    options: AliyunDriveUploadOptions,
    checkNameMode: 'ignore' | 'refuse'
  ): Promise<UploadSession> {
    const count = this.#partCount(options.bytes.byteLength)
    const partNumbers = Array.from({ length: count }, (_, index) => index + 1)
    const response = await this.#apiRequest(
      API_PATHS.create,
      {
        drive_id: namespace.driveId,
        parent_file_id: folderId,
        name: validateFigName(options.name),
        type: 'file',
        check_name_mode: checkNameMode,
        part_info_list: partNumbers.map((partNumber) => ({ part_number: partNumber }))
      },
      { signal: options.signal, expectedAuthority: options.expectedAuthority, retry: false }
    )
    await this.#expect(response, [200, 201])
    const value = await this.#readJson(response)
    if (!isRecord(value)) {
      throw new AliyunDriveError('invalid-response', 'Aliyun Drive returned an invalid upload')
    }
    return {
      driveId: namespace.driveId,
      fileId: requiredString(value.file_id, 'upload file ID'),
      uploadId: requiredString(value.upload_id, 'upload ID'),
      partURLs: this.#parsePartURLs(value.part_info_list, partNumbers)
    }
  }

  async #refreshUploadURL(
    session: UploadSession,
    partNumber: number,
    options: AliyunDriveUploadOptions
  ): Promise<string> {
    const response = await this.#apiRequest(
      API_PATHS.getUploadUrl,
      {
        drive_id: session.driveId,
        file_id: session.fileId,
        upload_id: session.uploadId,
        part_info_list: [{ part_number: partNumber }]
      },
      { signal: options.signal, expectedAuthority: options.expectedAuthority, retry: true }
    )
    await this.#expect(response, [200])
    const value = await this.#readJson(response)
    if (!isRecord(value)) {
      throw new AliyunDriveError('invalid-response', 'Aliyun Drive returned invalid upload URLs')
    }
    return this.#parsePartURLs(value.part_info_list, [partNumber]).get(partNumber) ?? (() => {
      throw new AliyunDriveError('invalid-response', 'Aliyun Drive omitted an upload URL')
    })()
  }

  async #putPart(
    initialURL: string,
    body: Uint8Array,
    session: UploadSession,
    partNumber: number,
    options: AliyunDriveUploadOptions
  ): Promise<void> {
    let url = initialURL
    const payload = new ArrayBuffer(body.byteLength)
    new Uint8Array(payload).set(body)
    for (let refresh = 0; refresh < 2; refresh++) {
      let response: Response
      try {
        response = await this.#capabilityRequest(
          url,
          'upload',
          {
            method: 'PUT',
            headers: {
              'Content-Length': String(body.byteLength),
              'Content-Type': 'application/octet-stream'
            },
            body: payload
          },
          { signal: options.signal, expectedAuthority: options.expectedAuthority },
          this.#limits.maxUploadAttempts
        )
      } finally {
        this.#capabilities.delete(url)
      }
      if (response.ok) {
        await discard(response)
        return
      }
      if ((response.status === 400 || response.status === 403) && refresh === 0) {
        await discard(response)
        url = await this.#refreshUploadURL(session, partNumber, options)
        continue
      }
      throw await this.#responseError(response)
    }
    throw new AliyunDriveError(
      'upload-url-expired',
      'Aliyun Drive upload URL expired before the part completed',
      { retryable: true }
    )
  }

  async #uploadSession(
    namespace: AliyunDriveNamespace,
    folderId: string,
    session: UploadSession,
    options: AliyunDriveUploadOptions
  ): Promise<AliyunDriveItem> {
    const total = options.bytes.byteLength
    options.onProgress?.({ transferredBytes: 0, totalBytes: total })
    let offset = 0
    for (let partNumber = 1; offset < total; partNumber++) {
      const end = Math.min(offset + this.#uploadChunkBytes, total)
      const url = session.partURLs.get(partNumber)
      if (!url) {
        throw new AliyunDriveError('invalid-response', 'Aliyun Drive omitted an upload part URL')
      }
      await this.#putPart(
        url,
        options.bytes.slice(offset, end),
        session,
        partNumber,
        options
      )
      offset = end
      options.onProgress?.({ transferredBytes: offset, totalBytes: total })
    }
    const complete = await this.#apiRequest(
      API_PATHS.complete,
      {
        drive_id: session.driveId,
        file_id: session.fileId,
        upload_id: session.uploadId
      },
      { signal: options.signal, expectedAuthority: options.expectedAuthority, retry: false }
    )
    await this.#expect(complete, [200, 201])
    await discard(complete)
    const item = await this.#getItem(namespace.driveId, session.fileId, options)
    if (!item) {
      throw new AliyunDriveError('invalid-response', 'Aliyun Drive completed file disappeared')
    }
    this.#validateDirectChild(item, namespace.driveId, folderId, 'file')
    if (item.name !== options.name) {
      throw new AliyunDriveError('invalid-response', 'Aliyun Drive uploaded an unexpected file')
    }
    aliyunDriveRemoteRevisionFor(item)
    return item
  }

  async #uploadNewFile(
    namespace: AliyunDriveNamespace,
    folderId: string,
    options: AliyunDriveUploadOptions,
    checkNameMode: 'ignore' | 'refuse'
  ): Promise<AliyunDriveItem> {
    const session = await this.#createUploadSession(namespace, folderId, options, checkNameMode)
    return this.#uploadSession(namespace, folderId, session, options)
  }

  async #trashItem(
    driveId: string,
    fileId: string,
    options: DocumentLookupOptions = {}
  ): Promise<void> {
    const response = await this.#apiRequest(
      API_PATHS.trash,
      { drive_id: driveId, file_id: fileId },
      { ...options, retry: false }
    )
    if (response.status === 404) {
      await discard(response)
      return
    }
    await this.#expect(response, [200, 204])
    await discard(response)
  }

  async createDocument(options: AliyunDriveUploadOptions): Promise<AliyunDriveUploadResult> {
    const documentId = validateDocumentId(options.documentId)
    validateFigName(options.name)
    const namespace = await this.#namespace(options.signal, options.expectedAuthority)
    const existingFolder = await this.#findDocumentFolder(namespace, documentId, options)
    const folder = existingFolder
      ? existingFolder
      : await this.#createFolder(
          namespace.driveId,
          namespace.documentsFolderId,
          documentId,
          options
        )
    const before = await this.#listChildren(namespace.driveId, folder.fileId, options)
    if (before.length !== 0) {
      throw new AliyunDriveError('conflict', 'Aliyun Drive document folder already contains content')
    }
    const item = await this.#uploadNewFile(namespace, folder.fileId, options, 'refuse')
    const after = await this.#listChildren(namespace.driveId, folder.fileId, options)
    if (after.length !== 1 || after[0]?.fileId !== item.fileId) {
      await this.#trashItem(namespace.driveId, item.fileId, options)
      throw new AliyunDriveError('conflict', 'Aliyun Drive document changed during creation')
    }
    return { item, remoteRevision: aliyunDriveRemoteRevisionFor(item) }
  }

  async #pollAsyncTask(
    asyncTaskId: string,
    options: DocumentLookupOptions
  ): Promise<void> {
    for (let poll = 0; poll < this.#limits.maxAsyncTaskPolls; poll++) {
      const response = await this.#apiRequest(
        API_PATHS.asyncTask,
        { async_task_id: validateIdentifier(asyncTaskId, 'async task ID') },
        { ...options, retry: true }
      )
      await this.#expect(response, [200])
      const value = await this.#readJson(response)
      if (!isRecord(value)) {
        throw new AliyunDriveError('invalid-response', 'Aliyun Drive returned an invalid task')
      }
      const state = requiredString(value.state, 'async task state', 64)
      if (state === 'Succeed') return
      if (state === 'Failed') {
        throw new AliyunDriveError('server', 'Aliyun Drive move task failed')
      }
      if (state !== 'Running' && state !== 'Wait') {
        throw new AliyunDriveError('invalid-response', 'Aliyun Drive returned an unknown task state')
      }
      await this.#sleep(Math.min(250 * 2 ** Math.min(poll, 5), 5_000), options.signal)
    }
    throw new AliyunDriveError('resource-limit', 'Aliyun Drive move task exceeded the poll limit')
  }

  async #moveToConflictFolder(
    namespace: AliyunDriveNamespace,
    item: AliyunDriveItem,
    options: AliyunDriveReplacementOptions
  ): Promise<AliyunDriveItem> {
    if (options.conflictDocumentId === options.documentId) {
      throw new AliyunDriveError('invalid-input', 'Aliyun Drive conflict ID reused the document ID')
    }
    const existing = await this.#findDocumentFolder(namespace, options.conflictDocumentId, options)
    const folder = existing
      ? existing
      : await this.#createFolder(
          namespace.driveId,
          namespace.documentsFolderId,
          validateDocumentId(options.conflictDocumentId),
          options
        )
    if ((await this.#listChildren(namespace.driveId, folder.fileId, options)).length !== 0) {
      throw new AliyunDriveError(
        'preservation-failed',
        'Aliyun Drive conflict folder was not empty'
      )
    }
    const response = await this.#apiRequest(
      API_PATHS.move,
      {
        drive_id: namespace.driveId,
        file_id: item.fileId,
        to_drive_id: namespace.driveId,
        to_parent_file_id: folder.fileId,
        check_name_mode: 'refuse',
        new_name: validateFigName(options.conflictName)
      },
      { signal: options.signal, expectedAuthority: options.expectedAuthority, retry: false }
    )
    await this.#expect(response, [200, 201, 202])
    let asyncTaskId: string | null = null
    if (response.status !== 204) {
      const value = await this.#readJson(response)
      if (!isRecord(value)) {
        throw new AliyunDriveError('invalid-response', 'Aliyun Drive returned an invalid move')
      }
      asyncTaskId = optionalString(value.async_task_id)
    }
    if (asyncTaskId) await this.#pollAsyncTask(asyncTaskId, options)
    const moved = await this.#getItem(namespace.driveId, item.fileId, options)
    if (!moved) {
      throw new AliyunDriveError('preservation-failed', 'Aliyun Drive conflict copy disappeared')
    }
    this.#validateDirectChild(moved, namespace.driveId, folder.fileId, 'file')
    if (moved.name !== options.conflictName) {
      throw new AliyunDriveError(
        'preservation-failed',
        'Aliyun Drive conflict copy has an unexpected name'
      )
    }
    return moved
  }

  async #currentRevisionOrNull(
    namespace: AliyunDriveNamespace,
    folder: AliyunDriveItem,
    options: DocumentLookupOptions
  ): Promise<StorageRemoteRevision | null> {
    try {
      const file = await this.#fileInFolder(namespace, folder, options, false)
      return file ? aliyunDriveRemoteRevisionFor(file) : null
    } catch (error) {
      if (error instanceof AliyunDriveError && error.code === 'not-found') return null
      throw error
    }
  }

  async #preserveReplacement(
    namespace: AliyunDriveNamespace,
    item: AliyunDriveItem,
    options: AliyunDriveReplacementOptions
  ): Promise<AliyunDriveReplacementResult> {
    let moved: AliyunDriveItem
    try {
      moved = await this.#moveToConflictFolder(namespace, item, options)
    } catch (error) {
      throw new AliyunDriveError(
        'preservation-failed',
        'Aliyun Drive kept the uploaded item but could not finalize its conflict folder',
        { cause: error }
      )
    }
    return {
      outcome: 'conflict-copy',
      remoteRevision: await this.#currentRevisionOrNull(namespace, options.current.folder, options),
      conflictDocumentId: options.conflictDocumentId,
      conflictCopyRevision: aliyunDriveRemoteRevisionFor(moved)
    }
  }

  async replaceDocument(
    options: AliyunDriveReplacementOptions
  ): Promise<AliyunDriveReplacementResult> {
    validateDocumentId(options.documentId)
    validateDocumentId(options.conflictDocumentId)
    validateFigName(options.name)
    validateFigName(options.conflictName)
    const namespace = await this.#namespace(options.signal, options.expectedAuthority)
    const current = await this.getDocumentFile(options.documentId, options)
    const actualRevision = current ? aliyunDriveRemoteRevisionFor(current.file) : null
    if (
      !current ||
      current.folder.fileId !== options.current.folder.fileId ||
      current.file.fileId !== options.current.file.fileId ||
      !revisionsMatch(options.expectedRemoteRevision, actualRevision)
    ) {
      throw new AliyunDriveError('precondition', 'Aliyun Drive document changed before upload', {
        status: 412
      })
    }
    const uploaded = await this.#uploadNewFile(namespace, current.folder.fileId, options, 'ignore')
    const beforeTrash = await this.#listChildren(namespace.driveId, current.folder.fileId, options)
    const oldNow = await this.#getItem(namespace.driveId, current.file.fileId, options)
    const oldRevision = oldNow ? aliyunDriveRemoteRevisionFor(oldNow) : null
    const exactPair =
      containsExactItemPair(beforeTrash, uploaded.fileId, current.file.fileId) &&
      oldNow?.parentFileId === current.folder.fileId &&
      revisionsMatch(options.expectedRemoteRevision, oldRevision)
    if (!exactPair) return this.#preserveReplacement(namespace, uploaded, options)

    await this.#trashItem(namespace.driveId, current.file.fileId, options)
    const afterTrash = await this.#listChildren(namespace.driveId, current.folder.fileId, options)
    if (!containsOnlyItem(afterTrash, uploaded.fileId)) {
      return this.#preserveReplacement(namespace, uploaded, options)
    }
    const fresh = await this.#getItem(namespace.driveId, uploaded.fileId, options)
    if (
      !fresh ||
      fresh.parentFileId !== current.folder.fileId ||
      !revisionsMatch(aliyunDriveRemoteRevisionFor(uploaded), aliyunDriveRemoteRevisionFor(fresh))
    ) {
      if (fresh) return this.#preserveReplacement(namespace, fresh, options)
      throw new AliyunDriveError(
        'preservation-failed',
        'Aliyun Drive replacement disappeared after the old item was trashed'
      )
    }
    const finalChildren = await this.#listChildren(
      namespace.driveId,
      current.folder.fileId,
      options
    )
    if (!containsOnlyItem(finalChildren, fresh.fileId)) {
      return this.#preserveReplacement(namespace, fresh, options)
    }
    return {
      outcome: 'updated',
      item: fresh,
      remoteRevision: aliyunDriveRemoteRevisionFor(fresh)
    }
  }

  async deleteDocumentFile(
    documentId: string,
    signal?: AbortSignal,
    expectedAuthority?: StorageDocumentAuthority
  ): Promise<void> {
    const located = await this.getDocumentFile(validateDocumentId(documentId), {
      signal,
      expectedAuthority
    })
    if (!located) return
    const expectedRevision = aliyunDriveRemoteRevisionFor(located.file)
    const fresh = await this.#getItem(located.file.driveId, located.file.fileId, {
      signal,
      expectedAuthority
    })
    if (
      !fresh ||
      fresh.parentFileId !== located.folder.fileId ||
      !revisionsMatch(expectedRevision, aliyunDriveRemoteRevisionFor(fresh))
    ) {
      throw new AliyunDriveError('precondition', 'Aliyun Drive document changed before trash', {
        status: 412
      })
    }
    await this.#trashItem(located.file.driveId, located.file.fileId, {
      signal,
      expectedAuthority
    })
  }
}
