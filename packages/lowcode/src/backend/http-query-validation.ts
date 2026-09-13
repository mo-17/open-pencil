import type { BackendHttpAPIQueryIRV1, DataEntityIR } from './types'
import {
  diagnostic,
  id,
  parseArrayItems,
  record,
  sorted,
  uniqueBy,
  type BackendValidationContext
} from './validation-helpers'

const SCALARS = new Set([
  'string',
  'integer',
  'number',
  'boolean',
  'uuid',
  'date',
  'datetime',
  'enum'
])
const KEYS = ['filterFields', 'searchFields', 'sortFields'] as const

/** A query may narrow only fields already exposed by the resource. */
export function parseBackendHttpQuery(
  value: unknown,
  path: string,
  entity: DataEntityIR,
  readFields: readonly string[],
  hasList: boolean,
  context: BackendValidationContext
): BackendHttpAPIQueryIRV1 | undefined {
  const source = record(value, path, context, KEYS)
  if (!source) return undefined
  const reject = (message: string) =>
    diagnostic(context, 'backend-http-api-query-invalid', path, message)
  if (!hasList) reject('Query fields require a list operation.')
  const parse = (key: (typeof KEYS)[number]) => {
    const fields = parseArrayItems(source[key], `${path}.${key}`, context, 16, id)
    if (!fields) return undefined
    uniqueBy(fields, `${path}.${key}`, context, 'Query field')
    for (const fieldId of fields) {
      const field = entity.fields.find((entry) => entry.id === fieldId)
      if (!field || !readFields.includes(fieldId) || !SCALARS.has(field.type)) {
        reject('Query fields must be readable scalar fields on the same resource.')
      } else if (key === 'searchFields' && field.type !== 'string') {
        reject('Search fields must be strings.')
      } else if (key === 'sortFields' && (field.nullable || field.type === 'string')) {
        reject(
          'Sort fields must be non-null numeric, Boolean, UUID, date, datetime or enum fields.'
        )
      }
    }
    return sorted(fields, (field) => field)
  }
  const filterFields = parse('filterFields')
  const searchFields = parse('searchFields')
  const sortFields = parse('sortFields')
  if (!filterFields || !searchFields || !sortFields) return undefined
  if (filterFields.length + searchFields.length + sortFields.length === 0)
    reject('At least one query field is required.')
  return { filterFields, searchFields, sortFields }
}
