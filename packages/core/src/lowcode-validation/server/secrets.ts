import { detectServiceRole } from '#core/lowcode-validation/supabase-config'

const HIGH_CONFIDENCE_SECRET_PATTERNS = [
  /\bsb_secret_[A-Za-z0-9_-]*/i,
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9_-]+/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i
]
const JWT_CANDIDATE_RE = /[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}/g
const SAFE_PATH_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-api-token',
  'x-auth-token',
  'x-access-token',
  'x-client-secret',
  'api-key',
  'apikey'
])

function containsSecret(value: string): boolean {
  if (HIGH_CONFIDENCE_SECRET_PATTERNS.some((pattern) => pattern.test(value))) return true
  for (const candidate of value.match(JWT_CANDIDATE_RE) ?? []) {
    if (detectServiceRole(candidate)) return true
  }
  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function serverWorkflowSafePathKey(key: string): string {
  return SAFE_PATH_KEY_RE.test(key) && !containsSecret(key) ? key : '*'
}

export function isSensitiveServerHeader(name: string): boolean {
  return SENSITIVE_HEADER_NAMES.has(name.toLowerCase())
}

/** Return the path of the first high-confidence secret literal without ever
 * returning or interpolating the detected value itself. */
export function findServerWorkflowSecretLiteral(value: unknown, where: string): string | undefined {
  if (typeof value === 'string') return containsSecret(value) ? where : undefined
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = findServerWorkflowSecretLiteral(value[i], `${where}[${i}]`)
      if (found) return found
    }
    return undefined
  }
  if (!isRecord(value)) return undefined
  for (const [key, nested] of Object.entries(value)) {
    // An env reference stores only the variable name, never its runtime value.
    // Secret-looking names such as SB_SECRET_KEY are therefore safe metadata.
    if (value.kind === 'env' && key === 'name') continue
    const found = findServerWorkflowSecretLiteral(
      nested,
      `${where}.${serverWorkflowSafePathKey(key)}`
    )
    if (found) return found
  }
  return undefined
}
