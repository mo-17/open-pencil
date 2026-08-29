/* eslint-disable max-lines -- Exact schema migration, receipt validation, and one SQLite transaction boundary are reviewed together. */
import { Database } from 'bun:sqlite'
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

import {
  canonicalManifestJSON,
  canonicalManifestValue,
  parseSha256Base64URL,
  validateModuleIdentity
} from '@open-pencil/scene-graph'

import { verifyMarketplaceAuditChain } from './audit'
import {
  MARKETPLACE_NONCE_NAMESPACES,
  type MarketplaceNonceNamespace,
  type MarketplaceNonceStore
} from './auth'
import {
  MarketplacePublicationCompletionConflictError,
  MarketplacePublicationQuiescedError,
  MarketplacePublicationReservationConflictError,
  assertMarketplacePublicationCompletionReceiptState,
  assertMarketplacePublicationReservationState,
  parseMarketplacePublicationCompletionReceipt,
  parseMarketplacePublicationReservation,
  sameMarketplacePublicationReservation,
  type MarketplacePublicationCompletionReceiptV1,
  type MarketplacePublicationReservationV1
} from './publication/reservation'
import {
  MARKETPLACE_PUBLISHER_MUTATION_LIMITS,
  MarketplacePublisherMutationCommitPlan,
  MarketplacePublisherMutationCapacityError,
  MarketplacePublisherMutationConflictError,
  MarketplacePublisherMutationTerminalError,
  createMarketplacePublisherMutationTerminalResponse,
  parseMarketplacePublisherMutationResponse,
  parseMarketplacePublisherMutationSuccessResponse,
  parseMarketplaceVerifiedPublisherMutationRequest,
  sameMarketplacePublisherMutationRequest,
  type MarketplacePublisherMutationExecution,
  type MarketplacePublisherMutationReceipt,
  type MarketplacePublisherMutationResponse,
  type MarketplacePublisherMutationSuccessResponse,
  type MarketplaceVerifiedPublisherMutationRequest
} from './publisher/idempotency'
import {
  createMemoryMarketplaceRepository,
  type MarketplacePublicationReservationRepository
} from './repository'
import {
  assertMarketplaceSqliteSchema,
  assertMarketplaceSqliteSchemaV1,
  assertMarketplaceSqliteSchemaV2,
  assertMarketplaceSqliteSchemaV3,
  assertMarketplaceSqliteSchemaV4,
  MARKETPLACE_INCOMPLETE_GENERATION_FILE,
  MARKETPLACE_LEGACY_SQLITE_SCHEMA_VERSION,
  MARKETPLACE_PUBLICATION_RESERVATION_SQLITE_SCHEMA_VERSION,
  MARKETPLACE_SUCCESS_RECEIPT_SQLITE_SCHEMA_VERSION,
  MARKETPLACE_SQLITE_SCHEMA_VERSION,
  MARKETPLACE_TERMINAL_RECEIPT_SQLITE_SCHEMA_VERSION,
  marketplaceGenerationReservationPath
} from './sqlite-layout'
import {
  createEmptyMarketplaceState,
  parseMarketplaceState,
  type MarketplaceStateV1
} from './types'

class MarketplacePublisherMutationTerminalCallbackAbortError extends Error {
  constructor(readonly terminalError: MarketplacePublisherMutationTerminalError) {
    super('Marketplace Publisher mutation callback returned a terminal failure')
    this.name = 'MarketplacePublisherMutationTerminalCallbackAbortError'
  }
}

export { MARKETPLACE_SQLITE_SCHEMA_VERSION }

export interface CreateSqliteMarketplaceRepositoryOptions {
  path: string
  initialState?: unknown
  busyTimeoutMilliseconds?: number
  now?: () => number
}

export interface SqliteMarketplaceRepository extends MarketplacePublicationReservationRepository {
  readonly nonces: MarketplaceNonceStore
  checkpoint(): Promise<MarketplaceSqliteCheckpoint>
  close(): Promise<void>
}

export interface MarketplaceSqliteCheckpoint {
  readonly state: MarketplaceStateV1
  readonly databaseBytes: Uint8Array
}

interface StateRow {
  schema_version: number
  state_json: string
}

interface ChangeResult {
  changes: number
}

function marketplaceServerTime(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('Marketplace clock is invalid')
  }
  return value
}

interface DataVersionRow {
  data_version: number
}

interface ReceiptRow {
  namespace: string
  publisher_id: string
  nonce: string
  auth_version: number
  operation: string
  audience: string
  key_id: string
  method: string
  target: string
  timestamp: string
  fresh_until: number
  body_digest: string
  request_digest: string
  signature_digest: string
  response_status: number
  response_json: string
  response_digest: string
  response_byte_length: number
  committed_at: number
}

interface PublicationReservationRow {
  id: number
  request_digest: string
  state_digest: string
  audit_sequence: number
  audit_head: string
  expected_next_sequence: number
}

interface PublicationCompletionReceiptRow {
  request_digest: string
  bundle_digest: string
  state_digest: string
  audit_sequence: number
  audit_head: string
  expected_next_sequence: number
  completion_event_hash: string
  publication_json: string
}

interface CountRow {
  count: number
  bytes: number | null
}

interface MarketplaceDatabasePath {
  readonly path: string
  readonly isNew: boolean
  readonly descriptor: number | null
  readonly identity: { readonly device: bigint; readonly inode: bigint } | null
}

const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/
const SQLITE_PATH_QUEUES = new Map<string | symbol, Promise<void>>()

function assertCompleteGeneration(generation: string): void {
  for (const marker of [
    marketplaceGenerationReservationPath(generation),
    join(generation, MARKETPLACE_INCOMPLETE_GENERATION_FILE)
  ]) {
    try {
      lstatSync(marker)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') continue
      throw error
    }
    throw new Error('Marketplace SQLite generation is incomplete or reserved')
  }
}

function assertDatabaseSchema(database: Database): void {
  assertMarketplaceSqliteSchema(database, 'Marketplace SQLite')
}

function databasePath(value: string): MarketplaceDatabasePath {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new TypeError('Marketplace SQLite path must be a non-empty file path')
  }
  if (value === ':memory:') {
    return Object.freeze({ path: value, isNew: true, descriptor: null, identity: null })
  }
  const lexicalPath = resolve(value)
  const lexicalParent = dirname(lexicalPath)
  assertCompleteGeneration(lexicalParent)
  mkdirSync(lexicalParent, { recursive: true, mode: 0o700 })
  // Final-entry claims cannot make a shared parent trustworthy. Deployment must
  // keep this canonical parent controlled by the Marketplace service account.
  const absolute = resolve(realpathSync(lexicalParent), basename(lexicalPath))
  assertCompleteGeneration(dirname(absolute))
  const noFollow = constants.O_NOFOLLOW
  let descriptor: number
  let isNew = false
  try {
    descriptor = openSync(
      absolute,
      constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | noFollow,
      0o600
    )
    isNew = true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const entry = lstatSync(absolute, { bigint: true })
    if (entry.isSymbolicLink()) {
      throw new Error('Marketplace SQLite path must not be a symbolic link')
    }
    if (!entry.isFile()) {
      throw new Error('Marketplace SQLite path must be a regular file')
    }
    if (entry.nlink !== 1n) {
      throw new Error('Marketplace SQLite path must not be a multiply linked file')
    }
    descriptor = openSync(absolute, constants.O_RDWR | noFollow)
    try {
      const opened = fstatSync(descriptor, { bigint: true })
      if (
        !opened.isFile() ||
        opened.nlink !== 1n ||
        opened.dev !== entry.dev ||
        opened.ino !== entry.ino
      ) {
        throw new Error('Marketplace SQLite path changed while it was opened')
      }
    } catch (error) {
      closeSync(descriptor)
      throw error
    }
  }
  try {
    const opened = fstatSync(descriptor, { bigint: true })
    if (!opened.isFile() || opened.nlink !== 1n) {
      throw new Error('Marketplace SQLite path must resolve to a single-link regular file')
    }
    assertCompleteGeneration(dirname(absolute))
    fchmodSync(descriptor, 0o600)
    return Object.freeze({
      path: absolute,
      isNew,
      descriptor,
      identity: Object.freeze({ device: opened.dev, inode: opened.ino })
    })
  } catch (error) {
    closeSync(descriptor)
    throw error
  }
}

function assertDatabasePathIdentity(
  path: string,
  expected: NonNullable<MarketplaceDatabasePath['identity']>
): void {
  const current = lstatSync(path, { bigint: true })
  if (
    current.isSymbolicLink() ||
    !current.isFile() ||
    current.nlink !== 1n ||
    current.dev !== expected.device ||
    current.ino !== expected.inode
  ) {
    throw new Error('Marketplace SQLite path changed while the database was opened')
  }
}

function openDatabase(prepared: MarketplaceDatabasePath): Database {
  let database: Database | null = null
  try {
    database = new Database(prepared.path, { create: prepared.isNew, strict: true })
    if (prepared.identity) assertDatabasePathIdentity(prepared.path, prepared.identity)
    if (prepared.path !== ':memory:') assertCompleteGeneration(dirname(prepared.path))
    return database
  } catch (error) {
    database?.close(false)
    throw error
  } finally {
    if (prepared.descriptor !== null) closeSync(prepared.descriptor)
  }
}

function busyTimeout(value: number | undefined): number {
  const resolved = value ?? 5_000
  if (!Number.isSafeInteger(resolved) || resolved < 0 || resolved > 60_000) {
    throw new TypeError('Marketplace SQLite busy timeout must be between 0 and 60000 ms')
  }
  return resolved
}

function stateJSON(value: MarketplaceStateV1): string {
  return JSON.stringify(canonicalManifestValue(value))
}

async function verifiedState(value: unknown): Promise<MarketplaceStateV1> {
  const state = parseMarketplaceState(value)
  const auditEvents = await verifyMarketplaceAuditChain(state.auditEvents)
  return Object.freeze({ ...state, auditEvents })
}

function parseStateRow(row: StateRow | null): unknown {
  if (!row) throw new Error('Marketplace SQLite state row is missing')
  if (row.schema_version !== MARKETPLACE_SQLITE_SCHEMA_VERSION) {
    throw new Error(`Unsupported marketplace SQLite schema version ${row.schema_version}`)
  }
  try {
    return JSON.parse(row.state_json)
  } catch {
    throw new Error('Marketplace SQLite state contains invalid JSON')
  }
}

function portableSerializedDatabase(value: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(value)
  const header = new TextDecoder().decode(bytes.subarray(0, 16))
  if (bytes.byteLength < 100 || header !== 'SQLite format 3\0') {
    throw new Error('Marketplace SQLite serialization is invalid')
  }
  // sqlite3_serialize includes all committed WAL pages, but preserves WAL mode
  // in header bytes 18/19. A standalone recovery image has no companion WAL,
  // so mark the complete serialized image as rollback-journal readable.
  bytes[18] = 1
  bytes[19] = 1
  return bytes
}

function assertSubjectId(value: string): void {
  const reason = validateModuleIdentity(value, 'marketplace nonce subject id')
  if (reason) throw new TypeError(reason)
}

function assertNonceNamespace(value: string): asserts value is MarketplaceNonceNamespace {
  if (!(Object.values(MARKETPLACE_NONCE_NAMESPACES) as readonly string[]).includes(value)) {
    throw new TypeError('Marketplace nonce namespace is invalid')
  }
}

function assertNonce(value: string): void {
  if (!NONCE_PATTERN.test(value)) {
    throw new TypeError('Marketplace nonce must be bounded base64url text')
  }
}

function exactStateRow(database: Database): StateRow {
  const rows = database
    .query<StateRow & { id: number }, []>(
      'SELECT id, schema_version, state_json FROM marketplace_state ORDER BY id'
    )
    .all()
  if (rows.length !== 1 || rows[0]?.id !== 1) {
    throw new Error('Marketplace SQLite state row is missing or not unique')
  }
  return rows[0]
}

function publicationReservationFromRows(
  rows: readonly PublicationReservationRow[]
): MarketplacePublicationReservationV1 | null {
  if (rows.length === 0) return null
  const row = rows.at(0)
  if (rows.length !== 1 || row?.id !== 1) {
    throw new Error('Marketplace SQLite publication reservation row is not unique')
  }
  try {
    return parseMarketplacePublicationReservation({
      requestDigest: row.request_digest,
      stateDigest: row.state_digest,
      auditSequence: row.audit_sequence,
      auditHead: row.audit_head,
      expectedNextSequence: row.expected_next_sequence
    })
  } catch (cause) {
    throw new Error('Marketplace SQLite publication reservation is invalid', { cause })
  }
}

function publicationCompletionReceiptFromRow(
  row: PublicationCompletionReceiptRow,
  state: MarketplaceStateV1
): MarketplacePublicationCompletionReceiptV1 {
  let publication: unknown
  try {
    publication = JSON.parse(row.publication_json)
  } catch (cause) {
    throw new Error('Marketplace SQLite publication completion receipt contains invalid JSON', {
      cause
    })
  }
  try {
    const receipt = assertMarketplacePublicationCompletionReceiptState(
      parseMarketplacePublicationCompletionReceipt({
        requestDigest: row.request_digest,
        bundleDigest: row.bundle_digest,
        stateDigest: row.state_digest,
        auditSequence: row.audit_sequence,
        auditHead: row.audit_head,
        expectedNextSequence: row.expected_next_sequence,
        completionEventHash: row.completion_event_hash,
        publication
      }),
      state
    )
    if (canonicalManifestJSON(receipt.publication) !== row.publication_json) {
      throw new TypeError('publication JSON is not canonical')
    }
    return receipt
  } catch (cause) {
    throw new Error('Marketplace SQLite publication completion receipt is invalid', { cause })
  }
}

export function verifyMarketplaceSqlitePublicationReservation(
  database: Database,
  stateValue: unknown
): void {
  const state = parseMarketplaceState(stateValue)
  const rows = database
    .query<PublicationReservationRow, []>(
      `SELECT id, request_digest, state_digest, audit_sequence, audit_head,
              expected_next_sequence
       FROM marketplace_publication_reservation
       ORDER BY id`
    )
    .all()
  const reservation = publicationReservationFromRows(rows)
  if (reservation === null) return
  try {
    assertMarketplacePublicationReservationState(reservation, state)
  } catch (cause) {
    throw new Error('Marketplace SQLite publication reservation is invalid', { cause })
  }
}

export function verifyMarketplaceSqlitePublicationCompletions(
  database: Database,
  stateValue: unknown
): void {
  const state = parseMarketplaceState(stateValue)
  const rows = database
    .query<PublicationCompletionReceiptRow, []>(
      `SELECT request_digest, bundle_digest, state_digest, audit_sequence, audit_head,
              expected_next_sequence, completion_event_hash, publication_json
       FROM marketplace_publication_completion_receipts
       ORDER BY expected_next_sequence, request_digest`
    )
    .all()
  if (rows.length > state.publications.length) {
    throw new Error('Marketplace SQLite contains too many publication completion receipts')
  }
  for (const row of rows) publicationCompletionReceiptFromRow(row, state)
}

function migrateMarketplaceSqliteV1(database: Database): void {
  assertMarketplaceSqliteSchemaV1(database, 'Marketplace SQLite migration source')
  const source = exactStateRow(database)
  if (source.schema_version !== MARKETPLACE_LEGACY_SQLITE_SCHEMA_VERSION) {
    throw new Error('Marketplace SQLite migration source version changed unexpectedly')
  }
  let state: MarketplaceStateV1
  try {
    state = parseMarketplaceState(JSON.parse(source.state_json))
  } catch (cause) {
    throw new Error('Marketplace SQLite migration source state is invalid', { cause })
  }
  if (
    state.publishers.some(({ id }) => ['admin-assertion-v1', 'admin-assertion-v2'].includes(id))
  ) {
    throw new Error('Marketplace SQLite legacy nonce namespace collides with a Publisher id')
  }

  database.exec('BEGIN IMMEDIATE')
  try {
    const current = exactStateRow(database)
    if (current.schema_version === MARKETPLACE_SQLITE_SCHEMA_VERSION) {
      assertMarketplaceSqliteSchema(database, 'Marketplace SQLite concurrently migrated schema')
      database.exec('COMMIT')
      return
    }
    if (current.schema_version !== MARKETPLACE_LEGACY_SQLITE_SCHEMA_VERSION) {
      throw new Error(`Unsupported marketplace SQLite schema version ${current.schema_version}`)
    }
    assertMarketplaceSqliteSchemaV1(database, 'Marketplace SQLite migration source')
    database.exec(`
      ALTER TABLE marketplace_nonces RENAME TO marketplace_nonces_v1;
      DROP INDEX marketplace_nonces_expiry;
      CREATE TABLE marketplace_nonces (
        namespace TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        nonce TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (namespace, subject_id, nonce)
      );
      INSERT INTO marketplace_nonces (namespace, subject_id, nonce, expires_at)
      SELECT
        CASE publisher_id
          WHEN 'admin-assertion-v1' THEN 'admin-assertion-v1'
          WHEN 'admin-assertion-v2' THEN 'admin-assertion-v2'
          ELSE 'publisher-request-v2'
        END,
        CASE publisher_id
          WHEN 'admin-assertion-v1' THEN 'openpencil-marketplace-admin'
          WHEN 'admin-assertion-v2' THEN 'openpencil-marketplace-admin'
          ELSE publisher_id
        END,
        nonce,
        expires_at
      FROM marketplace_nonces_v1;
      DROP TABLE marketplace_nonces_v1;
      CREATE INDEX marketplace_nonces_expiry
        ON marketplace_nonces (expires_at);
      CREATE TABLE marketplace_publisher_mutation_receipts (
        namespace TEXT NOT NULL CHECK (namespace = 'publisher-request-v2'),
        publisher_id TEXT NOT NULL,
        nonce TEXT NOT NULL,
        auth_version INTEGER NOT NULL CHECK (auth_version = 2),
        operation TEXT NOT NULL,
        audience TEXT NOT NULL,
        key_id TEXT NOT NULL,
        method TEXT NOT NULL CHECK (method = 'POST'),
        target TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        fresh_until INTEGER NOT NULL,
        body_digest TEXT NOT NULL,
        request_digest TEXT NOT NULL,
        signature_digest TEXT NOT NULL,
        response_status INTEGER NOT NULL CHECK (response_status IN (200, 201, 400, 401, 404, 409)),
        response_json TEXT NOT NULL,
        response_digest TEXT NOT NULL,
        response_byte_length INTEGER NOT NULL CHECK (response_byte_length > 0),
        committed_at INTEGER NOT NULL,
        PRIMARY KEY (namespace, publisher_id, nonce),
        FOREIGN KEY (namespace, publisher_id, nonce)
          REFERENCES marketplace_nonces (namespace, subject_id, nonce)
          ON DELETE CASCADE
      );
      CREATE TABLE marketplace_publication_reservation (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        request_digest TEXT NOT NULL,
        state_digest TEXT NOT NULL,
        audit_sequence INTEGER NOT NULL CHECK (audit_sequence > 0),
        audit_head TEXT NOT NULL,
        expected_next_sequence INTEGER NOT NULL CHECK (expected_next_sequence > 0)
      );
      CREATE TABLE marketplace_publication_completion_receipts (
        request_digest TEXT PRIMARY KEY,
        bundle_digest TEXT NOT NULL,
        state_digest TEXT NOT NULL,
        audit_sequence INTEGER NOT NULL CHECK (audit_sequence > 0),
        audit_head TEXT NOT NULL,
        expected_next_sequence INTEGER NOT NULL CHECK (expected_next_sequence > 0),
        completion_event_hash TEXT NOT NULL,
        publication_json TEXT NOT NULL
      );
      UPDATE marketplace_state
        SET schema_version = ${MARKETPLACE_SQLITE_SCHEMA_VERSION}
        WHERE id = 1;
    `)
    assertMarketplaceSqliteSchema(database, 'Marketplace SQLite migrated schema')
    database.exec('COMMIT')
  } catch (error) {
    if (database.inTransaction) database.exec('ROLLBACK')
    throw error
  }
}

function migrateMarketplaceSqliteV2(database: Database): void {
  assertMarketplaceSqliteSchemaV2(database, 'Marketplace SQLite migration source')
  const source = exactStateRow(database)
  if (source.schema_version !== MARKETPLACE_SUCCESS_RECEIPT_SQLITE_SCHEMA_VERSION) {
    throw new Error('Marketplace SQLite migration source version changed unexpectedly')
  }
  verifyMarketplaceSqlitePublisherReceipts(database)

  database.exec('BEGIN IMMEDIATE')
  try {
    const current = exactStateRow(database)
    if (current.schema_version === MARKETPLACE_SQLITE_SCHEMA_VERSION) {
      assertMarketplaceSqliteSchema(database, 'Marketplace SQLite concurrently migrated schema')
      database.exec('COMMIT')
      return
    }
    if (current.schema_version !== MARKETPLACE_SUCCESS_RECEIPT_SQLITE_SCHEMA_VERSION) {
      throw new Error(`Unsupported marketplace SQLite schema version ${current.schema_version}`)
    }
    assertMarketplaceSqliteSchemaV2(database, 'Marketplace SQLite migration source')
    database.exec(`
      ALTER TABLE marketplace_publisher_mutation_receipts
        RENAME TO marketplace_publisher_mutation_receipts_v2;
      CREATE TABLE marketplace_publisher_mutation_receipts (
        namespace TEXT NOT NULL CHECK (namespace = 'publisher-request-v2'),
        publisher_id TEXT NOT NULL,
        nonce TEXT NOT NULL,
        auth_version INTEGER NOT NULL CHECK (auth_version = 2),
        operation TEXT NOT NULL,
        audience TEXT NOT NULL,
        key_id TEXT NOT NULL,
        method TEXT NOT NULL CHECK (method = 'POST'),
        target TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        fresh_until INTEGER NOT NULL,
        body_digest TEXT NOT NULL,
        request_digest TEXT NOT NULL,
        signature_digest TEXT NOT NULL,
        response_status INTEGER NOT NULL CHECK (response_status IN (200, 201, 400, 401, 404, 409)),
        response_json TEXT NOT NULL,
        response_digest TEXT NOT NULL,
        response_byte_length INTEGER NOT NULL CHECK (response_byte_length > 0),
        committed_at INTEGER NOT NULL,
        PRIMARY KEY (namespace, publisher_id, nonce),
        FOREIGN KEY (namespace, publisher_id, nonce)
          REFERENCES marketplace_nonces (namespace, subject_id, nonce)
          ON DELETE CASCADE
      );
      INSERT INTO marketplace_publisher_mutation_receipts (
        namespace, publisher_id, nonce, auth_version, operation, audience, key_id,
        method, target, timestamp, fresh_until, body_digest, request_digest,
        signature_digest, response_status, response_json, response_digest,
        response_byte_length, committed_at
      )
      SELECT
        namespace, publisher_id, nonce, auth_version, operation, audience, key_id,
        method, target, timestamp, fresh_until, body_digest, request_digest,
        signature_digest, response_status, response_json, response_digest,
        response_byte_length, committed_at
      FROM marketplace_publisher_mutation_receipts_v2;
      DROP TABLE marketplace_publisher_mutation_receipts_v2;
      CREATE TABLE marketplace_publication_reservation (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        request_digest TEXT NOT NULL,
        state_digest TEXT NOT NULL,
        audit_sequence INTEGER NOT NULL CHECK (audit_sequence > 0),
        audit_head TEXT NOT NULL,
        expected_next_sequence INTEGER NOT NULL CHECK (expected_next_sequence > 0)
      );
      CREATE TABLE marketplace_publication_completion_receipts (
        request_digest TEXT PRIMARY KEY,
        bundle_digest TEXT NOT NULL,
        state_digest TEXT NOT NULL,
        audit_sequence INTEGER NOT NULL CHECK (audit_sequence > 0),
        audit_head TEXT NOT NULL,
        expected_next_sequence INTEGER NOT NULL CHECK (expected_next_sequence > 0),
        completion_event_hash TEXT NOT NULL,
        publication_json TEXT NOT NULL
      );
      UPDATE marketplace_state
        SET schema_version = ${MARKETPLACE_SQLITE_SCHEMA_VERSION}
        WHERE id = 1;
    `)
    assertMarketplaceSqliteSchema(database, 'Marketplace SQLite migrated schema')
    verifyMarketplaceSqlitePublisherReceipts(database)
    database.exec('COMMIT')
  } catch (error) {
    if (database.inTransaction) database.exec('ROLLBACK')
    throw error
  }
}

function migrateMarketplaceSqliteV3(database: Database): void {
  assertMarketplaceSqliteSchemaV3(database, 'Marketplace SQLite migration source')
  const source = exactStateRow(database)
  if (source.schema_version !== MARKETPLACE_TERMINAL_RECEIPT_SQLITE_SCHEMA_VERSION) {
    throw new Error('Marketplace SQLite migration source version changed unexpectedly')
  }
  verifyMarketplaceSqlitePublisherReceipts(database)

  database.exec('BEGIN IMMEDIATE')
  try {
    const current = exactStateRow(database)
    if (current.schema_version === MARKETPLACE_SQLITE_SCHEMA_VERSION) {
      assertMarketplaceSqliteSchema(database, 'Marketplace SQLite concurrently migrated schema')
      database.exec('COMMIT')
      return
    }
    if (current.schema_version !== MARKETPLACE_TERMINAL_RECEIPT_SQLITE_SCHEMA_VERSION) {
      throw new Error(`Unsupported marketplace SQLite schema version ${current.schema_version}`)
    }
    assertMarketplaceSqliteSchemaV3(database, 'Marketplace SQLite migration source')
    database.exec(`
      CREATE TABLE marketplace_publication_reservation (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        request_digest TEXT NOT NULL,
        state_digest TEXT NOT NULL,
        audit_sequence INTEGER NOT NULL CHECK (audit_sequence > 0),
        audit_head TEXT NOT NULL,
        expected_next_sequence INTEGER NOT NULL CHECK (expected_next_sequence > 0)
      );
      CREATE TABLE marketplace_publication_completion_receipts (
        request_digest TEXT PRIMARY KEY,
        bundle_digest TEXT NOT NULL,
        state_digest TEXT NOT NULL,
        audit_sequence INTEGER NOT NULL CHECK (audit_sequence > 0),
        audit_head TEXT NOT NULL,
        expected_next_sequence INTEGER NOT NULL CHECK (expected_next_sequence > 0),
        completion_event_hash TEXT NOT NULL,
        publication_json TEXT NOT NULL
      );
      UPDATE marketplace_state
        SET schema_version = ${MARKETPLACE_SQLITE_SCHEMA_VERSION}
        WHERE id = 1;
    `)
    assertMarketplaceSqliteSchema(database, 'Marketplace SQLite migrated schema')
    verifyMarketplaceSqlitePublisherReceipts(database)
    database.exec('COMMIT')
  } catch (error) {
    if (database.inTransaction) database.exec('ROLLBACK')
    throw error
  }
}

function migrateMarketplaceSqliteV4(database: Database): void {
  assertMarketplaceSqliteSchemaV4(database, 'Marketplace SQLite migration source')
  const source = exactStateRow(database)
  if (source.schema_version !== MARKETPLACE_PUBLICATION_RESERVATION_SQLITE_SCHEMA_VERSION) {
    throw new Error('Marketplace SQLite migration source version changed unexpectedly')
  }
  verifyMarketplaceSqlitePublisherReceipts(database)

  database.exec('BEGIN IMMEDIATE')
  try {
    const current = exactStateRow(database)
    if (current.schema_version === MARKETPLACE_SQLITE_SCHEMA_VERSION) {
      assertMarketplaceSqliteSchema(database, 'Marketplace SQLite concurrently migrated schema')
      database.exec('COMMIT')
      return
    }
    if (current.schema_version !== MARKETPLACE_PUBLICATION_RESERVATION_SQLITE_SCHEMA_VERSION) {
      throw new Error(`Unsupported marketplace SQLite schema version ${current.schema_version}`)
    }
    assertMarketplaceSqliteSchemaV4(database, 'Marketplace SQLite migration source')
    database.exec(`
      CREATE TABLE marketplace_publication_completion_receipts (
        request_digest TEXT PRIMARY KEY,
        bundle_digest TEXT NOT NULL,
        state_digest TEXT NOT NULL,
        audit_sequence INTEGER NOT NULL CHECK (audit_sequence > 0),
        audit_head TEXT NOT NULL,
        expected_next_sequence INTEGER NOT NULL CHECK (expected_next_sequence > 0),
        completion_event_hash TEXT NOT NULL,
        publication_json TEXT NOT NULL
      );
      UPDATE marketplace_state
        SET schema_version = ${MARKETPLACE_SQLITE_SCHEMA_VERSION}
        WHERE id = 1;
    `)
    assertMarketplaceSqliteSchema(database, 'Marketplace SQLite migrated schema')
    verifyMarketplaceSqlitePublisherReceipts(database)
    database.exec('COMMIT')
  } catch (error) {
    if (database.inTransaction) database.exec('ROLLBACK')
    throw error
  }
}

function receiptFromRow(row: ReceiptRow): MarketplacePublisherMutationReceipt {
  const request = parseMarketplaceVerifiedPublisherMutationRequest({
    authVersion: row.auth_version as 2,
    operation: row.operation as MarketplaceVerifiedPublisherMutationRequest['operation'],
    audience: row.audience,
    publisherId: row.publisher_id,
    keyId: row.key_id,
    method: row.method,
    target: row.target,
    timestamp: row.timestamp,
    nonce: row.nonce,
    bodyDigest: row.body_digest,
    requestDigest: row.request_digest,
    signatureDigest: row.signature_digest,
    freshUntil: row.fresh_until
  })
  if (row.namespace !== MARKETPLACE_NONCE_NAMESPACES.publisherRequestV2) {
    throw new TypeError('Publisher mutation receipt namespace is invalid')
  }
  if (!Number.isSafeInteger(row.committed_at) || row.committed_at < 0) {
    throw new TypeError('Publisher mutation receipt committed time is invalid')
  }
  const response = parseMarketplacePublisherMutationResponse(request.operation, {
    status: row.response_status as MarketplacePublisherMutationResponse['status'],
    json: row.response_json,
    digest: row.response_digest,
    byteLength: row.response_byte_length
  })
  return Object.freeze({ ...request, response, committedAt: row.committed_at })
}

export function verifyMarketplaceSqlitePublisherReceipts(database: Database): void {
  const rows = database
    .query<ReceiptRow, []>(
      `SELECT namespace, publisher_id, nonce, auth_version, operation, audience, key_id,
              method, target, timestamp, fresh_until, body_digest, request_digest,
              signature_digest, response_status, response_json, response_digest,
              response_byte_length, committed_at
       FROM marketplace_publisher_mutation_receipts
       ORDER BY namespace, publisher_id, nonce`
    )
    .all()
  if (rows.length > MARKETPLACE_PUBLISHER_MUTATION_LIMITS.maxReceipts) {
    throw new Error('Marketplace SQLite contains too many Publisher mutation receipts')
  }
  let aggregateBytes = 0
  const perPublisher = new Map<string, number>()
  for (const row of rows) {
    const receipt = receiptFromRow(row)
    aggregateBytes += receipt.response.byteLength
    perPublisher.set(receipt.publisherId, (perPublisher.get(receipt.publisherId) ?? 0) + 1)
  }
  if (aggregateBytes > MARKETPLACE_PUBLISHER_MUTATION_LIMITS.maxAggregateResponseBytes) {
    throw new Error('Marketplace SQLite Publisher mutation responses exceed capacity')
  }
  if (
    [...perPublisher.values()].some(
      (count) => count > MARKETPLACE_PUBLISHER_MUTATION_LIMITS.maxReceiptsPerPublisher
    )
  ) {
    throw new Error('Marketplace SQLite Publisher mutation receipts exceed subject capacity')
  }
  const foreignKeyProblems = database
    .query<Record<string, unknown>, []>('PRAGMA foreign_key_check')
    .all()
  if (foreignKeyProblems.length !== 0) {
    throw new Error('Marketplace SQLite foreign key check failed')
  }
}

export function createSqliteMarketplaceRepository(
  options: CreateSqliteMarketplaceRepositoryOptions
): SqliteMarketplaceRepository {
  const prepared = databasePath(options.path)
  const queueKey: string | symbol =
    prepared.path === ':memory:' ? Symbol('marketplace-memory-sqlite') : prepared.path
  const isNewDatabase = prepared.isNew
  const database = openDatabase(prepared)
  try {
    database.exec(`PRAGMA busy_timeout = ${busyTimeout(options.busyTimeoutMilliseconds)}`)
    database.exec('PRAGMA journal_mode = WAL')
    database.exec('PRAGMA synchronous = FULL')
    database.exec('PRAGMA foreign_keys = ON')

    if (!isNewDatabase) {
      if (options.initialState !== undefined) {
        throw new Error('Marketplace SQLite initialState is only allowed for a new database')
      }
      const row = exactStateRow(database)
      if (row.schema_version === MARKETPLACE_LEGACY_SQLITE_SCHEMA_VERSION) {
        migrateMarketplaceSqliteV1(database)
      } else if (row.schema_version === MARKETPLACE_SUCCESS_RECEIPT_SQLITE_SCHEMA_VERSION) {
        migrateMarketplaceSqliteV2(database)
      } else if (row.schema_version === MARKETPLACE_TERMINAL_RECEIPT_SQLITE_SCHEMA_VERSION) {
        migrateMarketplaceSqliteV3(database)
      } else if (row.schema_version === MARKETPLACE_PUBLICATION_RESERVATION_SQLITE_SCHEMA_VERSION) {
        migrateMarketplaceSqliteV4(database)
      } else if (row.schema_version === MARKETPLACE_SQLITE_SCHEMA_VERSION) {
        assertDatabaseSchema(database)
      } else {
        throw new Error(`Unsupported marketplace SQLite schema version ${row.schema_version}`)
      }
      exactStateRow(database)
    }

    if (isNewDatabase) {
      database.exec(`
        CREATE TABLE marketplace_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          schema_version INTEGER NOT NULL,
          state_json TEXT NOT NULL
        );
        CREATE TABLE marketplace_nonces (
          namespace TEXT NOT NULL,
          subject_id TEXT NOT NULL,
          nonce TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          PRIMARY KEY (namespace, subject_id, nonce)
        );
        CREATE INDEX marketplace_nonces_expiry
          ON marketplace_nonces (expires_at);
        CREATE TABLE marketplace_publisher_mutation_receipts (
          namespace TEXT NOT NULL CHECK (namespace = 'publisher-request-v2'),
          publisher_id TEXT NOT NULL,
          nonce TEXT NOT NULL,
          auth_version INTEGER NOT NULL CHECK (auth_version = 2),
          operation TEXT NOT NULL,
          audience TEXT NOT NULL,
          key_id TEXT NOT NULL,
          method TEXT NOT NULL CHECK (method = 'POST'),
          target TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          fresh_until INTEGER NOT NULL,
          body_digest TEXT NOT NULL,
          request_digest TEXT NOT NULL,
          signature_digest TEXT NOT NULL,
          response_status INTEGER NOT NULL CHECK (response_status IN (200, 201, 400, 401, 404, 409)),
          response_json TEXT NOT NULL,
          response_digest TEXT NOT NULL,
          response_byte_length INTEGER NOT NULL CHECK (response_byte_length > 0),
          committed_at INTEGER NOT NULL,
          PRIMARY KEY (namespace, publisher_id, nonce),
          FOREIGN KEY (namespace, publisher_id, nonce)
            REFERENCES marketplace_nonces (namespace, subject_id, nonce)
            ON DELETE CASCADE
        );
        CREATE TABLE marketplace_publication_reservation (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          request_digest TEXT NOT NULL,
          state_digest TEXT NOT NULL,
          audit_sequence INTEGER NOT NULL CHECK (audit_sequence > 0),
          audit_head TEXT NOT NULL,
          expected_next_sequence INTEGER NOT NULL CHECK (expected_next_sequence > 0)
        );
        CREATE TABLE marketplace_publication_completion_receipts (
          request_digest TEXT PRIMARY KEY,
          bundle_digest TEXT NOT NULL,
          state_digest TEXT NOT NULL,
          audit_sequence INTEGER NOT NULL CHECK (audit_sequence > 0),
          audit_head TEXT NOT NULL,
          expected_next_sequence INTEGER NOT NULL CHECK (expected_next_sequence > 0),
          completion_event_hash TEXT NOT NULL,
          publication_json TEXT NOT NULL
        );
      `)
      const initialState =
        options.initialState === undefined
          ? createEmptyMarketplaceState()
          : parseMarketplaceState(options.initialState)
      const inserted = database
        .query<ChangeResult, [number, string]>(
          'INSERT INTO marketplace_state (id, schema_version, state_json) VALUES (1, ?, ?)'
        )
        .run(MARKETPLACE_SQLITE_SCHEMA_VERSION, stateJSON(initialState))
      if (inserted.changes !== 1) {
        throw new Error('Marketplace SQLite state row could not be initialized')
      }
      assertDatabaseSchema(database)
    }
  } catch (error) {
    database.close(false)
    throw error
  }

  const readStateRow = database.query<StateRow, []>(
    'SELECT schema_version, state_json FROM marketplace_state WHERE id = 1'
  )
  const updateStateRow = database.query<ChangeResult, [number, string]>(
    'UPDATE marketplace_state SET schema_version = ?, state_json = ? WHERE id = 1'
  )
  const readPublicationReservationRows = database.query<PublicationReservationRow, []>(
    `SELECT id, request_digest, state_digest, audit_sequence, audit_head,
            expected_next_sequence
     FROM marketplace_publication_reservation
     ORDER BY id`
  )
  const insertPublicationReservation = database.query<
    ChangeResult,
    [string, string, number, string, number]
  >(
    `INSERT INTO marketplace_publication_reservation (
       id, request_digest, state_digest, audit_sequence, audit_head, expected_next_sequence
     ) VALUES (1, ?, ?, ?, ?, ?)`
  )
  const deletePublicationReservation = database.query<
    ChangeResult,
    [string, string, number, string, number]
  >(
    `DELETE FROM marketplace_publication_reservation
     WHERE id = 1
       AND request_digest = ?
       AND state_digest = ?
       AND audit_sequence = ?
       AND audit_head = ?
      AND expected_next_sequence = ?`
  )
  const readPublicationCompletion = database.query<PublicationCompletionReceiptRow, [string]>(
    `SELECT request_digest, bundle_digest, state_digest, audit_sequence, audit_head,
            expected_next_sequence, completion_event_hash, publication_json
     FROM marketplace_publication_completion_receipts
     WHERE request_digest = ?`
  )
  const insertPublicationCompletion = database.query<
    ChangeResult,
    [string, string, string, number, string, number, string, string]
  >(
    `INSERT INTO marketplace_publication_completion_receipts (
       request_digest, bundle_digest, state_digest, audit_sequence, audit_head,
       expected_next_sequence, completion_event_hash, publication_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const prunePublicationCompletionsBefore = database.query<ChangeResult, [number]>(
    'DELETE FROM marketplace_publication_completion_receipts WHERE expected_next_sequence < ?'
  )
  const deleteAllPublicationCompletions = database.query<ChangeResult, []>(
    'DELETE FROM marketplace_publication_completion_receipts'
  )
  const readDataVersion = database.query<DataVersionRow, []>('PRAGMA data_version')
  const cleanupNonces = database.query<never, [number]>(
    'DELETE FROM marketplace_nonces WHERE expires_at < ?'
  )
  const insertNonce = database.query<ChangeResult, [string, string, string, number]>(
    'INSERT OR IGNORE INTO marketplace_nonces (namespace, subject_id, nonce, expires_at) VALUES (?, ?, ?, ?)'
  )
  const readNonce = database.query<{ expires_at: number }, [string, string, string]>(
    'SELECT expires_at FROM marketplace_nonces WHERE namespace = ? AND subject_id = ? AND nonce = ?'
  )
  const extendNonceExpiry = database.query<ChangeResult, [number, string, string, string]>(
    `UPDATE marketplace_nonces
     SET expires_at = MAX(expires_at, ?)
     WHERE namespace = ? AND subject_id = ? AND nonce = ?`
  )
  const readReceipt = database.query<ReceiptRow, [string, string, string]>(
    `SELECT namespace, publisher_id, nonce, auth_version, operation, audience, key_id,
            method, target, timestamp, fresh_until, body_digest, request_digest,
            signature_digest, response_status, response_json, response_digest,
            response_byte_length, committed_at
     FROM marketplace_publisher_mutation_receipts
     WHERE namespace = ? AND publisher_id = ? AND nonce = ?`
  )
  const insertReceipt = database.query<
    ChangeResult,
    [
      string,
      string,
      string,
      number,
      string,
      string,
      string,
      string,
      string,
      string,
      number,
      string,
      string,
      string,
      number,
      string,
      string,
      number,
      number
    ]
  >(
    `INSERT INTO marketplace_publisher_mutation_receipts (
       namespace, publisher_id, nonce, auth_version, operation, audience, key_id,
       method, target, timestamp, fresh_until, body_digest, request_digest,
       signature_digest, response_status, response_json, response_digest,
       response_byte_length, committed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const receiptCapacity = database.query<CountRow, []>(
    `SELECT COUNT(*) AS count,
            COALESCE(SUM(response_byte_length), 0) AS bytes
     FROM marketplace_publisher_mutation_receipts`
  )
  const publisherReceiptCount = database.query<{ count: number }, [string]>(
    'SELECT COUNT(*) AS count FROM marketplace_publisher_mutation_receipts WHERE publisher_id = ?'
  )
  const nonceCapacity = database.query<{ count: number }, []>(
    'SELECT COUNT(*) AS count FROM marketplace_nonces'
  )
  const subjectNonceCount = database.query<{ count: number }, [string, string]>(
    'SELECT COUNT(*) AS count FROM marketplace_nonces WHERE namespace = ? AND subject_id = ?'
  )
  let queue: Promise<void> = Promise.resolve()
  let closed = false
  let cachedState: MarketplaceStateV1 | null = null
  let cachedDataVersion = -1

  function dataVersion(): number {
    const version = readDataVersion.get()?.data_version
    if (!Number.isSafeInteger(version) || (version as number) < 0) {
      throw new Error('Marketplace SQLite data version is invalid')
    }
    return version as number
  }

  async function load(): Promise<MarketplaceStateV1> {
    return verifiedState(parseStateRow(readStateRow.get()))
  }

  async function refreshVerifiedState(): Promise<MarketplaceStateV1> {
    const before = dataVersion()
    const state = await load()
    const after = dataVersion()
    if (before !== after) {
      throw new Error('Marketplace SQLite state changed while it was being verified')
    }
    cachedState = state
    cachedDataVersion = after
    return state
  }

  async function currentVerifiedState(): Promise<MarketplaceStateV1> {
    const version = dataVersion()
    if (cachedState !== null && cachedDataVersion === version) return cachedState
    return refreshVerifiedState()
  }

  function verifyStoredPublisherReceipts(): void {
    verifyMarketplaceSqlitePublisherReceipts(database)
  }

  function readPublicationReservation(): MarketplacePublicationReservationV1 | null {
    return publicationReservationFromRows(readPublicationReservationRows.all())
  }

  function verifyStoredPublicationCompletions(state: MarketplaceStateV1): void {
    verifyMarketplaceSqlitePublicationCompletions(database, state)
  }

  function publicationCompletion(
    requestDigestValue: unknown,
    bundleDigestValue: unknown,
    state: MarketplaceStateV1
  ): MarketplacePublicationCompletionReceiptV1 | null {
    const requestDigest = parseSha256Base64URL(
      requestDigestValue,
      'marketplace publication completion request digest'
    )
    const bundleDigest = parseSha256Base64URL(
      bundleDigestValue,
      'marketplace publication completion bundle digest'
    )
    const row = readPublicationCompletion.get(requestDigest)
    if (!row) return null
    if (row.bundle_digest !== bundleDigest) {
      throw new MarketplacePublicationCompletionConflictError()
    }
    return publicationCompletionReceiptFromRow(row, state)
  }

  function prunePublicationCompletions(state: MarketplaceStateV1): void {
    const firstRetained = state.publications.at(0)?.sequence
    if (firstRetained === undefined) deleteAllPublicationCompletions.run()
    else prunePublicationCompletionsBefore.run(firstRetained)
  }

  const initialization = refreshVerifiedState().then((state) => {
    verifyStoredPublisherReceipts()
    verifyMarketplaceSqlitePublicationReservation(database, state)
    verifyStoredPublicationCompletions(state)
    return undefined
  })

  function assertOpen(): void {
    if (closed) throw new Error('Marketplace SQLite repository is closed')
  }

  function enqueue<Value>(operation: () => Promise<Value>): Promise<Value> {
    if (closed) return Promise.reject(new Error('Marketplace SQLite repository is closed'))
    const previous = SQLITE_PATH_QUEUES.get(queueKey) ?? Promise.resolve()
    const running = previous.then(async () => {
      await initialization
      return operation()
    })
    const settled = running.then(
      () => undefined,
      () => undefined
    )
    SQLITE_PATH_QUEUES.set(queueKey, settled)
    queue = settled
    void settled.then(() => {
      if (SQLITE_PATH_QUEUES.get(queueKey) === settled) SQLITE_PATH_QUEUES.delete(queueKey)
      return undefined
    })
    return running
  }

  function rollback(error: unknown): never {
    try {
      if (database.inTransaction) database.exec('ROLLBACK')
    } catch (rollbackError) {
      // Preserve the original storage error; the repository remains fail-closed.
      void rollbackError
    }
    throw error
  }

  function persistNonceCollision(
    namespace: MarketplaceNonceNamespace,
    subjectId: string,
    nonce: string,
    expiresAt: number
  ): void {
    const updated = extendNonceExpiry.run(expiresAt, namespace, subjectId, nonce)
    if (updated.changes !== 1) {
      throw new Error('Marketplace nonce collision could not extend its freshness boundary')
    }
    database.exec('COMMIT')
  }

  const nonces: MarketplaceNonceStore = {
    consume(namespace, subjectId, nonce, expiresAt, currentTime) {
      return enqueue(async () => {
        assertNonceNamespace(namespace)
        assertSubjectId(subjectId)
        assertNonce(nonce)
        if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) {
          throw new TypeError('Marketplace nonce expiry must be a positive safe integer')
        }
        const now = currentTime ?? (options.now ?? Date.now)()
        if (!Number.isSafeInteger(now)) throw new TypeError('Marketplace clock is invalid')
        database.exec('BEGIN IMMEDIATE')
        try {
          cleanupNonces.run(now)
          if (readNonce.get(namespace, subjectId, nonce)) {
            persistNonceCollision(namespace, subjectId, nonce, expiresAt)
            return false
          }
          const total = nonceCapacity.get()?.count ?? 0
          const subject = subjectNonceCount.get(namespace, subjectId)?.count ?? 0
          if (
            total >= MARKETPLACE_PUBLISHER_MUTATION_LIMITS.maxLiveNonces ||
            subject >= MARKETPLACE_PUBLISHER_MUTATION_LIMITS.maxLiveNoncesPerSubject
          ) {
            throw new MarketplacePublisherMutationCapacityError(
              'Marketplace nonce capacity is exhausted'
            )
          }
          const result = insertNonce.run(namespace, subjectId, nonce, expiresAt)
          database.exec('COMMIT')
          return result.changes === 1
        } catch (error) {
          return rollback(error)
        }
      })
    }
  }

  function replayedReceipt(
    row: ReceiptRow,
    request: MarketplaceVerifiedPublisherMutationRequest
  ): MarketplacePublisherMutationExecution {
    const receipt = receiptFromRow(row)
    if (!sameMarketplacePublisherMutationRequest(receipt, request)) {
      throw new MarketplacePublisherMutationConflictError()
    }
    return Object.freeze({
      source: 'replayed' as const,
      response: structuredClone(receipt.response)
    })
  }

  function assertPublisherMutationCapacity(
    request: MarketplaceVerifiedPublisherMutationRequest,
    responseBytes = 0
  ): void {
    const receipts = receiptCapacity.get()
    const totalReceipts = receipts?.count ?? 0
    const aggregateBytes = receipts?.bytes ?? 0
    const publisherReceipts = publisherReceiptCount.get(request.publisherId)?.count ?? 0
    const totalNonces = nonceCapacity.get()?.count ?? 0
    const publisherNonces =
      subjectNonceCount.get(MARKETPLACE_NONCE_NAMESPACES.publisherRequestV2, request.publisherId)
        ?.count ?? 0
    if (
      totalReceipts >= MARKETPLACE_PUBLISHER_MUTATION_LIMITS.maxReceipts ||
      publisherReceipts >= MARKETPLACE_PUBLISHER_MUTATION_LIMITS.maxReceiptsPerPublisher ||
      totalNonces >= MARKETPLACE_PUBLISHER_MUTATION_LIMITS.maxLiveNonces ||
      publisherNonces >= MARKETPLACE_PUBLISHER_MUTATION_LIMITS.maxLiveNoncesPerSubject ||
      (responseBytes === 0
        ? aggregateBytes >= MARKETPLACE_PUBLISHER_MUTATION_LIMITS.maxAggregateResponseBytes
        : aggregateBytes + responseBytes >
          MARKETPLACE_PUBLISHER_MUTATION_LIMITS.maxAggregateResponseBytes)
    ) {
      throw new MarketplacePublisherMutationCapacityError(
        'Marketplace Publisher request capacity is exhausted'
      )
    }
  }

  return {
    nonces,
    snapshot() {
      return enqueue(currentVerifiedState).then((state) => structuredClone(state))
    },
    async immutableSnapshot() {
      assertOpen()
      await initialization
      assertOpen()
      if (cachedState !== null && cachedDataVersion === dataVersion()) return cachedState
      return enqueue(currentVerifiedState)
    },
    inspectPublicationReservation() {
      return enqueue(async () => {
        const reservation = readPublicationReservation()
        return reservation === null ? null : structuredClone(reservation)
      })
    },
    inspectPublicationCompletion(requestDigest, bundleDigest) {
      return enqueue(async () => {
        database.exec('BEGIN')
        try {
          const receipt = publicationCompletion(
            requestDigest,
            bundleDigest,
            await currentVerifiedState()
          )
          database.exec('COMMIT')
          return receipt === null ? null : structuredClone(receipt)
        } catch (error) {
          return rollback(error)
        }
      })
    },
    reservePublication(reservationValue) {
      return enqueue(async () => {
        const reservation = parseMarketplacePublicationReservation(reservationValue)
        database.exec('BEGIN IMMEDIATE')
        try {
          const existing = readPublicationReservation()
          if (existing !== null) {
            if (!sameMarketplacePublicationReservation(existing, reservation)) {
              throw new MarketplacePublicationReservationConflictError()
            }
            assertMarketplacePublicationReservationState(existing, await currentVerifiedState())
            database.exec('COMMIT')
            return Object.freeze({
              source: 'replayed' as const,
              reservation: structuredClone(existing)
            })
          }
          assertMarketplacePublicationReservationState(reservation, await currentVerifiedState())
          const inserted = insertPublicationReservation.run(
            reservation.requestDigest,
            reservation.stateDigest,
            reservation.auditSequence,
            reservation.auditHead,
            reservation.expectedNextSequence
          )
          if (inserted.changes !== 1) {
            throw new MarketplacePublicationReservationConflictError()
          }
          database.exec('COMMIT')
          return Object.freeze({
            source: 'reserved' as const,
            reservation: structuredClone(reservation)
          })
        } catch (error) {
          return rollback(error)
        }
      })
    },
    completePublication(reservationValue, bundleDigestValue, operation) {
      return enqueue(async () => {
        const reservation = parseMarketplacePublicationReservation(reservationValue)
        const bundleDigest = parseSha256Base64URL(
          bundleDigestValue,
          'marketplace publication completion bundle digest'
        )
        database.exec('BEGIN IMMEDIATE')
        try {
          const state = await currentVerifiedState()
          const replayed = publicationCompletion(reservation.requestDigest, bundleDigest, state)
          if (replayed) {
            database.exec('COMMIT')
            return Object.freeze({
              source: 'replayed' as const,
              receipt: structuredClone(replayed),
              publication: structuredClone(replayed.publication)
            })
          }
          const existing = readPublicationReservation()
          if (existing === null || !sameMarketplacePublicationReservation(existing, reservation)) {
            throw new MarketplacePublicationReservationConflictError()
          }
          assertMarketplacePublicationReservationState(reservation, state)
          const memory = createMemoryMarketplaceRepository({ initialState: state })
          await memory.reservePublication(reservation)
          const execution = await memory.completePublication(reservation, bundleDigest, operation)
          if (execution.source !== 'committed') {
            throw new MarketplacePublicationCompletionConflictError()
          }
          const verifiedNext = await verifiedState(await memory.snapshot())
          const updated = updateStateRow.run(
            MARKETPLACE_SQLITE_SCHEMA_VERSION,
            stateJSON(verifiedNext)
          )
          if (updated.changes !== 1) {
            throw new Error('Marketplace SQLite state row update did not affect exactly one row')
          }
          const receipt = execution.receipt
          const inserted = insertPublicationCompletion.run(
            receipt.requestDigest,
            receipt.bundleDigest,
            receipt.stateDigest,
            receipt.auditSequence,
            receipt.auditHead,
            receipt.expectedNextSequence,
            receipt.completionEventHash,
            canonicalManifestJSON(receipt.publication)
          )
          if (inserted.changes !== 1) {
            throw new MarketplacePublicationCompletionConflictError()
          }
          const deleted = deletePublicationReservation.run(
            reservation.requestDigest,
            reservation.stateDigest,
            reservation.auditSequence,
            reservation.auditHead,
            reservation.expectedNextSequence
          )
          if (deleted.changes !== 1) {
            throw new MarketplacePublicationReservationConflictError()
          }
          const committedDataVersion = dataVersion()
          database.exec('COMMIT')
          cachedState = verifiedNext
          cachedDataVersion = committedDataVersion
          return Object.freeze({
            source: 'committed' as const,
            receipt: structuredClone(receipt),
            publication: structuredClone(receipt.publication)
          })
        } catch (error) {
          return rollback(error)
        }
      })
    },
    cancelPublication(reservationValue, confirmedRequestDigest, context) {
      return enqueue(async () => {
        const reservation = parseMarketplacePublicationReservation(reservationValue)
        database.exec('BEGIN IMMEDIATE')
        try {
          const existing = readPublicationReservation()
          if (existing === null || !sameMarketplacePublicationReservation(existing, reservation)) {
            throw new MarketplacePublicationReservationConflictError()
          }
          const state = await currentVerifiedState()
          assertMarketplacePublicationReservationState(reservation, state)
          const memory = createMemoryMarketplaceRepository({ initialState: state })
          await memory.reservePublication(reservation)
          const event = await memory.cancelPublication(reservation, confirmedRequestDigest, context)
          const verifiedNext = await verifiedState(await memory.snapshot())
          const updated = updateStateRow.run(
            MARKETPLACE_SQLITE_SCHEMA_VERSION,
            stateJSON(verifiedNext)
          )
          if (updated.changes !== 1) {
            throw new Error('Marketplace SQLite state row update did not affect exactly one row')
          }
          const deleted = deletePublicationReservation.run(
            reservation.requestDigest,
            reservation.stateDigest,
            reservation.auditSequence,
            reservation.auditHead,
            reservation.expectedNextSequence
          )
          if (deleted.changes !== 1) {
            throw new MarketplacePublicationReservationConflictError()
          }
          const committedDataVersion = dataVersion()
          database.exec('COMMIT')
          cachedState = verifiedNext
          cachedDataVersion = committedDataVersion
          return structuredClone(event)
        } catch (error) {
          return rollback(error)
        }
      })
    },
    transaction(operation) {
      return enqueue(async () => {
        database.exec('BEGIN IMMEDIATE')
        try {
          if (readPublicationReservation() !== null) {
            throw new MarketplacePublicationQuiescedError()
          }
          const state = await currentVerifiedState()
          const memory = createMemoryMarketplaceRepository({ initialState: state })
          const result = await memory.transaction(operation)
          const next = await memory.snapshot()
          const verifiedNext = await verifiedState(next)
          const updated = updateStateRow.run(
            MARKETPLACE_SQLITE_SCHEMA_VERSION,
            stateJSON(verifiedNext)
          )
          if (updated.changes !== 1) {
            throw new Error('Marketplace SQLite state row update did not affect exactly one row')
          }
          prunePublicationCompletions(verifiedNext)
          // Capture the connection's external-change generation while BEGIN IMMEDIATE
          // still excludes other writers. Reading it after COMMIT could bind this state
          // to a newer writer's generation or turn a durable success into an error.
          const committedDataVersion = dataVersion()
          database.exec('COMMIT')
          cachedState = verifiedNext
          cachedDataVersion = committedDataVersion
          return structuredClone(result)
        } catch (error) {
          return rollback(error)
        }
      })
    },
    inspectPublisherMutation(requestValue, currentTime) {
      return enqueue(async () => {
        const request = parseMarketplaceVerifiedPublisherMutationRequest(requestValue)
        const now = marketplaceServerTime(currentTime)
        database.exec('BEGIN IMMEDIATE')
        try {
          cleanupNonces.run(now)
          const receipt = readReceipt.get(
            MARKETPLACE_NONCE_NAMESPACES.publisherRequestV2,
            request.publisherId,
            request.nonce
          )
          if (receipt) {
            try {
              const execution = replayedReceipt(receipt, request)
              database.exec('COMMIT')
              return execution
            } catch (error) {
              if (error instanceof MarketplacePublisherMutationConflictError) {
                persistNonceCollision(
                  MARKETPLACE_NONCE_NAMESPACES.publisherRequestV2,
                  request.publisherId,
                  request.nonce,
                  request.freshUntil
                )
              }
              throw error
            }
          }
          const nonce = readNonce.get(
            MARKETPLACE_NONCE_NAMESPACES.publisherRequestV2,
            request.publisherId,
            request.nonce
          )
          if (nonce) {
            persistNonceCollision(
              MARKETPLACE_NONCE_NAMESPACES.publisherRequestV2,
              request.publisherId,
              request.nonce,
              request.freshUntil
            )
            throw new MarketplacePublisherMutationConflictError()
          }
          database.exec('COMMIT')
          return null
        } catch (error) {
          return rollback(error)
        }
      })
    },
    executePublisherMutation(requestValue, currentTime, operation) {
      return enqueue(async () => {
        const request = parseMarketplaceVerifiedPublisherMutationRequest(requestValue)
        const now = marketplaceServerTime(currentTime)
        database.exec('BEGIN IMMEDIATE')
        try {
          if (readPublicationReservation() !== null) {
            throw new MarketplacePublicationQuiescedError()
          }
          cleanupNonces.run(now)
          const receipt = readReceipt.get(
            MARKETPLACE_NONCE_NAMESPACES.publisherRequestV2,
            request.publisherId,
            request.nonce
          )
          if (receipt) {
            try {
              const execution = replayedReceipt(receipt, request)
              database.exec('COMMIT')
              return execution
            } catch (error) {
              if (error instanceof MarketplacePublisherMutationConflictError) {
                persistNonceCollision(
                  MARKETPLACE_NONCE_NAMESPACES.publisherRequestV2,
                  request.publisherId,
                  request.nonce,
                  request.freshUntil
                )
              }
              throw error
            }
          }
          const existingNonce = readNonce.get(
            MARKETPLACE_NONCE_NAMESPACES.publisherRequestV2,
            request.publisherId,
            request.nonce
          )
          if (existingNonce) {
            persistNonceCollision(
              MARKETPLACE_NONCE_NAMESPACES.publisherRequestV2,
              request.publisherId,
              request.nonce,
              request.freshUntil
            )
            throw new MarketplacePublisherMutationConflictError()
          }
          assertPublisherMutationCapacity(request)

          const state = await currentVerifiedState()
          const memory = createMemoryMarketplaceRepository({ initialState: state })
          let committedResponse: MarketplacePublisherMutationResponse
          const commitPlans: MarketplacePublisherMutationCommitPlan[] = []
          let verifiedNext: MarketplaceStateV1 | null = null
          try {
            committedResponse = await memory.transaction(async (transaction) => {
              let result:
                | MarketplacePublisherMutationCommitPlan
                | MarketplacePublisherMutationSuccessResponse
              try {
                result = await operation(transaction)
              } catch (error) {
                if (!(error instanceof MarketplacePublisherMutationTerminalError)) throw error
                throw new MarketplacePublisherMutationTerminalCallbackAbortError(error)
              }
              if (result instanceof MarketplacePublisherMutationCommitPlan) {
                commitPlans.push(result)
              }
              return parseMarketplacePublisherMutationSuccessResponse(
                request.operation,
                result instanceof MarketplacePublisherMutationCommitPlan ? result.response : result
              )
            })
            verifiedNext = await verifiedState(await memory.snapshot())
          } catch (error) {
            if (!(error instanceof MarketplacePublisherMutationTerminalCallbackAbortError)) {
              throw error
            }
            committedResponse = createMarketplacePublisherMutationTerminalResponse(
              error.terminalError
            )
          }
          assertPublisherMutationCapacity(request, committedResponse.byteLength)
          if (commitPlans.length > 1) {
            throw new Error('Marketplace Publisher mutation returned multiple commit plans')
          }
          await commitPlans[0]?.commit()

          const nonceResult = insertNonce.run(
            MARKETPLACE_NONCE_NAMESPACES.publisherRequestV2,
            request.publisherId,
            request.nonce,
            request.freshUntil
          )
          if (nonceResult.changes !== 1) {
            throw new MarketplacePublisherMutationConflictError()
          }
          if (verifiedNext) {
            const updated = updateStateRow.run(
              MARKETPLACE_SQLITE_SCHEMA_VERSION,
              stateJSON(verifiedNext)
            )
            if (updated.changes !== 1) {
              throw new Error('Marketplace SQLite state row update did not affect exactly one row')
            }
            prunePublicationCompletions(verifiedNext)
          }
          const inserted = insertReceipt.run(
            MARKETPLACE_NONCE_NAMESPACES.publisherRequestV2,
            request.publisherId,
            request.nonce,
            request.authVersion,
            request.operation,
            request.audience,
            request.keyId,
            request.method,
            request.target,
            request.timestamp,
            request.freshUntil,
            request.bodyDigest,
            request.requestDigest,
            request.signatureDigest,
            committedResponse.status,
            committedResponse.json,
            committedResponse.digest,
            committedResponse.byteLength,
            now
          )
          if (inserted.changes !== 1) {
            throw new Error('Marketplace SQLite Publisher mutation receipt was not inserted')
          }
          // See transaction(): the cache generation must be sampled under the write lock.
          const committedDataVersion = dataVersion()
          database.exec('COMMIT')
          cachedState = verifiedNext ?? state
          cachedDataVersion = committedDataVersion
          return Object.freeze({
            source: 'committed' as const,
            response: structuredClone(committedResponse)
          })
        } catch (error) {
          return rollback(error)
        }
      })
    },
    checkpoint() {
      return enqueue(async () => {
        database.exec('BEGIN IMMEDIATE')
        try {
          const now = (options.now ?? Date.now)()
          if (!Number.isSafeInteger(now)) throw new TypeError('Marketplace clock is invalid')
          cleanupNonces.run(now)
          verifyStoredPublisherReceipts()
          const integrity = database
            .query<Record<string, string>, []>('PRAGMA quick_check')
            .all()
            .flatMap((row) => Object.values(row))
          if (integrity.length !== 1 || integrity[0] !== 'ok') {
            throw new Error('Marketplace SQLite quick_check failed')
          }
          const state = await refreshVerifiedState()
          verifyMarketplaceSqlitePublicationReservation(database, state)
          verifyStoredPublicationCompletions(state)
          const databaseBytes = portableSerializedDatabase(database.serialize())
          database.exec('COMMIT')
          return Object.freeze({ state: structuredClone(state), databaseBytes })
        } catch (error) {
          return rollback(error)
        }
      })
    },
    async close() {
      if (closed) return
      closed = true
      await Promise.allSettled([initialization, queue])
      database.close(false)
    }
  }
}
