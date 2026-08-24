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

import { canonicalManifestValue, validateModuleIdentity } from '@open-pencil/scene-graph'

import { verifyMarketplaceAuditChain } from './audit'
import type { MarketplaceNonceStore } from './auth'
import { createMemoryMarketplaceRepository, type MarketplaceRepository } from './repository'
import {
  assertMarketplaceSqliteSchema,
  MARKETPLACE_INCOMPLETE_GENERATION_FILE,
  MARKETPLACE_SQLITE_SCHEMA_VERSION,
  marketplaceGenerationReservationPath
} from './sqlite-layout'
import {
  createEmptyMarketplaceState,
  parseMarketplaceState,
  type MarketplaceStateV1
} from './types'

export { MARKETPLACE_SQLITE_SCHEMA_VERSION }

export interface CreateSqliteMarketplaceRepositoryOptions {
  path: string
  initialState?: unknown
  busyTimeoutMilliseconds?: number
  now?: () => number
}

export interface SqliteMarketplaceRepository extends MarketplaceRepository {
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

interface DataVersionRow {
  data_version: number
}

interface MarketplaceDatabasePath {
  readonly path: string
  readonly isNew: boolean
  readonly descriptor: number | null
  readonly identity: { readonly device: bigint; readonly inode: bigint } | null
}

const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/

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

function assertPublisherId(value: string): void {
  const reason = validateModuleIdentity(value, 'marketplace nonce publisher id')
  if (reason) throw new TypeError(reason)
}

function assertNonce(value: string): void {
  if (!NONCE_PATTERN.test(value)) {
    throw new TypeError('Marketplace nonce must be bounded base64url text')
  }
}

export function createSqliteMarketplaceRepository(
  options: CreateSqliteMarketplaceRepositoryOptions
): SqliteMarketplaceRepository {
  const prepared = databasePath(options.path)
  const isNewDatabase = prepared.isNew
  const database = openDatabase(prepared)
  try {
    if (!isNewDatabase) {
      if (options.initialState !== undefined) {
        throw new Error('Marketplace SQLite initialState is only allowed for a new database')
      }
      assertDatabaseSchema(database)
      const rows = database
        .query<{ count: number; expected: number }, []>(
          'SELECT COUNT(*) AS count, SUM(CASE WHEN id = 1 THEN 1 ELSE 0 END) AS expected FROM marketplace_state'
        )
        .get()
      if (rows?.count !== 1 || rows.expected !== 1) {
        throw new Error('Marketplace SQLite state row is missing or not unique')
      }
    }

    database.exec(`PRAGMA busy_timeout = ${busyTimeout(options.busyTimeoutMilliseconds)}`)
    database.exec('PRAGMA journal_mode = WAL')
    database.exec('PRAGMA synchronous = FULL')
    database.exec('PRAGMA foreign_keys = ON')

    if (isNewDatabase) {
      database.exec(`
        CREATE TABLE marketplace_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          schema_version INTEGER NOT NULL,
          state_json TEXT NOT NULL
        );
        CREATE TABLE marketplace_nonces (
          publisher_id TEXT NOT NULL,
          nonce TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          PRIMARY KEY (publisher_id, nonce)
        );
        CREATE INDEX marketplace_nonces_expiry
          ON marketplace_nonces (expires_at);
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
  const readDataVersion = database.query<DataVersionRow, []>('PRAGMA data_version')
  const cleanupNonces = database.query<never, [number]>(
    'DELETE FROM marketplace_nonces WHERE expires_at < ?'
  )
  const insertNonce = database.query<ChangeResult, [string, string, number]>(
    'INSERT OR IGNORE INTO marketplace_nonces (publisher_id, nonce, expires_at) VALUES (?, ?, ?)'
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

  const initialization = refreshVerifiedState().then(() => undefined)

  function assertOpen(): void {
    if (closed) throw new Error('Marketplace SQLite repository is closed')
  }

  function enqueue<Value>(operation: () => Promise<Value>): Promise<Value> {
    if (closed) return Promise.reject(new Error('Marketplace SQLite repository is closed'))
    const running = queue.then(async () => {
      await initialization
      return operation()
    })
    queue = running.then(
      () => undefined,
      () => undefined
    )
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

  const nonces: MarketplaceNonceStore = {
    consume(publisherId, nonce, expiresAt) {
      return enqueue(async () => {
        assertPublisherId(publisherId)
        assertNonce(nonce)
        if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) {
          throw new TypeError('Marketplace nonce expiry must be a positive safe integer')
        }
        const now = (options.now ?? Date.now)()
        if (!Number.isSafeInteger(now)) throw new TypeError('Marketplace clock is invalid')
        database.exec('BEGIN IMMEDIATE')
        try {
          cleanupNonces.run(now)
          const result = insertNonce.run(publisherId, nonce, expiresAt)
          database.exec('COMMIT')
          return result.changes === 1
        } catch (error) {
          return rollback(error)
        }
      })
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
    transaction(operation) {
      return enqueue(async () => {
        database.exec('BEGIN IMMEDIATE')
        try {
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
          database.exec('COMMIT')
          cachedState = verifiedNext
          cachedDataVersion = dataVersion()
          return structuredClone(result)
        } catch (error) {
          return rollback(error)
        }
      })
    },
    checkpoint() {
      return enqueue(async () => {
        database.exec('BEGIN IMMEDIATE')
        try {
          const integrity = database
            .query<Record<string, string>, []>('PRAGMA quick_check')
            .all()
            .flatMap((row) => Object.values(row))
          if (integrity.length !== 1 || integrity[0] !== 'ok') {
            throw new Error('Marketplace SQLite quick_check failed')
          }
          const state = await refreshVerifiedState()
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
