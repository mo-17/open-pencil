import type { FetchFunction } from '@/app/http/types'

export interface ProxyHttpHeader {
  name: string
  value: string
}

// Compatibility alias for storage adapters that predate the generic proxy naming.
export type TauriHttpHeader = ProxyHttpHeader

export interface ProxyHttpRequest {
  url: string
  method?: string
  headers?: ProxyHttpHeader[]
  body?: number[]
  max_response_bytes?: number
  max_error_response_bytes?: number
  follow_redirects?: boolean
  timeout_ms?: number
}

export interface ProxyHttpResponse {
  status: number
  headers: ProxyHttpHeader[]
  body: number[]
  url: string
}

function headersToProxyHeaders(headers: Headers): ProxyHttpHeader[] {
  return [...headers.entries()].map(([name, value]) => ({ name, value }))
}

export function tauriResponseBody(status: number, body: number[]): Uint8Array<ArrayBuffer> | null {
  if (status === 204 || status === 205 || status === 304) return null
  const bytes = new Uint8Array(body.length)
  bytes.set(body)
  return bytes
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted', 'AbortError')
}

function desktopHttpError(error: unknown): Error {
  return error instanceof Error ? error : new Error('Desktop HTTP request failed', { cause: error })
}

export function withAbortSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  mapError: (error: unknown) => Error = desktopHttpError
): Promise<T> {
  if (signal.aborted) {
    void promise.catch(() => undefined)
    return Promise.reject(abortReason(signal))
  }

  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      cleanup()
      reject(abortReason(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    void (async () => {
      try {
        const value = await promise
        cleanup()
        resolve(value)
      } catch (error) {
        cleanup()
        reject(mapError(error))
      }
    })()
  })
}

export interface TauriFetchOptions {
  timeoutMs?: number
  maxResponseBytes?: number
  nativeFetch?: FetchFunction
}

const nativeFetch: typeof fetch = globalThis.fetch.bind(globalThis)

export function createTauriFetch(options: TauriFetchOptions = {}): FetchFunction {
  return (input, init) =>
    executeTauriFetch(
      options.nativeFetch ?? nativeFetch,
      input,
      init,
      options.maxResponseBytes,
      options.timeoutMs
    )
}

export async function tauriFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  maxResponseBytes?: number,
  timeoutMs?: number,
  onDispatch?: () => void,
  maxErrorResponseBytes?: number
): Promise<Response> {
  return executeTauriFetch(
    nativeFetch,
    input,
    init,
    maxResponseBytes,
    timeoutMs,
    onDispatch,
    maxErrorResponseBytes
  )
}

async function executeTauriFetch(
  fetcher: FetchFunction,
  input: RequestInfo | URL,
  init?: RequestInit,
  maxResponseBytes?: number,
  timeoutMs?: number,
  onDispatch?: () => void,
  maxErrorResponseBytes?: number
): Promise<Response> {
  const parsedURL = new URL(input instanceof Request ? input.url : input.toString())
  const isIpcURL =
    parsedURL.protocol === 'ipc:' ||
    ((parsedURL.protocol === 'http:' || parsedURL.protocol === 'https:') &&
      parsedURL.hostname === 'ipc.localhost')
  if (isIpcURL) {
    return fetcher(input, init)
  }

  const request = new Request(input, init)
  request.signal.throwIfAborted()
  const { invoke } = await import('@tauri-apps/api/core')
  request.signal.throwIfAborted()

  // Capture generated multipart headers before consuming the Request body.
  const headers = headersToProxyHeaders(request.headers)
  let bodyData: Uint8Array | undefined
  if (request.body != null) {
    const buffer = await request.arrayBuffer()
    request.signal.throwIfAborted()
    bodyData = new Uint8Array(buffer)
  }

  const payload: ProxyHttpRequest = {
    url: request.url,
    method: request.method,
    headers,
    body: bodyData ? Array.from(bodyData) : undefined,
    max_response_bytes: maxResponseBytes,
    max_error_response_bytes: maxErrorResponseBytes,
    follow_redirects: request.redirect === 'follow',
    timeout_ms: timeoutMs
  }
  request.signal.throwIfAborted()
  // Tauri invoke cannot cancel the native command once dispatched. Callers use this exact
  // boundary to avoid claiming that a dispatched mutation was cancelled remotely.
  onDispatch?.()
  const response = await withAbortSignal(
    invoke<ProxyHttpResponse>('proxy_http_request', { request: payload }),
    request.signal
  )
  const proxiedResponse = new Response(tauriResponseBody(response.status, response.body), {
    status: response.status,
    headers: response.headers.map(({ name, value }): [string, string] => [name, value])
  })
  Object.defineProperty(proxiedResponse, 'url', { value: response.url })
  return proxiedResponse
}
