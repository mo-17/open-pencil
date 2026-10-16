import type {
  BackendDataFilterIR,
  BackendDataValueIR,
  BackendHttpHeaderIR,
  BackendValueSource
} from './types'
import {
  array,
  boundedText,
  id,
  identifier,
  oneOf,
  parseArrayItems,
  record,
  uniqueBy,
  type BackendUnknownRecord,
  type BackendValidationContext
} from './validation-helpers'

type ValueParser<Value extends object> = (
  value: unknown,
  path: string,
  context: BackendValidationContext
) => Value | undefined
type DataFilter<Value> = Omit<BackendDataFilterIR, 'value'> & { value: Value }
type DataValue<Value> = Omit<BackendDataValueIR, 'value'> & { value: Value }
interface DataReadInput<Filter> {
  entityId: string | undefined
  resultName: string | undefined
  rawFields: unknown[] | undefined
  fields: string[] | undefined
  filters: Filter[] | undefined
}

export function parseDataFilter<Value extends object>(
  value: unknown,
  path: string,
  context: BackendValidationContext,
  parseValue: ValueParser<Value>
): DataFilter<Value> | undefined {
  const source = record(value, path, context, ['field', 'operator', 'value'])
  if (!source) return undefined
  const field = id(source.field, `${path}.field`, context)
  const operator = oneOf(source.operator, `${path}.operator`, context, [
    'eq',
    'neq',
    'gt',
    'gte',
    'lt',
    'lte',
    'like',
    'in'
  ])
  const parsedValue = parseValue(source.value, `${path}.value`, context)
  return field && operator && parsedValue ? { field, operator, value: parsedValue } : undefined
}

export function parseDataValue<Value extends object>(
  value: unknown,
  path: string,
  context: BackendValidationContext,
  parseValue: ValueParser<Value>
): DataValue<Value> | undefined {
  const source = record(value, path, context, ['field', 'value'])
  if (!source) return undefined
  const field = id(source.field, `${path}.field`, context)
  const parsedValue = parseValue(source.value, `${path}.value`, context)
  return field && parsedValue ? { field, value: parsedValue } : undefined
}

export function parseDataReadInput<Filter extends object>(
  source: BackendUnknownRecord,
  path: string,
  context: BackendValidationContext,
  maximum: number,
  label: string,
  parseFilter: ValueParser<Filter>
): DataReadInput<Filter> {
  const entityId = id(source.entityId, `${path}.entityId`, context)
  const resultName = identifier(source.resultName, `${path}.resultName`, context)
  const rawFields =
    source.fields === undefined
      ? undefined
      : array(source.fields, `${path}.fields`, context, maximum)
  const fields = rawFields
    ?.map((entry, index) => id(entry, `${path}.fields[${index}]`, context))
    .filter((entry): entry is string => entry !== undefined)
  if (fields) uniqueBy(fields, `${path}.fields`, context, label)
  const filters = parseArrayItems(
    source.filters,
    `${path}.filters`,
    context,
    maximum,
    parseFilter,
    true
  )
  return { entityId, resultName, rawFields, fields, filters }
}

export function parseHttpHeader(
  value: unknown,
  path: string,
  context: BackendValidationContext,
  parseValue: ValueParser<BackendValueSource>
): BackendHttpHeaderIR | undefined {
  const source = record(value, path, context, ['name', 'value'])
  if (!source) return undefined
  const name = boundedText(source.name, `${path}.name`, context, 128)
  if (name && !/^[A-Za-z][A-Za-z0-9-]{0,127}$/u.test(name))
    context.diagnostics.push({
      code: 'backend-http-header-invalid',
      severity: 'error',
      path: `${path}.name`,
      message: 'HTTP header name is invalid.'
    })
  const parsedValue = parseValue(source.value, `${path}.value`, context)
  return name && /^[A-Za-z][A-Za-z0-9-]{0,127}$/u.test(name) && parsedValue
    ? { name, value: parsedValue }
    : undefined
}
