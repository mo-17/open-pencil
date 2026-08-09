import type {
  StorageDocumentAuthority,
  StorageTransferOptions,
  StorageTransferProgress
} from '../types'
import {
  FILE_FIELDS,
  allowedGoogleUrl,
  boundedString,
  contentDispositionName,
  defaultSleep,
  discard,
  exactAuthority,
  isOpenPencilFile,
  isRecord,
  optionalString,
  parseAppProperties,
  parseSize,
  parseTimestamp,
  resolveLimits,
  retryDelay,
  revisionFrom,
  tokenAuthority,
  validateDocumentId,
  validateEtag,
  validatePageToken,
  validateUploadMetadata,
  type CachedMetadata,
  type ResolvedLimits,
  type ResolvedToken
} from './client-helpers'
import {
  GoogleDriveError,
  errorCodeForStatus,
  isAbortError,
  isRetryableStatus,
  parseRetryAfter,
  throwIfAborted
} from './errors'
import { uploadResumable, validateUploadChunkBytes } from './transfer'
import {
  GOOGLE_DRIVE_API_BASE,
  GOOGLE_DRIVE_APP_PROPERTY,
  GOOGLE_DRIVE_APP_PROPERTY_VALUE,
  GOOGLE_DRIVE_FIG_MIME_TYPE,
  GOOGLE_DRIVE_UPLOAD_BASE,
  GOOGLE_DRIVE_UPLOAD_CHUNK_BYTES,
  type GoogleDriveChange,
  type GoogleDriveChangesResult,
  type GoogleDriveClientOptions,
  type GoogleDriveDownloadResult,
  type GoogleDriveFile,
  type GoogleDriveRequestContext,
  type GoogleDriveSleep,
  type GoogleDriveTokenResolver,
  type GoogleDriveTransport,
  type GoogleDriveUploadOptions,
  type GoogleDriveUploadResult
} from './types'

type RequestOptions = {
  signal?: AbortSignal
  authority?: StorageDocumentAuthority
  retryTransient?: boolean
}

export class GoogleDriveClient {
  readonly #tokenSource: GoogleDriveTokenResolver
  readonly #transport: GoogleDriveTransport
  readonly #sleep: GoogleDriveSleep
  readonly #limits: ResolvedLimits
  readonly #uploadChunkBytes: number
  readonly #metadataCache = new Map<string, CachedMetadata>()

  constructor(options: GoogleDriveClientOptions) {
    this.#tokenSource = options.tokenSource
    this.#transport = options.transport ?? ((input, init) => fetch(input, init))
    this.#sleep = options.sleep ?? defaultSleep
    this.#limits = resolveLimits(options.limits)
    this.#uploadChunkBytes = validateUploadChunkBytes(
      options.uploadChunkBytes ?? GOOGLE_DRIVE_UPLOAD_CHUNK_BYTES
    )
  }

  async #resolveToken(
    signal?: AbortSignal,
    expectedAuthority?: StorageDocumentAuthority
  ): Promise<ResolvedToken> {
    throwIfAborted(signal)
    const raw =
      typeof this.#tokenSource === 'function'
        ? await this.#tokenSource(signal)
        : await this.#tokenSource.getAccessToken(signal)
    const resolved = tokenAuthority(raw)
    exactAuthority(resolved.authority, expectedAuthority)
    return resolved
  }

  async #begin(
    signal?: AbortSignal,
    expectedAuthority?: StorageDocumentAuthority
  ): Promise<GoogleDriveRequestContext> {
    const { authority } = await this.#resolveToken(signal, expectedAuthority)
    return { authority, signal }
  }

  async #requestFile(
    id: string,
    init: RequestInit,
    signal?: AbortSignal,
    expectedAuthority?: StorageDocumentAuthority
  ): Promise<readonly [fileId: string, response: Response]> {
    const fileId = validateDocumentId(id)
    const context = await this.#begin(signal, expectedAuthority)
    const url = new URL(`${GOOGLE_DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}`)
    url.searchParams.set('fields', FILE_FIELDS)
    return [fileId, await this.#request(url.toString(), init, context)]
  }

  async getAuthority(signal?: AbortSignal): Promise<StorageDocumentAuthority> {
    return (await this.#begin(signal)).authority
  }

  async #responseRetryDelay(response: Response, attempt: number): Promise<number | null> {
    if (isRetryableStatus(response.status)) return retryDelay(response, attempt)
    if (response.status !== 403) return null
    const classified = await this.responseError(response.clone())
    return classified.retryable ? (classified.retryAfterMs ?? retryDelay(response, attempt)) : null
  }

  async #request(
    url: string,
    init: RequestInit,
    options: RequestOptions = {},
    uploadSession = false
  ): Promise<Response> {
    const safeUrl = allowedGoogleUrl(url, uploadSession)
    const attempts = options.retryTransient === false ? 1 : this.#limits.maxRequestAttempts
    for (let attempt = 1; attempt <= attempts; attempt++) {
      throwIfAborted(options.signal)
      const { accessToken } = await this.#resolveToken(options.signal, options.authority)
      const headers = new Headers(init.headers)
      headers.set('Authorization', `Bearer ${accessToken}`)
      headers.set('Accept', 'application/json')
      let response: Response
      try {
        response = await this.#transport(safeUrl, {
          ...init,
          headers,
          signal: options.signal,
          credentials: 'omit',
          redirect: 'error'
        })
      } catch (error) {
        if (isAbortError(error) || options.signal?.aborted) {
          throw new GoogleDriveError('aborted', 'Google Drive operation was cancelled', {
            cause: error
          })
        }
        if (attempt === attempts) {
          throw new GoogleDriveError('network', 'Google Drive request failed', {
            retryable: true,
            cause: error
          })
        }
        await this.#sleep(retryDelay(null, attempt), options.signal)
        continue
      }
      if (attempt === attempts) return response
      const delayMs = await this.#responseRetryDelay(response, attempt)
      if (delayMs === null) return response
      await discard(response)
      await this.#sleep(delayMs, options.signal)
    }
    throw new GoogleDriveError('network', 'Google Drive request retry limit was reached')
  }

  async #readBytes(
    response: Response,
    limit: number,
    onProgress?: (progress: StorageTransferProgress) => void
  ): Promise<Uint8Array> {
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > limit) {
      await discard(response)
      throw new GoogleDriveError('resource-limit', 'Google Drive response exceeded the byte limit')
    }
    if (!response.body) return new Uint8Array()
    const totalBytes = Number.isFinite(declared) && declared >= 0 ? declared : null
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > limit) {
        await reader.cancel().catch(() => undefined)
        throw new GoogleDriveError(
          'resource-limit',
          'Google Drive response exceeded the byte limit'
        )
      }
      chunks.push(value)
      onProgress?.({ transferredBytes: received, totalBytes })
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
      throw new GoogleDriveError('invalid-response', 'Google Drive returned an empty response')
    }
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown
    } catch (error) {
      throw new GoogleDriveError('invalid-response', 'Google Drive returned invalid JSON', {
        cause: error
      })
    }
  }

  async responseError(response: Response): Promise<GoogleDriveError> {
    let message = `Google Drive request failed (${response.status})`
    let reason: string | null = null
    try {
      const bytes = await this.#readBytes(response, this.#limits.maxErrorBytes)
      const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown
      if (isRecord(value) && isRecord(value.error)) {
        if (typeof value.error.message === 'string' && value.error.message.length <= 2_048) {
          message = value.error.message
        }
        const errors = value.error.errors
        if (Array.isArray(errors) && isRecord(errors[0])) {
          reason = optionalString(errors[0].reason, 256) ?? null
        }
        reason ??= optionalString(value.error.status, 256) ?? null
      }
    } catch (error) {
      void error
      // The bounded status-based error remains useful if the body is absent or malformed.
    }
    const rateLimitedReason =
      response.status === 403 &&
      reason !== null &&
      /^(?:rateLimitExceeded|userRateLimitExceeded|sharingRateLimitExceeded)$/i.test(reason)
    const code = rateLimitedReason ? 'rate-limited' : errorCodeForStatus(response.status)
    return new GoogleDriveError(code, message, {
      status: response.status,
      reason,
      retryable: rateLimitedReason || isRetryableStatus(response.status),
      retryAfterMs: parseRetryAfter(response.headers.get('retry-after'))
    })
  }

  #parseFile(value: unknown, headers = new Headers()): GoogleDriveFile {
    if (!isRecord(value)) {
      throw new GoogleDriveError('invalid-response', 'Google Drive returned an invalid file')
    }
    const id = validateDocumentId(boundedString(value.id, 'file ID', 256))
    const version = optionalString(value.version, 128)
    const md5Checksum = optionalString(value.md5Checksum, 128)
    const headRevisionId = optionalString(value.headRevisionId, 256)
    const partial = { version, md5Checksum, headRevisionId }
    const file: GoogleDriveFile = {
      id,
      name: boundedString(value.name, 'file name', 512),
      mimeType: boundedString(value.mimeType, 'MIME type', 256),
      modifiedTime: parseTimestamp(value.modifiedTime),
      size: parseSize(value.size),
      ...(version ? { version } : {}),
      ...(md5Checksum ? { md5Checksum } : {}),
      ...(headRevisionId ? { headRevisionId } : {}),
      trashed: value.trashed === true,
      appProperties: parseAppProperties(value.appProperties),
      remoteRevision: null
    }
    file.remoteRevision = revisionFrom(headers, partial)
    this.#metadataCache.set(id, {
      name: file.name,
      updatedAt: file.modifiedTime,
      size: file.size
    })
    return file
  }

  async #expectFile(response: Response): Promise<GoogleDriveFile> {
    if (!response.ok) throw await this.responseError(response)
    return this.#parseFile(await this.#readJson(response), response.headers)
  }

  async generateIds(
    count = 1,
    signal?: AbortSignal,
    expectedAuthority?: StorageDocumentAuthority
  ): Promise<string[]> {
    if (!Number.isSafeInteger(count) || count < 1 || count > 1_000) {
      throw new GoogleDriveError(
        'invalid-input',
        'Google Drive ID count must be between 1 and 1000'
      )
    }
    const context = await this.#begin(signal, expectedAuthority)
    const url = new URL(`${GOOGLE_DRIVE_API_BASE}/files/generateIds`)
    url.searchParams.set('count', String(count))
    url.searchParams.set('space', 'drive')
    url.searchParams.set('type', 'files')
    const response = await this.#request(url.toString(), { method: 'GET' }, context)
    if (!response.ok) throw await this.responseError(response)
    const value = await this.#readJson(response)
    if (!isRecord(value) || !Array.isArray(value.ids) || value.ids.length !== count) {
      throw new GoogleDriveError('invalid-response', 'Google Drive returned invalid generated IDs')
    }
    return value.ids.map((id) => validateDocumentId(boundedString(id, 'generated file ID', 256)))
  }

  async listFiles(signal?: AbortSignal): Promise<GoogleDriveFile[]> {
    const context = await this.#begin(signal)
    const output: GoogleDriveFile[] = []
    const seenTokens = new Set<string>()
    let pageToken: string | null = null
    for (let page = 0; page < this.#limits.maxListPages; page++) {
      const url = new URL(`${GOOGLE_DRIVE_API_BASE}/files`)
      url.searchParams.set(
        'q',
        `trashed = false and appProperties has { key='${GOOGLE_DRIVE_APP_PROPERTY}' and value='${GOOGLE_DRIVE_APP_PROPERTY_VALUE}' }`
      )
      url.searchParams.set('spaces', 'drive')
      url.searchParams.set('pageSize', String(Math.min(1_000, this.#limits.maxListItems)))
      url.searchParams.set('orderBy', 'modifiedTime desc')
      url.searchParams.set('fields', `nextPageToken,incompleteSearch,files(${FILE_FIELDS})`)
      if (pageToken) url.searchParams.set('pageToken', pageToken)
      const response = await this.#request(url.toString(), { method: 'GET' }, context)
      if (!response.ok) throw await this.responseError(response)
      const value = await this.#readJson(response)
      if (!isRecord(value) || !Array.isArray(value.files)) {
        throw new GoogleDriveError('invalid-response', 'Google Drive returned an invalid file list')
      }
      if (value.incompleteSearch === true) {
        throw new GoogleDriveError('resource-limit', 'Google Drive returned an incomplete search')
      }
      for (const entry of value.files) {
        const file = this.#parseFile(entry)
        if (!isOpenPencilFile(file)) continue
        output.push(file)
        if (output.length > this.#limits.maxListItems) {
          throw new GoogleDriveError('resource-limit', 'Google Drive file list exceeded the limit')
        }
      }
      const next = optionalString(value.nextPageToken, 4_096) ?? null
      if (!next) return output
      if (seenTokens.has(next)) {
        throw new GoogleDriveError('invalid-response', 'Google Drive repeated a file page token')
      }
      seenTokens.add(next)
      pageToken = next
    }
    throw new GoogleDriveError('resource-limit', 'Google Drive file pagination exceeded the limit')
  }

  async getFileMetadata(
    id: string,
    signal?: AbortSignal,
    expectedAuthority?: StorageDocumentAuthority
  ): Promise<GoogleDriveFile | null> {
    const [, response] = await this.#requestFile(id, { method: 'GET' }, signal, expectedAuthority)
    if (response.status === 404) {
      await discard(response)
      return null
    }
    return this.#expectFile(response)
  }

  async downloadFile(
    id: string,
    options: StorageTransferOptions = {}
  ): Promise<GoogleDriveDownloadResult> {
    const fileId = validateDocumentId(id)
    const context = await this.#begin(options.signal, options.expectedAuthority)
    const url = new URL(`${GOOGLE_DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}`)
    url.searchParams.set('alt', 'media')
    const response = await this.#request(url.toString(), { method: 'GET' }, context)
    if (!response.ok) throw await this.responseError(response)
    const cached = this.#metadataCache.get(fileId)
    const name =
      contentDispositionName(response.headers.get('content-disposition')) ?? cached?.name ?? fileId
    const lastModified = response.headers.get('last-modified')
    const updatedAt = lastModified
      ? parseTimestamp(lastModified)
      : (cached?.updatedAt ?? new Date(0).toISOString())
    const remoteRevision = revisionFrom(response.headers)
    const bytes = await this.#readBytes(response, this.#limits.maxDownloadBytes, options.onProgress)
    return { bytes, metadata: { name, updatedAt }, remoteRevision }
  }

  async #createUploadSession(
    context: GoogleDriveRequestContext,
    method: 'POST' | 'PATCH',
    id: string,
    metadata: Readonly<Record<string, unknown>>,
    expectedEtag?: string
  ): Promise<string> {
    const url =
      method === 'POST'
        ? new URL(`${GOOGLE_DRIVE_UPLOAD_BASE}/files`)
        : new URL(`${GOOGLE_DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(id)}`)
    url.searchParams.set('uploadType', 'resumable')
    url.searchParams.set('fields', FILE_FIELDS)
    const headers = new Headers({
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': GOOGLE_DRIVE_FIG_MIME_TYPE
    })
    const safeEtag = validateEtag(expectedEtag)
    if (safeEtag) headers.set('If-Match', safeEtag)
    const response = await this.#request(
      url.toString(),
      { method, headers, body: JSON.stringify(metadata) },
      context,
      true
    )
    if (!response.ok) throw await this.responseError(response)
    await discard(response)
    const location = response.headers.get('location')
    if (!location || location.length > 8_192) {
      throw new GoogleDriveError(
        'invalid-response',
        'Google Drive did not return a resumable upload location'
      )
    }
    return allowedGoogleUrl(location, true)
  }

  async #upload(
    method: 'POST' | 'PATCH',
    options: GoogleDriveUploadOptions
  ): Promise<GoogleDriveUploadResult> {
    const id = validateDocumentId(options.id)
    const context = await this.#begin(options.signal, options.expectedAuthority)
    const uploadMetadata = validateUploadMetadata(options.metadata)
    const appProperties = {
      ...uploadMetadata.appProperties,
      [GOOGLE_DRIVE_APP_PROPERTY]: GOOGLE_DRIVE_APP_PROPERTY_VALUE
    }
    const body: Record<string, unknown> = {
      name: uploadMetadata.name,
      mimeType: GOOGLE_DRIVE_FIG_MIME_TYPE,
      appProperties
    }
    if (method === 'POST') body.id = id
    const createSession = () =>
      this.#createUploadSession(context, method, id, body, options.expectedEtag)
    const response = await uploadResumable({
      bytes: options.bytes,
      createSession,
      request: (sessionUrl, init) =>
        this.#request(sessionUrl, init, { ...context, retryTransient: false }, true),
      responseError: (uploadResponse) => this.responseError(uploadResponse),
      signal: options.signal,
      onProgress: options.onProgress,
      chunkBytes: this.#uploadChunkBytes,
      maxAttempts: this.#limits.maxUploadAttempts,
      maxSessionRestarts: this.#limits.maxUploadSessionRestarts,
      sleep: this.#sleep
    })
    const file = await this.#expectFile(response)
    return { file, remoteRevision: file.remoteRevision }
  }

  async createFile(options: GoogleDriveUploadOptions): Promise<GoogleDriveUploadResult> {
    return this.#upload('POST', options)
  }

  async updateFile(options: GoogleDriveUploadOptions): Promise<GoogleDriveUploadResult> {
    return this.#upload('PATCH', options)
  }

  async trashFile(
    id: string,
    signal?: AbortSignal,
    expectedAuthority?: StorageDocumentAuthority
  ): Promise<void> {
    const [fileId, response] = await this.#requestFile(
      id,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ trashed: true })
      },
      signal,
      expectedAuthority
    )
    if (response.status === 404) {
      await discard(response)
      return
    }
    await this.#expectFile(response)
    this.#metadataCache.delete(fileId)
  }

  async getStartPageToken(signal?: AbortSignal): Promise<string> {
    const context = await this.#begin(signal)
    const url = new URL(`${GOOGLE_DRIVE_API_BASE}/changes/startPageToken`)
    url.searchParams.set('supportsAllDrives', 'false')
    const response = await this.#request(url.toString(), { method: 'GET' }, context)
    if (!response.ok) throw await this.responseError(response)
    const value = await this.#readJson(response)
    if (!isRecord(value)) {
      throw new GoogleDriveError(
        'invalid-response',
        'Google Drive returned an invalid start page token'
      )
    }
    return validatePageToken(boundedString(value.startPageToken, 'start page token', 4_096))
  }

  async listChanges(pageToken: string, signal?: AbortSignal): Promise<GoogleDriveChangesResult> {
    const context = await this.#begin(signal)
    const changes: GoogleDriveChange[] = []
    const seenTokens = new Set<string>()
    let currentToken = validatePageToken(pageToken, 'changes page token')
    for (let page = 0; page < this.#limits.maxChangePages; page++) {
      const url = new URL(`${GOOGLE_DRIVE_API_BASE}/changes`)
      url.searchParams.set('pageToken', currentToken)
      url.searchParams.set('pageSize', String(Math.min(1_000, this.#limits.maxChanges)))
      url.searchParams.set('spaces', 'drive')
      url.searchParams.set('includeRemoved', 'true')
      url.searchParams.set('restrictToMyDrive', 'true')
      url.searchParams.set(
        'fields',
        `nextPageToken,newStartPageToken,changes(fileId,removed,time,file(${FILE_FIELDS}))`
      )
      const response = await this.#request(url.toString(), { method: 'GET' }, context)
      if (!response.ok) throw await this.responseError(response)
      const value = await this.#readJson(response)
      if (!isRecord(value) || !Array.isArray(value.changes)) {
        throw new GoogleDriveError('invalid-response', 'Google Drive returned invalid changes')
      }
      for (const rawChange of value.changes) {
        if (!isRecord(rawChange)) {
          throw new GoogleDriveError('invalid-response', 'Google Drive returned an invalid change')
        }
        const removed = rawChange.removed === true
        const file = rawChange.file == null ? null : this.#parseFile(rawChange.file)
        changes.push({
          fileId: validateDocumentId(boundedString(rawChange.fileId, 'change file ID', 256)),
          removed,
          time:
            typeof rawChange.time === 'string' && Number.isFinite(Date.parse(rawChange.time))
              ? new Date(rawChange.time).toISOString()
              : null,
          file
        })
        if (changes.length > this.#limits.maxChanges) {
          throw new GoogleDriveError('resource-limit', 'Google Drive changes exceeded the limit')
        }
      }
      const next = optionalString(value.nextPageToken, 4_096)
      if (next) {
        const validated = validatePageToken(next, 'next changes page token')
        if (seenTokens.has(validated)) {
          throw new GoogleDriveError('invalid-response', 'Google Drive repeated a changes token')
        }
        seenTokens.add(validated)
        currentToken = validated
        continue
      }
      return {
        changes,
        newStartPageToken: validatePageToken(
          boundedString(value.newStartPageToken, 'new start page token', 4_096),
          'new start page token'
        )
      }
    }
    throw new GoogleDriveError(
      'resource-limit',
      'Google Drive changes pagination exceeded the limit'
    )
  }
}

export { isOpenPencilFile, revisionFrom, validateDocumentId }
