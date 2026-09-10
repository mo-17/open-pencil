import { validStorageRetryAfterMs, type StorageNativeErrorOptions } from './storage-native-common'

export type GoogleDriveNativeErrorCode =
  | 'invalid-request'
  | 'unsupported'
  | 'cancelled'
  | 'timeout'
  | 'browser-open-failed'
  | 'oauth-denied'
  | 'oauth-failed'
  | 'oauth-client-invalid'
  | 'authorization-grant-invalid'
  | 'redirect-uri-mismatch'
  | 'token-request-invalid'
  | 'token-exchange-failed'
  | 'token-response-invalid'
  | 'oauth-broker-rate-limited'
  | 'oauth-broker-unavailable'
  | 'oauth-broker-misconfigured'
  | 'oauth-broker-protocol-invalid'
  | 'userinfo-failed'
  | 'scope-mismatch'
  | 'subject-mismatch'
  | 'network-failed'
  | 'response-too-large'

type NativeGoogleDriveErrorValue = {
  code?: GoogleDriveNativeErrorCode
  message?: string
  retryAfterMs?: unknown
}

type GoogleDriveNativeErrorOptions = StorageNativeErrorOptions

export class GoogleDriveNativeError extends Error {
  readonly retryAfterMs: number | undefined

  constructor(
    readonly code: GoogleDriveNativeErrorCode,
    message: string,
    options?: GoogleDriveNativeErrorOptions
  ) {
    super(message, options)
    this.name = 'GoogleDriveNativeError'
    const retryAfterMs = options?.retryAfterMs
    this.retryAfterMs = validStorageRetryAfterMs(retryAfterMs) ? retryAfterMs : undefined
  }
}

export function nativeGoogleDriveError(error: unknown): GoogleDriveNativeError {
  if (error instanceof GoogleDriveNativeError) return error
  const value =
    typeof error === 'object' && error !== null ? (error as NativeGoogleDriveErrorValue) : undefined
  const retryAfterMs = value?.retryAfterMs
  return new GoogleDriveNativeError(
    value?.code ?? 'oauth-failed',
    value?.message ?? 'Google Drive native operation failed',
    validStorageRetryAfterMs(retryAfterMs) ? { retryAfterMs } : undefined
  )
}
