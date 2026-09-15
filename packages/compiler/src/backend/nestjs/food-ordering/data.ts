/** Static generated SQL helpers: author input supplies values, never identifiers or SQL. */
export const FOOD_DATA_SOURCE = String.raw`import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import type { DatabaseTransaction } from './database.service.js'
import type { CommandRow, Scalar } from './command-types.js'
import { commandScalar } from './command-input.js'
import { FOOD } from './food-model.js'

export type FoodTable = keyof typeof FOOD.tables
export type FoodRow = CommandRow
export type FoodInput = Readonly<Record<string, Scalar>>
export const foodConflict = (): never => { throw new ConflictException('Food ordering state conflict.') }
export const foodMissing = (): never => { throw new NotFoundException('Record not found.') }
export function foodAmount(value: unknown): number {
  const integer = typeof value === 'bigint' ? value : typeof value === 'number' && Number.isSafeInteger(value) ? BigInt(value) : -1n
  if (integer < 0n || integer > 2147483647n) return foodConflict()
  return Number(integer)
}
export function foodText(value: Scalar | undefined): string {
  if (typeof value !== 'string') throw new ServiceUnavailableException('Invalid stored food ordering value.')
  return value
}
export function foodRequired(value: Scalar | undefined): string {
  const text = foodText(value).trim()
  if (!text) throw new BadRequestException('A nonempty value is required.')
  return text
}
export function foodColumn(table: FoodTable, field: string): string {
  const columns: Readonly<Record<string, string>> = FOOD.tables[table].columns
  if (!Object.hasOwn(columns, field)) throw new ServiceUnavailableException('Invalid food ordering field.')
  return columns[field]
}
function foodRecord(value: Record<string, unknown>): FoodRow {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, commandScalar(item)]))
}
export async function foodRows(client: DatabaseTransaction, table: FoodTable, filters: FoodInput, lock: 'none' | 'share' | 'update' = 'none', limit = FOOD.maxItems + 1): Promise<FoodRow[]> {
  const keys = Object.keys(filters)
  if (!keys.length || !Number.isSafeInteger(limit) || limit < 1 || limit > FOOD.maxItems + 1) return foodConflict()
  const model = FOOD.tables[table]
  const predicate = keys.map((key, index) => foodColumn(table, key) + '=$' + (index + 1)).join(' AND ')
  const locking = lock === 'none' ? '' : lock === 'share' ? ' FOR SHARE' : ' FOR UPDATE'
  const result = await client.query('SELECT ' + model.projection + ' FROM ' + model.table + ' WHERE ' + predicate +
    ' ORDER BY ' + foodColumn(table, 'id') + ' LIMIT ' + limit + locking, keys.map(key => filters[key]))
  return result.rows.map(foodRecord)
}
export async function foodOne(client: DatabaseTransaction, table: FoodTable, filters: FoodInput, lock: 'share' | 'update' = 'update'): Promise<FoodRow> {
  return (await foodRows(client, table, filters, lock, 1))[0] ?? foodMissing()
}
export async function foodInsert(client: DatabaseTransaction, table: FoodTable, values: FoodInput): Promise<FoodRow> {
  const model = FOOD.tables[table], keys = Object.keys(values)
  const columns = keys.map(key => foodColumn(table, key)).join(',')
  const placeholders = keys.map((_, index) => '$' + (index + 1)).join(',')
  const result = await client.query('INSERT INTO ' + model.table + ' (' + columns + ') VALUES (' + placeholders + ') RETURNING ' + model.projection, keys.map(key => values[key]))
  if (!result.rows[0]) throw new ServiceUnavailableException('Food ordering insert failed.')
  return foodRecord(result.rows[0])
}
export async function foodUpdate(client: DatabaseTransaction, table: FoodTable, id: Scalar, values: FoodInput): Promise<FoodRow> {
  const model = FOOD.tables[table], keys = Object.keys(values)
  const assignments = keys.map((key, index) => foodColumn(table, key) + '=$' + (index + 2)).join(',')
  const result = await client.query('UPDATE ' + model.table + ' SET ' + assignments + ' WHERE ' + foodColumn(table, 'id') + '=$1 RETURNING ' + model.projection, [id, ...keys.map(key => values[key])])
  return result.rows[0] ? foodRecord(result.rows[0]) : foodMissing()
}
export async function foodCart(client: DatabaseTransaction, subject: string): Promise<FoodRow> {
  const table = FOOD.tables.carts.table, owner = foodColumn('carts', 'owner_id')
  await client.query('INSERT INTO ' + table + ' (' + owner + ') VALUES ($1) ON CONFLICT (' + owner + ') DO NOTHING', [subject])
  return foodOne(client, 'carts', { owner_id: subject })
}
export function foodProjection(row: FoodRow, fields: readonly string[]): FoodRow {
  return Object.fromEntries(fields.map(field => [field, commandScalar(row[field])]))
}
`
