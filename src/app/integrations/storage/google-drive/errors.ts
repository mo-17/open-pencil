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

export type GoogleDriveErrorOptions = HttpStorageProviderErrorOptions

export class GoogleDriveError extends HttpStorageProviderError<GoogleDriveErrorCode> {
  constructor(code: GoogleDriveErrorCode, message: string, options: GoogleDriveErrorOptions = {}) {
    super(code, message, options)
    this.name = 'GoogleDriveError'
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

export function throwIfAborted(signal?: AbortSignal): void {
  throwIfStorageProviderAborted(
    signal,
    () => new GoogleDriveError('aborted', 'Google Drive operation was cancelled')
  )
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  return parseStandardRetryAfter(value, now)
}

export function errorCodeForStatus(status: number): GoogleDriveErrorCode {
  return storageErrorCodeForStatus(status, false)
}

export function isRetryableStatus(status: number): boolean {
  return isRetryableStorageStatus(status, 'bounded-server-errors')
}
import {
  HttpStorageProviderError,
  type HttpStorageProviderErrorOptions,
  isRetryableStorageStatus,
  parseStandardRetryAfter,
  storageErrorCodeForStatus,
  throwIfStorageProviderAborted
} from '../shared/errors'
