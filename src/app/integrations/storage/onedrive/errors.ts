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

export type OneDriveErrorOptions = HttpStorageProviderErrorOptions

export class OneDriveError extends HttpStorageProviderError<OneDriveErrorCode> {
  constructor(code: OneDriveErrorCode, message: string, options: OneDriveErrorOptions = {}) {
    super(code, message, options)
    this.name = 'OneDriveError'
  }
}

export function throwIfOneDriveAborted(signal?: AbortSignal): void {
  throwIfStorageProviderAborted(
    signal,
    (cause) => new OneDriveError('aborted', 'OneDrive operation was cancelled', { cause })
  )
}

export function isOneDriveAbortError(error: unknown): boolean {
  return isStorageProviderAbortError(error, error instanceof OneDriveError)
}

export function parseOneDriveRetryAfter(value: string | null, now = Date.now()): number | null {
  return parseStandardRetryAfter(value, now)
}

export function oneDriveErrorCodeForStatus(status: number): OneDriveErrorCode {
  return storageErrorCodeForStatus(status, true)
}

export function isRetryableOneDriveStatus(status: number): boolean {
  return isRetryableStorageStatus(status, 'all-server-errors')
}
import {
  HttpStorageProviderError,
  type HttpStorageProviderErrorOptions,
  isRetryableStorageStatus,
  isStorageProviderAbortError,
  parseStandardRetryAfter,
  storageErrorCodeForStatus,
  throwIfStorageProviderAborted
} from '../shared/errors'
