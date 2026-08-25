export const BAIDU_NETDISK_NATIVE_ERROR_CODES = [
  'invalid-request',
  'unsupported',
  'cancelled',
  'timeout',
  'browser-open-failed',
  'oauth-denied',
  'oauth-failed',
  'oauth-client-invalid',
  'authorization-grant-invalid',
  'device-code-expired',
  'token-request-invalid',
  'token-exchange-failed',
  'token-response-invalid',
  'userinfo-failed',
  'scope-mismatch',
  'account-mismatch',
  'broker-unavailable',
  'network-failed',
  'response-too-large',
  'rate-limited'
] as const

export type BaiduNetdiskNativeErrorCode = (typeof BAIDU_NETDISK_NATIVE_ERROR_CODES)[number]

const ERROR_CODES = new Set<string>(BAIDU_NETDISK_NATIVE_ERROR_CODES)

const SAFE_MESSAGES: Readonly<Record<BaiduNetdiskNativeErrorCode, string>> = Object.freeze({
  'invalid-request': 'Baidu Netdisk request is invalid',
  unsupported: 'Baidu Netdisk is unavailable in this desktop build',
  cancelled: 'Baidu authorization was cancelled',
  timeout: 'Baidu Netdisk operation timed out',
  'browser-open-failed': 'The system browser could not be opened',
  'oauth-denied': 'Baidu authorization was denied',
  'oauth-failed': 'Baidu authorization failed',
  'oauth-client-invalid': 'Baidu OAuth application credentials are invalid',
  'authorization-grant-invalid': 'Baidu authorization grant is invalid or expired',
  'device-code-expired': 'Baidu device authorization expired',
  'token-request-invalid': 'Baidu token request is invalid',
  'token-exchange-failed': 'Baidu token exchange failed',
  'token-response-invalid': 'Baidu returned an invalid token response',
  'userinfo-failed': 'Baidu Netdisk account information could not be verified',
  'scope-mismatch': 'Baidu did not grant the required Netdisk scopes',
  'account-mismatch': 'Baidu authorization belongs to a different account',
  'broker-unavailable': 'The OpenPencil Baidu OAuth Broker is unavailable',
  'network-failed': 'Baidu Netdisk network request failed',
  'response-too-large': 'Baidu Netdisk response exceeded the byte limit',
  'rate-limited': 'Baidu Netdisk temporarily rate limited the request'
})

type BaiduNetdiskNativeErrorOptions = ErrorOptions & {
  retryAfterMs?: number
}

function validRetryAfterMs(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 300_000
}

function ownValue(value: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value
}

function errorCode(value: unknown): BaiduNetdiskNativeErrorCode {
  if (typeof value !== 'object' || value === null) return 'oauth-failed'
  const code = ownValue(value, 'code')
  return typeof code === 'string' && ERROR_CODES.has(code)
    ? (code as BaiduNetdiskNativeErrorCode)
    : 'oauth-failed'
}

export class BaiduNetdiskNativeError extends Error {
  readonly retryAfterMs: number | undefined

  constructor(
    readonly code: BaiduNetdiskNativeErrorCode,
    options?: BaiduNetdiskNativeErrorOptions
  ) {
    super(SAFE_MESSAGES[code], options)
    this.name = 'BaiduNetdiskNativeError'
    const retryAfterMs = options?.retryAfterMs
    this.retryAfterMs = validRetryAfterMs(retryAfterMs) ? retryAfterMs : undefined
  }
}

/** Provider text, query strings, tokens, and account details never cross this renderer boundary. */
export function nativeBaiduNetdiskError(error: unknown): BaiduNetdiskNativeError {
  if (error instanceof BaiduNetdiskNativeError) return error
  const code = errorCode(error)
  const retryAfterMs =
    code === 'rate-limited' && typeof error === 'object' && error !== null
      ? ownValue(error, 'retryAfterMs')
      : undefined
  return new BaiduNetdiskNativeError(
    code,
    validRetryAfterMs(retryAfterMs) ? { retryAfterMs } : undefined
  )
}
