import { Database } from 'bun:sqlite'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { canonicalManifestValue, validateModuleIdentity } from '@open-pencil/scene-graph'

import { verifyMarketplaceAuditChain } from './audit'
import type { MarketplaceNonceStore } from './auth'
import { createMemoryMarketplaceRepository, type MarketplaceRepository } from './repository'
import { createEmptyMarketplaceState, parseMarketplaceState } from './types'

export const MARKETPLACE_SQLITE_SCHEMA_VERSION = 1 as const

export interface CreateSqliteMarketplaceRepositoryOptions {
  path: string
  initialState?: unknown
  busyTimeoutMilliseconds?: number
  now?: () => number
}

export interface SqliteMarketplaceRepository extends MarketplaceRepository {
  readonly nonces: MarketplaceNonceStore
  close(): Promise<void>
}

interface StateRow {
  schema_version: number
  state_json: string
}

interface ChangeResult {
  changes: number
}

const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/

function databasePath(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new TypeError('Marketplace SQLite path must be a non-empty file path')
  }
  if (value === ':memory:') return value
  const absolute = resolve(value)
  mkdirSync(dirname(absolute), { recursive: true, mode: 0o700 })
  return absolute
}

function busyTimeout(value: number | undefined): number {
  const resolved = value ?? 5_000
  if (!Number.isSafeInteger(resolved) || resolved < 0 || resolved > 60_000) {
    throw new TypeError('Marketplace SQLite busy timeout must be between 0 and 60000 ms')
  }
  return resolved
}

function stateJSON(value: unknown): string {
  return JSON.stringify(canonicalManifestValue(parseMarketplaceState(value)))
}

async function verifiedState(value: unknown) {
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
  const path = databasePath(options.path)
  const database = new Database(path, { create: true, strict: true })
  database.exec(`PRAGMA busy_timeout = ${busyTimeout(options.busyTimeoutMilliseconds)}`)
  database.exec('PRAGMA journal_mode = WAL')
  database.exec('PRAGMA synchronous = FULL')
  database.exec('PRAGMA foreign_keys = ON')
  database.exec(`
    CREATE TABLE IF NOT EXISTS marketplace_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      schema_version INTEGER NOT NULL,
      state_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS marketplace_nonces (
      publisher_id TEXT NOT NULL,
      nonce TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY (publisher_id, nonce)
    );
    CREATE INDEX IF NOT EXISTS marketplace_nonces_expiry
      ON marketplace_nonces (expires_at);
  `)
  const initialState =
    options.initialState === undefined
      ? createEmptyMarketplaceState()
      : parseMarketplaceState(options.initialState)
  database
    .query(
      'INSERT OR IGNORE INTO marketplace_state (id, schema_version, state_json) VALUES (1, ?, ?)'
    )
    .run(MARKETPLACE_SQLITE_SCHEMA_VERSION, stateJSON(initialState))
  if (path !== ':memory:') chmodSync(path, 0o600)

  const readStateRow = database.query<StateRow, []>(
    'SELECT schema_version, state_json FROM marketplace_state WHERE id = 1'
  )
  const updateStateRow = database.query<never, [number, string]>(
    'UPDATE marketplace_state SET schema_version = ?, state_json = ? WHERE id = 1'
  )
  const cleanupNonces = database.query<never, [number]>(
    'DELETE FROM marketplace_nonces WHERE expires_at < ?'
  )
  const insertNonce = database.query<ChangeResult, [string, string, number]>(
    'INSERT OR IGNORE INTO marketplace_nonces (publisher_id, nonce, expires_at) VALUES (?, ?, ?)'
  )
  const initialization = verifiedState(parseStateRow(readStateRow.get())).then(() => undefined)
  let queue: Promise<void> = Promise.resolve()
  let closed = false

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

  async function load(): Promise<Awaited<ReturnType<typeof verifiedState>>> {
    return verifiedState(parseStateRow(readStateRow.get()))
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
          database.exec('ROLLBACK')
          throw error
        }
      })
    }
  }

  return {
    nonces,
    snapshot() {
      return enqueue(load)
    },
    transaction(operation) {
      return enqueue(async () => {
        database.exec('BEGIN IMMEDIATE')
        try {
          const state = await load()
          const memory = createMemoryMarketplaceRepository({ initialState: state })
          const result = await memory.transaction(operation)
          const next = await memory.snapshot()
          updateStateRow.run(MARKETPLACE_SQLITE_SCHEMA_VERSION, stateJSON(next))
          database.exec('COMMIT')
          return structuredClone(result)
        } catch (error) {
          database.exec('ROLLBACK')
          throw error
        }
      })
    },
    async close() {
      if (closed) return
      closed = true
      await queue
      database.close(false)
    }
  }
}
