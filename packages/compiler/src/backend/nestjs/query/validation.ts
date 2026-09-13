export const LIST_VALIDATION_SOURCE = String.raw`import { BadRequestException } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { itemId } from './request-validation.js'

type Scalar = string | number | boolean | null
interface QueryField {
  readonly id: string
  readonly column: string
  readonly type: string
  readonly nullable: boolean
  readonly values?: readonly string[]
}
export interface QuerySpec {
  readonly filterFields: readonly QueryField[]
  readonly searchFields: readonly QueryField[]
  readonly sortFields: readonly QueryField[]
}
export interface ListQuery {
  readonly limit: number
  readonly after?: string
  readonly filter: readonly { field: QueryField; value: Scalar }[]
  readonly search?: { fields: readonly QueryField[]; value: string }
  readonly sort?: QueryField
  readonly direction: 'asc' | 'desc'
  readonly context: string
  readonly cursor?: { id: string; value: Scalar }
}
const EMPTY_SPEC: QuerySpec = { filterFields: [], searchFields: [], sortFields: [] }
function invalid(): never { throw new BadRequestException('Invalid list query') }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid()
  return value as Record<string, unknown>
}
function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || value.length > maximum ||
      /[\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(value)) return invalid()
  return value
}
function scalar(value: unknown, field: QueryField): Scalar {
  if (value === null) return field.nullable ? null : invalid()
  if (field.type === 'boolean') return typeof value === 'boolean' ? value : invalid()
  if (field.type === 'integer') return typeof value === 'number' && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647 ? value : invalid()
  if (field.type === 'number') return typeof value === 'number' && Number.isFinite(value) ? value : invalid()
  if (field.type === 'uuid') return itemId(value)
  const result = text(value, 512)
  if (field.type === 'enum' && !field.values?.includes(result)) return invalid()
  if (field.type === 'date' && (!/^(?!0000)\d{4}-\d{2}-\d{2}$/u.test(result) ||
      !Number.isFinite(Date.parse(result)) || new Date(result).toISOString().slice(0,10) !== result)) return invalid()
  if (field.type === 'datetime' && (!/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/u.test(result) ||
      !Number.isFinite(Date.parse(result)) || new Date(result).toISOString().slice(0,19) !== result.slice(0,19))) return invalid()
  return result
}
function parseFilter(value: unknown, fields: QuerySpec['filterFields']): ListQuery['filter'] {
  if (value === undefined) return []
  const encoded = text(value, 4096)
  let parsed: unknown
  try { parsed = JSON.parse(encoded) } catch { return invalid() }
  const source = object(parsed)
  const keys = Object.keys(source).sort()
  if (keys.length === 0 || keys.length > 16) return invalid()
  return keys.map((id) => {
    const field = fields.find((entry) => entry.id === id)
    if (!field) return invalid()
    return { field, value: scalar(source[id], field) }
  })
}
function parseCursor(value: unknown, sort: QueryField, direction: string, context: string): ListQuery['cursor'] {
  const encoded = text(value, 4096)
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) return invalid()
  let cursor: unknown
  try {
    const bytes = Buffer.from(encoded, 'base64url')
    if (bytes.toString('base64url') !== encoded) return invalid()
    cursor = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch { return invalid() }
  if (!Array.isArray(cursor) || cursor.length !== 5 || cursor[0] !== sort.id || cursor[1] !== direction || cursor[2] !== context) return invalid()
  return { value: scalar(cursor[3], sort), id: itemId(cursor[4]) }
}
export function listQuery(query: object, maximum: number, spec: QuerySpec = EMPTY_SPEC): ListQuery {
  const source = object(query)
  const allowed = ['limit', 'after', ...(spec.filterFields.length ? ['filter'] : []),
    ...(spec.searchFields.length ? ['q'] : []), ...(spec.sortFields.length ? ['sort', 'direction'] : [])]
  if (Object.keys(source).some((key) => !allowed.includes(key))) return invalid()
  const size = source.limit
  if (size !== undefined && (typeof size !== 'string' || !/^[1-9][0-9]{0,2}$/u.test(size))) return invalid()
  const limit = size === undefined ? maximum : Number(size)
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum) return invalid()
  const filter = parseFilter(source.filter, spec.filterFields)
  const search = source.q === undefined ? undefined : { fields: spec.searchFields, value: text(source.q, 128) }
  if (search && !search.value.trim()) return invalid()
  const sort = source.sort === undefined ? undefined : spec.sortFields.find((field) => field.id === source.sort)
  if (source.sort !== undefined && !sort) return invalid()
  if (source.direction !== undefined && (!sort || !['asc', 'desc'].includes(String(source.direction)) || typeof source.direction !== 'string')) return invalid()
  const direction = source.direction === 'desc' ? 'desc' : 'asc'
  const context = createHash('sha256').update(JSON.stringify([filter.map(({field,value}) => [field.id,value]), search?.value ?? null])).digest('hex')
  return { limit, filter, direction, context, ...(sort ? { sort } : {}), ...(search ? { search } : {}),
    ...(source.after === undefined ? {} : sort ? { cursor: parseCursor(source.after, sort, direction, context) } : { after: itemId(source.after) }) }
}
`
