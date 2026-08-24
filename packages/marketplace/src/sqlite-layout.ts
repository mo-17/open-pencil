import type { Database } from 'bun:sqlite'
import { basename, dirname, join, resolve } from 'node:path'

export const MARKETPLACE_SQLITE_SCHEMA_VERSION = 1 as const
export const MARKETPLACE_INCOMPLETE_GENERATION_FILE = '.openpencil-marketplace-incomplete' as const

interface MarketplaceSqliteSchemaObject {
  readonly type: string
  readonly name: string
  readonly table_name: string
  readonly sql: string | null
}

interface MarketplaceSqliteColumn {
  readonly cid: number
  readonly name: string
  readonly type: string
  readonly notnull: number
  readonly dflt_value: string | null
  readonly pk: number
  readonly hidden: number
}

interface MarketplaceSqliteIndex {
  readonly name: string
  readonly unique: number
  readonly origin: string
  readonly partial: number
}

interface MarketplaceSqliteIndexColumn {
  readonly seqno: number
  readonly cid: number
  readonly name: string | null
}

const EXPECTED_USER_SCHEMA = Object.freeze([
  Object.freeze({
    type: 'index',
    name: 'marketplace_nonces_expiry',
    tableName: 'marketplace_nonces',
    sql: 'CREATE INDEX marketplace_nonces_expiry ON marketplace_nonces (expires_at)'
  }),
  Object.freeze({
    type: 'table',
    name: 'marketplace_nonces',
    tableName: 'marketplace_nonces',
    sql: 'CREATE TABLE marketplace_nonces ( publisher_id TEXT NOT NULL, nonce TEXT NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY (publisher_id, nonce) )'
  }),
  Object.freeze({
    type: 'table',
    name: 'marketplace_state',
    tableName: 'marketplace_state',
    sql: 'CREATE TABLE marketplace_state ( id INTEGER PRIMARY KEY CHECK (id = 1), schema_version INTEGER NOT NULL, state_json TEXT NOT NULL )'
  })
])

const EXPECTED_STATE_COLUMNS = Object.freeze([
  '0:id:INTEGER:0:null:1:0',
  '1:schema_version:INTEGER:1:null:0:0',
  '2:state_json:TEXT:1:null:0:0'
])

const EXPECTED_NONCE_COLUMNS = Object.freeze([
  '0:publisher_id:TEXT:1:null:1:0',
  '1:nonce:TEXT:1:null:2:0',
  '2:expires_at:INTEGER:1:null:0:0'
])

const EXPECTED_NONCE_INDEXES = Object.freeze([
  'marketplace_nonces_expiry:0:c:0',
  'sqlite_autoindex_marketplace_nonces_1:1:pk:0'
])

function normalizedSQL(value: string | null): string {
  return value?.replace(/\s+/g, ' ').trim() ?? 'null'
}

function schemaObjectSignature(value: MarketplaceSqliteSchemaObject): string {
  return [value.type, value.name, value.table_name, normalizedSQL(value.sql)].join(':')
}

function expectedSchemaObjectSignature(value: (typeof EXPECTED_USER_SCHEMA)[number]): string {
  return [value.type, value.name, value.tableName, value.sql].join(':')
}

function columnSignature(value: MarketplaceSqliteColumn): string {
  return [
    value.cid,
    value.name,
    value.type,
    value.notnull,
    value.dflt_value ?? 'null',
    value.pk,
    value.hidden
  ].join(':')
}

function indexSignature(value: MarketplaceSqliteIndex): string {
  return [value.name, value.unique, value.origin, value.partial].join(':')
}

function indexColumnSignature(value: MarketplaceSqliteIndexColumn): string {
  return [value.seqno, value.cid, value.name ?? 'null'].join(':')
}

function matches(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.join('\n') === expected.join('\n')
}

export function assertMarketplaceSqliteSchema(database: Database, label: string): void {
  const userSchema = database
    .query<MarketplaceSqliteSchemaObject, []>(`
      SELECT type, name, tbl_name AS table_name, sql
      FROM sqlite_master
      WHERE type IN ('table', 'index', 'trigger', 'view')
        AND name NOT GLOB 'sqlite_*'
      ORDER BY type, name
    `)
    .all()
    .map(schemaObjectSignature)
  const stateColumns = database
    .query<MarketplaceSqliteColumn, []>('PRAGMA table_xinfo(marketplace_state)')
    .all()
    .map(columnSignature)
  const nonceColumns = database
    .query<MarketplaceSqliteColumn, []>('PRAGMA table_xinfo(marketplace_nonces)')
    .all()
    .map(columnSignature)
  const stateIndexes = database
    .query<MarketplaceSqliteIndex, []>('PRAGMA index_list(marketplace_state)')
    .all()
    .map(indexSignature)
    .sort()
  const nonceIndexes = database
    .query<MarketplaceSqliteIndex, []>('PRAGMA index_list(marketplace_nonces)')
    .all()
    .map(indexSignature)
    .sort()
  const expiryIndexColumns = database
    .query<MarketplaceSqliteIndexColumn, []>('PRAGMA index_info(marketplace_nonces_expiry)')
    .all()
    .map(indexColumnSignature)
  const noncePrimaryKeyColumns = database
    .query<MarketplaceSqliteIndexColumn, []>(
      'PRAGMA index_info(sqlite_autoindex_marketplace_nonces_1)'
    )
    .all()
    .map(indexColumnSignature)

  if (
    !matches(userSchema, EXPECTED_USER_SCHEMA.map(expectedSchemaObjectSignature)) ||
    !matches(stateColumns, EXPECTED_STATE_COLUMNS) ||
    !matches(nonceColumns, EXPECTED_NONCE_COLUMNS) ||
    stateIndexes.length !== 0 ||
    !matches(nonceIndexes, EXPECTED_NONCE_INDEXES) ||
    !matches(expiryIndexColumns, ['0:2:expires_at']) ||
    !matches(noncePrimaryKeyColumns, ['0:0:publisher_id', '1:1:nonce'])
  ) {
    throw new Error(
      `${label} schema does not exactly match the Marketplace schema-v${MARKETPLACE_SQLITE_SCHEMA_VERSION} allowlist`
    )
  }
}

export function marketplaceGenerationReservationPath(generationPath: string): string {
  const generation = resolve(generationPath)
  const name = basename(generation)
  if (name.length === 0) {
    throw new Error('Marketplace generation must not be the filesystem root')
  }
  return join(dirname(generation), `.${name}${MARKETPLACE_INCOMPLETE_GENERATION_FILE}`)
}
