import { detectSupabaseSecretKey } from './supabase-config'

export type CodePenSecretKind =
  | 'an OpenAI API key'
  | 'a Stripe secret'
  | 'a GitHub access token'
  | 'a Slack access token'
  | 'an AWS access key'
  | 'a private key'
  | 'URL credentials'
  | 'a sensitive literal assignment'
  | 'a Supabase secret/service_role key'

const KNOWN_SECRET_PATTERNS: readonly Readonly<{
  kind: CodePenSecretKind
  pattern: RegExp
}>[] = Object.freeze([
  { kind: 'an OpenAI API key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/ },
  {
    kind: 'a Stripe secret',
    pattern: /\b(?:(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{12,}|whsec_[A-Za-z0-9]{12,})\b/
  },
  {
    kind: 'a GitHub access token',
    pattern: /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[oprsu]_[A-Za-z0-9_]{20,})\b/
  },
  {
    kind: 'a Slack access token',
    pattern: /\b(?:xox[abprs]|xapp)-[A-Za-z0-9-]{12,}\b/
  },
  {
    kind: 'an AWS access key',
    pattern: /\b(?:A3T[A-Z0-9]|AKIA|ASIA|AIDA|AROA|AIPA|ANPA|ANVA|ASCA)[A-Z0-9]{16}\b/
  },
  {
    kind: 'a private key',
    pattern:
      /-----BEGIN (?:(?:RSA|EC|OPENSSH|DSA|ENCRYPTED) PRIVATE KEY|PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----/
  },
  {
    kind: 'URL credentials',
    pattern: /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s/?#@:]+:[^\s/?#@]+@/
  }
])

const SENSITIVE_LITERAL_ASSIGNMENT =
  /(?:^|[^\w$-])(["']?)([A-Za-z_$][\w$-]{1,80})\1\s*[:=]\s*(["'`])([^\r\n"'`]{8,})\3/gim
const JWT_CANDIDATE = /\b[A-Za-z0-9_-]{1,2048}\.[A-Za-z0-9_-]{1,8192}\.[A-Za-z0-9_-]{1,8192}\b/g
const SUPABASE_OPAQUE_SECRET = /\bsb_secret_[A-Za-z0-9_-]*/gi

function isSensitiveAssignmentName(name: string): boolean {
  const normalized = name.replace(/[$_-]/g, '').toLowerCase()
  return /(?:api(?:key|secret)|access(?:key(?:id)?|token)|auth(?:entication)?token|bearertoken|clientsecret|privatekey|secret(?:access)?key|servicerole(?:key)?|password|passwd|pwd|credentials?|token|secret)$/.test(
    normalized
  )
}

function isPlaceholderSecret(value: string): boolean {
  const normalized = value.trim()
  return (
    normalized === '' ||
    /^(?:undefined|null|none|false|true|changeme|change-me|example|placeholder|redacted|masked|not-set|todo|x{3,}|\*{3,})$/i.test(
      normalized
    ) ||
    /^(?:your|replace|insert)(?:[_\s-].*)?$/i.test(normalized) ||
    /^\$\{?[A-Z_][A-Z0-9_]*\}?$/.test(normalized) ||
    /^(?:process\.env|import\.meta\.env)\.[A-Z_][A-Z0-9_]*$/i.test(normalized)
  )
}

function hasSupabaseSecret(source: string): boolean {
  for (const match of source.matchAll(SUPABASE_OPAQUE_SECRET)) {
    if (detectSupabaseSecretKey(match[0])) return true
  }
  for (const match of source.matchAll(JWT_CANDIDATE)) {
    if (detectSupabaseSecretKey(match[0])) return true
  }
  return false
}

export function findCodePenSecretKinds(source: string): CodePenSecretKind[] {
  const kinds: CodePenSecretKind[] = []
  for (const candidate of KNOWN_SECRET_PATTERNS) {
    if (candidate.pattern.test(source)) kinds.push(candidate.kind)
  }
  for (const match of source.matchAll(SENSITIVE_LITERAL_ASSIGNMENT)) {
    if (!isSensitiveAssignmentName(match[2]) || isPlaceholderSecret(match[4])) continue
    kinds.push('a sensitive literal assignment')
    break
  }
  if (hasSupabaseSecret(source)) kinds.push('a Supabase secret/service_role key')
  return kinds
}

export function containsCodePenSecret(source: string): boolean {
  return findCodePenSecretKinds(source).length > 0
}
