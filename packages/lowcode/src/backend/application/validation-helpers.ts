import { parseExpression } from '@open-pencil/lowcode'

import { discriminatedRecord } from '../discriminated-record'
import { COMMON_PRINCIPAL_SHAPES, parseCommonPrincipal } from '../row-access/principal'
import { parseHttpHeader } from '../step-records'
import type {
  AuthPolicyIR,
  AuthPrincipalIntent,
  BackendHttpHeaderIR,
  BackendLiteral,
  BackendValueSource,
  DataEntityIR,
  DataModelIR
} from '../types'
import {
  boundedText,
  environmentName,
  id,
  identifier,
  parseArrayItems,
  type BackendUnknownRecord,
  type BackendValidationContext
} from '../validation-helpers'
import type { BackendTransactionValueSourceIR } from './types'

const PRINCIPAL_SHAPES = {
  ...COMMON_PRINCIPAL_SHAPES,
  'tenant-member': { allowed: ['kind', 'tenantId'], required: ['kind', 'tenantId'] }
} as const

const VALUE_SOURCE_SHAPES = {
  expression: { allowed: ['kind', 'expression'], required: ['kind', 'expression'] },
  environment: { allowed: ['kind', 'name'], required: ['kind', 'name'] }
} as const

const TRANSACTION_VALUE_SOURCE_SHAPES = {
  parameter: { allowed: ['kind', 'name'], required: ['kind', 'name'] },
  result: { allowed: ['kind', 'name', 'field'], required: ['kind', 'name'] },
  literal: { allowed: ['kind', 'value'], required: ['kind', 'value'] }
} as const

export function integerBetween(
  value: unknown,
  path: string,
  context: BackendValidationContext,
  minimum: number,
  maximum: number
): number | undefined {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    context.diagnostics.push({
      code: 'backend-integer-invalid',
      severity: 'error',
      path,
      message: `Value must be a safe integer from ${minimum} through ${maximum}.`
    })
    return undefined
  }
  return value as number
}

export function finiteNumberBetween(
  value: unknown,
  path: string,
  context: BackendValidationContext,
  minimum: number,
  maximum: number
): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    context.diagnostics.push({
      code: 'backend-number-invalid',
      severity: 'error',
      path,
      message: `Value must be a finite number from ${minimum} through ${maximum}.`
    })
    return undefined
  }
  return value
}

export function literal(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendLiteral | undefined {
  if (
    value !== null &&
    typeof value !== 'string' &&
    typeof value !== 'boolean' &&
    (typeof value !== 'number' || !Number.isFinite(value))
  ) {
    context.diagnostics.push({
      code: 'backend-literal-invalid',
      severity: 'error',
      path,
      message: 'Value must be a string, finite number, boolean, or null.'
    })
    return undefined
  }
  return value as BackendLiteral
}

export function parseAuthPrincipalIntentV2(
  value: unknown,
  path: string,
  context: BackendValidationContext
): AuthPrincipalIntent | undefined {
  const parsed = discriminatedRecord(value, path, context, PRINCIPAL_SHAPES)
  if (!parsed) return undefined
  const { kind, source } = parsed
  if (kind !== 'tenant-member') return parseCommonPrincipal(kind, source, path, context)
  const tenantId = id(source.tenantId, `${path}.tenantId`, context)
  return tenantId ? { kind, tenantId } : undefined
}

export function principalKey(principal: AuthPrincipalIntent): string {
  if (principal.kind === 'role') return `${principal.kind}:${principal.roleId}`
  if (principal.kind === 'owner') return `${principal.kind}:${principal.ownershipId}`
  if (principal.kind === 'tenant-member')
    return (
      `${principal.kind}:${principal.tenantId}` +
      (principal.roleId === undefined ? '' : `:role:${principal.roleId}`)
    )
  return principal.kind
}

export function validatePrincipalReference(
  principal: AuthPrincipalIntent,
  path: string,
  auth: AuthPolicyIR,
  context: BackendValidationContext
): void {
  const present =
    principal.kind === 'anonymous' ||
    (principal.kind === 'authenticated' &&
      auth.identities.some((entry) => entry.kind === 'user')) ||
    (principal.kind === 'role' && auth.roles.some((entry) => entry.id === principal.roleId)) ||
    (principal.kind === 'owner' &&
      auth.ownership.some((entry) => entry.id === principal.ownershipId)) ||
    (principal.kind === 'tenant-member' &&
      auth.tenants.some((entry) => entry.id === principal.tenantId))
  if (present) return
  context.diagnostics.push({
    code: 'backend-principal-reference-missing',
    severity: 'error',
    path,
    message: 'Principal must reference an identity, role, ownership, or tenant declared by Auth IR.'
  })
}

export function parseBackendValueSourceV2(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendValueSource | undefined {
  const parsed = discriminatedRecord(value, path, context, VALUE_SOURCE_SHAPES)
  if (!parsed) return undefined
  if (parsed.kind === 'environment') {
    const name = environmentName(parsed.source.name, `${path}.name`, context)
    return name ? { kind: 'environment', name } : undefined
  }
  const expression = boundedText(parsed.source.expression, `${path}.expression`, context)
  if (!expression) return undefined
  if (!parseExpression(expression).ok) {
    context.diagnostics.push({
      code: 'backend-automation-expression-invalid',
      severity: 'error',
      path: `${path}.expression`,
      message: 'Automation expression is invalid.'
    })
    return undefined
  }
  return { kind: 'expression', expression }
}

function httpHeader(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendHttpHeaderIR | undefined {
  return parseHttpHeader(value, path, context, parseBackendValueSourceV2)
}

export function parseHttpHeadersV2(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendHttpHeaderIR[] | undefined {
  return parseArrayItems(value, path, context, 64, httpHeader, true)
}

export function parseTransactionValueSource(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendTransactionValueSourceIR | undefined {
  const parsed = discriminatedRecord(value, path, context, TRANSACTION_VALUE_SOURCE_SHAPES)
  if (!parsed) return undefined
  const { kind, source } = parsed
  if (kind === 'literal') {
    const parsedLiteral = literal(source.value, `${path}.value`, context)
    return parsedLiteral !== undefined || source.value === null
      ? { kind, value: parsedLiteral ?? null }
      : undefined
  }
  const name = identifier(source.name, `${path}.name`, context)
  if (!name) return undefined
  if (kind === 'parameter') return { kind, name }
  const field = source.field === undefined ? undefined : id(source.field, `${path}.field`, context)
  return { kind, name, ...(field ? { field } : {}) }
}

export function entityMap(model: DataModelIR): ReadonlyMap<string, DataEntityIR> {
  return new Map(model.entities.map((entity) => [entity.id, entity]))
}

export function referencedEntity(
  entityId: string,
  path: string,
  model: DataModelIR,
  context: BackendValidationContext
): DataEntityIR | undefined {
  const entity = entityMap(model).get(entityId)
  if (entity) return entity
  context.diagnostics.push({
    code: 'backend-entity-reference-missing',
    severity: 'error',
    path,
    message: 'Referenced entity is not declared by DataModel IR.'
  })
  return undefined
}

export function validateFieldReference(
  entity: DataEntityIR | undefined,
  fieldId: string,
  path: string,
  context: BackendValidationContext
): void {
  if (!entity || entity.fields.some((field) => field.id === fieldId)) return
  context.diagnostics.push({
    code: 'backend-field-reference-missing',
    severity: 'error',
    path,
    message: 'Referenced field is not declared by the entity.'
  })
}

export function validateEnvironmentReference(
  name: string,
  path: string,
  declaredEnvironmentNames: ReadonlySet<string>,
  context: BackendValidationContext
): void {
  if (declaredEnvironmentNames.has(name)) return
  context.diagnostics.push({
    code: 'backend-automation-environment-undeclared',
    severity: 'error',
    path,
    message: 'Automation environment references must be declared by application secrets.'
  })
}

export function exactNonEmptyText(
  source: BackendUnknownRecord,
  key: string,
  path: string,
  context: BackendValidationContext,
  maximum = 1_024
): string | undefined {
  return boundedText(source[key], `${path}.${key}`, context, maximum)
}
