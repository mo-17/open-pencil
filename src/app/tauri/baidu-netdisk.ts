/* oxlint-disable eslint/max-lines -- OAuth cancellation, exact provider capabilities, bounded native bodies, and ranged downloads share this bridge. */

import { invoke } from '@tauri-apps/api/core'

import { randomHex } from '@open-pencil/core/random'

import {
  BAIDU_NETDISK_API_ORIGIN,
  BAIDU_NETDISK_LOCATE_UPLOAD_APP_ID,
  BAIDU_NETDISK_MAX_DOCUMENT_BYTES,
  BAIDU_NETDISK_PCS_ORIGIN,
  BAIDU_NETDISK_UPLOAD_CHUNK_BYTES
} from '@/app/integrations/storage/baidu-netdisk/config'
import type {
  BaiduNetdiskCapabilityKind,
  BaiduNetdiskTransport
} from '@/app/integrations/storage/baidu-netdisk/types'

import { BaiduNetdiskNativeError, nativeBaiduNetdiskError } from './baidu-netdisk-oauth-error'
import { withAbortSignal, type TauriHttpHeader } from './http'

export {
  BaiduNetdiskNativeError,
  type BaiduNetdiskNativeErrorCode
} from './baidu-netdisk-oauth-error'

export type BaiduNetdiskNativeOAuthClient =
  | { mode: 'publisher-broker' }
  | {
      mode: 'self-hosted'
      appKey: string
      secretKey: string
    }

export type BaiduNetdiskNativeAuthorizeRequest = {
  oauthClient: BaiduNetdiskNativeOAuthClient
  timeoutMs?: number
}

export type BaiduNetdiskNativeTokenResult = {
  accessToken: string
  refreshToken: string
  expiresIn: number
  grantedScopes: string[]
  uk: string
  baiduName?: string
  netdiskName?: string
}

export type BaiduNetdiskNativeAuthorizeResult = BaiduNetdiskNativeTokenResult

export type BaiduNetdiskNativeRefreshRequest = {
  oauthClient: BaiduNetdiskNativeOAuthClient
  refreshToken: string
  expectedUk: string
  timeoutMs?: number
}

export type BaiduNetdiskNativeRefreshResult = BaiduNetdiskNativeTokenResult

export type BaiduNetdiskTransferKind = 'api' | 'download' | 'upload'
export type BaiduNetdiskTransferHeader = TauriHttpHeader

export type BaiduNetdiskNativeTransferRequest = {
  kind: BaiduNetdiskTransferKind
  url: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  headers?: BaiduNetdiskTransferHeader[]
  body?: number[]
  maxResponseBytes: number
  timeoutMs?: number
}

export type BaiduNetdiskNativeTransferResponse = {
  status: number
  headers: BaiduNetdiskTransferHeader[]
  body: number[]
}

export type BaiduNetdiskInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

export type BaiduNetdiskNativeTransferInvoker = (
  request: BaiduNetdiskNativeTransferRequest,
  signal?: AbortSignal
) => Promise<BaiduNetdiskNativeTransferResponse>

export type CreateBaiduNetdiskTauriTransportOptions = {
  transfer?: BaiduNetdiskNativeTransferInvoker
  downloadChunkBytes?: number
  maxDownloadBytes?: number
}

export interface BaiduNetdiskNativeBridge {
  authorize(
    request: BaiduNetdiskNativeAuthorizeRequest,
    signal?: AbortSignal
  ): Promise<BaiduNetdiskNativeAuthorizeResult>
  refresh(
    request: BaiduNetdiskNativeRefreshRequest,
    signal?: AbortSignal
  ): Promise<BaiduNetdiskNativeRefreshResult>
}

const DEFAULT_DOWNLOAD_CHUNK_BYTES = BAIDU_NETDISK_UPLOAD_CHUNK_BYTES
const MIN_DOWNLOAD_CHUNK_BYTES = 256 * 1024
export const BAIDU_NETDISK_NATIVE_MAX_TRANSFER_BODY_BYTES =
  BAIDU_NETDISK_UPLOAD_CHUNK_BYTES + 256 * 1024
const MAX_DOWNLOAD_BYTES = BAIDU_NETDISK_MAX_DOCUMENT_BYTES
const MAX_METADATA_BODY_BYTES = 2 * 1024 * 1024
const MAX_METADATA_RESPONSE_BYTES = 2 * 1024 * 1024
const TRANSFER_TIMEOUT_MS = 120_000
const DEFAULT_INVOKE = invoke as BaiduNetdiskInvoke

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted', 'AbortError')
}

async function cancelOAuthOperation(
  invokeCommand: BaiduNetdiskInvoke,
  operationId: string
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (await invokeCommand<boolean>('baidu_netdisk_oauth_cancel', { operationId })) return
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
  invokeCommand: BaiduNetdiskInvoke,
  command: string,
  args: Record<string, unknown>,
  signal?: AbortSignal
): Promise<T> {
  signal?.throwIfAborted()
  let pending: Promise<T>
  try {
    pending = invokeCommand<T>(command, args)
  } catch (error) {
    throw nativeBaiduNetdiskError(error)
  }
  if (!signal) {
    try {
      return await pending
    } catch (error) {
      throw nativeBaiduNetdiskError(error)
    }
  }
  return withAbortSignal(pending, signal, nativeBaiduNetdiskError)
}

async function invokeCancellableOAuth<T>(
  invokeCommand: BaiduNetdiskInvoke,
  command: 'baidu_netdisk_oauth_authorize' | 'baidu_netdisk_oauth_refresh',
  request: object,
  signal?: AbortSignal
): Promise<T> {
  signal?.throwIfAborted()
  const operationId = randomHex(16)
  let pending: Promise<T>
  try {
    pending = invokeCommand<T>(command, { request: { ...request, operationId } })
  } catch (error) {
    throw nativeBaiduNetdiskError(error)
  }
  if (!signal) {
    try {
      return await pending
    } catch (error) {
      throw nativeBaiduNetdiskError(error)
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
        reject(nativeBaiduNetdiskError(error))
        return undefined
      }
    )
  })
}

export function createBaiduNetdiskNativeBridge(
  invokeCommand: BaiduNetdiskInvoke = DEFAULT_INVOKE
): BaiduNetdiskNativeBridge {
  return Object.freeze({
    authorize(request: BaiduNetdiskNativeAuthorizeRequest, signal?: AbortSignal) {
      return invokeCancellableOAuth<BaiduNetdiskNativeAuthorizeResult>(
        invokeCommand,
        'baidu_netdisk_oauth_authorize',
        request,
        signal
      )
    },
    refresh(request: BaiduNetdiskNativeRefreshRequest, signal?: AbortSignal) {
      return invokeCancellableOAuth<BaiduNetdiskNativeRefreshResult>(
        invokeCommand,
        'baidu_netdisk_oauth_refresh',
        request,
        signal
      )
    }
  })
}

export const baiduNetdiskNativeBridge = createBaiduNetdiskNativeBridge()

export function createBaiduNetdiskNativeTransfer(
  invokeCommand: BaiduNetdiskInvoke = DEFAULT_INVOKE
): BaiduNetdiskNativeTransferInvoker {
  return (request, signal) =>
    invokeWithAbort<BaiduNetdiskNativeTransferResponse>(
      invokeCommand,
      'baidu_netdisk_transfer',
      { request },
      signal
    )
}

export const baiduNetdiskNativeTransfer = createBaiduNetdiskNativeTransfer()

function transportError(message: string): BaiduNetdiskNativeError {
  return new BaiduNetdiskNativeError('invalid-request', { cause: new TypeError(message) })
}

function boundedPositiveInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw transportError('Baidu Netdisk native transfer limit is invalid')
  }
  return value
}

function isPcsHost(hostname: string): boolean {
  const host = hostname.toLocaleLowerCase()
  return host === 'd.pcs.baidu.com' || host.endsWith('.pcs.baidu.com')
}

function validateHttpsURL(url: URL): void {
  if (
    url.protocol !== 'https:' ||
    (url.port && url.port !== '443') ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw transportError('Baidu Netdisk native transfer URL is invalid')
  }
}

function isStaticAPIURL(url: URL): boolean {
  if (url.origin === BAIDU_NETDISK_API_ORIGIN) {
    const method = url.searchParams.get('method')
    if (url.pathname === '/rest/2.0/xpan/file') {
      return ['list', 'precreate', 'create', 'filemanager'].includes(method ?? '')
    }
    if (url.pathname === '/rest/2.0/xpan/multimedia') return method === 'filemetas'
    if (url.pathname === '/rest/2.0/xpan/nas') return method === 'uinfo'
    return false
  }
  return (
    url.origin === BAIDU_NETDISK_PCS_ORIGIN &&
    url.pathname === '/rest/2.0/pcs/file' &&
    url.searchParams.get('method') === 'locateupload' &&
    url.searchParams.get('appid') === BAIDU_NETDISK_LOCATE_UPLOAD_APP_ID
  )
}

function capabilityKey(kind: BaiduNetdiskCapabilityKind, rawURL: string): string {
  let url: URL
  try {
    url = new URL(rawURL)
  } catch {
    throw transportError('Baidu Netdisk capability URL is invalid')
  }
  validateHttpsURL(url)
  if (!isPcsHost(url.hostname)) {
    throw transportError('Baidu Netdisk capability host is invalid')
  }
  if (kind === 'upload' && url.pathname !== '/rest/2.0/pcs/superfile2') {
    throw transportError('Baidu Netdisk upload capability path is invalid')
  }
  if (kind === 'download') url.searchParams.delete('access_token')
  return `${kind}:${url.toString()}`
}

function transferKind(url: URL, capabilities: ReadonlySet<string>): BaiduNetdiskTransferKind {
  validateHttpsURL(url)
  if (isStaticAPIURL(url)) return 'api'
  if (
    url.pathname === '/rest/2.0/pcs/superfile2' &&
    capabilities.has(capabilityKey('upload', url.toString()))
  ) {
    return 'upload'
  }
  if (capabilities.has(capabilityKey('download', url.toString()))) {
    return 'download'
  }
  throw transportError('Baidu Netdisk native transfer URL was not issued by a trusted response')
}

async function boundedRequestBody(
  request: Request,
  maxBytes: number
): Promise<number[] | undefined> {
  if (!request.body) return undefined
  const declared = request.headers.get('content-length')
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    throw transportError('Baidu Netdisk request body is too large')
  }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    let next = await reader.read()
    while (!next.done) {
      total += next.value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw transportError('Baidu Netdisk request body is too large')
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

function nativeHeaders(headers: Headers): BaiduNetdiskTransferHeader[] {
  return [...headers.entries()].map(([name, value]) => ({ name, value }))
}

function nativeResponse(response: BaiduNetdiskNativeTransferResponse): Response {
  if (
    !Number.isSafeInteger(response.status) ||
    response.status < 200 ||
    response.status > 599 ||
    response.body.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 255)
  ) {
    throw transportError('Baidu Netdisk returned an invalid native response')
  }
  const body = [204, 205, 304].includes(response.status) ? null : new Uint8Array(response.body)
  return new Response(body, {
    status: response.status,
    headers: response.headers.map(({ name, value }): [string, string] => [name, value])
  })
}

function linkedAbortController(signal: AbortSignal): {
  controller: AbortController
  cleanup: () => void
} {
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  if (signal.aborted) abort()
  else signal.addEventListener('abort', abort, { once: true })
  return { controller, cleanup: () => signal.removeEventListener('abort', abort) }
}

type ParsedContentRange = { start: number; end: number; total: number }

function parseContentRange(
  value: string | null,
  expectedStart: number,
  bodyLength: number,
  expectedTotal: number | null,
  maxDownloadBytes: number
): ParsedContentRange {
  const match = value ? /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value.trim()) : null
  if (!match) throw transportError('Baidu Netdisk returned an invalid Content-Range')
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
    throw transportError('Baidu Netdisk returned inconsistent ranged bytes')
  }
  return { start, end, total }
}

function responseHeader(response: BaiduNetdiskNativeTransferResponse, name: string): string | null {
  return response.headers.find((header) => header.name.toLowerCase() === name)?.value ?? null
}

function downloadValidator(response: BaiduNetdiskNativeTransferResponse): string | null {
  const etag = responseHeader(response, 'etag')
  if (etag && etag.length <= 1_024 && /^"[\x21\x23-\x7e]+"$/.test(etag)) return etag
  const modified = responseHeader(response, 'last-modified')
  return modified && modified.length <= 128 && Number.isFinite(Date.parse(modified))
    ? modified
    : null
}

async function metadataResponse(
  request: Request,
  url: URL,
  method: BaiduNetdiskNativeTransferRequest['method'],
  kind: Exclude<BaiduNetdiskTransferKind, 'download'>,
  transfer: BaiduNetdiskNativeTransferInvoker,
  linked: ReturnType<typeof linkedAbortController>
): Promise<Response> {
  try {
    const body = await boundedRequestBody(
      request,
      kind === 'upload' ? BAIDU_NETDISK_NATIVE_MAX_TRANSFER_BODY_BYTES : MAX_METADATA_BODY_BYTES
    )
    return nativeResponse(
      await transfer(
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
    )
  } finally {
    linked.cleanup()
  }
}

async function downloadResponse(
  request: Request,
  url: URL,
  transfer: BaiduNetdiskNativeTransferInvoker,
  linked: ReturnType<typeof linkedAbortController>,
  chunkBytes: number,
  maxDownloadBytes: number
): Promise<Response> {
  try {
    if (request.method !== 'GET' || request.body !== null || request.headers.has('range')) {
      throw transportError('Baidu Netdisk ranged download request is invalid')
    }
    const baseHeaders = new Headers(request.headers)
    const fetchChunk = (start: number, validator?: string) => {
      const headers = new Headers(baseHeaders)
      headers.set(
        'range',
        `bytes=${start}-${Math.min(start + chunkBytes - 1, maxDownloadBytes - 1)}`
      )
      if (validator) headers.set('if-range', validator)
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
    const first = await fetchChunk(0)
    if (first.status !== 206) {
      linked.cleanup()
      if (first.status === 200 && first.body.length <= chunkBytes) return nativeResponse(first)
      return nativeResponse(first)
    }
    const range = parseContentRange(
      responseHeader(first, 'content-range'),
      0,
      first.body.length,
      null,
      maxDownloadBytes
    )
    const validator = downloadValidator(first)
    if (range.end + 1 < range.total && !validator) {
      throw transportError('Baidu Netdisk ranged download has no stable validator')
    }
    const headers = new Headers(first.headers.map(({ name, value }) => [name, value]))
    headers.set('content-length', String(range.total))
    headers.delete('content-range')
    let nextOffset = range.end + 1
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
        if (nextOffset === range.total) {
          finish()
          controller.close()
        }
      },
      async pull(controller) {
        if (finished) return
        try {
          requestCount++
          if (requestCount > Math.ceil(maxDownloadBytes / chunkBytes) + 1) {
            throw transportError('Baidu Netdisk ranged download exceeded the request limit')
          }
          const response = await fetchChunk(nextOffset, validator ?? undefined)
          if (response.status !== 206 || downloadValidator(response) !== validator) {
            throw transportError('Baidu Netdisk file changed during ranged download')
          }
          const nextRange = parseContentRange(
            responseHeader(response, 'content-range'),
            nextOffset,
            response.body.length,
            range.total,
            maxDownloadBytes
          )
          nextOffset = nextRange.end + 1
          controller.enqueue(new Uint8Array(response.body))
          if (nextOffset === range.total) {
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
    return new Response(stream, { status: 200, headers })
  } catch (error) {
    linked.cleanup()
    throw error
  }
}

export function createBaiduNetdiskTauriTransport(
  options: CreateBaiduNetdiskTauriTransportOptions = {}
): BaiduNetdiskTransport {
  const transfer = options.transfer ?? baiduNetdiskNativeTransfer
  const chunkBytes = boundedPositiveInteger(
    options.downloadChunkBytes ?? DEFAULT_DOWNLOAD_CHUNK_BYTES,
    MIN_DOWNLOAD_CHUNK_BYTES,
    BAIDU_NETDISK_UPLOAD_CHUNK_BYTES
  )
  const maxDownloadBytes = boundedPositiveInteger(
    options.maxDownloadBytes ?? MAX_DOWNLOAD_BYTES,
    chunkBytes,
    MAX_DOWNLOAD_BYTES
  )
  const capabilities = new Set<string>()
  const transport = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const request = new Request(input, init)
    request.signal.throwIfAborted()
    if (!['error', 'manual'].includes(request.redirect)) {
      throw transportError('Baidu Netdisk native transport policy is invalid')
    }
    const method = request.method.toUpperCase()
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) {
      throw transportError('Baidu Netdisk native transfer method is invalid')
    }
    const url = new URL(request.url)
    const kind = transferKind(url, capabilities)
    if (kind === 'download' && new Headers(request.headers).get('user-agent') !== 'pan.baidu.com') {
      throw transportError('Baidu Netdisk download User-Agent is invalid')
    }
    const linked = linkedAbortController(request.signal)
    return kind === 'download'
      ? downloadResponse(request, url, transfer, linked, chunkBytes, maxDownloadBytes)
      : metadataResponse(
          request,
          url,
          method as BaiduNetdiskNativeTransferRequest['method'],
          kind,
          transfer,
          linked
        )
  }
  return Object.assign(transport, {
    registerCapability(kind: BaiduNetdiskCapabilityKind, url: string) {
      const key = capabilityKey(kind, url)
      if (capabilities.size >= 256 && !capabilities.has(key)) {
        const oldest = capabilities.values().next().value
        if (typeof oldest === 'string') capabilities.delete(oldest)
      }
      capabilities.add(key)
    }
  })
}

export const baiduNetdiskTauriTransport = createBaiduNetdiskTauriTransport()
