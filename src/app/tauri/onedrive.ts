/* eslint-disable max-lines -- OAuth cancellation and capability transport share one native bridge. */
import { invoke } from '@tauri-apps/api/core'

import { randomHex } from '@open-pencil/core/random'

import { withAbortSignal, type TauriHttpHeader } from './http'
import { OneDriveNativeError, nativeOneDriveError } from './onedrive-oauth-error'

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

export type OneDriveInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

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

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted', 'AbortError')
}

async function cancelOAuthOperation(
  invokeCommand: OneDriveInvoke,
  operationId: string
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (await invokeCommand<boolean>('onedrive_oauth_cancel', { operationId })) return
    } catch {
      return
    }
    if (attempt < 2) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 25)
      })
    }
  }
}

async function invokeWithAbort<T>(
  invokeCommand: OneDriveInvoke,
  command: string,
  args: Record<string, unknown>,
  signal?: AbortSignal
): Promise<T> {
  signal?.throwIfAborted()
  let pending: Promise<T>
  try {
    pending = invokeCommand<T>(command, args)
  } catch (error) {
    throw nativeOneDriveError(error)
  }
  if (!signal) {
    try {
      return await pending
    } catch (error) {
      throw nativeOneDriveError(error)
    }
  }
  return withAbortSignal(pending, signal, nativeOneDriveError)
}

async function invokeCancellableOAuth<T>(
  invokeCommand: OneDriveInvoke,
  command: 'onedrive_oauth_authorize' | 'onedrive_oauth_refresh',
  request: object,
  signal?: AbortSignal
): Promise<T> {
  signal?.throwIfAborted()
  const operationId = randomHex(16)
  let pending: Promise<T>
  try {
    pending = invokeCommand<T>(command, { request: { ...request, operationId } })
  } catch (error) {
    throw nativeOneDriveError(error)
  }
  if (!signal) {
    try {
      return await pending
    } catch (error) {
      throw nativeOneDriveError(error)
    }
  }

  return new Promise<T>((resolve, reject) => {
    let aborting = false
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      if (aborting) return
      aborting = true
      cleanup()
      reject(abortReason(signal))
      void cancelOAuthOperation(invokeCommand, operationId)
      void pending.catch(() => undefined)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    void pending.then(
      (value) => {
        if (aborting) return undefined
        cleanup()
        resolve(value)
        return undefined
      },
      (error) => {
        if (aborting) return undefined
        cleanup()
        reject(nativeOneDriveError(error))
        return undefined
      }
    )
  })
}

export function createOneDriveNativeBridge(
  invokeCommand: OneDriveInvoke = DEFAULT_INVOKE
): OneDriveNativeBridge {
  return Object.freeze({
    authorize(request: OneDriveNativeAuthorizeRequest = {}, signal?: AbortSignal) {
      return invokeCancellableOAuth<OneDriveNativeAuthorizeResult>(
        invokeCommand,
        'onedrive_oauth_authorize',
        request,
        signal
      )
    },
    refresh(request: OneDriveNativeRefreshRequest, signal?: AbortSignal) {
      return invokeCancellableOAuth<OneDriveNativeRefreshResult>(
        invokeCommand,
        'onedrive_oauth_refresh',
        request,
        signal
      )
    }
  })
}

export const oneDriveNativeBridge = createOneDriveNativeBridge()

export function createOneDriveNativeTransfer(
  invokeCommand: OneDriveInvoke = DEFAULT_INVOKE
): OneDriveNativeTransferInvoker {
  return (request, signal) =>
    invokeWithAbort<OneDriveNativeTransferResponse>(
      invokeCommand,
      'onedrive_transfer',
      { request },
      signal
    )
}

export const oneDriveNativeTransfer = createOneDriveNativeTransfer()

function transportError(message: string): OneDriveNativeError {
  return new OneDriveNativeError('invalid-request', { cause: new TypeError(message) })
}

function boundedPositiveInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw transportError('OneDrive native transfer limit is invalid')
  }
  return value
}

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
  if (capabilities.size >= 128 && !capabilities.has(key)) {
    const oldest = capabilities.keys().next().value
    if (typeof oldest === 'string') capabilities.delete(oldest)
  }
  capabilities.set(key, kind)
}

function responseHeader(
  response: OneDriveNativeTransferResponse,
  expectedName: string
): string | null {
  return (
    response.headers.find(({ name }) => name.toLowerCase() === expectedName.toLowerCase())?.value ??
    null
  )
}

function rememberGraphCapabilities(
  response: OneDriveNativeTransferResponse,
  capabilities: Map<string, OneDriveCapabilityKind>
): void {
  const location = responseHeader(response, 'location')
  if (location) rememberCapability(capabilities, location, 'download')
  const contentType = responseHeader(response, 'content-type')?.split(';', 1)[0]?.trim()
  if (contentType?.toLowerCase() !== 'application/json' || response.body.length === 0) return
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(new Uint8Array(response.body))) as unknown
  } catch {
    return
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return
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
  if (!request.body) return undefined
  const declaredLength = request.headers.get('content-length')
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxBytes)
  ) {
    throw transportError('OneDrive request body is too large')
  }

  const chunks: Uint8Array[] = []
  const reader = request.body.getReader()
  let total = 0
  try {
    let next = await reader.read()
    while (!next.done) {
      total += next.value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw transportError('OneDrive request body is too large')
      }
      chunks.push(next.value)
      next = await reader.read()
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return [...bytes]
}

function nativeHeaders(headers: Headers): OneDriveTransferHeader[] {
  return [...headers.entries()].map(([name, value]) => ({ name, value }))
}

function nativeResponse(response: OneDriveNativeTransferResponse): Response {
  if (
    !Number.isSafeInteger(response.status) ||
    response.status < 200 ||
    response.status > 599 ||
    response.body.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 255)
  ) {
    throw transportError('OneDrive returned an invalid native response')
  }
  const body = [204, 205, 304].includes(response.status) ? null : new Uint8Array(response.body)
  return new Response(body, {
    status: response.status,
    headers: response.headers.map(({ name, value }): [string, string] => [name, value])
  })
}

type ParsedContentRange = {
  start: number
  end: number
  total: number
}

function parseContentRange(
  value: string | null,
  expectedStart: number,
  bodyLength: number,
  expectedTotal: number | null,
  maxDownloadBytes: number
): ParsedContentRange {
  const match = value ? /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value.trim()) : null
  if (!match) throw transportError('OneDrive returned an invalid download Content-Range')
  const start = Number(match[1])
  const end = Number(match[2])
  const total = Number(match[3])
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    !Number.isSafeInteger(total) ||
    start !== expectedStart ||
    end < start ||
    end >= total ||
    total < 1 ||
    total > maxDownloadBytes ||
    end - start + 1 !== bodyLength ||
    (expectedTotal !== null && total !== expectedTotal)
  ) {
    throw transportError('OneDrive returned inconsistent ranged download bytes')
  }
  return { start, end, total }
}

function strongEtag(value: string | null): string | null | undefined {
  if (value === null) return null
  if (value.length < 2 || value.length > 1_024 || value.startsWith('W/')) return undefined
  if (value[0] !== '"' || value.at(-1) !== '"') return undefined
  for (let index = 1; index < value.length - 1; index++) {
    const code = value.charCodeAt(index)
    if (code !== 0x21 && (code < 0x23 || code > 0x7e)) return undefined
  }
  return value
}

function linkedAbortController(signal: AbortSignal): {
  controller: AbortController
  cleanup: () => void
} {
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  if (signal.aborted) abort()
  else signal.addEventListener('abort', abort, { once: true })
  return {
    controller,
    cleanup: () => signal.removeEventListener('abort', abort)
  }
}

type OneDriveMethod = OneDriveNativeTransferRequest['method']

type LinkedAbortController = ReturnType<typeof linkedAbortController>

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
      {
        kind,
        url: url.toString(),
        method,
        headers: nativeHeaders(request.headers),
        ...(body ? { body } : {}),
        maxResponseBytes: MAX_METADATA_RESPONSE_BYTES,
        timeoutMs: TRANSFER_TIMEOUT_MS
      },
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
        headers: nativeHeaders(headers),
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
  const etag = strongEtag(headers.get('etag'))
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
  let nextOffset = metadata.range.end + 1
  let requestCount = 1
  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    linked.cleanup()
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(first.body))
      if (nextOffset === metadata.range.total) {
        finish()
        controller.close()
      }
    },
    async pull(controller) {
      if (finished) return
      try {
        linked.controller.signal.throwIfAborted()
        requestCount++
        if (requestCount > Math.ceil(maxDownloadBytes / chunkBytes) + 1) {
          throw transportError('OneDrive ranged download exceeded the request limit')
        }
        const response = await fetchChunk(nextOffset, metadata.etag ?? undefined)
        if (response.status !== 206) {
          throw transportError('OneDrive ranged download did not continue with 206')
        }
        const headers = new Headers(response.headers.map(({ name, value }) => [name, value]))
        if (strongEtag(headers.get('etag')) !== metadata.etag) {
          throw transportError('OneDrive file changed during ranged download')
        }
        const range = parseContentRange(
          headers.get('content-range'),
          nextOffset,
          response.body.length,
          metadata.range.total,
          maxDownloadBytes
        )
        nextOffset = range.end + 1
        controller.enqueue(new Uint8Array(response.body))
        if (nextOffset === metadata.range.total) {
          finish()
          controller.close()
        }
      } catch (error) {
        finish()
        controller.error(error)
      }
    },
    cancel(reason) {
      linked.controller.abort(reason)
      finish()
    }
  })
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
    const linked = linkedAbortController(request.signal)
    return kind === 'download'
      ? downloadResponse(request, url, transfer, linked, chunkBytes, maxDownloadBytes)
      : metadataResponse(request, url, method, kind, transfer, linked, capabilities)
  }
}

export const oneDriveTauriTransport = createOneDriveTauriTransport()
