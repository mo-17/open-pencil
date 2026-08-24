import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { link, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import { createSqliteMarketplaceRepository } from '@open-pencil/marketplace'

const directories: string[] = []

function databasePath(): string {
  const root = join(tmpdir(), `openpencil-marketplace-phase8-sqlite-${randomUUID()}`)
  directories.push(root)
  return join(root, 'generation', 'marketplace.sqlite')
}

const INCOMPLETE_GENERATION_FILE = '.openpencil-marketplace-incomplete'

function reservationPath(generation: string): string {
  return join(dirname(generation), `.${basename(generation)}${INCOMPLETE_GENERATION_FILE}`)
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('Phase 8 SQLite recovery invariants', () => {
  test('rejects a parent-side generation reservation before creating its directory or database', async () => {
    const path = databasePath()
    const generation = dirname(path)
    await mkdir(dirname(generation), { recursive: true })
    await writeFile(reservationPath(generation), 'incomplete\n', { mode: 0o600 })

    expect(() => createSqliteMarketplaceRepository({ path })).toThrow(/incomplete|reservation/i)
    expect(existsSync(generation)).toBe(false)
    expect(existsSync(path)).toBe(false)
  })

  test('rejects an in-generation marker without silently creating a missing database', async () => {
    const path = databasePath()
    await mkdir(dirname(path), { recursive: true })
    await writeFile(join(dirname(path), INCOMPLETE_GENERATION_FILE), 'incomplete\n', {
      mode: 0o600
    })

    expect(() => createSqliteMarketplaceRepository({ path })).toThrow(/incomplete/i)
    expect(existsSync(path)).toBe(false)
  })

  test('rejects an in-generation marker before opening an existing database', async () => {
    const path = databasePath()
    const repository = createSqliteMarketplaceRepository({ path })
    await repository.close()
    await writeFile(join(dirname(path), INCOMPLETE_GENERATION_FILE), 'incomplete\n', {
      mode: 0o600
    })

    expect(() => createSqliteMarketplaceRepository({ path })).toThrow(/incomplete/i)
  })

  test('rejects a dangling database symlink without creating its target', async () => {
    const path = databasePath()
    const target = join(dirname(path), 'escaped.sqlite')
    await mkdir(dirname(path), { recursive: true })
    await symlink(target, path)

    let repository: ReturnType<typeof createSqliteMarketplaceRepository> | undefined
    let failure: unknown
    try {
      repository = createSqliteMarketplaceRepository({ path })
    } catch (error) {
      failure = error
    } finally {
      await repository?.close()
    }

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toMatch(/symbolic link|symlink/i)
    expect(existsSync(target)).toBe(false)
  })

  test('rejects a multiply linked database file', async () => {
    const path = databasePath()
    const repository = createSqliteMarketplaceRepository({ path })
    await repository.close()
    const alias = join(dirname(path), 'marketplace-alias.sqlite')
    await link(path, alias)

    let reopened: ReturnType<typeof createSqliteMarketplaceRepository> | undefined
    let failure: unknown
    try {
      reopened = createSqliteMarketplaceRepository({ path: alias })
    } catch (error) {
      failure = error
    } finally {
      await reopened?.close()
    }

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toMatch(/hard link|multiply linked/i)
  })

  test('leaves a failed new database unable to silently reinitialize', () => {
    const path = databasePath()
    expect(() => createSqliteMarketplaceRepository({ path, initialState: {} })).toThrow()
    expect(existsSync(path)).toBe(true)
    expect(() => createSqliteMarketplaceRepository({ path })).toThrow(/state row|schema/i)
  })

  test('fails closed when an existing marketplace database has lost its sole state row', async () => {
    const path = databasePath()
    const repository = createSqliteMarketplaceRepository({ path })
    await repository.transaction((transaction) =>
      transaction.createPublisher(
        { id: 'acme', displayName: 'Acme Plugins' },
        { actor: 'operator:test', time: '2026-08-22T00:00:00.000Z' }
      )
    )
    await repository.close()

    const database = new Database(path, { strict: true })
    database.exec('DELETE FROM marketplace_state WHERE id = 1')
    database.close(false)

    expect(() => createSqliteMarketplaceRepository({ path })).toThrow(/state row.*missing/i)
  })

  test('rejects a same-name state table with an extra column and no id CHECK constraint', async () => {
    const path = databasePath()
    const repository = createSqliteMarketplaceRepository({ path })
    await repository.close()

    const database = new Database(path, { strict: true })
    database.exec(`
      ALTER TABLE marketplace_state RENAME TO marketplace_state_previous;
      CREATE TABLE marketplace_state (
        id INTEGER PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        state_json TEXT NOT NULL,
        unexpected TEXT
      );
      INSERT INTO marketplace_state (id, schema_version, state_json)
        SELECT id, schema_version, state_json FROM marketplace_state_previous;
      DROP TABLE marketplace_state_previous;
    `)
    database.close(false)

    let reopened: ReturnType<typeof createSqliteMarketplaceRepository> | undefined
    let failure: unknown
    try {
      reopened = createSqliteMarketplaceRepository({ path })
    } catch (error) {
      failure = error
    } finally {
      await reopened?.close()
    }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toMatch(/schema/i)
  })

  test('rejects a same-name expiry index with changed uniqueness and column order', async () => {
    const path = databasePath()
    const repository = createSqliteMarketplaceRepository({ path })
    await repository.close()

    const database = new Database(path, { strict: true })
    database.exec(`
      DROP INDEX marketplace_nonces_expiry;
      CREATE UNIQUE INDEX marketplace_nonces_expiry
        ON marketplace_nonces (publisher_id, expires_at);
    `)
    database.close(false)

    expect(() => createSqliteMarketplaceRepository({ path })).toThrow(/schema/i)
  })

  test('serializes state and replay nonces into one repository checkpoint', async () => {
    const path = databasePath()
    const repository = createSqliteMarketplaceRepository({
      path,
      now: () => Date.parse('2026-08-22T00:00:00.000Z')
    })
    await repository.transaction((transaction) =>
      transaction.createPublisher(
        { id: 'acme', displayName: 'Acme Plugins' },
        { actor: 'operator:test', time: '2026-08-22T00:00:00.000Z' }
      )
    )
    expect(
      await repository.nonces.consume(
        'acme',
        'phase8-checkpoint-nonce',
        Date.parse('2026-08-22T00:01:00.000Z')
      )
    ).toBe(true)

    const checkpoint = await repository.checkpoint()
    expect(checkpoint.state.publishers.map(({ id }) => id)).toEqual(['acme'])
    expect(checkpoint.databaseBytes.byteLength).toBeGreaterThan(0)

    const serialized = Database.deserialize(checkpoint.databaseBytes, {
      readonly: true,
      strict: true
    })
    expect(
      serialized
        .query<{ count: number }, []>(
          'SELECT COUNT(*) AS count FROM marketplace_state WHERE id = 1'
        )
        .get()?.count
    ).toBe(1)
    expect(
      serialized
        .query<{ count: number }, []>(
          "SELECT COUNT(*) AS count FROM marketplace_nonces WHERE publisher_id = 'acme'"
        )
        .get()?.count
    ).toBe(1)
    serialized.close(false)
    await repository.close()
  })
})
