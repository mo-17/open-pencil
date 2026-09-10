export type StorageProviderErrorOptions = Readonly<{
  status?: number
  retryable?: boolean
  cause?: unknown
}>

export type HttpStorageProviderErrorOptions = StorageProviderErrorOptions &
  Readonly<{
    reason?: string | null
    retryAfterMs?: number | null
  }>

export abstract class StorageProviderError<Code extends string> extends Error {
  readonly status: number | null
  readonly retryable: boolean

  protected constructor(
    readonly code: Code,
    message: string,
    options: StorageProviderErrorOptions = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'StorageProviderError'
    this.status = options.status ?? null
    this.retryable = options.retryable ?? false
  }
}

export abstract class HttpStorageProviderError<
  Code extends string
> extends StorageProviderError<Code> {
  readonly reason: string | null
  readonly retryAfterMs: number | null

  protected constructor(
    code: Code,
    message: string,
    options: HttpStorageProviderErrorOptions = {}
  ) {
    super(code, message, options)
    this.name = 'HttpStorageProviderError'
    this.reason = options.reason ?? null
    this.retryAfterMs = options.retryAfterMs ?? null
  }
}

export function isNativeAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

export function isStorageProviderAbortError(
  error: unknown,
  isExpectedProviderError: boolean
): boolean {
  return (
    isNativeAbortError(error) ||
    (isExpectedProviderError && error instanceof StorageProviderError && error.code === 'aborted')
  )
}

export function throwIfStorageProviderAborted(
  signal: AbortSignal | undefined,
  createError: (reason: unknown) => Error
): void {
  if (signal?.aborted) throw createError(signal.reason)
}

const MAX_RETRY_AFTER_MS = 60_000

export function parseNumericRetryAfter(value: string | null, multiplier: number): number | null {
  if (!value) return null
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0) return null
  return Math.min(Math.round(amount * multiplier), MAX_RETRY_AFTER_MS)
}

export function parseStandardRetryAfter(value: string | null, now = Date.now()): number | null {
  const numericDelay = parseNumericRetryAfter(value, 1_000)
  if (numericDelay !== null) return numericDelay
  if (!value) return null
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return null
  return Math.min(Math.max(0, timestamp - now), MAX_RETRY_AFTER_MS)
}

export type StorageHttpErrorCode =
  | 'auth'
  | 'conflict'
  | 'invalid-response'
  | 'not-found'
  | 'permission'
  | 'precondition'
  | 'quota'
  | 'rate-limited'
  | 'server'

type StorageHttpErrorCodeWithoutQuota = Exclude<StorageHttpErrorCode, 'quota'>

export function storageErrorCodeForStatus(status: number): StorageHttpErrorCodeWithoutQuota
export function storageErrorCodeForStatus(
  status: number,
  includeQuota: false
): StorageHttpErrorCodeWithoutQuota
export function storageErrorCodeForStatus(status: number, includeQuota: true): StorageHttpErrorCode
export function storageErrorCodeForStatus(
  status: number,
  includeQuota = false
): StorageHttpErrorCode {
  if (status === 401) return 'auth'
  if (status === 403) return 'permission'
  if (status === 404) return 'not-found'
  if (status === 409) return 'conflict'
  if (status === 412) return 'precondition'
  if (status === 429) return 'rate-limited'
  if (includeQuota && status === 507) return 'quota'
  if (status >= 500) return 'server'
  return 'invalid-response'
}

export function isRetryableStorageStatus(
  status: number,
  policy: 'bounded-server-errors' | 'all-server-errors'
): boolean {
  if (policy === 'bounded-server-errors') {
    return status === 429 || status === 500 || status === 502 || status === 503 || status === 504
  }
  return status === 408 || status === 423 || status === 429 || status >= 500
}
