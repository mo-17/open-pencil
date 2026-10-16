import type { BackendFieldScalarType } from '@open-pencil/lowcode/backend'

export { quoteIdentifier } from '#compiler/backend/supabase/migration-review/common'

export function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

const ATOMIC_POSTGRES_TYPES: Partial<Record<BackendFieldScalarType, string>> = {
  string: 'text',
  integer: 'int8',
  number: 'float8',
  boolean: 'bool',
  date: 'date',
  datetime: 'timestamptz',
  uuid: 'uuid'
}

export function atomicPostgresType(
  type: BackendFieldScalarType,
  subject: 'field' | 'parameter'
): string {
  const result = Object.hasOwn(ATOMIC_POSTGRES_TYPES, type)
    ? ATOMIC_POSTGRES_TYPES[type]
    : undefined
  if (result === undefined) throw new TypeError(`Unsupported Supabase atomic RPC ${subject} type.`)
  return result
}
