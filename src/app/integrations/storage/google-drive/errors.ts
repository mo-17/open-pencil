export type GoogleDriveErrorCode =
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
  | 'rate-limited'
  | 'resource-limit'
  | 'server'
  | 'upload-session-expired'

export type GoogleDriveErrorOptions = {
  status?: number
  reason?: string | null
  retryable?: boolean
  retryAfterMs?: number | null
  cause?: unknown
}

export class GoogleDriveError extends Error {
  readonly code: GoogleDriveErrorCode
  readonly status: number | null
  readonly reason: string | null
  readonly retryable: boolean
  readonly retryAfterMs: number | null

  constructor(code: GoogleDriveErrorCode, message: string, options: GoogleDriveErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'GoogleDriveError'
    this.code = code
    this.status = options.status ?? null
    this.reason = options.reason ?? null
    this.retryable = options.retryable ?? false
    this.retryAfterMs = options.retryAfterMs ?? null
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw new GoogleDriveError('aborted', 'Google Drive operation was cancelled')
}

const MAX_RETRY_AFTER_MS = 60_000

export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.round(seconds * 1_000), MAX_RETRY_AFTER_MS)
  }
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return null
  return Math.min(Math.max(0, timestamp - now), MAX_RETRY_AFTER_MS)
}

export function errorCodeForStatus(status: number): GoogleDriveErrorCode {
  if (status === 401) return 'auth'
  if (status === 403) return 'permission'
  if (status === 404) return 'not-found'
  if (status === 409) return 'conflict'
  if (status === 412) return 'precondition'
  if (status === 429) return 'rate-limited'
  if (status >= 500) return 'server'
  return 'invalid-response'
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504
}
