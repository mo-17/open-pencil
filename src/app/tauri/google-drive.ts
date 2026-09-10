import { invoke } from '@tauri-apps/api/core'

import type { ParsedContentRange } from './content-range'
import { GoogleDriveNativeError, nativeGoogleDriveError } from './drive-oauth-error'
import {
  defaultGoogleDriveTransferSleep,
  linkedGoogleDriveAbortController,
  parseStrongGoogleDriveEtag,
  retryGoogleDriveContinuation,
  type GoogleDriveTransferSleep
} from './google-drive-download'
import type { TauriHttpHeader } from './http'
import {
  boundedStorageRequestBody,
  createBoundedStorageInteger,
  createStorageContentRangeParser,
  invokeCancellableStorageOAuth,
  invokeStorageNative,
  storageNativeHeaders,
  storageRangedDownloadStream,
  type StorageNativeInvoke
} from './storage-native-common'

export { GoogleDriveNativeError, type GoogleDriveNativeErrorCode } from './drive-oauth-error'

export type GoogleDriveNativeOAuthClient =
  | { mode: 'publisher-broker' }
  | {
      mode: 'self-hosted-desktop'
      clientId: string
      clientSecret: string
    }

export type GoogleDriveNativeAuthorizeRequest = {
  oauthClient: GoogleDriveNativeOAuthClient
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
  oauthClient: GoogleDriveNativeOAuthClient
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
const GOOGLE_DRIVE_INVOKE = invoke as StorageNativeInvoke

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

async function invokeCancellableOAuth<T>(
  command: 'google_drive_oauth_authorize' | 'google_drive_oauth_refresh',
  request: object,
  lateToken?: (result: T) => string,
  signal?: AbortSignal
): Promise<T> {
  return invokeCancellableStorageOAuth<T>({
    invokeCommand: GOOGLE_DRIVE_INVOKE,
    command,
    cancelCommand: 'google_drive_oauth_cancel',
    request,
    mapError: nativeGoogleDriveError,
    signal,
    onLateResult: async (result) => {
      const token = lateToken?.(result)
      if (!token) return
      await invoke('google_drive_oauth_revoke', {
        request: { token, timeoutMs: 15_000 }
      })
    }
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
    await invokeStorageNative<unknown>(
      GOOGLE_DRIVE_INVOKE,
      'google_drive_oauth_revoke',
      { request },
      nativeGoogleDriveError,
      signal
    )
  }
})

export function googleDriveNativeTransfer(
  request: GoogleDriveNativeTransferRequest,
  signal?: AbortSignal
): Promise<GoogleDriveNativeTransferResponse> {
  return invokeStorageNative(
    GOOGLE_DRIVE_INVOKE,
    'google_drive_transfer',
    { request },
    nativeGoogleDriveError,
    signal
  )
}

function transportError(message: string): GoogleDriveNativeError {
  return new GoogleDriveNativeError('invalid-request', message)
}

const boundedPositiveInteger = createBoundedStorageInteger(() =>
  transportError('Google Drive native transfer limit is invalid')
)

const parseDownloadContentRange = createStorageContentRangeParser(
  () => transportError('Google Drive returned an invalid download Content-Range'),
  () => transportError('Google Drive returned inconsistent ranged download bytes')
)

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
  return boundedStorageRequestBody(request, maxBytes, () =>
    transportError('Google Drive request body is too large')
  )
}

function responseFromNative(response: GoogleDriveNativeTransferResponse): Response {
  return new Response(new Uint8Array(response.body), {
    status: response.status,
    headers: response.headers.map(({ name, value }): [string, string] => [name, value])
  })
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
              headers: storageNativeHeaders(request.headers),
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
          headers: storageNativeHeaders(headers),
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

    const maximumRequestCount = Math.ceil(maxDownloadBytes / chunkBytes) + 1
    const stream = storageRangedDownloadStream(
      first.body,
      firstRange.end + 1,
      firstRange.total,
      linked,
      maximumRequestCount,
      () => transportError('Google Drive ranged download exceeded the request limit'),
      async (nextOffset) => {
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
        const continuedOffset = range.end + 1
        if (continuedOffset <= nextOffset) {
          throw transportError('Google Drive ranged download made no progress')
        }
        return { body: response.body, nextOffset: continuedOffset }
      }
    )
    firstHeaders.delete('content-range')
    return new Response(stream, { status: 200, headers: firstHeaders })
  }
}

export const googleDriveTauriTransport = createGoogleDriveTauriTransport()
