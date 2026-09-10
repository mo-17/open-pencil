/* oxlint-disable eslint/max-lines -- OAuth cancellation and the bounded native capability transport share one bridge. */

import { invoke } from '@tauri-apps/api/core'

import { ALIYUN_DRIVE_OPENAPI_ORIGIN } from '@/app/integrations/storage/aliyun-drive/config'

import { AliyunDriveNativeError, nativeAliyunDriveError } from './aliyun-drive-oauth-error'
import type { TauriHttpHeader } from './http'
import {
  boundedStorageRequestBody,
  createBoundedStorageInteger,
  invokeCancellableStorageOAuth,
  invokeStorageNative,
  parseStorageJSONBody,
  rememberBoundedStorageCapability,
  storageNativeHeaders,
  storageNativeResponse,
  storageNativeResponseHeader,
  type StorageNativeInvoke
} from './storage-native-common'

export { AliyunDriveNativeError, type AliyunDriveNativeErrorCode } from './aliyun-drive-oauth-error'

export type AliyunDriveNativeOAuthClient =
  | Readonly<{ mode: 'publisher-broker-confidential' }>
  | Readonly<{
      mode: 'self-hosted-confidential'
      clientId: string
      clientSecret: string
      redirectUri: string
    }>
  | Readonly<{
      mode: 'self-hosted-public'
      clientId: string
      redirectUri: string
    }>

export type AliyunDriveNativeConfidentialOAuthClient = Exclude<
  AliyunDriveNativeOAuthClient,
  Readonly<{ mode: 'self-hosted-public' }>
>

export type AliyunDriveNativeAuthorizeRequest = {
  oauthClient: AliyunDriveNativeOAuthClient
  timeoutMs?: number
}

type AliyunDriveNativeTokenResultBase = {
  accessToken: string
  expiresIn: number
  grantedScopes: string[]
  subject: string
  email?: string
  name?: string
}

export type AliyunDriveNativeRefreshGrantResult = AliyunDriveNativeTokenResultBase & {
  grantType: 'refresh-grant'
  refreshToken: string
}

export type AliyunDriveNativeAccessGrantResult = AliyunDriveNativeTokenResultBase & {
  grantType: 'access-grant'
}

export type AliyunDriveNativeAuthorizeResult =
  | AliyunDriveNativeRefreshGrantResult
  | AliyunDriveNativeAccessGrantResult

export type AliyunDriveNativeRefreshRequest = {
  oauthClient: AliyunDriveNativeConfidentialOAuthClient
  refreshToken: string
  expectedSubject: string
  timeoutMs?: number
}

export type AliyunDriveNativeRefreshResult = AliyunDriveNativeRefreshGrantResult

export type AliyunDriveTransferKind = 'api' | 'upload' | 'download'
export type AliyunDriveTransferHeader = TauriHttpHeader

export type AliyunDriveNativeTransferRequest = {
  kind: AliyunDriveTransferKind
  url: string
  method: 'GET' | 'POST' | 'PUT'
  headers?: AliyunDriveTransferHeader[]
  body?: number[]
  maxResponseBytes: number
  timeoutMs?: number
}

export type AliyunDriveNativeTransferResponse = {
  status: number
  headers: AliyunDriveTransferHeader[]
  body: number[]
}

export type AliyunDriveInvoke = StorageNativeInvoke

export type AliyunDriveNativeTransferInvoker = (
  request: AliyunDriveNativeTransferRequest,
  signal?: AbortSignal
) => Promise<AliyunDriveNativeTransferResponse>

export type CreateAliyunDriveTauriTransportOptions = {
  transfer?: AliyunDriveNativeTransferInvoker
  maxDownloadBytes?: number
}

export interface AliyunDriveNativeBridge {
  authorize(
    request: AliyunDriveNativeAuthorizeRequest,
    signal?: AbortSignal
  ): Promise<AliyunDriveNativeAuthorizeResult>
  refresh(
    request: AliyunDriveNativeRefreshRequest,
    signal?: AbortSignal
  ): Promise<AliyunDriveNativeRefreshResult>
}

export const ALIYUN_DRIVE_NATIVE_MAX_TRANSFER_CHUNK_BYTES = 10 * 1024 * 1024
const MAX_METADATA_BODY_BYTES = 1024 * 1024
const MAX_METADATA_RESPONSE_BYTES = 2 * 1024 * 1024
const DEFAULT_MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024
const MAX_CAPABILITIES = 10_016
const MAX_HEADERS = 256
const MAX_HEADER_NAME_LENGTH = 256
const MAX_HEADER_VALUE_LENGTH = 16_384
const TRANSFER_TIMEOUT_MS = 120_000

const DEFAULT_INVOKE = invoke as AliyunDriveInvoke

export function createAliyunDriveNativeBridge(
  invokeCommand: AliyunDriveInvoke = DEFAULT_INVOKE
): AliyunDriveNativeBridge {
  return Object.freeze({
    authorize(request: AliyunDriveNativeAuthorizeRequest, signal?: AbortSignal) {
      return invokeCancellableStorageOAuth<AliyunDriveNativeAuthorizeResult>({
        invokeCommand,
        command: 'aliyun_drive_oauth_authorize',
        cancelCommand: 'aliyun_drive_oauth_cancel',
        request,
        mapError: nativeAliyunDriveError,
        signal
      })
    },
    refresh(request: AliyunDriveNativeRefreshRequest, signal?: AbortSignal) {
      return invokeCancellableStorageOAuth<AliyunDriveNativeRefreshResult>({
        invokeCommand,
        command: 'aliyun_drive_oauth_refresh',
        cancelCommand: 'aliyun_drive_oauth_cancel',
        request,
        mapError: nativeAliyunDriveError,
        signal
      })
    }
  })
}

export const aliyunDriveNativeBridge = createAliyunDriveNativeBridge()

export function createAliyunDriveNativeTransfer(
  invokeCommand: AliyunDriveInvoke = DEFAULT_INVOKE
): AliyunDriveNativeTransferInvoker {
  return (request, signal) =>
    invokeStorageNative<AliyunDriveNativeTransferResponse>(
      invokeCommand,
      'aliyun_drive_transfer',
      { request },
      nativeAliyunDriveError,
      signal
    )
}

export const aliyunDriveNativeTransfer = createAliyunDriveNativeTransfer()

function transportError(message: string): AliyunDriveNativeError {
  return new AliyunDriveNativeError('invalid-request', { cause: new TypeError(message) })
}

function responseError(message: string): AliyunDriveNativeError {
  return new AliyunDriveNativeError('invalid-response', { cause: new TypeError(message) })
}

const boundedPositiveInteger = createBoundedStorageInteger(() =>
  transportError('Aliyun Drive native transfer limit is invalid')
)

type AliyunDriveCapabilityKind = Exclude<AliyunDriveTransferKind, 'api'>

function safeCapabilityURL(rawURL: string): URL | null {
  let url: URL
  try {
    url = new URL(rawURL)
  } catch {
    return null
  }
  return url.protocol === 'https:' &&
    (!url.port || url.port === '443') &&
    !url.username &&
    !url.password &&
    !url.hash &&
    url.hostname
    ? url
    : null
}

function rememberCapability(
  capabilities: Map<string, AliyunDriveCapabilityKind>,
  rawURL: string,
  kind: AliyunDriveCapabilityKind
): void {
  const url = safeCapabilityURL(rawURL)
  if (!url) return
  const key = url.toString()
  rememberBoundedStorageCapability(capabilities, key, kind, MAX_CAPABILITIES)
}

function rememberPartCapabilities(
  value: unknown,
  capabilities: Map<string, AliyunDriveCapabilityKind>
): void {
  if (!Array.isArray(value) || value.length > 10_000) return
  for (const part of value) {
    if (typeof part !== 'object' || part === null || Array.isArray(part)) continue
    const uploadURL = Reflect.get(part, 'upload_url')
    if (typeof uploadURL === 'string') rememberCapability(capabilities, uploadURL, 'upload')
  }
}

function rememberAPICapabilities(
  requestURL: URL,
  response: AliyunDriveNativeTransferResponse,
  capabilities: Map<string, AliyunDriveCapabilityKind>
): void {
  if (response.status < 200 || response.status >= 300 || response.body.length === 0) return
  const contentType = storageNativeResponseHeader(response, 'content-type')
    ?.split(';', 1)[0]
    ?.trim()
  if (contentType?.toLowerCase() !== 'application/json') return
  const value = parseStorageJSONBody(response.body)
  if (!value) return
  if (requestURL.pathname === '/adrive/v1.0/openFile/getDownloadUrl') {
    const downloadURL = Reflect.get(value, 'url')
    if (typeof downloadURL === 'string') rememberCapability(capabilities, downloadURL, 'download')
    return
  }
  if (
    requestURL.pathname === '/adrive/v1.0/openFile/create' ||
    requestURL.pathname === '/adrive/v1.0/openFile/getUploadUrl'
  ) {
    rememberPartCapabilities(Reflect.get(value, 'part_info_list'), capabilities)
  }
}

function transferKind(
  url: URL,
  capabilities: ReadonlyMap<string, AliyunDriveCapabilityKind>
): AliyunDriveTransferKind {
  if (
    url.protocol !== 'https:' ||
    (url.port && url.port !== '443') ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw transportError('Aliyun Drive native transfer URL is invalid')
  }
  if (url.origin === ALIYUN_DRIVE_OPENAPI_ORIGIN && url.pathname.startsWith('/adrive/v1.0/')) {
    return 'api'
  }
  const capability = capabilities.get(url.toString())
  if (capability) return capability
  throw transportError('Aliyun Drive signed URL was not registered by the API')
}

async function boundedRequestBody(
  request: Request,
  maxBytes: number
): Promise<number[] | undefined> {
  return boundedStorageRequestBody(request, maxBytes, () =>
    transportError('Aliyun Drive request body is too large')
  )
}

function validatedHeaders(headers: AliyunDriveTransferHeader[]): Headers {
  if (headers.length > MAX_HEADERS) throw responseError('Aliyun Drive returned too many headers')
  const output = new Headers()
  for (const { name, value } of headers) {
    if (
      typeof name !== 'string' ||
      typeof value !== 'string' ||
      name.length === 0 ||
      name.length > MAX_HEADER_NAME_LENGTH ||
      value.length > MAX_HEADER_VALUE_LENGTH ||
      /[\r\n]/.test(name) ||
      /[\r\n]/.test(value)
    ) {
      throw responseError('Aliyun Drive returned invalid response headers')
    }
    try {
      output.append(name, value)
    } catch (error) {
      throw new AliyunDriveNativeError('invalid-response', { cause: error })
    }
  }
  return output
}

function nativeResponse(
  response: AliyunDriveNativeTransferResponse,
  maxResponseBytes: number
): Response {
  return storageNativeResponse(
    response,
    () => responseError('Aliyun Drive returned an invalid native response'),
    maxResponseBytes,
    validatedHeaders
  )
}

type AliyunDriveMethod = AliyunDriveNativeTransferRequest['method']

function parsedTransportRequest(
  input: string,
  init: RequestInit,
  capabilities: ReadonlyMap<string, AliyunDriveCapabilityKind>
): {
  request: Request
  url: URL
  method: AliyunDriveMethod
  kind: AliyunDriveTransferKind
} {
  const request = new Request(input, init)
  request.signal.throwIfAborted()
  if (request.redirect !== 'error') {
    throw transportError('Aliyun Drive native transport requires redirect rejection')
  }
  const method = request.method.toUpperCase()
  if (!['GET', 'POST', 'PUT'].includes(method)) {
    throw transportError('Aliyun Drive native transport method is invalid')
  }
  const url = new URL(request.url)
  const kind = transferKind(url, capabilities)
  if (kind === 'api') {
    if (method !== 'POST' || !request.headers.get('authorization')?.startsWith('Bearer ')) {
      throw transportError('Aliyun Drive API request is invalid')
    }
  } else {
    if (request.headers.has('authorization')) {
      throw transportError('Aliyun Drive signed URL request must not contain authorization')
    }
    if ((kind === 'upload' && method !== 'PUT') || (kind === 'download' && method !== 'GET')) {
      throw transportError('Aliyun Drive signed URL method is invalid')
    }
  }
  return { request, url, method: method as AliyunDriveMethod, kind }
}

export function createAliyunDriveTauriTransport(
  options: CreateAliyunDriveTauriTransportOptions = {}
): (input: string, init?: RequestInit) => Promise<Response> {
  const transfer = options.transfer ?? aliyunDriveNativeTransfer
  const maxDownloadBytes = boundedPositiveInteger(
    options.maxDownloadBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES,
    1,
    MAX_DOWNLOAD_BYTES
  )
  const capabilities = new Map<string, AliyunDriveCapabilityKind>()

  return async (input, init = {}) => {
    const { request, url, method, kind } = parsedTransportRequest(input, init, capabilities)
    const maxRequestBytes =
      kind === 'upload' ? ALIYUN_DRIVE_NATIVE_MAX_TRANSFER_CHUNK_BYTES : MAX_METADATA_BODY_BYTES
    const maxResponseBytes = kind === 'download' ? maxDownloadBytes : MAX_METADATA_RESPONSE_BYTES
    const body = await boundedRequestBody(request, maxRequestBytes)
    const response = await transfer(
      {
        kind,
        url: url.toString(),
        method,
        headers: storageNativeHeaders(request.headers),
        ...(body ? { body } : {}),
        maxResponseBytes,
        timeoutMs: TRANSFER_TIMEOUT_MS
      },
      request.signal
    )
    const rendered = nativeResponse(response, maxResponseBytes)
    if (kind === 'api') rememberAPICapabilities(url, response, capabilities)
    return rendered
  }
}

export const aliyunDriveTauriTransport = createAliyunDriveTauriTransport()
