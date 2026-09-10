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

export type AliyunDriveErrorOptions = HttpStorageProviderErrorOptions

export class AliyunDriveError extends HttpStorageProviderError<AliyunDriveErrorCode> {
  constructor(code: AliyunDriveErrorCode, message: string, options: AliyunDriveErrorOptions = {}) {
    super(code, message, options)
    this.name = 'AliyunDriveError'
  }
}

export function throwIfAliyunDriveAborted(signal?: AbortSignal): void {
  throwIfStorageProviderAborted(
    signal,
    (cause) => new AliyunDriveError('aborted', 'Aliyun Drive operation was cancelled', { cause })
  )
}

export function isAliyunDriveAbortError(error: unknown): boolean {
  return isStorageProviderAbortError(error, error instanceof AliyunDriveError)
}

/** Aliyun uses `x-retry-after` milliseconds; standard Retry-After is seconds/date. */
export function parseAliyunDriveRetryAfter(
  retryAfter: string | null,
  aliRetryAfter: string | null,
  now = Date.now()
): number | null {
  return parseNumericRetryAfter(aliRetryAfter, 1) ?? parseStandardRetryAfter(retryAfter, now)
}

export function aliyunDriveErrorCodeForStatus(status: number): AliyunDriveErrorCode {
  return storageErrorCodeForStatus(status, true)
}

export function isRetryableAliyunDriveStatus(status: number): boolean {
  return isRetryableStorageStatus(status, 'all-server-errors')
}
import {
  HttpStorageProviderError,
  type HttpStorageProviderErrorOptions,
  isRetryableStorageStatus,
  isStorageProviderAbortError,
  parseNumericRetryAfter,
  parseStandardRetryAfter,
  storageErrorCodeForStatus,
  throwIfStorageProviderAborted
} from '../shared/errors'
