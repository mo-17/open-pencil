import { invoke } from '@tauri-apps/api/core'

import { randomHex } from '@open-pencil/core/random'

import {
  defaultGoogleDriveTransferSleep,
  linkedGoogleDriveAbortController,
  parseStrongGoogleDriveEtag,
  retryGoogleDriveContinuation,
  type GoogleDriveTransferSleep
} from './google-drive-download'
import { withAbortSignal, type TauriHttpHeader } from './http'

export type GoogleDriveNativeErrorCode =
  | 'invalid-request'
  | 'unsupported'
  | 'cancelled'
  | 'timeout'
  | 'browser-open-failed'
  | 'oauth-denied'
  | 'oauth-failed'
  | 'scope-mismatch'
  | 'subject-mismatch'
  | 'network-failed'
  | 'response-too-large'

type NativeErrorValue = {
  code?: GoogleDriveNativeErrorCode
  message?: string
}

export class GoogleDriveNativeError extends Error {
  constructor(
    readonly code: GoogleDriveNativeErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'GoogleDriveNativeError'
  }
}

export type GoogleDriveNativeAuthorizeRequest = {
  clientId: string
  timeoutMs?: number
}

export type GoogleDriveNativeAuthorizeResult = {
  accessToken: string
  refreshToken: string
  expiresIn: number
  grantedScopes: string[]
  subject: string
  email?: string
}

export type GoogleDriveNativeRefreshRequest = {
  clientId: string
  refreshToken: string
  expectedSubject: string
  timeoutMs?: number
}

export type GoogleDriveNativeRefreshResult = {
  accessToken: string
  expiresIn: number
  subject: string
  email?: string
}

export type GoogleDriveNativeRevokeRequest = {
  token: string
  timeoutMs?: number
}

export type GoogleDriveTransferKind = 'api' | 'resumable-init' | 'upload-chunk' | 'download-chunk'

export type GoogleDriveTransferHeader = TauriHttpHeader

export type GoogleDriveNativeTransferRequest = {
  kind: GoogleDriveTransferKind
  url: string
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  headers?: GoogleDriveTransferHeader[]
  body?: number[]
  maxResponseBytes: number
  timeoutMs?: number
}

export type GoogleDriveNativeTransferResponse = {
  status: number
  headers: GoogleDriveTransferHeader[]
  body: number[]
}

export type GoogleDriveNativeTransferInvoker = (
  request: GoogleDriveNativeTransferRequest,
  signal?: AbortSignal
) => Promise<GoogleDriveNativeTransferResponse>

export type CreateGoogleDriveTauriTransportOptions = {
  transfer?: GoogleDriveNativeTransferInvoker
  downloadChunkBytes?: number
  maxDownloadBytes?: number
  sleep?: GoogleDriveTransferSleep
}

const DEFAULT_DOWNLOAD_CHUNK_BYTES = 4 * 1024 * 1024
const MIN_DOWNLOAD_CHUNK_BYTES = 1024 * 1024
const MAX_DOWNLOAD_CHUNK_BYTES = 8 * 1024 * 1024
const MAX_TAURI_DOWNLOAD_BYTES = 512 * 1024 * 1024
const MAX_NATIVE_METADATA_BYTES = 2 * 1024 * 1024
const MAX_NATIVE_METADATA_BODY_BYTES = 1024 * 1024

export interface GoogleDriveNativeBridge {
  authorize(
    request: GoogleDriveNativeAuthorizeRequest,
    signal?: AbortSignal
  ): Promise<GoogleDriveNativeAuthorizeResult>
  refresh(
    request: GoogleDriveNativeRefreshRequest,
    signal?: AbortSignal
  ): Promise<GoogleDriveNativeRefreshResult>
  revoke(request: GoogleDriveNativeRevokeRequest, signal?: AbortSignal): Promise<void>
}

function nativeError(error: unknown): GoogleDriveNativeError {
  if (error instanceof GoogleDriveNativeError) return error
  const value =
    typeof error === 'object' && error !== null ? (error as NativeErrorValue) : undefined
  return new GoogleDriveNativeError(
    value?.code ?? 'oauth-failed',
    value?.message ?? 'Google Drive native operation failed'
  )
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted', 'AbortError')
}

async function cancelOAuthOperation(operationId: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (await invoke<boolean>('google_drive_oauth_cancel', { operationId })) return
    } catch {
      return
    }
    if (attempt < 2) {
      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 25)
      })
    }
  }
}

async function invokeWithAbort<T>(
  command: string,
  args: Record<string, unknown>,
  signal?: AbortSignal
): Promise<T> {
  signal?.throwIfAborted()
  const pending = invoke<T>(command, args)
  if (!signal) {
    try {
      return await pending
    } catch (error) {
      throw nativeError(error)
    }
  }
  return withAbortSignal(pending, signal, nativeError)
}

async function invokeCancellableOAuth<T>(
  command: 'google_drive_oauth_authorize' | 'google_drive_oauth_refresh',
  request: object,
  lateToken?: (result: T) => string,
  signal?: AbortSignal
): Promise<T> {
  signal?.throwIfAborted()
  const operationId = randomHex(16)
  const pending = invoke<T>(command, { request: { ...request, operationId } })
  if (!signal) {
    try {
      return await pending
    } catch (error) {
      throw nativeError(error)
    }
  }

  return new Promise<T>((resolve, reject) => {
    let aborting = false
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const rejectAbort = () => reject(abortReason(signal))
    const onAbort = () => {
      if (aborting) return
      aborting = true
      cleanup()
      rejectAbort()
      void cancelOAuthOperation(operationId)
      void (async () => {
        try {
          const result = await pending
          const token = lateToken?.(result)
          if (token) {
            await invoke('google_drive_oauth_revoke', {
              request: { token, timeoutMs: 15_000 }
            })
          }
        } catch (error) {
          void error
          // The caller is already aborting; native errors remain intentionally undisclosed.
        }
      })()
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
        reject(nativeError(error))
        return undefined
      }
    )
  })
}

export const googleDriveNativeBridge: GoogleDriveNativeBridge = Object.freeze({
  authorize(request: GoogleDriveNativeAuthorizeRequest, signal?: AbortSignal) {
    return invokeCancellableOAuth<GoogleDriveNativeAuthorizeResult>(
      'google_drive_oauth_authorize',
      request,
      (result) => result.refreshToken,
      signal
    )
  },
  refresh(request: GoogleDriveNativeRefreshRequest, signal?: AbortSignal) {
    return invokeCancellableOAuth<GoogleDriveNativeRefreshResult>(
      'google_drive_oauth_refresh',
      request,
      undefined,
      signal
    )
  },
  async revoke(request: GoogleDriveNativeRevokeRequest, signal?: AbortSignal) {
    await invokeWithAbort<unknown>('google_drive_oauth_revoke', { request }, signal)
  }
})

export function googleDriveNativeTransfer(
  request: GoogleDriveNativeTransferRequest,
  signal?: AbortSignal
): Promise<GoogleDriveNativeTransferResponse> {
  return invokeWithAbort('google_drive_transfer', { request }, signal)
}

function transportError(message: string): GoogleDriveNativeError {
  return new GoogleDriveNativeError('invalid-request', message)
}

function boundedPositiveInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw transportError('Google Drive native transfer limit is invalid')
  }
  return value
}

function transferKind(url: URL, method: string): GoogleDriveTransferKind {
  if (url.searchParams.get('alt') === 'media') return 'download-chunk'
  if (url.pathname.startsWith('/upload/drive/v3/files')) {
    if (method === 'PUT' && url.searchParams.has('upload_id')) return 'upload-chunk'
    if (
      (method === 'POST' || method === 'PATCH') &&
      url.searchParams.get('uploadType') === 'resumable'
    ) {
      return 'resumable-init'
    }
  }
  return 'api'
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
    throw transportError('Google Drive request body is too large')
  }

  const chunks: Uint8Array[] = []
  const reader = request.body.getReader()
  let total = 0
  try {
    let next = await reader.read()
    while (!next.done) {
      const { value } = next
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw transportError('Google Drive request body is too large')
      }
      chunks.push(value)
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

function nativeHeaders(headers: Headers): GoogleDriveTransferHeader[] {
  return [...headers.entries()].map(([name, value]) => ({ name, value }))
}

function responseFromNative(response: GoogleDriveNativeTransferResponse): Response {
  return new Response(new Uint8Array(response.body), {
    status: response.status,
    headers: response.headers.map(({ name, value }): [string, string] => [name, value])
  })
}

type ParsedContentRange = {
  start: number
  end: number
  total: number
}

function parseDownloadContentRange(
  value: string | null,
  expectedStart: number,
  bodyLength: number,
  expectedTotal: number | null,
  maxDownloadBytes: number
): ParsedContentRange {
  const match = value ? /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value.trim()) : null
  if (!match) throw transportError('Google Drive returned an invalid download Content-Range')
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
    throw transportError('Google Drive returned inconsistent ranged download bytes')
  }
  return { start, end, total }
}

export function createGoogleDriveTauriTransport(
  options: CreateGoogleDriveTauriTransportOptions = {}
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  const transfer = options.transfer ?? googleDriveNativeTransfer
  const sleep = options.sleep ?? defaultGoogleDriveTransferSleep
  const chunkBytes = boundedPositiveInteger(
    options.downloadChunkBytes ?? DEFAULT_DOWNLOAD_CHUNK_BYTES,
    MIN_DOWNLOAD_CHUNK_BYTES,
    MAX_DOWNLOAD_CHUNK_BYTES
  )
  const maxDownloadBytes = boundedPositiveInteger(
    options.maxDownloadBytes ?? MAX_TAURI_DOWNLOAD_BYTES,
    chunkBytes,
    MAX_TAURI_DOWNLOAD_BYTES
  )

  return async (input, init = {}) => {
    const request = new Request(input, init)
    request.signal.throwIfAborted()
    if (request.redirect !== 'error') {
      throw transportError('Google Drive native transport requires redirect rejection')
    }
    const method = request.method.toUpperCase()
    if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
      throw transportError('Google Drive native transport method is invalid')
    }
    const url = new URL(request.url)
    const kind = transferKind(url, method)
    const linked = linkedGoogleDriveAbortController(request.signal)

    if (kind !== 'download-chunk') {
      try {
        const maxBodyBytes =
          kind === 'upload-chunk' ? MAX_DOWNLOAD_CHUNK_BYTES : MAX_NATIVE_METADATA_BODY_BYTES
        const body = await boundedRequestBody(request, maxBodyBytes)
        return responseFromNative(
          await transfer(
            {
              kind,
              url: url.toString(),
              method: method as GoogleDriveNativeTransferRequest['method'],
              headers: nativeHeaders(request.headers),
              ...(body ? { body } : {}),
              maxResponseBytes: MAX_NATIVE_METADATA_BYTES,
              timeoutMs: 120_000
            },
            linked.controller.signal
          )
        )
      } finally {
        linked.cleanup()
      }
    }

    if (method !== 'GET' || request.body !== null) {
      linked.cleanup()
      throw transportError('Google Drive ranged download request is invalid')
    }
    const baseHeaders = new Headers(request.headers)
    baseHeaders.delete('Range')
    baseHeaders.delete('If-Match')
    const fetchChunk = async (
      start: number,
      expectedEtag?: string
    ): Promise<GoogleDriveNativeTransferResponse> => {
      const headers = new Headers(baseHeaders)
      headers.set(
        'Range',
        `bytes=${start}-${Math.min(start + chunkBytes - 1, maxDownloadBytes - 1)}`
      )
      if (expectedEtag) headers.set('If-Match', expectedEtag)
      return transfer(
        {
          kind: 'download-chunk',
          url: url.toString(),
          method: 'GET',
          headers: nativeHeaders(headers),
          maxResponseBytes: chunkBytes,
          timeoutMs: 120_000
        },
        linked.controller.signal
      )
    }

    const fetchContinuationChunk = async (
      start: number,
      expectedEtag: string
    ): Promise<GoogleDriveNativeTransferResponse> => {
      return retryGoogleDriveContinuation(
        () => fetchChunk(start, expectedEtag),
        sleep,
        linked.controller.signal,
        () => transportError('Google Drive ranged download retry limit was reached')
      )
    }

    let first: GoogleDriveNativeTransferResponse
    try {
      first = await fetchChunk(0)
    } catch (error) {
      linked.cleanup()
      throw error
    }
    if (first.status !== 206) {
      linked.cleanup()
      if (first.status >= 200 && first.status < 300) {
        throw transportError('Google Drive ranged download did not return 206')
      }
      return responseFromNative(first)
    }
    const firstHeaders = new Headers(
      first.headers.map(({ name, value }): [string, string] => [name, value])
    )
    let firstRange: ParsedContentRange
    try {
      firstRange = parseDownloadContentRange(
        firstHeaders.get('content-range'),
        0,
        first.body.length,
        null,
        maxDownloadBytes
      )
    } catch (error) {
      linked.cleanup()
      throw error
    }
    const declaredChunkLength = firstHeaders.get('content-length')
    if (
      declaredChunkLength !== null &&
      (!/^\d+$/.test(declaredChunkLength) || Number(declaredChunkLength) !== first.body.length)
    ) {
      linked.cleanup()
      throw transportError('Google Drive returned an invalid download Content-Length')
    }
    firstHeaders.set('content-length', String(firstRange.total))
    const firstEtag = parseStrongGoogleDriveEtag(firstHeaders.get('etag'))
    if (firstEtag === undefined) {
      linked.cleanup()
      throw transportError('Google Drive returned an invalid download ETag')
    }
    if (firstRange.end + 1 < firstRange.total && !firstEtag) {
      linked.cleanup()
      throw transportError('Google Drive ranged download requires an ETag')
    }

    let nextOffset = firstRange.end + 1
    let requestCount = 1
    const maximumRequestCount = Math.ceil(maxDownloadBytes / chunkBytes) + 1
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      linked.cleanup()
    }
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(first.body))
        if (nextOffset === firstRange.total) {
          finish()
          controller.close()
        }
      },
      async pull(controller) {
        if (finished) return
        try {
          linked.controller.signal.throwIfAborted()
          requestCount++
          if (requestCount > maximumRequestCount) {
            throw transportError('Google Drive ranged download exceeded the request limit')
          }
          const response = await fetchContinuationChunk(nextOffset, firstEtag as string)
          if (response.status === 412) {
            throw transportError('Google Drive file changed during ranged download')
          }
          if (response.status !== 206) {
            throw transportError('Google Drive ranged download did not continue with 206')
          }
          const headers = new Headers(
            response.headers.map(({ name, value }): [string, string] => [name, value])
          )
          const responseEtag = parseStrongGoogleDriveEtag(headers.get('etag'))
          if (responseEtag === undefined) {
            throw transportError('Google Drive returned an invalid download ETag')
          }
          if (responseEtag !== null && responseEtag !== firstEtag) {
            throw transportError('Google Drive file changed during ranged download')
          }
          const range = parseDownloadContentRange(
            headers.get('content-range'),
            nextOffset,
            response.body.length,
            firstRange.total,
            maxDownloadBytes
          )
          const previousOffset = nextOffset
          nextOffset = range.end + 1
          if (nextOffset <= previousOffset) {
            throw transportError('Google Drive ranged download made no progress')
          }
          controller.enqueue(new Uint8Array(response.body))
          if (nextOffset === firstRange.total) {
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
    firstHeaders.delete('content-range')
    return new Response(stream, { status: 200, headers: firstHeaders })
  }
}

export const googleDriveTauriTransport = createGoogleDriveTauriTransport()
