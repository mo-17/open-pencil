import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createSqliteMarketplaceRepository } from '@open-pencil/marketplace'
import { exportEd25519PublicKeyPem } from '@open-pencil/scene-graph'

const NOW = Date.parse('2026-08-05T12:00:00.000Z')
const temporaryDirectories: string[] = []

function databasePath(): string {
  const directory = join(tmpdir(), `openpencil-marketplace-sqlite-${randomUUID()}`)
  temporaryDirectories.push(directory)
  return join(directory, 'marketplace.sqlite')
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('SQLite marketplace repository', () => {
  test('persists one versioned state row and durable replay nonces across restart', async () => {
    const path = databasePath()
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const first = createSqliteMarketplaceRepository({ path, now: () => NOW })
    await first.transaction(async (transaction) => {
      await transaction.createPublisher(
        { id: 'acme', displayName: 'Acme Plugins' },
        { actor: 'test', time: new Date(NOW).toISOString() }
      )
      await transaction.registerPublisherKey(
        {
          keyId: 'acme.release',
          publisherId: 'acme',
          publicKeyPem: await exportEd25519PublicKeyPem(pair.publicKey),
          notBefore: '2026-01-01T00:00:00.000Z',
          notAfter: '2027-01-01T00:00:00.000Z'
        },
        { actor: 'test', time: new Date(NOW).toISOString() }
      )
    })
    expect(await first.nonces.consume('acme', 'abcdefghijklmnop', NOW + 60_000)).toBe(true)
    await first.close()

    const reopened = createSqliteMarketplaceRepository({ path, now: () => NOW })
    const state = await reopened.snapshot()
    expect(state.publishers).toHaveLength(1)
    expect(state.publisherKeys).toHaveLength(1)
    expect(state.auditEvents.map(({ action }) => action)).toEqual([
      'publisher.created',
      'publisher_key.registered'
    ])
    expect(await reopened.nonces.consume('acme', 'abcdefghijklmnop', NOW + 60_000)).toBe(false)
    await reopened.close()

    const database = new Database(path, { strict: true })
    const rows = database
      .query<{ count: number }, []>('SELECT COUNT(*) AS count FROM marketplace_state')
      .get()
    expect(rows?.count).toBe(1)
    database.close(false)
  })

  test('rolls back failed transactions and rejects a tampered audit chain on load', async () => {
    const path = databasePath()
    const repository = createSqliteMarketplaceRepository({ path })
    await expect(
      repository.transaction(async (transaction) => {
        await transaction.createPublisher(
          { id: 'temporary', displayName: 'Temporary Publisher' },
          { actor: 'test', time: '2026-08-05T12:00:00.000Z' }
        )
        throw new Error('abort transaction')
      })
    ).rejects.toThrow('abort transaction')
    expect((await repository.snapshot()).publishers).toHaveLength(0)
    await repository.transaction((transaction) =>
      transaction.createPublisher(
        { id: 'acme', displayName: 'Acme Plugins' },
        { actor: 'test', time: '2026-08-05T12:00:00.000Z' }
      )
    )
    await repository.close()

    const database = new Database(path, { strict: true })
    const row = database
      .query<{ state_json: string }, []>('SELECT state_json FROM marketplace_state WHERE id = 1')
      .get()
    const state = JSON.parse(row?.state_json ?? '{}')
    state.auditEvents[0].eventHash = 'A'.repeat(43)
    database
      .query('UPDATE marketplace_state SET state_json = ? WHERE id = 1')
      .run(JSON.stringify(state))
    database.close(false)

    const tampered = createSqliteMarketplaceRepository({ path })
    await expect(tampered.snapshot()).rejects.toThrow('invalid eventHash')
    await tampered.close()
  })
})
