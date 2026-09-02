import { parseSha256Base64URL } from '@open-pencil/scene-graph'

import type { BackendValidationContext } from './validation-helpers'

const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9_-]{3,}\b/u,
  /\bgh[pousr]_[A-Za-z0-9_]{8,}\b/u,
  /\bgithub_pat_[A-Za-z0-9_]{8,}\b/u,
  /\bxox[baprs]-[A-Za-z0-9-]{8,}\b/u,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u,
  /\bsb_secret_[A-Za-z0-9_-]{3,}\b/iu,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
  /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/u,
  /\b(?:Basic|Bearer)\s+[A-Za-z0-9._~+/=-]{12,}\b/iu,
  /\b(?:api[_-]?key|password|secret|token)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{12,}/iu,
  /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^/\s:@]+:[^/\s@]+@/iu
]

const HIGH_ENTROPY_TOKEN = /[A-Za-z0-9_+/=-]{32,}/gu
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

function isKnownOpaqueNonSecret(value: string): boolean {
  if (CANONICAL_UUID.test(value)) return true
  try {
    parseSha256Base64URL(value)
    return true
  } catch {
    return false
  }
}

/**
 * Catch unlabeled bearer-style material such as an AWS Secret Access Key without treating
 * canonical UUID handles, SHA-256 digests, or ordinary prose as credentials. This is deliberately
 * conservative: Backend IR has explicit CredentialRef and environment-reference channels, so a
 * long mixed-alphabet opaque value has no legitimate reason to appear inline.
 */
function containsHighEntropySecretLikeMaterial(value: string): boolean {
  for (const match of value.matchAll(HIGH_ENTROPY_TOKEN)) {
    const token = match[0]
    if (isKnownOpaqueNonSecret(token)) continue
    const categoryCount = [/[a-z]/u, /[A-Z]/u, /[0-9]/u].filter((pattern) =>
      pattern.test(token)
    ).length
    const distinctRatio = new Set(token).size / token.length
    if (categoryCount === 3 && distinctRatio >= 0.45) return true
  }
  return false
}

export function containsBackendSecretLikeMaterial(value: string): boolean {
  return (
    SECRET_PATTERNS.some((pattern) => pattern.test(value)) ||
    containsHighEntropySecretLikeMaterial(value)
  )
}

function scanSecretFreeData(
  value: unknown,
  path: string,
  context: BackendValidationContext
): boolean {
  if (typeof value === 'string') {
    if (!containsBackendSecretLikeMaterial(value)) return true
    context.diagnostics.push({
      code: 'backend-secret-material-forbidden',
      severity: 'error',
      path,
      message: 'Backend IR cannot contain material that resembles a credential or secret value.'
    })
    return false
  }
  if (value === null || typeof value !== 'object') return true
  let valid = true
  for (const key of Object.keys(value)) {
    if (containsBackendSecretLikeMaterial(key)) {
      context.diagnostics.push({
        code: 'backend-secret-material-forbidden',
        severity: 'error',
        path,
        message: 'Backend IR cannot contain material that resembles a credential or secret value.'
      })
      valid = false
      continue
    }
    valid = scanSecretFreeData(Reflect.get(value, key), `${path}.${key}`, context) && valid
  }
  return valid
}

export function assertBackendSecretFreeData(
  value: unknown,
  context: BackendValidationContext
): boolean {
  return scanSecretFreeData(value, '$', context)
}
