import type { BackendFieldDefault, BackendFieldScalarType } from './types'
import {
  oneOf,
  record,
  type BackendUnknownRecord,
  type BackendValidationContext
} from './validation-helpers'

export const BACKEND_FIELD_TYPES: readonly (BackendFieldScalarType | 'enum')[] = [
  'string',
  'integer',
  'number',
  'boolean',
  'date',
  'datetime',
  'uuid',
  'json',
  'bytes',
  'enum'
]

const UUID_LITERAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const DATE_LITERAL = /^\d{4}-\d{2}-\d{2}$/u
const RFC3339_DATETIME =
  /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))$/u

function isCanonicalDate(value: string): boolean {
  if (!DATE_LITERAL.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function literalMatchesFieldType(
  type: BackendFieldScalarType | 'enum',
  value: BackendFieldDefault & { kind: 'literal' },
  nullable: boolean
): boolean {
  if (value.value === null) return nullable
  switch (type) {
    case 'string':
    case 'bytes':
    case 'enum':
      return typeof value.value === 'string'
    case 'integer':
      return typeof value.value === 'number' && Number.isSafeInteger(value.value)
    case 'number':
      return typeof value.value === 'number'
    case 'boolean':
      return typeof value.value === 'boolean'
    case 'date':
      return typeof value.value === 'string' && isCanonicalDate(value.value)
    case 'datetime':
      return (
        typeof value.value === 'string' &&
        RFC3339_DATETIME.test(value.value) &&
        isCanonicalDate(RFC3339_DATETIME.exec(value.value)?.[1] ?? '') &&
        Number.isFinite(Date.parse(value.value))
      )
    case 'uuid':
      return typeof value.value === 'string' && UUID_LITERAL.test(value.value)
    case 'json':
      return true
  }
  return false
}

function generatedDefaultMatchesFieldType(
  type: BackendFieldScalarType | 'enum',
  value: BackendFieldDefault & { kind: 'generated' }
): boolean {
  if (value.generator === 'uuid') return type === 'uuid'
  if (value.generator === 'identity') return type === 'integer'
  return type === 'datetime'
}

function fieldDefaultMatchesType(
  type: BackendFieldScalarType | 'enum',
  value: BackendFieldDefault,
  nullable: boolean
): boolean {
  return value.kind === 'literal'
    ? literalMatchesFieldType(type, value, nullable)
    : generatedDefaultMatchesFieldType(type, value)
}

function parseLiteralDefault(
  source: BackendUnknownRecord,
  path: string,
  context: BackendValidationContext
): BackendFieldDefault | undefined {
  if ('generator' in source) {
    context.diagnostics.push({
      code: 'backend-default-field-invalid',
      severity: 'error',
      path: `${path}.generator`,
      message: 'Literal defaults cannot declare a generator.'
    })
  }
  const literal = source.value
  if (
    literal !== null &&
    typeof literal !== 'string' &&
    typeof literal !== 'boolean' &&
    (typeof literal !== 'number' || !Number.isFinite(literal))
  ) {
    context.diagnostics.push({
      code: 'backend-default-literal-invalid',
      severity: 'error',
      path: `${path}.value`,
      message: 'Literal default must be a string, finite number, boolean, or null.'
    })
    return undefined
  }
  return { kind: 'literal', value: literal }
}

function parseGeneratedDefault(
  source: BackendUnknownRecord,
  path: string,
  context: BackendValidationContext
): BackendFieldDefault | undefined {
  if ('value' in source) {
    context.diagnostics.push({
      code: 'backend-default-field-invalid',
      severity: 'error',
      path: `${path}.value`,
      message: 'Generated defaults cannot declare a literal value.'
    })
  }
  const generator = oneOf(source.generator, `${path}.generator`, context, [
    'uuid',
    'identity',
    'created-at',
    'updated-at'
  ])
  return generator ? { kind: 'generated', generator } : undefined
}

export function parseBackendFieldDefault(
  value: unknown,
  path: string,
  context: BackendValidationContext,
  type: BackendFieldScalarType | 'enum' | undefined,
  nullable: boolean | undefined
): BackendFieldDefault | undefined {
  const source = record(value, path, context, ['kind', 'value', 'generator'], ['kind'])
  if (!source) return undefined
  const kind = oneOf(source.kind, `${path}.kind`, context, ['literal', 'generated'])
  let parsed: BackendFieldDefault | undefined
  if (kind === 'literal') parsed = parseLiteralDefault(source, path, context)
  if (kind === 'generated') parsed = parseGeneratedDefault(source, path, context)
  if (!parsed || !type || nullable === undefined) return parsed
  if (fieldDefaultMatchesType(type, parsed, nullable)) return parsed
  context.diagnostics.push({
    code: 'backend-field-default-type-mismatch',
    severity: 'error',
    path,
    message: 'Field default must match the field scalar type and nullability.'
  })
  return undefined
}
