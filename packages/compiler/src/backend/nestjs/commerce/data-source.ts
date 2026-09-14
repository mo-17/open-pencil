export const COMMERCE_DATA_SOURCE = String.raw`import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import type { DatabaseTransaction } from './database.service.js'
import { COMMERCE } from './commerce-model.js'
import type { CommandRow, Scalar } from './command-types.js'
import { commandScalar } from './command-input.js'

export type TableKey = keyof typeof COMMERCE.tables
export type Row = CommandRow
export type Input = Readonly<Record<string, Scalar>>
export interface Context { cart?: Row; group?: Row; order?: Row; refund?: Row; settlement?: Row; product?: Row }
export const conflict = (): never => { throw new ConflictException('Commerce state conflict.') }
export const missing = (): never => { throw new NotFoundException('Record not found.') }
export function text(value: Scalar | undefined): string {
  if (typeof value !== 'string') throw new ServiceUnavailableException('Invalid stored commerce value.')
  return value
}
export function amount(value: Scalar | bigint | undefined): number {
  const integer = typeof value === 'bigint' ? value : typeof value === 'number' && Number.isInteger(value) ? BigInt(value) : -1n
  if (integer < 0n || integer > 2147483647n) return conflict()
  return Number(integer)
}
export function requiredText(value: Scalar | undefined): string {
  const result = text(value).trim()
  if (!result) throw new BadRequestException('A nonempty value is required.')
  return result
}
export function column(key: TableKey, field: string): string {
  const columns: Readonly<Record<string, string>> = COMMERCE.tables[key].columns
  const result = columns[field]
  if (!result) throw new ServiceUnavailableException('Invalid commerce field.')
  return result
}
function record(value: Record<string, unknown>): Row {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, commandScalar(item)]))
}
export async function rows(client: DatabaseTransaction, key: TableKey, filters: Input, lock: boolean | 'share' = false, limit = 51): Promise<Row[]> {
  const fields = Object.keys(filters)
  if (!fields.length || !Number.isInteger(limit) || limit < 1 || limit > 501) return conflict()
  const model = COMMERCE.tables[key]
  const where = fields.map((field, index) => column(key, field) + '=$' + (index + 1)).join(' AND ')
  const result = await client.query('SELECT ' + model.projection + ' FROM ' + model.table + ' WHERE ' + where +
    ' ORDER BY ' + column(key, 'id') + ' LIMIT ' + limit + (lock === 'share' ? ' FOR SHARE' : lock ? ' FOR UPDATE' : ''), fields.map((field) => filters[field]))
  return result.rows.map(record)
}
export async function one(client: DatabaseTransaction, key: TableKey, filters: Input, lock: boolean | 'share' = true): Promise<Row> {
  return (await rows(client, key, filters, lock, 1))[0] ?? missing()
}
export async function insert(client: DatabaseTransaction, key: TableKey, values: Input): Promise<Row> {
  const fields = Object.keys(values)
  const model = COMMERCE.tables[key]
  const result = await client.query('INSERT INTO ' + model.table + ' (' + fields.map((field) => column(key, field)).join(',') +
    ') VALUES (' + fields.map((_, index) => '$' + (index + 1)).join(',') + ') RETURNING ' + model.projection,
    fields.map((field) => values[field]))
  return record(result.rows[0])
}
export async function update(client: DatabaseTransaction, key: TableKey, id: Scalar, values: Input): Promise<Row> {
  const fields = Object.keys(values)
  const model = COMMERCE.tables[key]
  const result = await client.query('UPDATE ' + model.table + ' SET ' + fields.map((field, index) => column(key, field) + '=$' + (index + 2)).join(',') +
    ' WHERE ' + column(key, 'id') + '=$1 RETURNING ' + model.projection, [id, ...fields.map((field) => values[field])])
  return result.rows[0] ? record(result.rows[0]) : missing()
}
export async function cart(client: DatabaseTransaction, subject: string): Promise<Row> {
  const model = COMMERCE.tables.carts
  await client.query('INSERT INTO ' + model.table + ' (' + column('carts', 'owner_id') + ') VALUES ($1) ON CONFLICT (' + column('carts', 'owner_id') + ') DO NOTHING', [subject])
  return one(client, 'carts', { owner_id: subject })
}
export async function storeMember(client: DatabaseTransaction, storeId: Scalar, subject: string): Promise<void> {
  const model = COMMERCE.tables.stores
  const result = await client.query('SELECT ' + column('stores', 'id') + ' FROM ' + model.table + ' WHERE ' +
    column('stores', 'id') + '=$1 AND ' + column('stores', 'owner_id') + '=$2 FOR SHARE', [storeId, subject])
  if (result.rows.length !== 1) missing()
}
export async function entry(client: DatabaseTransaction, order: Row, kind: string, value: number, reference = ''): Promise<void> {
  const settlement = await one(client, 'settlements', { order_id: order.id })
  await client.query('INSERT INTO public.openpencil_commerce_entries (application_id,entry_key,order_id,kind,amount,currency,reference,merchant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (application_id,entry_key) DO NOTHING',
    [COMMERCE.applicationId, text(order.id) + ':' + kind, order.id, kind, value, order.currency, reference, settlement.merchant_id])
}
export async function event(client: DatabaseTransaction, group: Row, kind: string): Promise<boolean> {
  const result = await client.query('INSERT INTO public.openpencil_commerce_events (application_id,event_key,group_id,kind) VALUES ($1,$2,$3,$4) ON CONFLICT (application_id,event_key) DO NOTHING RETURNING event_key',
    [COMMERCE.applicationId, 'development-simulator:' + text(group.id) + ':' + kind, group.id, kind])
  return result.rows.length === 1
}
export function projected(row: Row, fields: readonly string[]): Row {
  const result = Object.create(null) as Row
  for (const field of fields) result[field] = commandScalar(row[field])
  return result
}
`
