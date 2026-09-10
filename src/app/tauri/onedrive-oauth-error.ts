import {
  storageNativeErrorDetails,
  validStorageRetryAfterMs,
  type StorageNativeErrorOptions
} from './storage-native-common'

export const ONEDRIVE_NATIVE_ERROR_CODES = [
  'invalid-request',
  'unsupported',
  'cancelled',
  'timeout',
  'browser-open-failed',
  'oauth-denied',
  'oauth-failed',
  'oauth-client-invalid',
  'authorization-grant-invalid',
  'redirect-uri-mismatch',
  'token-request-invalid',
  'token-exchange-failed',
  'token-response-invalid',
  'userinfo-failed',
  'scope-mismatch',
  'subject-mismatch',
  'network-failed',
  'response-too-large',
  'rate-limited'
] as const

export type OneDriveNativeErrorCode = (typeof ONEDRIVE_NATIVE_ERROR_CODES)[number]

const ERROR_CODES = new Set<string>(ONEDRIVE_NATIVE_ERROR_CODES)

const SAFE_MESSAGES: Readonly<Record<OneDriveNativeErrorCode, string>> = Object.freeze({
  'invalid-request': 'OneDrive request is invalid',
  unsupported: 'OneDrive is unavailable in this desktop build',
  cancelled: 'Microsoft authorization was cancelled',
  timeout: 'OneDrive operation timed out',
  'browser-open-failed': 'The system browser could not be opened',
  'oauth-denied': 'Microsoft authorization was denied',
  'oauth-failed': 'Microsoft authorization failed',
  'oauth-client-invalid': 'Microsoft OAuth client is invalid',
  'authorization-grant-invalid': 'Microsoft authorization grant is invalid or expired',
  'redirect-uri-mismatch': 'Microsoft rejected the local authorization callback',
  'token-request-invalid': 'Microsoft token request is invalid',
  'token-exchange-failed': 'Microsoft token exchange failed',
  'token-response-invalid': 'Microsoft returned an invalid token response',
  'userinfo-failed': 'Microsoft account information could not be verified',
  'scope-mismatch': 'Microsoft did not grant the required OneDrive scopes',
  'subject-mismatch': 'OneDrive authorization belongs to a different account',
  'network-failed': 'OneDrive network request failed',
  'response-too-large': 'OneDrive response exceeded the byte limit',
  'rate-limited': 'Microsoft temporarily rate limited OneDrive'
})

type OneDriveNativeErrorOptions = StorageNativeErrorOptions

export class OneDriveNativeError extends Error {
  readonly retryAfterMs: number | undefined

  constructor(
    readonly code: OneDriveNativeErrorCode,
    options?: OneDriveNativeErrorOptions
  ) {
    super(SAFE_MESSAGES[code], options)
    this.name = 'OneDriveNativeError'
    const retryAfterMs = options?.retryAfterMs
    this.retryAfterMs = validStorageRetryAfterMs(retryAfterMs) ? retryAfterMs : undefined
  }
}

/**
 * Converts the Tauri error envelope without exposing provider response text to the renderer.
 * Rust returns static messages too, but this second boundary also covers malformed bridge values.
 */
export function nativeOneDriveError(error: unknown): OneDriveNativeError {
  if (error instanceof OneDriveNativeError) return error
  const [code, retryAfterMs] = storageNativeErrorDetails<OneDriveNativeErrorCode>(
    error,
    ERROR_CODES,
    'oauth-failed',
    'rate-limited'
  )
  return new OneDriveNativeError(code, retryAfterMs === undefined ? undefined : { retryAfterMs })
}
