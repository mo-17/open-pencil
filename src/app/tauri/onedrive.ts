/* eslint-disable max-lines -- OAuth cancellation and capability transport share one native bridge. */
import { invoke } from '@tauri-apps/api/core'

import type { ParsedContentRange } from './content-range'
import type { TauriHttpHeader } from './http'
import { OneDriveNativeError, nativeOneDriveError } from './onedrive-oauth-error'
import {
  boundedStorageRequestBody,
  createBoundedStorageInteger,
  createStorageContentRangeParser,
  invokeCancellableStorageOAuth,
  invokeStorageNative,
  linkedStorageAbortController,
  parseStorageJSONBody,
  parseStrongStorageEtag,
  rememberBoundedStorageCapability,
  storageNativeHeaders,
  storageNativeResponse,
  storageNativeResponseHeader,
  storageNativeTransferRequest,
  storageRangedDownloadStream,
  type StorageNativeInvoke
} from './storage-native-common'

export { OneDriveNativeError, type OneDriveNativeErrorCode } from './onedrive-oauth-error'

export type OneDriveNativeAuthorizeRequest = {
  timeoutMs?: number
}

export type OneDriveNativeTokenResult = {
  accessToken: string
  refreshToken: string
  expiresIn: number
  grantedScopes: string[]
  subject: string
  email?: string
  name?: string
}

export type OneDriveNativeAuthorizeResult = OneDriveNativeTokenResult

export type OneDriveNativeRefreshRequest = {
  refreshToken: string
  expectedSubject: string
  timeoutMs?: number
}

export type OneDriveNativeRefreshResult = OneDriveNativeTokenResult

export type OneDriveTransferKind = 'api' | 'upload-session' | 'download'

export type OneDriveTransferHeader = TauriHttpHeader

export type OneDriveNativeTransferRequest = {
  kind: OneDriveTransferKind
  url: string
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  headers?: OneDriveTransferHeader[]
  body?: number[]
  maxResponseBytes: number
  timeoutMs?: number
}

export type OneDriveNativeTransferResponse = {
  status: number
  headers: OneDriveTransferHeader[]
  body: number[]
}

export type OneDriveInvoke = StorageNativeInvoke

export type OneDriveNativeTransferInvoker = (
  request: OneDriveNativeTransferRequest,
  signal?: AbortSignal
) => Promise<OneDriveNativeTransferResponse>

export type CreateOneDriveTauriTransportOptions = {
  transfer?: OneDriveNativeTransferInvoker
  downloadChunkBytes?: number
  maxDownloadBytes?: number
}

export interface OneDriveNativeBridge {
  authorize(
    request?: OneDriveNativeAuthorizeRequest,
    signal?: AbortSignal
  ): Promise<OneDriveNativeAuthorizeResult>
  refresh(
    request: OneDriveNativeRefreshRequest,
    signal?: AbortSignal
  ): Promise<OneDriveNativeRefreshResult>
}

const DEFAULT_DOWNLOAD_CHUNK_BYTES = 4 * 1024 * 1024
const MIN_DOWNLOAD_CHUNK_BYTES = 320 * 1024
export const ONEDRIVE_NATIVE_MAX_TRANSFER_CHUNK_BYTES = 10 * 1024 * 1024
const MAX_TRANSFER_CHUNK_BYTES = ONEDRIVE_NATIVE_MAX_TRANSFER_CHUNK_BYTES
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024
const MAX_METADATA_BODY_BYTES = 1024 * 1024
const MAX_METADATA_RESPONSE_BYTES = 2 * 1024 * 1024
const TRANSFER_TIMEOUT_MS = 120_000

const DEFAULT_INVOKE = invoke as OneDriveInvoke

export function createOneDriveNativeBridge(
  invokeCommand: OneDriveInvoke = DEFAULT_INVOKE
): OneDriveNativeBridge {
  return Object.freeze({
    authorize(request: OneDriveNativeAuthorizeRequest = {}, signal?: AbortSignal) {
      return invokeCancellableStorageOAuth<OneDriveNativeAuthorizeResult>({
        invokeCommand,
        command: 'onedrive_oauth_authorize',
        cancelCommand: 'onedrive_oauth_cancel',
        request,
        mapError: nativeOneDriveError,
        signal
      })
    },
    refresh(request: OneDriveNativeRefreshRequest, signal?: AbortSignal) {
      return invokeCancellableStorageOAuth<OneDriveNativeRefreshResult>({
        invokeCommand,
        command: 'onedrive_oauth_refresh',
        cancelCommand: 'onedrive_oauth_cancel',
        request,
        mapError: nativeOneDriveError,
        signal
      })
    }
  })
}

export const oneDriveNativeBridge = createOneDriveNativeBridge()

export function createOneDriveNativeTransfer(
  invokeCommand: OneDriveInvoke = DEFAULT_INVOKE
): OneDriveNativeTransferInvoker {
  return (request, signal) =>
    invokeStorageNative<OneDriveNativeTransferResponse>(
      invokeCommand,
      'onedrive_transfer',
      { request },
      nativeOneDriveError,
      signal
    )
}

export const oneDriveNativeTransfer = createOneDriveNativeTransfer()

function transportError(message: string): OneDriveNativeError {
  return new OneDriveNativeError('invalid-request', { cause: new TypeError(message) })
}

const boundedPositiveInteger = createBoundedStorageInteger(() =>
  transportError('OneDrive native transfer limit is invalid')
)

const parseContentRange = createStorageContentRangeParser(
  () => transportError('OneDrive returned an invalid download Content-Range'),
  () => transportError('OneDrive returned inconsistent ranged download bytes')
)

function isSubdomain(host: string, suffix: string): boolean {
  return host.length > suffix.length + 1 && host.endsWith(`.${suffix}`)
}

type OneDriveCapabilityKind = Exclude<OneDriveTransferKind, 'api'>

function transferKind(
  url: URL,
  capabilities: ReadonlyMap<string, OneDriveCapabilityKind>
): OneDriveTransferKind {
  if (
    url.protocol !== 'https:' ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0 ||
    (url.port.length > 0 && url.port !== '443')
  ) {
    throw transportError('OneDrive native transfer URL is invalid')
  }
  const host = url.hostname.toLowerCase()
  if (
    host === 'graph.microsoft.com' &&
    (url.pathname === '/v1.0' || url.pathname.startsWith('/v1.0/'))
  ) {
    return 'api'
  }
  if (isSubdomain(host, 'up.1drv.com')) return 'upload-session'
  if (isSubdomain(host, 'files.1drv.com') || isSubdomain(host, 'sharepoint-df.com')) {
    return 'download'
  }
  if (isSubdomain(host, 'sharepoint.com')) {
    const kind = capabilities.get(url.toString())
    if (kind) return kind
  }
  throw transportError('OneDrive native transfer URL is not allowed')
}

function capabilityHostAllowed(url: URL, kind: OneDriveCapabilityKind): boolean {
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash)
    return false
  const host = url.hostname.toLowerCase()
  return kind === 'upload-session'
    ? isSubdomain(host, 'up.1drv.com') || isSubdomain(host, 'sharepoint.com')
    : isSubdomain(host, 'files.1drv.com') ||
        isSubdomain(host, 'sharepoint.com') ||
        isSubdomain(host, 'sharepoint-df.com')
}

function rememberCapability(
  capabilities: Map<string, OneDriveCapabilityKind>,
  rawURL: string,
  kind: OneDriveCapabilityKind
): void {
  let url: URL
  try {
    url = new URL(rawURL)
  } catch {
    return
  }
  if (!capabilityHostAllowed(url, kind)) return
  const key = url.toString()
  rememberBoundedStorageCapability(capabilities, key, kind, 128)
}

function rememberGraphCapabilities(
  response: OneDriveNativeTransferResponse,
  capabilities: Map<string, OneDriveCapabilityKind>
): void {
  const location = storageNativeResponseHeader(response, 'location')
  if (location) rememberCapability(capabilities, location, 'download')
  const contentType = storageNativeResponseHeader(response, 'content-type')
    ?.split(';', 1)[0]
    ?.trim()
  if (contentType?.toLowerCase() !== 'application/json' || response.body.length === 0) return
  const value = parseStorageJSONBody(response.body)
  if (!value) return
  const uploadURL = Reflect.get(value, 'uploadUrl')
  if (typeof uploadURL === 'string') {
    rememberCapability(capabilities, uploadURL, 'upload-session')
  }
  const downloadURL = Reflect.get(value, '@microsoft.graph.downloadUrl')
  if (typeof downloadURL === 'string') {
    rememberCapability(capabilities, downloadURL, 'download')
  }
}

async function boundedRequestBody(
  request: Request,
  maxBytes: number
): Promise<number[] | undefined> {
  return boundedStorageRequestBody(request, maxBytes, () =>
    transportError('OneDrive request body is too large')
  )
}

function nativeResponse(response: OneDriveNativeTransferResponse): Response {
  return storageNativeResponse(response, () =>
    transportError('OneDrive returned an invalid native response')
  )
}

type OneDriveMethod = OneDriveNativeTransferRequest['method']

type LinkedAbortController = ReturnType<typeof linkedStorageAbortController>

type DownloadChunk = (
  start: number,
  expectedEtag?: string
) => Promise<OneDriveNativeTransferResponse>

function parsedTransportRequest(
  input: RequestInfo | URL,
  init: RequestInit,
  capabilities: ReadonlyMap<string, OneDriveCapabilityKind>
): {
  request: Request
  url: URL
  method: OneDriveMethod
  kind: OneDriveTransferKind
} {
  const request = new Request(input, init)
  request.signal.throwIfAborted()
  if (request.redirect !== 'error') {
    throw transportError('OneDrive native transport requires redirect rejection')
  }
  const method = request.method.toUpperCase()
  if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    throw transportError('OneDrive native transport method is invalid')
  }
  const url = new URL(request.url)
  return {
    request,
    url,
    method: method as OneDriveMethod,
    kind: transferKind(url, capabilities)
  }
}

async function metadataResponse(
  request: Request,
  url: URL,
  method: OneDriveMethod,
  kind: Exclude<OneDriveTransferKind, 'download'>,
  transfer: OneDriveNativeTransferInvoker,
  linked: LinkedAbortController,
  capabilities: Map<string, OneDriveCapabilityKind>
): Promise<Response> {
  try {
    const body = await boundedRequestBody(
      request,
      kind === 'upload-session' ? MAX_TRANSFER_CHUNK_BYTES : MAX_METADATA_BODY_BYTES
    )
    const response = await transfer(
      storageNativeTransferRequest(
        kind,
        url,
        method,
        request.headers,
        body,
        MAX_METADATA_RESPONSE_BYTES,
        TRANSFER_TIMEOUT_MS
      ),
      linked.controller.signal
    )
    if (kind === 'api') rememberGraphCapabilities(response, capabilities)
    return nativeResponse(response)
  } finally {
    linked.cleanup()
  }
}

function downloadChunkInvoker(
  request: Request,
  url: URL,
  transfer: OneDriveNativeTransferInvoker,
  linked: LinkedAbortController,
  chunkBytes: number,
  maxDownloadBytes: number
): DownloadChunk {
  const baseHeaders = new Headers(request.headers)
  return (start, expectedEtag) => {
    const headers = new Headers(baseHeaders)
    headers.set('range', `bytes=${start}-${Math.min(start + chunkBytes - 1, maxDownloadBytes - 1)}`)
    if (expectedEtag) headers.set('if-range', expectedEtag)
    return transfer(
      {
        kind: 'download',
        url: url.toString(),
        method: 'GET',
        headers: storageNativeHeaders(headers),
        maxResponseBytes: chunkBytes,
        timeoutMs: TRANSFER_TIMEOUT_MS
      },
      linked.controller.signal
    )
  }
}

function nonPartialDownloadResponse(
  response: OneDriveNativeTransferResponse,
  chunkBytes: number
): Response {
  if (response.status < 200 || response.status >= 300) return nativeResponse(response)
  const headers = new Headers(response.headers.map(({ name, value }) => [name, value]))
  const length = headers.get('content-length')
  const completeSmallResponse =
    response.status === 200 &&
    response.body.length <= chunkBytes &&
    (length === null || (/^\d+$/.test(length) && Number(length) === response.body.length))
  if (completeSmallResponse) return nativeResponse(response)
  throw transportError('OneDrive ranged download did not return 206')
}

function initialDownloadMetadata(
  response: OneDriveNativeTransferResponse,
  maxDownloadBytes: number
): { headers: Headers; range: ParsedContentRange; etag: string | null } {
  const headers = new Headers(response.headers.map(({ name, value }) => [name, value]))
  const range = parseContentRange(
    headers.get('content-range'),
    0,
    response.body.length,
    null,
    maxDownloadBytes
  )
  const declaredLength = headers.get('content-length')
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) !== response.body.length)
  ) {
    throw transportError('OneDrive returned an invalid download Content-Length')
  }
  const etag = parseStrongStorageEtag(headers.get('etag'))
  if (etag === undefined || (range.end + 1 < range.total && etag === null)) {
    throw transportError('OneDrive ranged download requires a strong ETag')
  }
  headers.set('content-length', String(range.total))
  headers.delete('content-range')
  return { headers, range, etag }
}

function rangedDownloadResponse(
  first: OneDriveNativeTransferResponse,
  fetchChunk: DownloadChunk,
  metadata: ReturnType<typeof initialDownloadMetadata>,
  linked: LinkedAbortController,
  chunkBytes: number,
  maxDownloadBytes: number
): Response {
  const stream = storageRangedDownloadStream(
    first.body,
    metadata.range.end + 1,
    metadata.range.total,
    linked,
    Math.ceil(maxDownloadBytes / chunkBytes) + 1,
    () => transportError('OneDrive ranged download exceeded the request limit'),
    async (nextOffset) => {
      const response = await fetchChunk(nextOffset, metadata.etag ?? undefined)
      if (response.status !== 206) {
        throw transportError('OneDrive ranged download did not continue with 206')
      }
      const headers = new Headers(response.headers.map(({ name, value }) => [name, value]))
      if (parseStrongStorageEtag(headers.get('etag')) !== metadata.etag) {
        throw transportError('OneDrive file changed during ranged download')
      }
      const range = parseContentRange(
        headers.get('content-range'),
        nextOffset,
        response.body.length,
        metadata.range.total,
        maxDownloadBytes
      )
      return { body: response.body, nextOffset: range.end + 1 }
    }
  )
  return new Response(stream, { status: 200, headers: metadata.headers })
}

async function downloadResponse(
  request: Request,
  url: URL,
  transfer: OneDriveNativeTransferInvoker,
  linked: LinkedAbortController,
  chunkBytes: number,
  maxDownloadBytes: number
): Promise<Response> {
  try {
    if (
      request.method !== 'GET' ||
      request.body !== null ||
      request.headers.has('range') ||
      request.headers.has('if-range')
    ) {
      throw transportError('OneDrive ranged download request is invalid')
    }
    const fetchChunk = downloadChunkInvoker(
      request,
      url,
      transfer,
      linked,
      chunkBytes,
      maxDownloadBytes
    )
    const first = await fetchChunk(0)
    if (first.status !== 206) {
      const response = nonPartialDownloadResponse(first, chunkBytes)
      linked.cleanup()
      return response
    }
    const metadata = initialDownloadMetadata(first, maxDownloadBytes)
    return rangedDownloadResponse(first, fetchChunk, metadata, linked, chunkBytes, maxDownloadBytes)
  } catch (error) {
    linked.cleanup()
    throw error
  }
}

export function createOneDriveTauriTransport(
  options: CreateOneDriveTauriTransportOptions = {}
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  const transfer = options.transfer ?? oneDriveNativeTransfer
  const chunkBytes = boundedPositiveInteger(
    options.downloadChunkBytes ?? DEFAULT_DOWNLOAD_CHUNK_BYTES,
    MIN_DOWNLOAD_CHUNK_BYTES,
    MAX_TRANSFER_CHUNK_BYTES
  )
  const maxDownloadBytes = boundedPositiveInteger(
    options.maxDownloadBytes ?? MAX_DOWNLOAD_BYTES,
    chunkBytes,
    MAX_DOWNLOAD_BYTES
  )
  const capabilities = new Map<string, OneDriveCapabilityKind>()

  return async (input, init = {}) => {
    const { request, url, method, kind } = parsedTransportRequest(input, init, capabilities)
    const linked = linkedStorageAbortController(request.signal)
    return kind === 'download'
      ? downloadResponse(request, url, transfer, linked, chunkBytes, maxDownloadBytes)
      : metadataResponse(request, url, method, kind, transfer, linked, capabilities)
  }
}

export const oneDriveTauriTransport = createOneDriveTauriTransport()
