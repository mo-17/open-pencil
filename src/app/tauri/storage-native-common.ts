import { randomHex } from '@open-pencil/core/random'

import type { ParsedContentRange } from './content-range'
import { tauriResponseBody, withAbortSignal, type TauriHttpHeader } from './http'

export type StorageNativeInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

export type StorageNativeErrorOptions = ErrorOptions & {
  retryAfterMs?: number
}

export interface StorageJSONObject {
  [key: string]: unknown
}

export type StorageContentRangeParser = (
  value: string | null,
  expectedStart: number,
  bodyLength: number,
  expectedTotal: number | null,
  maxDownloadBytes: number
) => ParsedContentRange

export type LinkedStorageAbortController = {
  controller: AbortController
  cleanup: () => void
}

type NativeTransferResponse = {
  status: number
  headers: TauriHttpHeader[]
  body: number[]
}

type CancellableOAuthOptions<T> = {
  invokeCommand: StorageNativeInvoke
  command: string
  cancelCommand: string
  request: object
  mapError: (error: unknown) => Error
  signal?: AbortSignal
  onLateResult?: (result: T) => Promise<void> | void
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted', 'AbortError')
}

function throwIfStorageAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortReason(signal)
}

async function cancelOAuthOperation(
  invokeCommand: StorageNativeInvoke,
  cancelCommand: string,
  operationId: string
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (await invokeCommand<boolean>(cancelCommand, { operationId })) return
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

export async function invokeStorageNative<T>(
  invokeCommand: StorageNativeInvoke,
  command: string,
  args: Record<string, unknown>,
  mapError: (error: unknown) => Error,
  signal?: AbortSignal
): Promise<T> {
  signal?.throwIfAborted()
  let pending: Promise<T>
  try {
    pending = invokeCommand<T>(command, args)
  } catch (error) {
    throw mapError(error)
  }
  if (!signal) {
    try {
      return await pending
    } catch (error) {
      throw mapError(error)
    }
  }
  return withAbortSignal(pending, signal, mapError)
}

export async function invokeCancellableStorageOAuth<T>(
  options: CancellableOAuthOptions<T>
): Promise<T> {
  const { invokeCommand, command, cancelCommand, request, mapError, signal, onLateResult } = options
  signal?.throwIfAborted()
  const operationId = randomHex(16)
  let pending: Promise<T>
  try {
    pending = invokeCommand<T>(command, { request: { ...request, operationId } })
  } catch (error) {
    throw mapError(error)
  }
  if (!signal) {
    try {
      return await pending
    } catch (error) {
      throw mapError(error)
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
      void cancelOAuthOperation(invokeCommand, cancelCommand, operationId)
      void pending.then(async (value) => onLateResult?.(value)).catch(() => undefined)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
      return
    }
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
        reject(mapError(error))
        return undefined
      }
    )
  })
}

export async function boundedStorageRequestBody(
  request: Request,
  maxBytes: number,
  tooLarge: () => Error
): Promise<number[] | undefined> {
  if (!request.body) return undefined
  const declaredLength = request.headers.get('content-length')
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxBytes)
  ) {
    throw tooLarge()
  }

  const chunks: Uint8Array[] = []
  const reader = request.body.getReader()
  const { signal } = request
  let total = 0
  let complete = false
  const cancelForAbort = () => {
    void reader.cancel(abortReason(signal)).catch(() => undefined)
  }
  signal.addEventListener('abort', cancelForAbort, { once: true })
  try {
    if (signal.aborted) {
      cancelForAbort()
      throw abortReason(signal)
    }
    let next = await reader.read()
    while (!next.done) {
      throwIfStorageAborted(signal)
      total += next.value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw tooLarge()
      }
      chunks.push(next.value)
      next = await reader.read()
    }
    throwIfStorageAborted(signal)
    complete = true
  } catch (error) {
    if (!complete) void reader.cancel(error).catch(() => undefined)
    throw error
  } finally {
    signal.removeEventListener('abort', cancelForAbort)
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

export function createBoundedStorageInteger(
  invalidValue: () => Error
): (value: number, minimum: number, maximum: number) => number {
  return (value, minimum, maximum) => {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw invalidValue()
    }
    return value
  }
}

export function storageNativeHeaders(headers: Headers): TauriHttpHeader[] {
  return [...headers.entries()].map(([name, value]) => ({ name, value }))
}

export function storageNativeTransferRequest<Kind extends string, Method extends string>(
  kind: Kind,
  url: URL,
  method: Method,
  headers: Headers,
  body: number[] | undefined,
  maxResponseBytes: number,
  timeoutMs: number
) {
  return {
    kind,
    url: url.toString(),
    method,
    headers: storageNativeHeaders(headers),
    ...(body ? { body } : {}),
    maxResponseBytes,
    timeoutMs
  }
}

export function storageNativeResponse(
  response: NativeTransferResponse,
  invalidResponse: () => Error,
  maxResponseBytes = Number.MAX_SAFE_INTEGER,
  responseHeaders: (headers: TauriHttpHeader[]) => HeadersInit = (headers) =>
    headers.map(({ name, value }): [string, string] => [name, value])
): Response {
  if (
    !Number.isSafeInteger(response.status) ||
    response.status < 200 ||
    response.status > 599 ||
    response.body.length > maxResponseBytes ||
    response.body.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 255)
  ) {
    throw invalidResponse()
  }
  return new Response(tauriResponseBody(response.status, response.body), {
    status: response.status,
    headers: responseHeaders(response.headers)
  })
}

export function storageNativeResponseHeader(
  response: Pick<NativeTransferResponse, 'headers'>,
  expectedName: string
): string | null {
  return (
    response.headers.find(({ name }) => name.toLowerCase() === expectedName.toLowerCase())?.value ??
    null
  )
}

export function parseStorageContentRange(
  value: string | null,
  expectedStart: number,
  bodyLength: number,
  expectedTotal: number | null,
  maxDownloadBytes: number,
  invalidRange: () => Error,
  inconsistentRange: () => Error
): ParsedContentRange {
  const match = value ? /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value.trim()) : null
  if (!match) throw invalidRange()
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
    throw inconsistentRange()
  }
  return { start, end, total }
}

export function createStorageContentRangeParser(
  invalidRange: () => Error,
  inconsistentRange: () => Error
): StorageContentRangeParser {
  return (value, expectedStart, bodyLength, expectedTotal, maxDownloadBytes) =>
    parseStorageContentRange(
      value,
      expectedStart,
      bodyLength,
      expectedTotal,
      maxDownloadBytes,
      invalidRange,
      inconsistentRange
    )
}

export function linkedStorageAbortController(signal: AbortSignal): LinkedStorageAbortController {
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  if (signal.aborted) abort()
  else signal.addEventListener('abort', abort, { once: true })
  return {
    controller,
    cleanup: () => signal.removeEventListener('abort', abort)
  }
}

export function storageRangedDownloadStream(
  firstBody: number[],
  initialOffset: number,
  totalBytes: number,
  linked: LinkedStorageAbortController,
  maximumRequestCount: number,
  requestLimitError: () => Error,
  loadNext: (offset: number) => Promise<{ body: number[]; nextOffset: number }>
): ReadableStream<Uint8Array> {
  let nextOffset = initialOffset
  let requestCount = 1
  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    linked.cleanup()
  }
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(firstBody))
      if (nextOffset === totalBytes) {
        finish()
        controller.close()
      }
    },
    async pull(controller) {
      if (finished) return
      try {
        linked.controller.signal.throwIfAborted()
        requestCount++
        if (requestCount > maximumRequestCount) throw requestLimitError()
        const next = await loadNext(nextOffset)
        nextOffset = next.nextOffset
        controller.enqueue(new Uint8Array(next.body))
        if (nextOffset === totalBytes) {
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
}

export function rememberBoundedStorageCapability<T>(
  capabilities: Map<string, T>,
  key: string,
  kind: T,
  maximum: number
): void {
  if (capabilities.size >= maximum && !capabilities.has(key)) {
    const oldest = capabilities.keys().next().value
    if (typeof oldest === 'string') capabilities.delete(oldest)
  }
  capabilities.set(key, kind)
}

function isStorageJSONObject(value: unknown): value is StorageJSONObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseStorageJSONBody(body: number[]): StorageJSONObject | null {
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(new Uint8Array(body))) as unknown
  } catch {
    return null
  }
  return isStorageJSONObject(value) ? value : null
}

export function parseStrongStorageEtag(value: string | null): string | null | undefined {
  if (value === null) return null
  if (value.length < 2 || value.length > 1_024 || value[0] !== '"' || value.at(-1) !== '"') {
    return undefined
  }
  for (let index = 1; index < value.length - 1; index++) {
    const code = value.charCodeAt(index)
    if (code !== 0x21 && (code < 0x23 || code > 0x7e)) return undefined
  }
  return value
}

export function validStorageRetryAfterMs(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 300_000
}

function ownValue(value: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value
}

export function storageNativeErrorDetails<Code extends string>(
  error: unknown,
  errorCodes: ReadonlySet<string>,
  fallbackCode: Code,
  rateLimitedCode: Code
): readonly [code: Code, retryAfterMs: number | undefined] {
  if (typeof error !== 'object' || error === null) return [fallbackCode, undefined]
  const rawCode = ownValue(error, 'code')
  const code =
    typeof rawCode === 'string' && errorCodes.has(rawCode) ? (rawCode as Code) : fallbackCode
  const retryAfterMs = code === rateLimitedCode ? ownValue(error, 'retryAfterMs') : undefined
  return [code, validStorageRetryAfterMs(retryAfterMs) ? retryAfterMs : undefined]
}
