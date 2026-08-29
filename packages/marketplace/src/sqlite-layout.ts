import type { Database } from 'bun:sqlite'
import { basename, dirname, join, resolve } from 'node:path'

export const MARKETPLACE_SQLITE_SCHEMA_VERSION = 5 as const
export const MARKETPLACE_PUBLICATION_RESERVATION_SQLITE_SCHEMA_VERSION = 4 as const
export const MARKETPLACE_TERMINAL_RECEIPT_SQLITE_SCHEMA_VERSION = 3 as const
export const MARKETPLACE_SUCCESS_RECEIPT_SQLITE_SCHEMA_VERSION = 2 as const
export const MARKETPLACE_LEGACY_SQLITE_SCHEMA_VERSION = 1 as const
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

interface MarketplaceSqliteForeignKey {
  readonly id: number
  readonly seq: number
  readonly table_name: string
  readonly from_column: string
  readonly to_column: string
  readonly on_update: string
  readonly on_delete: string
  readonly match: string
}

const STATE_SCHEMA =
  'CREATE TABLE marketplace_state ( id INTEGER PRIMARY KEY CHECK (id = 1), schema_version INTEGER NOT NULL, state_json TEXT NOT NULL )'
const LEGACY_NONCE_SCHEMA =
  'CREATE TABLE marketplace_nonces ( publisher_id TEXT NOT NULL, nonce TEXT NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY (publisher_id, nonce) )'
const NONCE_SCHEMA =
  'CREATE TABLE marketplace_nonces ( namespace TEXT NOT NULL, subject_id TEXT NOT NULL, nonce TEXT NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY (namespace, subject_id, nonce) )'
const SUCCESS_RECEIPT_SCHEMA =
  "CREATE TABLE marketplace_publisher_mutation_receipts ( namespace TEXT NOT NULL CHECK (namespace = 'publisher-request-v2'), publisher_id TEXT NOT NULL, nonce TEXT NOT NULL, auth_version INTEGER NOT NULL CHECK (auth_version = 2), operation TEXT NOT NULL, audience TEXT NOT NULL, key_id TEXT NOT NULL, method TEXT NOT NULL CHECK (method = 'POST'), target TEXT NOT NULL, timestamp TEXT NOT NULL, fresh_until INTEGER NOT NULL, body_digest TEXT NOT NULL, request_digest TEXT NOT NULL, signature_digest TEXT NOT NULL, response_status INTEGER NOT NULL CHECK (response_status IN (200, 201)), response_json TEXT NOT NULL, response_digest TEXT NOT NULL, response_byte_length INTEGER NOT NULL CHECK (response_byte_length > 0), committed_at INTEGER NOT NULL, PRIMARY KEY (namespace, publisher_id, nonce), FOREIGN KEY (namespace, publisher_id, nonce) REFERENCES marketplace_nonces (namespace, subject_id, nonce) ON DELETE CASCADE )"
const RECEIPT_SCHEMA =
  "CREATE TABLE marketplace_publisher_mutation_receipts ( namespace TEXT NOT NULL CHECK (namespace = 'publisher-request-v2'), publisher_id TEXT NOT NULL, nonce TEXT NOT NULL, auth_version INTEGER NOT NULL CHECK (auth_version = 2), operation TEXT NOT NULL, audience TEXT NOT NULL, key_id TEXT NOT NULL, method TEXT NOT NULL CHECK (method = 'POST'), target TEXT NOT NULL, timestamp TEXT NOT NULL, fresh_until INTEGER NOT NULL, body_digest TEXT NOT NULL, request_digest TEXT NOT NULL, signature_digest TEXT NOT NULL, response_status INTEGER NOT NULL CHECK (response_status IN (200, 201, 400, 401, 404, 409)), response_json TEXT NOT NULL, response_digest TEXT NOT NULL, response_byte_length INTEGER NOT NULL CHECK (response_byte_length > 0), committed_at INTEGER NOT NULL, PRIMARY KEY (namespace, publisher_id, nonce), FOREIGN KEY (namespace, publisher_id, nonce) REFERENCES marketplace_nonces (namespace, subject_id, nonce) ON DELETE CASCADE )"
const PUBLICATION_RESERVATION_SCHEMA =
  'CREATE TABLE marketplace_publication_reservation ( id INTEGER PRIMARY KEY CHECK (id = 1), request_digest TEXT NOT NULL, state_digest TEXT NOT NULL, audit_sequence INTEGER NOT NULL CHECK (audit_sequence > 0), audit_head TEXT NOT NULL, expected_next_sequence INTEGER NOT NULL CHECK (expected_next_sequence > 0) )'
const PUBLICATION_COMPLETION_RECEIPT_SCHEMA =
  'CREATE TABLE marketplace_publication_completion_receipts ( request_digest TEXT PRIMARY KEY, bundle_digest TEXT NOT NULL, state_digest TEXT NOT NULL, audit_sequence INTEGER NOT NULL CHECK (audit_sequence > 0), audit_head TEXT NOT NULL, expected_next_sequence INTEGER NOT NULL CHECK (expected_next_sequence > 0), completion_event_hash TEXT NOT NULL, publication_json TEXT NOT NULL )'

interface ExpectedMarketplaceSqliteSchemaObject {
  readonly type: 'index' | 'table'
  readonly name: string
  readonly tableName: string
  readonly sql: string
}

function expectedTable(name: string, sql: string): Readonly<ExpectedMarketplaceSqliteSchemaObject> {
  return Object.freeze({ type: 'table', name, tableName: name, sql })
}

const EXPECTED_NONCE_EXPIRY_INDEX = Object.freeze({
  type: 'index' as const,
  name: 'marketplace_nonces_expiry',
  tableName: 'marketplace_nonces',
  sql: 'CREATE INDEX marketplace_nonces_expiry ON marketplace_nonces (expires_at)'
}) satisfies ExpectedMarketplaceSqliteSchemaObject
const EXPECTED_LEGACY_NONCE_TABLE = expectedTable('marketplace_nonces', LEGACY_NONCE_SCHEMA)
const EXPECTED_NONCE_TABLE = expectedTable('marketplace_nonces', NONCE_SCHEMA)
const EXPECTED_SUCCESS_RECEIPT_TABLE = expectedTable(
  'marketplace_publisher_mutation_receipts',
  SUCCESS_RECEIPT_SCHEMA
)
const EXPECTED_RECEIPT_TABLE = expectedTable(
  'marketplace_publisher_mutation_receipts',
  RECEIPT_SCHEMA
)
const EXPECTED_PUBLICATION_RESERVATION_TABLE = expectedTable(
  'marketplace_publication_reservation',
  PUBLICATION_RESERVATION_SCHEMA
)
const EXPECTED_PUBLICATION_COMPLETION_RECEIPT_TABLE = expectedTable(
  'marketplace_publication_completion_receipts',
  PUBLICATION_COMPLETION_RECEIPT_SCHEMA
)
const EXPECTED_STATE_TABLE = expectedTable('marketplace_state', STATE_SCHEMA)

function expectedUserSchema(
  ...tables: Readonly<ExpectedMarketplaceSqliteSchemaObject>[]
): readonly Readonly<ExpectedMarketplaceSqliteSchemaObject>[] {
  return Object.freeze([EXPECTED_NONCE_EXPIRY_INDEX, ...tables, EXPECTED_STATE_TABLE])
}

const EXPECTED_V1_USER_SCHEMA = expectedUserSchema(EXPECTED_LEGACY_NONCE_TABLE)
const EXPECTED_V2_USER_SCHEMA = expectedUserSchema(
  EXPECTED_NONCE_TABLE,
  EXPECTED_SUCCESS_RECEIPT_TABLE
)
const EXPECTED_V3_USER_SCHEMA = expectedUserSchema(EXPECTED_NONCE_TABLE, EXPECTED_RECEIPT_TABLE)
const EXPECTED_V4_USER_SCHEMA = expectedUserSchema(
  EXPECTED_NONCE_TABLE,
  EXPECTED_PUBLICATION_RESERVATION_TABLE,
  EXPECTED_RECEIPT_TABLE
)
const EXPECTED_V5_USER_SCHEMA = expectedUserSchema(
  EXPECTED_NONCE_TABLE,
  EXPECTED_PUBLICATION_COMPLETION_RECEIPT_TABLE,
  EXPECTED_PUBLICATION_RESERVATION_TABLE,
  EXPECTED_RECEIPT_TABLE
)

const EXPECTED_STATE_COLUMNS = Object.freeze([
  '0:id:INTEGER:0:null:1:0',
  '1:schema_version:INTEGER:1:null:0:0',
  '2:state_json:TEXT:1:null:0:0'
])

const EXPECTED_V1_NONCE_COLUMNS = Object.freeze([
  '0:publisher_id:TEXT:1:null:1:0',
  '1:nonce:TEXT:1:null:2:0',
  '2:expires_at:INTEGER:1:null:0:0'
])

const EXPECTED_V2_NONCE_COLUMNS = Object.freeze([
  '0:namespace:TEXT:1:null:1:0',
  '1:subject_id:TEXT:1:null:2:0',
  '2:nonce:TEXT:1:null:3:0',
  '3:expires_at:INTEGER:1:null:0:0'
])

const EXPECTED_RECEIPT_COLUMNS = Object.freeze([
  '0:namespace:TEXT:1:null:1:0',
  '1:publisher_id:TEXT:1:null:2:0',
  '2:nonce:TEXT:1:null:3:0',
  '3:auth_version:INTEGER:1:null:0:0',
  '4:operation:TEXT:1:null:0:0',
  '5:audience:TEXT:1:null:0:0',
  '6:key_id:TEXT:1:null:0:0',
  '7:method:TEXT:1:null:0:0',
  '8:target:TEXT:1:null:0:0',
  '9:timestamp:TEXT:1:null:0:0',
  '10:fresh_until:INTEGER:1:null:0:0',
  '11:body_digest:TEXT:1:null:0:0',
  '12:request_digest:TEXT:1:null:0:0',
  '13:signature_digest:TEXT:1:null:0:0',
  '14:response_status:INTEGER:1:null:0:0',
  '15:response_json:TEXT:1:null:0:0',
  '16:response_digest:TEXT:1:null:0:0',
  '17:response_byte_length:INTEGER:1:null:0:0',
  '18:committed_at:INTEGER:1:null:0:0'
])

const EXPECTED_PUBLICATION_RESERVATION_COLUMNS = Object.freeze([
  '0:id:INTEGER:0:null:1:0',
  '1:request_digest:TEXT:1:null:0:0',
  '2:state_digest:TEXT:1:null:0:0',
  '3:audit_sequence:INTEGER:1:null:0:0',
  '4:audit_head:TEXT:1:null:0:0',
  '5:expected_next_sequence:INTEGER:1:null:0:0'
])

const EXPECTED_PUBLICATION_COMPLETION_RECEIPT_COLUMNS = Object.freeze([
  '0:request_digest:TEXT:0:null:1:0',
  '1:bundle_digest:TEXT:1:null:0:0',
  '2:state_digest:TEXT:1:null:0:0',
  '3:audit_sequence:INTEGER:1:null:0:0',
  '4:audit_head:TEXT:1:null:0:0',
  '5:expected_next_sequence:INTEGER:1:null:0:0',
  '6:completion_event_hash:TEXT:1:null:0:0',
  '7:publication_json:TEXT:1:null:0:0'
])

function normalizedSQL(value: string | null): string {
  return value?.replace(/\s+/g, ' ').trim() ?? 'null'
}

function schemaObjectSignature(value: MarketplaceSqliteSchemaObject): string {
  return [value.type, value.name, value.table_name, normalizedSQL(value.sql)].join(':')
}

function expectedSchemaObjectSignature(value: ExpectedMarketplaceSqliteSchemaObject): string {
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

function foreignKeySignature(value: MarketplaceSqliteForeignKey): string {
  return [
    value.id,
    value.seq,
    value.table_name,
    value.from_column,
    value.to_column,
    value.on_update,
    value.on_delete,
    value.match
  ].join(':')
}

function matches(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.join('\n') === expected.join('\n')
}

function schemaObjects(database: Database): string[] {
  return database
    .query<MarketplaceSqliteSchemaObject, []>(`
      SELECT type, name, tbl_name AS table_name, sql
      FROM sqlite_master
      WHERE type IN ('table', 'index', 'trigger', 'view')
        AND name NOT GLOB 'sqlite_*'
      ORDER BY type, name
    `)
    .all()
    .map(schemaObjectSignature)
}

function columns(database: Database, table: string): string[] {
  return database
    .query<MarketplaceSqliteColumn, []>(`PRAGMA table_xinfo(${table})`)
    .all()
    .map(columnSignature)
}

function indexes(database: Database, table: string): string[] {
  return database
    .query<MarketplaceSqliteIndex, []>(`PRAGMA index_list(${table})`)
    .all()
    .map(indexSignature)
    .sort()
}

function indexColumns(database: Database, index: string): string[] {
  return database
    .query<MarketplaceSqliteIndexColumn, []>(`PRAGMA index_info(${index})`)
    .all()
    .map(indexColumnSignature)
}

export function assertMarketplaceSqliteSchemaV1(database: Database, label: string): void {
  if (
    !matches(schemaObjects(database), EXPECTED_V1_USER_SCHEMA.map(expectedSchemaObjectSignature)) ||
    !matches(columns(database, 'marketplace_state'), EXPECTED_STATE_COLUMNS) ||
    !matches(columns(database, 'marketplace_nonces'), EXPECTED_V1_NONCE_COLUMNS) ||
    indexes(database, 'marketplace_state').length !== 0 ||
    !matches(indexes(database, 'marketplace_nonces'), [
      'marketplace_nonces_expiry:0:c:0',
      'sqlite_autoindex_marketplace_nonces_1:1:pk:0'
    ]) ||
    !matches(indexColumns(database, 'marketplace_nonces_expiry'), ['0:2:expires_at']) ||
    !matches(indexColumns(database, 'sqlite_autoindex_marketplace_nonces_1'), [
      '0:0:publisher_id',
      '1:1:nonce'
    ])
  ) {
    throw new Error(`${label} schema does not exactly match the Marketplace schema-v1 allowlist`)
  }
}

function publicationSchemaMatches(
  database: Database,
  includesReservation: boolean,
  includesCompletion: boolean
): boolean {
  if (
    includesReservation &&
    (!matches(
      columns(database, 'marketplace_publication_reservation'),
      EXPECTED_PUBLICATION_RESERVATION_COLUMNS
    ) ||
      indexes(database, 'marketplace_publication_reservation').length !== 0)
  ) {
    return false
  }
  if (
    includesCompletion &&
    (!matches(
      columns(database, 'marketplace_publication_completion_receipts'),
      EXPECTED_PUBLICATION_COMPLETION_RECEIPT_COLUMNS
    ) ||
      !matches(indexes(database, 'marketplace_publication_completion_receipts'), [
        'sqlite_autoindex_marketplace_publication_completion_receipts_1:1:pk:0'
      ]) ||
      !matches(
        indexColumns(database, 'sqlite_autoindex_marketplace_publication_completion_receipts_1'),
        ['0:0:request_digest']
      ))
  ) {
    return false
  }
  return true
}

function assertMarketplaceSqliteReceiptSchema(
  database: Database,
  label: string,
  expectedSchema: readonly ExpectedMarketplaceSqliteSchemaObject[],
  schemaVersion: number,
  includesPublicationReservation = false,
  includesPublicationCompletion = false
): void {
  const foreignKeys = database
    .query<MarketplaceSqliteForeignKey, []>(
      `SELECT id, seq, "table" AS table_name, "from" AS from_column,
              "to" AS to_column, on_update, on_delete, match
       FROM pragma_foreign_key_list('marketplace_publisher_mutation_receipts')
       ORDER BY id, seq`
    )
    .all()
    .map(foreignKeySignature)
  if (
    !matches(schemaObjects(database), expectedSchema.map(expectedSchemaObjectSignature)) ||
    !matches(columns(database, 'marketplace_state'), EXPECTED_STATE_COLUMNS) ||
    !matches(columns(database, 'marketplace_nonces'), EXPECTED_V2_NONCE_COLUMNS) ||
    !matches(
      columns(database, 'marketplace_publisher_mutation_receipts'),
      EXPECTED_RECEIPT_COLUMNS
    ) ||
    !publicationSchemaMatches(
      database,
      includesPublicationReservation,
      includesPublicationCompletion
    ) ||
    indexes(database, 'marketplace_state').length !== 0 ||
    !matches(indexes(database, 'marketplace_nonces'), [
      'marketplace_nonces_expiry:0:c:0',
      'sqlite_autoindex_marketplace_nonces_1:1:pk:0'
    ]) ||
    !matches(indexes(database, 'marketplace_publisher_mutation_receipts'), [
      'sqlite_autoindex_marketplace_publisher_mutation_receipts_1:1:pk:0'
    ]) ||
    !matches(indexColumns(database, 'marketplace_nonces_expiry'), ['0:3:expires_at']) ||
    !matches(indexColumns(database, 'sqlite_autoindex_marketplace_nonces_1'), [
      '0:0:namespace',
      '1:1:subject_id',
      '2:2:nonce'
    ]) ||
    !matches(indexColumns(database, 'sqlite_autoindex_marketplace_publisher_mutation_receipts_1'), [
      '0:0:namespace',
      '1:1:publisher_id',
      '2:2:nonce'
    ]) ||
    !matches(foreignKeys, [
      '0:0:marketplace_nonces:namespace:namespace:NO ACTION:CASCADE:NONE',
      '0:1:marketplace_nonces:publisher_id:subject_id:NO ACTION:CASCADE:NONE',
      '0:2:marketplace_nonces:nonce:nonce:NO ACTION:CASCADE:NONE'
    ])
  ) {
    throw new Error(
      `${label} schema does not exactly match the Marketplace schema-v${schemaVersion} allowlist`
    )
  }
}

export function assertMarketplaceSqliteSchemaV2(database: Database, label: string): void {
  assertMarketplaceSqliteReceiptSchema(
    database,
    label,
    EXPECTED_V2_USER_SCHEMA,
    MARKETPLACE_SUCCESS_RECEIPT_SQLITE_SCHEMA_VERSION
  )
}

export function assertMarketplaceSqliteSchemaV3(database: Database, label: string): void {
  assertMarketplaceSqliteReceiptSchema(
    database,
    label,
    EXPECTED_V3_USER_SCHEMA,
    MARKETPLACE_TERMINAL_RECEIPT_SQLITE_SCHEMA_VERSION
  )
}

export function assertMarketplaceSqliteSchemaV4(database: Database, label: string): void {
  assertMarketplaceSqliteReceiptSchema(
    database,
    label,
    EXPECTED_V4_USER_SCHEMA,
    MARKETPLACE_PUBLICATION_RESERVATION_SQLITE_SCHEMA_VERSION,
    true
  )
}

export function assertMarketplaceSqliteSchema(database: Database, label: string): void {
  assertMarketplaceSqliteReceiptSchema(
    database,
    label,
    EXPECTED_V5_USER_SCHEMA,
    MARKETPLACE_SQLITE_SCHEMA_VERSION,
    true,
    true
  )
}

export function marketplaceGenerationReservationPath(generationPath: string): string {
  const generation = resolve(generationPath)
  const name = basename(generation)
  if (name.length === 0) {
    throw new Error('Marketplace generation must not be the filesystem root')
  }
  return join(dirname(generation), `.${name}${MARKETPLACE_INCOMPLETE_GENERATION_FILE}`)
}
