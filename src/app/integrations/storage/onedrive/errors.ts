export type OneDriveErrorCode =
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
  | 'quota'
  | 'rate-limited'
  | 'resource-limit'
  | 'server'
  | 'upload-session-expired'

export type OneDriveErrorOptions = Readonly<{
  status?: number
  reason?: string | null
  retryable?: boolean
  retryAfterMs?: number | null
  cause?: unknown
}>

export class OneDriveError extends Error {
  readonly status: number | null
  readonly reason: string | null
  readonly retryable: boolean
  readonly retryAfterMs: number | null

  constructor(
    readonly code: OneDriveErrorCode,
    message: string,
    options: OneDriveErrorOptions = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'OneDriveError'
    this.status = options.status ?? null
    this.reason = options.reason ?? null
    this.retryable = options.retryable ?? false
    this.retryAfterMs = options.retryAfterMs ?? null
  }
}

export function throwIfOneDriveAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw new OneDriveError('aborted', 'OneDrive operation was cancelled', {
    cause: signal.reason
  })
}

export function isOneDriveAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError') ||
    (error instanceof OneDriveError && error.code === 'aborted')
  )
}

const MAX_RETRY_AFTER_MS = 60_000

export function parseOneDriveRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.round(seconds * 1_000), MAX_RETRY_AFTER_MS)
  }
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return null
  return Math.min(Math.max(0, timestamp - now), MAX_RETRY_AFTER_MS)
}

export function oneDriveErrorCodeForStatus(status: number): OneDriveErrorCode {
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

export function isRetryableOneDriveStatus(status: number): boolean {
  return status === 408 || status === 423 || status === 429 || status >= 500
}
