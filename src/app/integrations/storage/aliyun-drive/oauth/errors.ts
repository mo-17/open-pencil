import type { AliyunDriveNativeErrorCode } from '@/app/tauri/aliyun-drive-oauth-error'

export type AliyunDriveOAuthErrorCode =
  | 'unsupported'
  | 'setup-required'
  | 'invalid-client'
  | 'cancelled'
  | 'busy'
  | 'credential-missing'
  | 'credential-invalid'
  | 'credential-locked'
  | 'credential-unavailable'
  | 'metadata-missing'
  | 'metadata-invalid'
  | 'authority-mismatch'
  | 'profile-account-mismatch'
  | 'authorization-denied'
  | 'authorization-timeout'
  | 'browser-open-failed'
  | 'oauth-client-invalid'
  | 'authorization-grant-invalid'
  | 'redirect-uri-mismatch'
  | 'token-request-invalid'
  | 'token-exchange-failed'
  | 'scope-mismatch'
  | 'subject-mismatch'
  | 'token-response-invalid'
  | 'userinfo-failed'
  | 'network-failed'
  | 'rate-limited'
  | 'oauth-broker-unavailable'
  | 'reconnect-required'
  | 'persistence-failed'
  | 'native-failed'

export type AliyunDriveOAuthErrorOptions = ErrorOptions & {
  retryAfterMs?: number
}

export class AliyunDriveOAuthError extends Error {
  readonly retryAfterMs: number | undefined

  constructor(
    readonly code: AliyunDriveOAuthErrorCode,
    message: string,
    options?: AliyunDriveOAuthErrorOptions
  ) {
    super(message, options)
    this.name = 'AliyunDriveOAuthError'
    const retryAfterMs = options?.retryAfterMs
    this.retryAfterMs =
      Number.isSafeInteger(retryAfterMs) &&
      (retryAfterMs as number) > 0 &&
      (retryAfterMs as number) <= 300_000
        ? retryAfterMs
        : undefined
  }
}

function ownValue(value: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value
}

function nativeCode(error: unknown): AliyunDriveNativeErrorCode | null {
  if (typeof error !== 'object' || error === null) return null
  const code = ownValue(error, 'code')
  return typeof code === 'string' ? (code as AliyunDriveNativeErrorCode) : null
}

function nativeRetryAfterMs(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const value = ownValue(error, 'retryAfterMs')
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 300_000
    ? (value as number)
    : undefined
}

const NATIVE_ERROR_MAPPING: Readonly<
  Partial<
    Record<
      AliyunDriveNativeErrorCode,
      readonly [AliyunDriveOAuthErrorCode, string]
    >
  >
> = Object.freeze({
  unsupported: ['setup-required', 'This build does not provide Aliyun Drive OAuth setup'],
  'oauth-denied': ['authorization-denied', 'Aliyun Drive authorization was denied'],
  timeout: ['authorization-timeout', 'Aliyun Drive authorization timed out'],
  'browser-open-failed': [
    'browser-open-failed',
    'The system browser could not be opened'
  ],
  'oauth-client-invalid': ['oauth-client-invalid', 'Aliyun Drive OAuth client is invalid'],
  'authorization-grant-invalid': [
    'authorization-grant-invalid',
    'Aliyun Drive authorization grant is invalid or expired'
  ],
  'redirect-uri-mismatch': [
    'redirect-uri-mismatch',
    'Aliyun Drive rejected the authorization callback'
  ],
  'token-request-invalid': [
    'token-request-invalid',
    'Aliyun Drive token request is invalid'
  ],
  'token-exchange-failed': [
    'token-exchange-failed',
    'Aliyun Drive token exchange failed'
  ],
  'token-response-invalid': [
    'token-response-invalid',
    'Aliyun Drive returned an invalid token response'
  ],
  'userinfo-failed': [
    'userinfo-failed',
    'Aliyun Drive account information could not be verified'
  ],
  'scope-mismatch': ['scope-mismatch', 'Aliyun Drive did not grant the required scopes'],
  'subject-mismatch': [
    'subject-mismatch',
    'Aliyun Drive authorization belongs to a different account'
  ],
  'network-failed': ['network-failed', 'Aliyun Drive network request failed'],
  'rate-limited': ['rate-limited', 'Aliyun Drive temporarily rate limited requests'],
  'broker-unavailable': [
    'oauth-broker-unavailable',
    'The Aliyun Drive OAuth Broker is temporarily unavailable'
  ]
})

export function aliyunDriveOAuthNativeFailure(error: unknown): AliyunDriveOAuthError {
  if (error instanceof AliyunDriveOAuthError) return error
  if (
    (error instanceof Error && error.name === 'AbortError') ||
    nativeCode(error) === 'cancelled'
  ) {
    return new AliyunDriveOAuthError(
      'cancelled',
      'Aliyun Drive authorization was cancelled',
      { cause: error }
    )
  }
  const code = nativeCode(error)
  const mapped = code ? NATIVE_ERROR_MAPPING[code] : undefined
  if (!mapped) {
    return new AliyunDriveOAuthError(
      'native-failed',
      'Aliyun Drive native authorization failed',
      { cause: error }
    )
  }
  const retryAfterMs = mapped[0] === 'rate-limited' ? nativeRetryAfterMs(error) : undefined
  return new AliyunDriveOAuthError(
    mapped[0],
    mapped[1],
    retryAfterMs === undefined ? { cause: error } : { cause: error, retryAfterMs }
  )
}
