export type AliyunDriveErrorCode =
  | 'aborted'
  | 'auth'
  | 'authorization-changed'
  | 'conflict'
  | 'foreign-file'
  | 'invalid-input'
  | 'invalid-response'
  | 'network'
  | 'not-found'
  | 'permission'
  | 'precondition'
  | 'preservation-failed'
  | 'quota'
  | 'rate-limited'
  | 'resource-limit'
  | 'server'
  | 'upload-url-expired'

export type AliyunDriveErrorOptions = Readonly<{
  status?: number
  reason?: string | null
  retryable?: boolean
  retryAfterMs?: number | null
  cause?: unknown
}>

export class AliyunDriveError extends Error {
  readonly status: number | null
  readonly reason: string | null
  readonly retryable: boolean
  readonly retryAfterMs: number | null

  constructor(
    readonly code: AliyunDriveErrorCode,
    message: string,
    options: AliyunDriveErrorOptions = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'AliyunDriveError'
    this.status = options.status ?? null
    this.reason = options.reason ?? null
    this.retryable = options.retryable ?? false
    this.retryAfterMs = options.retryAfterMs ?? null
  }
}

export function throwIfAliyunDriveAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw new AliyunDriveError('aborted', 'Aliyun Drive operation was cancelled', {
    cause: signal.reason
  })
}

export function isAliyunDriveAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError') ||
    (error instanceof AliyunDriveError && error.code === 'aborted')
  )
}

const MAX_RETRY_AFTER_MS = 60_000

/** Aliyun uses `x-retry-after` milliseconds; standard Retry-After is seconds/date. */
export function parseAliyunDriveRetryAfter(
  retryAfter: string | null,
  aliRetryAfter: string | null,
  now = Date.now()
): number | null {
  if (aliRetryAfter) {
    const milliseconds = Number(aliRetryAfter)
    if (Number.isFinite(milliseconds) && milliseconds >= 0) {
      return Math.min(Math.round(milliseconds), MAX_RETRY_AFTER_MS)
    }
  }
  if (!retryAfter) return null
  const seconds = Number(retryAfter)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.round(seconds * 1_000), MAX_RETRY_AFTER_MS)
  }
  const timestamp = Date.parse(retryAfter)
  if (!Number.isFinite(timestamp)) return null
  return Math.min(Math.max(0, timestamp - now), MAX_RETRY_AFTER_MS)
}

export function aliyunDriveErrorCodeForStatus(status: number): AliyunDriveErrorCode {
  if (status === 401) return 'auth'
  if (status === 403) return 'permission'
  if (status === 404) return 'not-found'
  if (status === 409) return 'conflict'
  if (status === 412) return 'precondition'
  if (status === 429) return 'rate-limited'
  if (status === 507) return 'quota'
  if (status >= 500) return 'server'
  return 'invalid-response'
}

export function isRetryableAliyunDriveStatus(status: number): boolean {
  return status === 408 || status === 423 || status === 429 || status >= 500
}
