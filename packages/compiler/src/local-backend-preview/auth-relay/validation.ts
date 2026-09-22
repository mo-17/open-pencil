export const PREVIEW_AUTH_PATH = '/_openpencil/preview-auth'
export const PREVIEW_AUTH_CALLBACK_PATH = '/_openpencil/auth/callback'
export const MAX_AUTH_URL_BYTES = 16 * 1024

const RANDOM_VALUE = /^[A-Za-z0-9_-]{43,128}$/
const AUTH_FIELDS = new Set([
  'response_type',
  'client_id',
  'redirect_uri',
  'scope',
  'state',
  'nonce',
  'code_challenge',
  'code_challenge_method',
  'resource'
])
const CALLBACK_FIELDS = new Set([
  'state',
  'code',
  'error',
  'error_description',
  'error_uri',
  'iss',
  'session_state'
])

function plainText(value: string, maximum: number): boolean {
  return (
    value.length > 0 &&
    value.length <= maximum &&
    !Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
}

function uniqueFields(params: URLSearchParams, allowed: ReadonlySet<string>): boolean {
  const seen = new Set<string>()
  for (const [key] of params) {
    if (!allowed.has(key) || seen.has(key)) return false
    seen.add(key)
  }
  return true
}

function authorizationURL(value: unknown): string | null {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).join(',') !== 'authorizationURL' ||
    !('authorizationURL' in value) ||
    typeof value.authorizationURL !== 'string' ||
    Buffer.byteLength(value.authorizationURL) > MAX_AUTH_URL_BYTES ||
    !plainText(value.authorizationURL, MAX_AUTH_URL_BYTES) ||
    /\s|\\|#/.test(value.authorizationURL)
  )
    return null
  return value.authorizationURL
}

function authorizationEndpoint(raw: string): URL | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  const literalLoopback = /^http:\/\/(?:127\.0\.0\.1|\[::1\])(?::[0-9]+)?\//.test(raw)
  if (
    (!raw.startsWith('https://') && !literalLoopback) ||
    raw
      .slice(raw.indexOf('//') + 2)
      .split('/')[0]
      .includes('@') ||
    url.username ||
    url.password ||
    url.hash ||
    !uniqueFields(url.searchParams, AUTH_FIELDS)
  )
    return null
  return url
}

function validAuthorizationParameters(params: URLSearchParams, origin: string): boolean {
  const scope = params.get('scope') ?? ''
  return !(
    params.get('response_type') !== 'code' ||
    params.get('redirect_uri') !== origin + PREVIEW_AUTH_CALLBACK_PATH ||
    params.get('code_challenge_method') !== 'S256' ||
    !/^[A-Za-z0-9_-]{43}$/.test(params.get('code_challenge') ?? '') ||
    !RANDOM_VALUE.test(params.get('state') ?? '') ||
    !RANDOM_VALUE.test(params.get('nonce') ?? '') ||
    !plainText(params.get('client_id') ?? '', 512) ||
    !plainText(scope, 2048) ||
    !scope.split(' ').includes('openid') ||
    (params.has('resource') && !plainText(params.get('resource') ?? '', 2048))
  )
}

export function parsePreviewAuthorization(
  value: unknown,
  origin: string
): { authorizationURL: string; state: string } | null {
  const raw = authorizationURL(value)
  if (!raw) return null
  const url = authorizationEndpoint(raw)
  if (!url || !validAuthorizationParameters(url.searchParams, origin)) return null
  return { authorizationURL: raw, state: url.searchParams.get('state') ?? '' }
}

/** Preserve issuer/session metadata for the OIDC client to validate alongside PKCE. */
export function validPreviewAuthCallback(url: URL): boolean {
  const params = url.searchParams
  if (!uniqueFields(params, CALLBACK_FIELDS) || !RANDOM_VALUE.test(params.get('state') ?? ''))
    return false
  const code = params.get('code')
  const error = params.get('error')
  if ((code === null) === (error === null)) return false
  if (code !== null && !plainText(code, 4096)) return false
  if (error !== null && !plainText(error, 256)) return false
  for (const key of ['error_description', 'error_uri', 'iss', 'session_state']) {
    const value = params.get(key)
    if (value !== null && !plainText(value, 2048)) return false
  }
  return true
}

export function previewAuthCallbackURL(url: URL): string | null {
  if (!validPreviewAuthCallback(url)) return null
  const callbackURL = url.href
  return Buffer.byteLength(JSON.stringify({ callbackURL })) <= MAX_AUTH_URL_BYTES
    ? callbackURL
    : null
}
