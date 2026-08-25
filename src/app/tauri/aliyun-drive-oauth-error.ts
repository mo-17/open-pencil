export const ALIYUN_DRIVE_NATIVE_ERROR_CODES = [
  'invalid-request',
  'invalid-response',
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
  'rate-limited',
  'broker-unavailable'
] as const

export type AliyunDriveNativeErrorCode = (typeof ALIYUN_DRIVE_NATIVE_ERROR_CODES)[number]

const ERROR_CODES = new Set<string>(ALIYUN_DRIVE_NATIVE_ERROR_CODES)

const SAFE_MESSAGES: Readonly<Record<AliyunDriveNativeErrorCode, string>> = Object.freeze({
  'invalid-request': 'Aliyun Drive request is invalid',
  'invalid-response': 'Aliyun Drive returned an invalid response',
  unsupported: 'Aliyun Drive is unavailable in this desktop build',
  cancelled: 'Aliyun Drive authorization was cancelled',
  timeout: 'Aliyun Drive operation timed out',
  'browser-open-failed': 'The system browser could not be opened',
  'oauth-denied': 'Aliyun Drive authorization was denied',
  'oauth-failed': 'Aliyun Drive authorization failed',
  'oauth-client-invalid': 'Aliyun Drive OAuth client is invalid',
  'authorization-grant-invalid': 'Aliyun Drive authorization grant is invalid or expired',
  'redirect-uri-mismatch': 'Aliyun Drive rejected the authorization callback',
  'token-request-invalid': 'Aliyun Drive token request is invalid',
  'token-exchange-failed': 'Aliyun Drive token exchange failed',
  'token-response-invalid': 'Aliyun Drive returned an invalid token response',
  'userinfo-failed': 'Aliyun Drive account information could not be verified',
  'scope-mismatch': 'Aliyun Drive did not grant the required scopes',
  'subject-mismatch': 'Aliyun Drive authorization belongs to a different account',
  'network-failed': 'Aliyun Drive network request failed',
  'response-too-large': 'Aliyun Drive response exceeded the byte limit',
  'rate-limited': 'Aliyun Drive temporarily rate limited requests',
  'broker-unavailable': 'The Aliyun Drive OAuth Broker is temporarily unavailable'
})

type AliyunDriveNativeErrorOptions = ErrorOptions & {
  retryAfterMs?: number
}

function validRetryAfterMs(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 300_000
}

function ownValue(value: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value
}

function errorCode(value: unknown): AliyunDriveNativeErrorCode {
  if (typeof value !== 'object' || value === null) return 'oauth-failed'
  const code = ownValue(value, 'code')
  return typeof code === 'string' && ERROR_CODES.has(code)
    ? (code as AliyunDriveNativeErrorCode)
    : 'oauth-failed'
}

export class AliyunDriveNativeError extends Error {
  readonly retryAfterMs: number | undefined

  constructor(
    readonly code: AliyunDriveNativeErrorCode,
    options?: AliyunDriveNativeErrorOptions
  ) {
    super(SAFE_MESSAGES[code], options)
    this.name = 'AliyunDriveNativeError'
    const retryAfterMs = options?.retryAfterMs
    this.retryAfterMs = validRetryAfterMs(retryAfterMs) ? retryAfterMs : undefined
  }
}

/**
 * Converts a Tauri error envelope without exposing provider-controlled text to the renderer.
 * The Rust boundary must also emit static messages; this still fails closed for malformed values.
 */
export function nativeAliyunDriveError(error: unknown): AliyunDriveNativeError {
  if (error instanceof AliyunDriveNativeError) return error
  const code = errorCode(error)
  const retryAfterMs =
    code === 'rate-limited' && typeof error === 'object' && error !== null
      ? ownValue(error, 'retryAfterMs')
      : undefined
  return new AliyunDriveNativeError(
    code,
    validRetryAfterMs(retryAfterMs) ? { retryAfterMs } : undefined
  )
}
