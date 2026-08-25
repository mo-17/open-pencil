/* oxlint-disable eslint/max-lines -- OAuth cancellation and the bounded native capability transport share one bridge. */

import { invoke } from '@tauri-apps/api/core'

import { randomHex } from '@open-pencil/core/random'

import { ALIYUN_DRIVE_OPENAPI_ORIGIN } from '@/app/integrations/storage/aliyun-drive/config'

import { withAbortSignal, type TauriHttpHeader } from './http'
import {
  AliyunDriveNativeError,
  nativeAliyunDriveError
} from './aliyun-drive-oauth-error'

export {
  AliyunDriveNativeError,
  type AliyunDriveNativeErrorCode
} from './aliyun-drive-oauth-error'

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

export type AliyunDriveInvoke = <T>(
  command: string,
  args?: Record<string, unknown>
) => Promise<T>

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

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted', 'AbortError')
}

async function cancelOAuthOperation(
  invokeCommand: AliyunDriveInvoke,
  operationId: string
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (await invokeCommand<boolean>('aliyun_drive_oauth_cancel', { operationId })) return
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
  invokeCommand: AliyunDriveInvoke,
  command: string,
  args: Record<string, unknown>,
  signal?: AbortSignal
): Promise<T> {
  signal?.throwIfAborted()
  let pending: Promise<T>
  try {
    pending = invokeCommand<T>(command, args)
  } catch (error) {
    throw nativeAliyunDriveError(error)
  }
  if (!signal) {
    try {
      return await pending
    } catch (error) {
      throw nativeAliyunDriveError(error)
    }
  }
  return withAbortSignal(pending, signal, nativeAliyunDriveError)
}

async function invokeCancellableOAuth<T>(
  invokeCommand: AliyunDriveInvoke,
  command: 'aliyun_drive_oauth_authorize' | 'aliyun_drive_oauth_refresh',
  request: object,
  signal?: AbortSignal
): Promise<T> {
  signal?.throwIfAborted()
  const operationId = randomHex(16)
  let pending: Promise<T>
  try {
    pending = invokeCommand<T>(command, {
      request: { ...request, operationId }
    })
  } catch (error) {
    throw nativeAliyunDriveError(error)
  }
  if (!signal) {
    try {
      return await pending
    } catch (error) {
      throw nativeAliyunDriveError(error)
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
        reject(nativeAliyunDriveError(error))
        return undefined
      }
    )
  })
}

export function createAliyunDriveNativeBridge(
  invokeCommand: AliyunDriveInvoke = DEFAULT_INVOKE
): AliyunDriveNativeBridge {
  return Object.freeze({
    authorize(request: AliyunDriveNativeAuthorizeRequest, signal?: AbortSignal) {
      return invokeCancellableOAuth<AliyunDriveNativeAuthorizeResult>(
        invokeCommand,
        'aliyun_drive_oauth_authorize',
        request,
        signal
      )
    },
    refresh(request: AliyunDriveNativeRefreshRequest, signal?: AbortSignal) {
      return invokeCancellableOAuth<AliyunDriveNativeRefreshResult>(
        invokeCommand,
        'aliyun_drive_oauth_refresh',
        request,
        signal
      )
    }
  })
}

export const aliyunDriveNativeBridge = createAliyunDriveNativeBridge()

export function createAliyunDriveNativeTransfer(
  invokeCommand: AliyunDriveInvoke = DEFAULT_INVOKE
): AliyunDriveNativeTransferInvoker {
  return (request, signal) =>
    invokeWithAbort<AliyunDriveNativeTransferResponse>(
      invokeCommand,
      'aliyun_drive_transfer',
      { request },
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

function boundedPositiveInteger(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw transportError('Aliyun Drive native transfer limit is invalid')
  }
  return value
}

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
  if (capabilities.size >= MAX_CAPABILITIES && !capabilities.has(key)) {
    const oldest = capabilities.keys().next().value
    if (typeof oldest === 'string') capabilities.delete(oldest)
  }
  capabilities.set(key, kind)
}

function responseHeader(
  response: AliyunDriveNativeTransferResponse,
  expectedName: string
): string | null {
  return (
    response.headers.find(({ name }) => name.toLowerCase() === expectedName.toLowerCase())?.value ??
    null
  )
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
  const contentType = responseHeader(response, 'content-type')?.split(';', 1)[0]?.trim()
  if (contentType?.toLowerCase() !== 'application/json') return
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(new Uint8Array(response.body))) as unknown
  } catch {
    return
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return
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
  if (
    url.origin === ALIYUN_DRIVE_OPENAPI_ORIGIN &&
    url.pathname.startsWith('/adrive/v1.0/')
  ) {
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
  if (!request.body) return undefined
  const declaredLength = request.headers.get('content-length')
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxBytes)
  ) {
    throw transportError('Aliyun Drive request body is too large')
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
        throw transportError('Aliyun Drive request body is too large')
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

function nativeHeaders(headers: Headers): AliyunDriveTransferHeader[] {
  return [...headers.entries()].map(([name, value]) => ({ name, value }))
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
  if (
    !Number.isSafeInteger(response.status) ||
    response.status < 200 ||
    response.status > 599 ||
    response.body.length > maxResponseBytes ||
    response.body.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 255)
  ) {
    throw responseError('Aliyun Drive returned an invalid native response')
  }
  const body = [204, 205, 304].includes(response.status) ? null : new Uint8Array(response.body)
  return new Response(body, {
    status: response.status,
    headers: validatedHeaders(response.headers)
  })
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
        headers: nativeHeaders(request.headers),
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
