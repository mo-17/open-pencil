import type { DataFieldIR, DataModelIR } from '@open-pencil/lowcode/backend'

import { sqlIdentifier } from './artifact'

export const NESTJS_DATE_PATTERN = '^(?!0000)\\d{4}-\\d{2}-\\d{2}$'
export const NESTJS_DATETIME_PATTERN =
  '^(?!0000)\\d{4}-\\d{2}-\\d{2}T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?(?:Z|[+-](?:(?:0\\d|1[0-3]):[0-5]\\d|14:00))$'

/** Bound the normalized UTC instant as well as the authored local calendar year. */
export const NESTJS_UTC_DATETIME_MIN = Date.parse('0001-01-01T00:00:00Z')
export const NESTJS_UTC_DATETIME_MAX_EXCLUSIVE = Date.parse('+010000-01-01T00:00:00Z')

export function nestJSEnum(field: DataFieldIR, model: DataModelIR) {
  const value = model.enums.find((entry) => entry.id === field.enumId)
  if (field.type !== 'enum' || !value) throw new Error('Missing validated NestJS enum.')
  return value
}

/** Avoid pg's Date conversion: dates never shift timezone and timestamps retain microseconds. */
export function nestJSReadColumn(field: DataFieldIR): string {
  const column = sqlIdentifier(field.name)
  if (field.type === 'date') return 'to_char(' + column + ", 'YYYY-MM-DD')"
  if (field.type === 'datetime')
    return 'to_char(' + column + ' AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\')'
  return column
}

export function nestJSValidTemporalLiteral(field: DataFieldIR, value: unknown): boolean {
  if (typeof value !== 'string') return false
  const pattern = field.type === 'date' ? NESTJS_DATE_PATTERN : NESTJS_DATETIME_PATTERN
  if (!new RegExp(pattern, 'u').test(value)) return false
  const date = value.slice(0, 10)
  const parsed = new Date(date + 'T00:00:00.000Z')
  const instant = Date.parse(value)
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date &&
    instant >= NESTJS_UTC_DATETIME_MIN &&
    instant < NESTJS_UTC_DATETIME_MAX_EXCLUSIVE
  )
}
