import type {
  ServerHttpHeader,
  ServerValueSource,
  SupabaseFilter,
  SupabasePayloadEntry
} from '@open-pencil/scene-graph'

import { parseExpression } from '#core/lowcode-validation/expression'
import { isSafeLowcodeIdentifier } from '#core/lowcode-validation/identifiers'

import { findServerWorkflowSecretLiteral, isSensitiveServerHeader } from './secrets'

export type ServerValidationResult<T> = { ok: true; value: T } | { ok: false; error: string }

type FilterOp = SupabaseFilter['op']

const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]{0,127}$/
const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const FILTER_OPS = new Set<FilterOp>(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'in'])

export function serverFail(where: string, message: string): { ok: false; error: string } {
  return { ok: false, error: `${where} ${message}` }
}

export function isServerRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validateServerObjectArray<T>(
  where: string,
  raw: unknown,
  validateItem: (itemWhere: string, item: Record<string, unknown>) => ServerValidationResult<T>
): ServerValidationResult<T[] | undefined> {
  if (raw === undefined) return { ok: true, value: undefined }
  if (!Array.isArray(raw)) return serverFail(where, 'must be an array')
  const output: T[] = []
  for (let i = 0; i < raw.length; i++) {
    const itemWhere = `${where}[${i}]`
    const item = raw[i]
    if (!isServerRecord(item)) return serverFail(itemWhere, 'must be an object')
    const validated = validateItem(itemWhere, item)
    if (!validated.ok) return validated
    output.push(validated.value)
  }
  return { ok: true, value: output }
}

export function validateServerExactKeys(
  where: string,
  raw: Record<string, unknown>,
  allowed: readonly string[]
): { ok: true } | { ok: false; error: string } {
  const allowedSet = new Set(allowed)
  if (Object.keys(raw).some((key) => !allowedSet.has(key))) {
    return serverFail(where, 'contains an unknown field')
  }
  return { ok: true }
}

export function validateServerExpression(
  where: string,
  raw: unknown,
  scope: ReadonlySet<string>
): ServerValidationResult<string> {
  if (typeof raw !== 'string') return serverFail(where, 'must be an expression string')
  if (findServerWorkflowSecretLiteral(raw, where)) {
    return serverFail(where, 'contains a secret literal; use an environment-variable reference')
  }
  const parsed = parseExpression(raw)
  if (!parsed.ok) return serverFail(where, `is invalid: ${parsed.error}`)
  for (const reference of parsed.references) {
    if (!scope.has(reference)) {
      return serverFail(where, 'references an identifier outside the workflow scope')
    }
  }
  return { ok: true, value: raw }
}

export function validateServerIdentifier(
  where: string,
  raw: unknown
): ServerValidationResult<string> {
  if (typeof raw !== 'string' || !isSafeLowcodeIdentifier(raw)) {
    return serverFail(where, 'must be a valid identifier')
  }
  return { ok: true, value: raw }
}

export function validateServerValueSource(
  where: string,
  raw: unknown,
  scope: ReadonlySet<string>
): ServerValidationResult<ServerValueSource> {
  if (!isServerRecord(raw)) {
    return serverFail(where, 'must be an env reference or expression object')
  }
  if (raw.kind === 'env') {
    const keys = validateServerExactKeys(where, raw, ['kind', 'name'])
    if (!keys.ok) return keys
    if (typeof raw.name !== 'string' || !ENV_NAME_RE.test(raw.name)) {
      return serverFail(`${where}.name`, 'must be an uppercase environment variable name')
    }
    return { ok: true, value: { kind: 'env', name: raw.name } }
  }
  if (raw.kind === 'expr') {
    const keys = validateServerExactKeys(where, raw, ['kind', 'expr'])
    if (!keys.ok) return keys
    const parsed = validateServerExpression(`${where}.expr`, raw.expr, scope)
    if (!parsed.ok) return parsed
    return { ok: true, value: { kind: 'expr', expr: parsed.value } }
  }
  return serverFail(`${where}.kind`, 'must be "env" or "expr"')
}

export function validateServerHeaders(
  where: string,
  raw: unknown,
  scope: ReadonlySet<string>
): ServerValidationResult<ServerHttpHeader[] | undefined> {
  const seen = new Set<string>()
  return validateServerObjectArray(where, raw, (itemWhere, item) => {
    const keys = validateServerExactKeys(itemWhere, item, ['name', 'value'])
    if (!keys.ok) return keys
    if (typeof item.name !== 'string' || !HEADER_NAME_RE.test(item.name)) {
      return serverFail(`${itemWhere}.name`, 'must be a valid HTTP header name')
    }
    const normalizedName = item.name.toLowerCase()
    if (seen.has(normalizedName)) return serverFail(`${itemWhere}.name`, 'is duplicated')
    if (
      isSensitiveServerHeader(normalizedName) &&
      isServerRecord(item.value) &&
      item.value.kind === 'expr'
    ) {
      return serverFail(`${itemWhere}.value`, 'must use an environment-variable reference')
    }
    const source = validateServerValueSource(`${itemWhere}.value`, item.value, scope)
    if (!source.ok) return source
    if (isSensitiveServerHeader(normalizedName) && source.value.kind !== 'env') {
      return serverFail(`${itemWhere}.value`, 'must use an environment-variable reference')
    }
    seen.add(normalizedName)
    return { ok: true, value: { name: item.name, value: source.value } }
  })
}

export function validateServerFilters(
  where: string,
  raw: unknown,
  scope: ReadonlySet<string>
): ServerValidationResult<SupabaseFilter[] | undefined> {
  return validateServerObjectArray(where, raw, (itemWhere, item) => {
    const keys = validateServerExactKeys(itemWhere, item, ['column', 'op', 'valueExpr'])
    if (!keys.ok) return keys
    if (typeof item.column !== 'string' || item.column.trim() === '') {
      return serverFail(`${itemWhere}.column`, 'must be a non-empty string')
    }
    if (typeof item.op !== 'string' || !FILTER_OPS.has(item.op as FilterOp)) {
      return serverFail(`${itemWhere}.op`, 'must be a supported Supabase filter operation')
    }
    const valueExpr = validateServerExpression(`${itemWhere}.valueExpr`, item.valueExpr, scope)
    if (!valueExpr.ok) return valueExpr
    return {
      ok: true,
      value: { column: item.column, op: item.op as FilterOp, valueExpr: valueExpr.value }
    }
  })
}

export function validateServerPayloadEntries(
  where: string,
  raw: unknown,
  scope: ReadonlySet<string>
): ServerValidationResult<SupabasePayloadEntry[] | undefined> {
  const seen = new Set<string>()
  return validateServerObjectArray(where, raw, (itemWhere, item) => {
    const keys = validateServerExactKeys(itemWhere, item, ['key', 'valueExpr'])
    if (!keys.ok) return keys
    const key = validateServerIdentifier(`${itemWhere}.key`, item.key)
    if (!key.ok) return key
    if (seen.has(key.value)) return serverFail(`${itemWhere}.key`, 'is duplicated')
    const valueExpr = validateServerExpression(`${itemWhere}.valueExpr`, item.valueExpr, scope)
    if (!valueExpr.ok) return valueExpr
    seen.add(key.value)
    return { ok: true, value: { key: key.value, valueExpr: valueExpr.value } }
  })
}

export function validateServerResultName(
  where: string,
  raw: unknown,
  required: boolean
): ServerValidationResult<string | undefined> {
  if (raw === undefined && !required) return { ok: true, value: undefined }
  return validateServerIdentifier(where, raw)
}
