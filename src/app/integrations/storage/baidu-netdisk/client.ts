/* oxlint-disable eslint/max-lines -- One client owns Baidu origin policy, lossless IDs, bounded paging, capability URLs, and the three-stage upload protocol. */

import { md5 } from '@noble/hashes/legacy'

import type {
  StorageDocumentAuthority,
  StorageGetDocumentResult,
  StorageRemoteRevision,
  StorageTransferOptions
} from '../types'
import {
  BAIDU_NETDISK_API_ORIGIN,
  BAIDU_NETDISK_APP_ROOT,
  BAIDU_NETDISK_LIST_PAGE_SIZE,
  BAIDU_NETDISK_LOCATE_UPLOAD_APP_ID,
  BAIDU_NETDISK_MAX_DOCUMENT_BYTES,
  BAIDU_NETDISK_MAX_UPLOAD_PARTS,
  BAIDU_NETDISK_PCS_ORIGIN,
  BAIDU_NETDISK_UPLOAD_CHUNK_BYTES
} from './config'
import {
  baiduNetdiskErrorCodeForErrno,
  baiduNetdiskErrorCodeForStatus,
  BaiduNetdiskError,
  isBaiduNetdiskAbortError,
  isRetryableBaiduNetdiskStatus,
  throwIfBaiduNetdiskAborted
} from './errors'
import type {
  BaiduNetdiskAccessToken,
  BaiduNetdiskCapabilityKind,
  BaiduNetdiskClientLimits,
  BaiduNetdiskClientOptions,
  BaiduNetdiskDocumentFile,
  BaiduNetdiskItem,
  BaiduNetdiskPromotionResult,
  BaiduNetdiskTransport,
  BaiduNetdiskUploadOptions,
  BaiduNetdiskUploadResult
} from './types'

const DOCUMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const DOCUMENT_FILENAME_PATTERN =
  /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})--(.+\.fig)$/
const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)$/
const MD5_PATTERN = /^[0-9a-f]{32}$/
const DEFAULT_MAX_DOWNLOAD_BYTES = BAIDU_NETDISK_MAX_DOCUMENT_BYTES
const DEFAULT_MAX_ERROR_BYTES = 32 * 1024
const DEFAULT_MAX_JSON_BYTES = 2 * 1024 * 1024
const DEFAULT_MAX_LIST_ITEMS = 3_200
const DEFAULT_MAX_LIST_PAGES = 32
const DEFAULT_MAX_REDIRECTS = 5

type ResolvedLimits = Required<BaiduNetdiskClientLimits>

type RequestOptions = Readonly<{
  signal?: AbortSignal
  expectedAuthority?: StorageDocumentAuthority
}>

type JSONResult = Readonly<{
  value: unknown
  token: BaiduNetdiskAccessToken
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedPositiveInteger(
  value: number | undefined,
  fallback: number,
  field: string,
  maximum: number
): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > maximum) {
    throw new BaiduNetdiskError('invalid-input', `${field} is invalid`)
  }
  return resolved
}

function resolveLimits(limits: BaiduNetdiskClientLimits | undefined): ResolvedLimits {
  return {
    maxDownloadBytes: boundedPositiveInteger(
      limits?.maxDownloadBytes,
      DEFAULT_MAX_DOWNLOAD_BYTES,
      'Baidu Netdisk download byte limit',
      BAIDU_NETDISK_MAX_DOCUMENT_BYTES
    ),
    maxErrorBytes: boundedPositiveInteger(
      limits?.maxErrorBytes,
      DEFAULT_MAX_ERROR_BYTES,
      'Baidu Netdisk error byte limit',
      1024 * 1024
    ),
    maxJsonBytes: boundedPositiveInteger(
      limits?.maxJsonBytes,
      DEFAULT_MAX_JSON_BYTES,
      'Baidu Netdisk JSON byte limit',
      16 * 1024 * 1024
    ),
    maxListItems: boundedPositiveInteger(
      limits?.maxListItems,
      DEFAULT_MAX_LIST_ITEMS,
      'Baidu Netdisk list item limit',
      100_000
    ),
    maxListPages: boundedPositiveInteger(
      limits?.maxListPages,
      DEFAULT_MAX_LIST_PAGES,
      'Baidu Netdisk list page limit',
      1_000
    ),
    maxRedirects: boundedPositiveInteger(
      limits?.maxRedirects,
      DEFAULT_MAX_REDIRECTS,
      'Baidu Netdisk redirect limit',
      10
    )
  }
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127
  })
}

function requiredString(value: unknown, field: string, max = 2_048): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > max ||
    hasControlCharacter(value)
  ) {
    throw new BaiduNetdiskError('invalid-response', `Baidu Netdisk returned an invalid ${field}`)
  }
  return value
}

function requiredDecimalString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length > 32 || !DECIMAL_PATTERN.test(value)) {
    throw new BaiduNetdiskError(
      'invalid-response',
      `Baidu Netdisk returned a non-lossless ${field}`
    )
  }
  return value
}

function safeInteger(value: unknown, field: string, maximum = Number.MAX_SAFE_INTEGER): number {
  const number = typeof value === 'string' && DECIMAL_PATTERN.test(value) ? Number(value) : value
  if (!Number.isSafeInteger(number) || (number as number) < 0 || (number as number) > maximum) {
    throw new BaiduNetdiskError('invalid-response', `Baidu Netdisk returned an invalid ${field}`)
  }
  return number as number
}

/** Quotes selected provider uint64 fields before JSON.parse can round them. */
export function protectBaiduNetdiskDecimalIds(json: string): string {
  const protectedKeys = new Set(['"fs_id"', '"uk"'])
  let output = ''
  let index = 0
  while (index < json.length) {
    if (json[index] !== '"') {
      output += json[index]
      index++
      continue
    }
    const start = index
    index++
    let escaped = false
    while (index < json.length) {
      const character = json[index++]
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') break
    }
    const token = json.slice(start, index)
    output += token
    if (!protectedKeys.has(token)) continue
    let cursor = index
    while (/\s/.test(json[cursor] ?? '')) cursor++
    if (json[cursor] !== ':') continue
    output += json.slice(index, cursor + 1)
    cursor++
    while (/\s/.test(json[cursor] ?? '')) {
      output += json[cursor]
      cursor++
    }
    if (json[cursor] === '"') {
      index = cursor
      continue
    }
    const numberStart = cursor
    if (json[cursor] === '-') cursor++
    while (/\d/.test(json[cursor] ?? '')) cursor++
    if (cursor === numberStart || (cursor === numberStart + 1 && json[numberStart] === '-')) {
      index = numberStart
      continue
    }
    output += `"${json.slice(numberStart, cursor)}"`
    index = cursor
  }
  return output
}

function parseLosslessJSON(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(protectBaiduNetdiskDecimalIds(new TextDecoder().decode(bytes))) as unknown
  } catch (error) {
    throw new BaiduNetdiskError('invalid-response', 'Baidu Netdisk returned invalid JSON', {
      cause: error
    })
  }
}

function validateAuthority(value: StorageDocumentAuthority): StorageDocumentAuthority {
  const accountId = value.accountId.trim()
  const authorizationVersion = value.authorizationVersion.trim()
  if (
    !DECIMAL_PATTERN.test(accountId) ||
    accountId.length > 32 ||
    !authorizationVersion ||
    authorizationVersion.length > 512 ||
    hasControlCharacter(authorizationVersion)
  ) {
    throw new BaiduNetdiskError('auth', 'Baidu Netdisk authorization identity is invalid')
  }
  return { accountId, authorizationVersion }
}

function validateToken(value: BaiduNetdiskAccessToken): BaiduNetdiskAccessToken {
  const accessToken = value.accessToken.trim()
  if (!accessToken || accessToken.length > 32_768 || /[\r\n]/.test(accessToken)) {
    throw new BaiduNetdiskError('auth', 'Baidu Netdisk access token is unavailable')
  }
  return { accessToken, authority: validateAuthority(value.authority) }
}

function authoritiesEqual(
  left: StorageDocumentAuthority,
  right: StorageDocumentAuthority
): boolean {
  return (
    left.accountId === right.accountId && left.authorizationVersion === right.authorizationVersion
  )
}

function validateDocumentId(value: string): string {
  if (!DOCUMENT_ID_PATTERN.test(value)) {
    throw new BaiduNetdiskError(
      'invalid-input',
      'Baidu Netdisk document ID must be a canonical UUID v4'
    )
  }
  return value
}

function validateFigName(value: string): string {
  if (
    value !== value.trim() ||
    value.length < 5 ||
    value.length > 240 ||
    !value.toLocaleLowerCase().endsWith('.fig') ||
    hasControlCharacter(value) ||
    /[\\/]/.test(value)
  ) {
    throw new BaiduNetdiskError('invalid-input', 'Baidu Netdisk document name is invalid')
  }
  return value
}

function filenameFor(documentId: string, name: string): string {
  return `${validateDocumentId(documentId)}--${validateFigName(name)}`
}

function pathFor(documentId: string, name: string): string {
  return `${BAIDU_NETDISK_APP_ROOT}/${filenameFor(documentId, name)}`
}

function parseDocumentFilename(value: string): { documentId: string; name: string } | null {
  const match = DOCUMENT_FILENAME_PATTERN.exec(value)
  if (!match) return null
  return { documentId: match[1], name: match[2] }
}

function validatePath(value: unknown, filename: string): string {
  const path = requiredString(value, 'file path', 1_024)
  if (
    path !== `${BAIDU_NETDISK_APP_ROOT}/${filename}` ||
    path.includes('/../') ||
    path.includes('/./')
  ) {
    throw new BaiduNetdiskError('foreign-file', 'Baidu Netdisk returned a file outside OpenPencil')
  }
  return path
}

function parseItem(value: unknown): BaiduNetdiskItem {
  if (!isRecord(value)) {
    throw new BaiduNetdiskError('invalid-response', 'Baidu Netdisk returned an invalid file item')
  }
  const serverFilename = requiredString(value.server_filename, 'server filename', 255)
  const isDirectory = safeInteger(value.isdir, 'directory flag', 1) === 1
  const md5Value = value.md5
  const md5Hash =
    md5Value === undefined || md5Value === null || md5Value === ''
      ? null
      : requiredString(md5Value, 'cloud hash', 64).toLocaleLowerCase()
  if (md5Hash !== null && !MD5_PATTERN.test(md5Hash)) {
    throw new BaiduNetdiskError('invalid-response', 'Baidu Netdisk returned an invalid cloud hash')
  }
  return {
    fsId: requiredDecimalString(value.fs_id, 'file ID'),
    path: validatePath(value.path, serverFilename),
    serverFilename,
    size: safeInteger(value.size, 'file size', BAIDU_NETDISK_MAX_DOCUMENT_BYTES),
    isDirectory,
    serverMtime: safeInteger(value.server_mtime ?? value.mtime, 'modification time', 0xffff_ffff),
    md5: md5Hash
  }
}

function parseDocument(value: unknown): BaiduNetdiskDocumentFile | null {
  const item = parseItem(value)
  if (item.isDirectory) return null
  const identity = parseDocumentFilename(item.serverFilename)
  return identity ? { ...identity, item } : null
}

export function baiduNetdiskRemoteRevision(
  document: BaiduNetdiskDocumentFile
): StorageRemoteRevision {
  const md5Hash = document.item.md5
  if (!md5Hash) {
    throw new BaiduNetdiskError('invalid-response', 'Baidu Netdisk file is missing a cloud hash')
  }
  return {
    fsId: document.item.fsId,
    path: document.item.path,
    serverMtime: String(document.item.serverMtime),
    size: String(document.item.size),
    md5: md5Hash
  }
}

export function baiduNetdiskRevisionsMatch(
  expected: StorageRemoteRevision | null | undefined,
  actual: StorageRemoteRevision | null | undefined
): boolean {
  if (
    !expected ||
    !actual ||
    Object.keys(expected).length !== 5 ||
    Object.keys(actual).length !== 5
  ) {
    return false
  }
  return (
    typeof expected.fsId === 'string' &&
    expected.fsId === actual.fsId &&
    typeof expected.path === 'string' &&
    expected.path === actual.path &&
    typeof expected.serverMtime === 'string' &&
    expected.serverMtime === actual.serverMtime &&
    typeof expected.size === 'string' &&
    expected.size === actual.size &&
    typeof expected.md5 === 'string' &&
    expected.md5 === actual.md5
  )
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

export function baiduNetdiskChunkMd5(bytes: Uint8Array): string {
  return hex(md5(bytes))
}

function apiURL(path: string): URL {
  return new URL(path, BAIDU_NETDISK_API_ORIGIN)
}

function locateUploadURL(): URL {
  return new URL('/rest/2.0/pcs/file', BAIDU_NETDISK_PCS_ORIGIN)
}

function formBody(values: Readonly<Record<string, string>>): URLSearchParams {
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) body.set(key, value)
  return body
}

function isPcsHost(hostname: string): boolean {
  const host = hostname.toLocaleLowerCase()
  return host === 'd.pcs.baidu.com' || host.endsWith('.pcs.baidu.com')
}

function validateCapabilityURL(value: string, kind: BaiduNetdiskCapabilityKind): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch (error) {
    throw new BaiduNetdiskError(
      'invalid-response',
      `Baidu Netdisk returned an invalid ${kind} URL`,
      { cause: error }
    )
  }
  if (
    url.protocol !== 'https:' ||
    (url.port && url.port !== '443') ||
    url.username ||
    url.password ||
    url.hash ||
    !isPcsHost(url.hostname)
  ) {
    throw new BaiduNetdiskError(
      'invalid-response',
      `Baidu Netdisk returned an untrusted ${kind} URL`
    )
  }
  if (kind === 'upload' && url.pathname !== '/rest/2.0/pcs/superfile2') {
    throw new BaiduNetdiskError('invalid-response', 'Baidu Netdisk upload URL is invalid')
  }
  return url
}

function capabilityKey(kind: BaiduNetdiskCapabilityKind, value: string): string {
  const url = validateCapabilityURL(value, kind)
  if (kind === 'download') url.searchParams.delete('access_token')
  return `${kind}:${url.toString()}`
}

async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined)
}

function responseErrno(value: unknown): number | null {
  if (!isRecord(value) || value.errno === undefined) return null
  const candidate =
    typeof value.errno === 'string' && /^-?\d+$/.test(value.errno)
      ? Number(value.errno)
      : value.errno
  return Number.isSafeInteger(candidate) ? (candidate as number) : null
}

export class BaiduNetdiskClient {
  readonly #resolveAccessToken: BaiduNetdiskClientOptions['resolveAccessToken']
  readonly #transport: BaiduNetdiskTransport
  readonly #limits: ResolvedLimits
  readonly #capabilities = new Set<string>()

  constructor(options: BaiduNetdiskClientOptions) {
    this.#resolveAccessToken = options.resolveAccessToken
    this.#transport = options.transport ?? ((input, init) => fetch(input, init))
    this.#limits = resolveLimits(options.limits)
  }

  async #resolveToken(options: RequestOptions): Promise<BaiduNetdiskAccessToken> {
    throwIfBaiduNetdiskAborted(options.signal)
    const token = validateToken(await this.#resolveAccessToken(options.signal))
    if (
      options.expectedAuthority &&
      !authoritiesEqual(token.authority, validateAuthority(options.expectedAuthority))
    ) {
      throw new BaiduNetdiskError(
        'authorization-changed',
        'Baidu Netdisk authorization changed during the operation'
      )
    }
    return token
  }

  async getAuthority(signal?: AbortSignal): Promise<StorageDocumentAuthority> {
    return (await this.#resolveToken({ signal })).authority
  }

  async #readBytes(
    response: Response,
    limit: number,
    onProgress?: StorageTransferOptions['onProgress']
  ): Promise<Uint8Array> {
    const length = response.headers.get('content-length')
    const declared = length === null ? null : Number(length)
    if (declared !== null && (!Number.isSafeInteger(declared) || declared < 0)) {
      await discard(response)
      throw new BaiduNetdiskError(
        'invalid-response',
        'Baidu Netdisk returned an invalid content length'
      )
    }
    if (declared !== null && declared > limit) {
      await discard(response)
      throw new BaiduNetdiskError(
        'resource-limit',
        'Baidu Netdisk response exceeded the byte limit'
      )
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
        throw new BaiduNetdiskError(
          'resource-limit',
          'Baidu Netdisk response exceeded the byte limit'
        )
      }
      chunks.push(value)
      onProgress?.({ transferredBytes: received, totalBytes: declared })
    }
    if (declared !== null && received !== declared) {
      throw new BaiduNetdiskError(
        'invalid-response',
        'Baidu Netdisk response length did not match its header'
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

  async #readJson(response: Response, limit = this.#limits.maxJsonBytes): Promise<unknown> {
    const bytes = await this.#readBytes(response, limit)
    if (bytes.byteLength === 0) {
      throw new BaiduNetdiskError('invalid-response', 'Baidu Netdisk returned an empty response')
    }
    return parseLosslessJSON(bytes)
  }

  async #responseError(response: Response): Promise<BaiduNetdiskError> {
    let errno: number | null = null
    try {
      errno = responseErrno(await this.#readJson(response, this.#limits.maxErrorBytes))
    } catch {
      await discard(response)
    }
    const code =
      errno === null
        ? baiduNetdiskErrorCodeForStatus(response.status)
        : baiduNetdiskErrorCodeForErrno(errno)
    return new BaiduNetdiskError(code, `Baidu Netdisk request failed (${response.status})`, {
      status: response.status,
      ...(errno === null ? {} : { errno }),
      retryable: isRetryableBaiduNetdiskStatus(response.status) || errno === 20012
    })
  }

  #throwErrno(value: unknown): void {
    const errno = responseErrno(value)
    if (errno === null || errno === 0) return
    const code = baiduNetdiskErrorCodeForErrno(errno)
    throw new BaiduNetdiskError(code, `Baidu Netdisk operation failed (${errno})`, {
      errno,
      retryable: errno === 20012 || errno === 111
    })
  }

  async #staticRequest(url: URL, init: RequestInit, options: RequestOptions): Promise<JSONResult> {
    const token = await this.#resolveToken(options)
    url.searchParams.set('access_token', token.accessToken)
    let response: Response
    try {
      response = await this.#transport(url, {
        ...init,
        signal: options.signal,
        credentials: 'omit',
        redirect: 'error'
      })
    } catch (error) {
      if (isBaiduNetdiskAbortError(error) || options.signal?.aborted) {
        throw new BaiduNetdiskError('aborted', 'Baidu Netdisk operation was cancelled')
      }
      throw new BaiduNetdiskError('network', 'Baidu Netdisk network request failed', {
        retryable: true
      })
    }
    if (!response.ok) throw await this.#responseError(response)
    const value = await this.#readJson(response)
    this.#throwErrno(value)
    return { value, token }
  }

  #rememberCapability(kind: BaiduNetdiskCapabilityKind, value: string): void {
    const key = capabilityKey(kind, value)
    if (this.#capabilities.size >= 256 && !this.#capabilities.has(key)) {
      const oldest = this.#capabilities.values().next().value
      if (typeof oldest === 'string') this.#capabilities.delete(oldest)
    }
    this.#capabilities.add(key)
    this.#transport.registerCapability?.(kind, value)
  }

  #assertCapability(kind: BaiduNetdiskCapabilityKind, value: string): URL {
    const key = capabilityKey(kind, value)
    if (!this.#capabilities.has(key)) {
      throw new BaiduNetdiskError(
        'invalid-input',
        `Baidu Netdisk ${kind} capability was not issued by a trusted API response`
      )
    }
    return validateCapabilityURL(value, kind)
  }

  async #listAll(options: RequestOptions): Promise<BaiduNetdiskDocumentFile[]> {
    const documents = new Map<string, BaiduNetdiskDocumentFile>()
    const seenFsIds = new Set<string>()
    let totalItems = 0
    let exhausted = false
    for (let page = 0; page < this.#limits.maxListPages; page++) {
      const url = apiURL('/rest/2.0/xpan/file')
      url.searchParams.set('method', 'list')
      url.searchParams.set('dir', BAIDU_NETDISK_APP_ROOT)
      url.searchParams.set('start', String(page * BAIDU_NETDISK_LIST_PAGE_SIZE))
      url.searchParams.set('limit', String(BAIDU_NETDISK_LIST_PAGE_SIZE))
      url.searchParams.set('order', 'name')
      url.searchParams.set('desc', '0')
      const { value } = await this.#staticRequest(url, { method: 'GET' }, options)
      if (!isRecord(value) || !Array.isArray(value.list)) {
        throw new BaiduNetdiskError(
          'invalid-response',
          'Baidu Netdisk returned an invalid list page'
        )
      }
      if (value.list.length > BAIDU_NETDISK_LIST_PAGE_SIZE) {
        throw new BaiduNetdiskError(
          'invalid-response',
          'Baidu Netdisk exceeded the requested page size'
        )
      }
      totalItems += value.list.length
      if (totalItems > this.#limits.maxListItems) {
        throw new BaiduNetdiskError('resource-limit', 'Baidu Netdisk list exceeded the item limit')
      }
      for (const raw of value.list) {
        const document = parseDocument(raw)
        if (!document) continue
        if (seenFsIds.has(document.item.fsId) || documents.has(document.documentId)) {
          throw new BaiduNetdiskError(
            'conflict',
            'Baidu Netdisk returned duplicate OpenPencil document identities'
          )
        }
        seenFsIds.add(document.item.fsId)
        documents.set(document.documentId, document)
      }
      if (value.list.length < BAIDU_NETDISK_LIST_PAGE_SIZE) {
        exhausted = true
        break
      }
    }
    if (!exhausted) {
      throw new BaiduNetdiskError('resource-limit', 'Baidu Netdisk list exceeded the page limit')
    }
    return [...documents.values()]
  }

  async testConnection(signal?: AbortSignal): Promise<void> {
    const url = apiURL('/rest/2.0/xpan/nas')
    url.searchParams.set('method', 'uinfo')
    url.searchParams.set('vip_version', 'v2')
    const { value, token } = await this.#staticRequest(url, { method: 'GET' }, { signal })
    if (!isRecord(value)) {
      throw new BaiduNetdiskError('invalid-response', 'Baidu Netdisk returned invalid user info')
    }
    const uk = requiredDecimalString(value.uk, 'user ID')
    if (uk !== token.authority.accountId) {
      throw new BaiduNetdiskError(
        'authorization-changed',
        'Baidu Netdisk authorization belongs to a different account'
      )
    }
  }

  listDocuments(signal?: AbortSignal): Promise<BaiduNetdiskDocumentFile[]> {
    return this.#listAll({ signal })
  }

  async getDocumentFile(
    documentId: string,
    options: RequestOptions = {}
  ): Promise<BaiduNetdiskDocumentFile | null> {
    const id = validateDocumentId(documentId)
    return (await this.#listAll(options)).find((document) => document.documentId === id) ?? null
  }

  async #documentByFsId(
    fsId: string,
    options: RequestOptions
  ): Promise<BaiduNetdiskDocumentFile | null> {
    requiredDecimalString(fsId, 'file ID')
    return (await this.#listAll(options)).find((document) => document.item.fsId === fsId) ?? null
  }

  async downloadDocument(
    documentId: string,
    options: RequestOptions & Pick<StorageTransferOptions, 'onProgress'> = {}
  ): Promise<StorageGetDocumentResult> {
    const document = await this.getDocumentFile(documentId, options)
    if (!document) throw new BaiduNetdiskError('not-found', 'Baidu Netdisk document was not found')
    const metas = apiURL('/rest/2.0/xpan/multimedia')
    metas.searchParams.set('method', 'filemetas')
    // The API requires a JSON array of uint64 values. Keep the ID lossless in memory and
    // serialize its already-validated decimal digits without passing through Number.
    metas.searchParams.set('fsids', `[${document.item.fsId}]`)
    metas.searchParams.set('dlink', '1')
    const { value } = await this.#staticRequest(metas, { method: 'GET' }, options)
    if (!isRecord(value) || !Array.isArray(value.list) || value.list.length !== 1) {
      throw new BaiduNetdiskError(
        'invalid-response',
        'Baidu Netdisk returned invalid file metadata'
      )
    }
    const raw = value.list[0]
    if (!isRecord(raw) || requiredDecimalString(raw.fs_id, 'file ID') !== document.item.fsId) {
      throw new BaiduNetdiskError('invalid-response', 'Baidu Netdisk metadata identity changed')
    }
    let next = requiredString(raw.dlink, 'download URL', 16_384)
    this.#rememberCapability('download', next)
    const token = await this.#resolveToken(options)
    const first = new URL(next)
    first.searchParams.set('access_token', token.accessToken)
    next = first.toString()
    for (let redirect = 0; redirect <= this.#limits.maxRedirects; redirect++) {
      const url = this.#assertCapability('download', next)
      let response: Response
      try {
        response = await this.#transport(url, {
          method: 'GET',
          headers: { 'User-Agent': 'pan.baidu.com' },
          signal: options.signal,
          credentials: 'omit',
          redirect: 'manual'
        })
      } catch (error) {
        if (isBaiduNetdiskAbortError(error) || options.signal?.aborted) {
          throw new BaiduNetdiskError('aborted', 'Baidu Netdisk operation was cancelled')
        }
        throw new BaiduNetdiskError('network', 'Baidu Netdisk download failed', {
          retryable: true
        })
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location')
        await discard(response)
        if (!location || redirect === this.#limits.maxRedirects) {
          throw new BaiduNetdiskError(
            'invalid-response',
            'Baidu Netdisk download redirect is invalid'
          )
        }
        next = new URL(location, url).toString()
        this.#rememberCapability('download', next)
        continue
      }
      if (response.status !== 200 && response.status !== 206) {
        throw await this.#responseError(response)
      }
      const bytes = await this.#readBytes(
        response,
        this.#limits.maxDownloadBytes,
        options.onProgress
      )
      if (bytes.byteLength !== document.item.size) {
        throw new BaiduNetdiskError(
          'invalid-response',
          'Baidu Netdisk download size did not match file metadata'
        )
      }
      return {
        bytes,
        metadata: {
          name: document.name,
          updatedAt: new Date(document.item.serverMtime * 1_000).toISOString()
        },
        remoteRevision: baiduNetdiskRemoteRevision(document)
      }
    }
    throw new BaiduNetdiskError('invalid-response', 'Baidu Netdisk redirect limit was reached')
  }

  async #uploadPart(
    origin: string,
    path: string,
    uploadId: string,
    part: number,
    chunk: Uint8Array,
    expectedMd5: string,
    options: RequestOptions
  ): Promise<void> {
    const token = await this.#resolveToken(options)
    const url = new URL('/rest/2.0/pcs/superfile2', origin)
    url.searchParams.set('method', 'upload')
    url.searchParams.set('access_token', token.accessToken)
    url.searchParams.set('type', 'tmpfile')
    url.searchParams.set('path', path)
    url.searchParams.set('uploadid', uploadId)
    url.searchParams.set('partseq', String(part))
    this.#rememberCapability('upload', url.toString())
    this.#assertCapability('upload', url.toString())
    const form = new FormData()
    form.set('file', new Blob([chunk.slice().buffer]), `part-${part}`)
    let response: Response
    try {
      response = await this.#transport(url, {
        method: 'POST',
        body: form,
        signal: options.signal,
        credentials: 'omit',
        redirect: 'error'
      })
    } catch (error) {
      if (isBaiduNetdiskAbortError(error) || options.signal?.aborted) {
        throw new BaiduNetdiskError('aborted', 'Baidu Netdisk operation was cancelled')
      }
      throw new BaiduNetdiskError('network', 'Baidu Netdisk part upload failed', {
        retryable: true
      })
    }
    if (!response.ok) throw await this.#responseError(response)
    const value = await this.#readJson(response)
    this.#throwErrno(value)
    if (!isRecord(value) || requiredString(value.md5, 'uploaded part hash', 32) !== expectedMd5) {
      throw new BaiduNetdiskError('invalid-response', 'Baidu Netdisk uploaded part hash changed')
    }
  }

  async uploadDocument(options: BaiduNetdiskUploadOptions): Promise<BaiduNetdiskUploadResult> {
    if (options.bytes.byteLength > BAIDU_NETDISK_MAX_DOCUMENT_BYTES) {
      throw new BaiduNetdiskError(
        'resource-limit',
        'Baidu Netdisk document exceeds the 512 MiB limit'
      )
    }
    const path = pathFor(options.documentId, options.name)
    const chunks: Uint8Array[] = []
    if (options.bytes.byteLength === 0) chunks.push(options.bytes)
    for (
      let offset = 0;
      offset < options.bytes.byteLength;
      offset += BAIDU_NETDISK_UPLOAD_CHUNK_BYTES
    ) {
      chunks.push(options.bytes.subarray(offset, offset + BAIDU_NETDISK_UPLOAD_CHUNK_BYTES))
    }
    if (chunks.length > BAIDU_NETDISK_MAX_UPLOAD_PARTS) {
      throw new BaiduNetdiskError(
        'resource-limit',
        'Baidu Netdisk upload exceeded the bounded part count'
      )
    }
    const hashes = chunks.map(baiduNetdiskChunkMd5)
    const precreate = apiURL('/rest/2.0/xpan/file')
    precreate.searchParams.set('method', 'precreate')
    const { value: prepared } = await this.#staticRequest(
      precreate,
      {
        method: 'POST',
        body: formBody({
          path,
          size: String(options.bytes.byteLength),
          isdir: '0',
          autoinit: '1',
          rtype: '1',
          block_list: JSON.stringify(hashes)
        })
      },
      options
    )
    if (!isRecord(prepared) || !Array.isArray(prepared.block_list)) {
      throw new BaiduNetdiskError(
        'invalid-response',
        'Baidu Netdisk returned invalid precreate data'
      )
    }
    const uploadId = requiredString(prepared.uploadid, 'upload ID', 4_096)
    const missing = prepared.block_list.map((value) =>
      safeInteger(value, 'part index', chunks.length - 1)
    )
    if (new Set(missing).size !== missing.length) {
      throw new BaiduNetdiskError('invalid-response', 'Baidu Netdisk repeated a part index')
    }
    if (missing.length > 0) {
      const locate = locateUploadURL()
      locate.searchParams.set('method', 'locateupload')
      locate.searchParams.set('appid', BAIDU_NETDISK_LOCATE_UPLOAD_APP_ID)
      locate.searchParams.set('path', path)
      locate.searchParams.set('uploadid', uploadId)
      locate.searchParams.set('upload_version', '2.0')
      const { value: located } = await this.#staticRequest(locate, { method: 'GET' }, options)
      if (!isRecord(located) || !Array.isArray(located.servers)) {
        throw new BaiduNetdiskError(
          'invalid-response',
          'Baidu Netdisk returned invalid upload hosts'
        )
      }
      const origins = located.servers.flatMap((entry) =>
        isRecord(entry) && typeof entry.server === 'string' ? [entry.server] : []
      )
      const origin = origins.find((candidate) => {
        try {
          const url = new URL(candidate)
          return (
            url.protocol === 'https:' &&
            !url.port &&
            !url.username &&
            !url.password &&
            !url.hash &&
            url.pathname === '/' &&
            isPcsHost(url.hostname)
          )
        } catch {
          return false
        }
      })
      if (!origin) {
        throw new BaiduNetdiskError(
          'invalid-response',
          'Baidu Netdisk returned no trusted upload host'
        )
      }
      let uploadedBytes = 0
      for (const part of missing) {
        await this.#uploadPart(origin, path, uploadId, part, chunks[part], hashes[part], options)
        uploadedBytes += chunks[part].byteLength
        const transferred = Math.min(options.bytes.byteLength, uploadedBytes)
        options.onProgress?.({
          transferredBytes: transferred,
          totalBytes: options.bytes.byteLength
        })
      }
    }
    options.onProgress?.({
      transferredBytes: options.bytes.byteLength,
      totalBytes: options.bytes.byteLength
    })
    const timestamp = Date.parse(options.updatedAt)
    if (!Number.isFinite(timestamp)) {
      throw new BaiduNetdiskError('invalid-input', 'Baidu Netdisk document timestamp is invalid')
    }
    const create = apiURL('/rest/2.0/xpan/file')
    create.searchParams.set('method', 'create')
    const { value: created } = await this.#staticRequest(
      create,
      {
        method: 'POST',
        body: formBody({
          path,
          size: String(options.bytes.byteLength),
          isdir: '0',
          rtype: '1',
          block_list: JSON.stringify(hashes),
          uploadid: uploadId,
          local_mtime: String(Math.floor(timestamp / 1_000))
        })
      },
      options
    )
    const document = parseDocument(created)
    if (!document || document.documentId !== options.documentId || document.item.path !== path) {
      throw new BaiduNetdiskError(
        'conflict',
        'Baidu Netdisk did not create the exact requested document path'
      )
    }
    return { document, remoteRevision: baiduNetdiskRemoteRevision(document) }
  }

  async #fileManager(
    operation: 'delete' | 'rename',
    filelist: unknown[],
    options: RequestOptions
  ): Promise<void> {
    const url = apiURL('/rest/2.0/xpan/file')
    url.searchParams.set('method', 'filemanager')
    url.searchParams.set('opera', operation)
    const { value } = await this.#staticRequest(
      url,
      {
        method: 'POST',
        body: formBody({
          async: '0',
          filelist: JSON.stringify(filelist),
          ...(operation === 'rename' ? { ondup: 'fail' } : {})
        })
      },
      options
    )
    if (!isRecord(value)) {
      throw new BaiduNetdiskError('invalid-response', 'Baidu Netdisk returned invalid file results')
    }
    if (Array.isArray(value.info)) {
      for (const entry of value.info) this.#throwErrno(entry)
    }
  }

  async promoteDocumentFile(
    staged: BaiduNetdiskDocumentFile,
    documentId: string,
    name: string,
    options: RequestOptions = {}
  ): Promise<BaiduNetdiskPromotionResult> {
    const finalId = validateDocumentId(documentId)
    const finalName = validateFigName(name)
    const before = await this.#documentByFsId(staged.item.fsId, options)
    if (
      !before ||
      !baiduNetdiskRevisionsMatch(
        baiduNetdiskRemoteRevision(before),
        baiduNetdiskRemoteRevision(staged)
      )
    ) {
      throw new BaiduNetdiskError('precondition', 'Baidu Netdisk staging file changed')
    }
    try {
      await this.#fileManager(
        'rename',
        [{ path: before.item.path, newname: filenameFor(finalId, finalName) }],
        options
      )
    } catch (error) {
      if (
        error instanceof BaiduNetdiskError &&
        ['aborted', 'auth', 'authorization-changed'].includes(error.code)
      ) {
        throw error
      }
      const reconciled = await this.#documentByFsId(staged.item.fsId, options)
      if (!reconciled) throw error
      return {
        outcome: reconciled.documentId === finalId ? 'promoted' : 'preserved',
        document: reconciled
      }
    }
    const reconciled = await this.#documentByFsId(staged.item.fsId, options)
    if (!reconciled) {
      throw new BaiduNetdiskError('invalid-response', 'Baidu Netdisk lost the promoted document')
    }
    return {
      outcome: reconciled.documentId === finalId ? 'promoted' : 'preserved',
      document: reconciled
    }
  }

  async trashDocumentFile(
    document: BaiduNetdiskDocumentFile,
    expectedRevision: StorageRemoteRevision,
    options: RequestOptions = {}
  ): Promise<void> {
    const before = await this.#documentByFsId(document.item.fsId, options)
    if (
      !before ||
      before.item.path !== document.item.path ||
      !baiduNetdiskRevisionsMatch(baiduNetdiskRemoteRevision(before), expectedRevision)
    ) {
      throw new BaiduNetdiskError('precondition', 'Baidu Netdisk document changed before trash')
    }
    try {
      await this.#fileManager('delete', [before.item.path], options)
    } catch (error) {
      if (
        error instanceof BaiduNetdiskError &&
        ['aborted', 'auth', 'authorization-changed'].includes(error.code)
      ) {
        throw error
      }
      if (!(await this.#documentByFsId(document.item.fsId, options))) return
      throw error
    }
    if (await this.#documentByFsId(document.item.fsId, options)) {
      throw new BaiduNetdiskError('server', 'Baidu Netdisk did not move the document to trash', {
        retryable: true
      })
    }
  }
}
