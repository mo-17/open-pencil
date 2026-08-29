import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, test } from 'bun:test'
import { createHash, randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  MARKETPLACE_PUBLISHER_MUTATION_LIMITS,
  MARKETPLACE_SQLITE_SCHEMA_VERSION,
  MarketplacePublisherMutationCommitPlan,
  MarketplacePublisherMutationConflictError,
  MarketplacePublisherMutationTerminalError,
  createMarketplaceHttpApp,
  createMarketplaceService,
  createMemoryMarketplaceArtifactStore,
  createMemoryMarketplaceRepository,
  createMarketplacePublisherMutationResponse,
  createMarketplacePublisherMutationTerminalResponse,
  createSqliteMarketplaceRepository,
  signMarketplaceRequest,
  type MarketplaceVerifiedPublisherMutationRequest
} from '@open-pencil/marketplace'
import { exportEd25519PublicKeyPem } from '@open-pencil/scene-graph'

const NOW = Date.parse('2026-08-27T12:00:00.000Z')
const temporaryDirectories: string[] = []

function databasePath(): string {
  const directory = join(tmpdir(), `openpencil-publisher-idempotency-${randomUUID()}`)
  temporaryDirectories.push(directory)
  return join(directory, 'marketplace.sqlite')
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('base64url')
}

function request(
  overrides: Partial<MarketplaceVerifiedPublisherMutationRequest> = {}
): MarketplaceVerifiedPublisherMutationRequest {
  return {
    authVersion: 2,
    operation: 'publisher.register',
    audience: 'openpencil-marketplace',
    publisherId: 'sqlite-publisher',
    keyId: 'sqlite-publisher-2026',
    method: 'POST',
    target: '/v1/publishers/register',
    timestamp: '2026-08-27T12:00:00.000Z',
    nonce: 'sqlitenonce000001',
    bodyDigest: digest('body'),
    requestDigest: digest('request'),
    signatureDigest: digest('signature'),
    freshUntil: NOW + 300_000,
    ...overrides
  }
}

async function syntheticSuccessResponse() {
  const fixture = createMemoryMarketplaceRepository({ now: () => NOW })
  const publisher = await fixture.transaction((transaction) =>
    transaction.createPublisher(
      { id: 'synthetic-success', displayName: 'Synthetic Success' },
      { actor: 'admin:test', time: '2026-08-27T12:00:00.000Z' }
    )
  )
  return createMarketplacePublisherMutationResponse('publisher.register', publisher)
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('Marketplace Publisher mutation SQLite idempotency', () => {
  test('serializes the same exact request across two SQLite connections', async () => {
    const path = databasePath()
    const first = createSqliteMarketplaceRepository({ path, now: () => NOW })
    await first.snapshot()
    const second = createSqliteMarketplaceRepository({ path, now: () => NOW })
    await second.snapshot()
    let executions = 0
    const execute = (repository: typeof first) =>
      repository.executePublisherMutation(request(), NOW, async (transaction) => {
        executions++
        const publisher = await transaction.createPublisher(
          { id: 'sqlite-publisher', displayName: 'SQLite Publisher' },
          { actor: 'publisher:sqlite-publisher', time: '2026-08-27T12:00:00.000Z' }
        )
        return createMarketplacePublisherMutationResponse('publisher.register', publisher)
      })

    const [left, right] = await Promise.all([execute(first), execute(second)])
    expect(executions).toBe(1)
    expect([left.source, right.source].sort()).toEqual(['committed', 'replayed'])
    expect(left.response).toEqual(right.response)
    await Promise.all([first.close(), second.close()])
  })

  test('replays the exact committed result after close and reopen', async () => {
    const path = databasePath()
    const first = createSqliteMarketplaceRepository({ path, now: () => NOW })
    const committed = await first.executePublisherMutation(request(), NOW, async (transaction) => {
      const publisher = await transaction.createPublisher(
        { id: 'sqlite-publisher', displayName: 'SQLite Publisher' },
        { actor: 'publisher:sqlite-publisher', time: '2026-08-27T12:00:00.000Z' }
      )
      return createMarketplacePublisherMutationResponse('publisher.register', publisher)
    })
    await first.close()

    const reopened = createSqliteMarketplaceRepository({ path, now: () => NOW })
    let executions = 0
    const replayed = await reopened.executePublisherMutation(request(), NOW, async () => {
      executions++
      throw new Error('a committed receipt must bypass the mutation callback')
    })
    expect(executions).toBe(0)
    expect(replayed.source).toBe('replayed')
    expect(replayed.response).toEqual(committed.response)
    expect((await reopened.snapshot()).auditEvents).toHaveLength(1)
    await reopened.close()

    const database = new Database(path, { readonly: true, strict: true })
    expect(
      database
        .query<{ count: number }, []>(
          'SELECT COUNT(*) AS count FROM marketplace_publisher_mutation_receipts'
        )
        .get()?.count
    ).toBe(1)
    database.close(false)
  })

  test('rolls back state, nonce, and receipt together when response creation fails', async () => {
    const path = databasePath()
    const repository = createSqliteMarketplaceRepository({ path, now: () => NOW })
    await expect(
      repository.executePublisherMutation(request(), NOW, async (transaction) => {
        await transaction.createPublisher(
          { id: 'sqlite-publisher', displayName: 'SQLite Publisher' },
          { actor: 'publisher:sqlite-publisher', time: '2026-08-27T12:00:00.000Z' }
        )
        throw new Error('response serialization failed')
      })
    ).rejects.toThrow('response serialization failed')
    expect((await repository.snapshot()).publishers).toHaveLength(0)
    expect(await repository.inspectPublisherMutation(request(), NOW)).toBeNull()
    await repository.close()
  })

  test('rejects normally returned terminal responses and terminal commit plans without side effects', async () => {
    const path = databasePath()
    const repository = createSqliteMarketplaceRepository({ path, now: () => NOW })
    const returnedRequest = request({
      nonce: 'returnedterminal01',
      requestDigest: digest('returned terminal request'),
      signatureDigest: digest('returned terminal signature')
    })
    await expect(
      repository.executePublisherMutation(returnedRequest, NOW, async (transaction) => {
        await transaction.createPublisher(
          { id: 'sqlite-publisher', displayName: 'Must Roll Back' },
          { actor: 'publisher:sqlite-publisher', time: '2026-08-27T12:00:00.000Z' }
        )
        return createMarketplacePublisherMutationTerminalResponse(
          new MarketplacePublisherMutationTerminalError('state-conflict')
        ) as never
      })
    ).rejects.toThrow('Publisher mutation callback must return a success response')
    expect((await repository.snapshot()).publishers).toHaveLength(0)
    expect((await repository.snapshot()).auditEvents).toHaveLength(0)
    expect(await repository.inspectPublisherMutation(returnedRequest, NOW)).toBeNull()

    let commitSideEffects = 0
    const plannedRequest = request({
      nonce: 'plannedterminal001',
      requestDigest: digest('planned terminal request'),
      signatureDigest: digest('planned terminal signature')
    })
    await expect(
      repository.executePublisherMutation(plannedRequest, NOW, async (transaction) => {
        await transaction.createPublisher(
          { id: 'sqlite-publisher', displayName: 'Must Still Roll Back' },
          { actor: 'publisher:sqlite-publisher', time: '2026-08-27T12:00:00.000Z' }
        )
        return new MarketplacePublisherMutationCommitPlan(
          'publisher.register',
          createMarketplacePublisherMutationTerminalResponse(
            new MarketplacePublisherMutationTerminalError('state-conflict')
          ) as never,
          async () => {
            commitSideEffects++
          }
        )
      })
    ).rejects.toThrow('Publisher mutation callback must return a success response')
    expect(commitSideEffects).toBe(0)
    expect((await repository.snapshot()).publishers).toHaveLength(0)
    expect((await repository.snapshot()).auditEvents).toHaveLength(0)
    expect(await repository.inspectPublisherMutation(plannedRequest, NOW)).toBeNull()

    const successResponse = await syntheticSuccessResponse()
    let poisonedPlanSideEffects = 0
    const poisonedRequest = request({
      nonce: 'poisonedplan0001',
      requestDigest: digest('poisoned plan request'),
      signatureDigest: digest('poisoned plan signature')
    })
    await expect(
      repository.executePublisherMutation(poisonedRequest, NOW, async (transaction) => {
        try {
          await transaction.createPublisher(
            { id: 'invalid publisher id', displayName: 'Invalid Publisher' },
            { actor: 'publisher:sqlite-publisher', time: '2026-08-27T12:00:00.000Z' }
          )
        } catch (error) {
          // The transaction must fail verification before its deferred side effect.
          expect(error).toBeInstanceOf(Error)
        }
        return new MarketplacePublisherMutationCommitPlan(
          'publisher.register',
          successResponse,
          async () => {
            poisonedPlanSideEffects++
          }
        )
      })
    ).rejects.toThrow()
    expect(poisonedPlanSideEffects).toBe(0)
    expect(await repository.inspectPublisherMutation(poisonedRequest, NOW)).toBeNull()

    let failingPlanAttempts = 0
    const failingPlanRequest = request({
      nonce: 'failingplan00001',
      requestDigest: digest('failing plan request'),
      signatureDigest: digest('failing plan signature')
    })
    await expect(
      repository.executePublisherMutation(
        failingPlanRequest,
        NOW,
        async () =>
          new MarketplacePublisherMutationCommitPlan(
            'publisher.register',
            successResponse,
            async () => {
              failingPlanAttempts++
              throw new MarketplacePublisherMutationTerminalError('state-conflict')
            }
          )
      )
    ).rejects.toBeInstanceOf(MarketplacePublisherMutationTerminalError)
    expect(failingPlanAttempts).toBe(1)
    expect((await repository.snapshot()).publishers).toHaveLength(0)
    expect((await repository.snapshot()).auditEvents).toHaveLength(0)
    expect(await repository.inspectPublisherMutation(failingPlanRequest, NOW)).toBeNull()
    await repository.close()
  })

  test('persists a deterministic failure across restart without committing domain state', async () => {
    const path = databasePath()
    const repository = createSqliteMarketplaceRepository({ path, now: () => NOW })
    const committed = await repository.executePublisherMutation(
      request(),
      NOW,
      async (transaction) => {
        await transaction.createPublisher(
          { id: 'sqlite-publisher', displayName: 'Must Roll Back' },
          { actor: 'publisher:sqlite-publisher', time: '2026-08-27T12:00:00.000Z' }
        )
        throw new MarketplacePublisherMutationTerminalError('resource-not-found')
      }
    )
    expect(committed.response.status).toBe(404)
    expect((await repository.snapshot()).publishers).toHaveLength(0)
    expect((await repository.snapshot()).auditEvents).toHaveLength(0)
    await repository.close()

    const reopened = createSqliteMarketplaceRepository({ path, now: () => NOW })
    await reopened.transaction((transaction) =>
      transaction.createPublisher(
        { id: 'state-changed', displayName: 'State Changed' },
        { actor: 'admin:test', time: '2026-08-27T12:00:00.000Z' }
      )
    )
    let replayCallbackCalls = 0
    const replayed = await reopened.executePublisherMutation(request(), NOW, async () => {
      replayCallbackCalls++
      throw new Error('a terminal receipt must bypass the mutation callback')
    })
    expect(replayCallbackCalls).toBe(0)
    expect(replayed.source).toBe('replayed')
    expect(replayed.response).toEqual(committed.response)
    expect((await reopened.snapshot()).publishers.map(({ id }) => id)).toEqual(['state-changed'])
    await reopened.close()
  })

  test('atomically migrates an exact schema-v1 database and preserves its nonce', async () => {
    const path = databasePath()
    const initialized = createSqliteMarketplaceRepository({ path, now: () => NOW })
    await initialized.close()

    const legacy = new Database(path, { strict: true })
    legacy.exec(`
      PRAGMA foreign_keys = OFF;
      DROP TABLE marketplace_publication_completion_receipts;
      DROP TABLE marketplace_publication_reservation;
      DROP TABLE marketplace_publisher_mutation_receipts;
      DROP INDEX marketplace_nonces_expiry;
      ALTER TABLE marketplace_nonces RENAME TO marketplace_nonces_v2;
      CREATE TABLE marketplace_nonces (
        publisher_id TEXT NOT NULL,
        nonce TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (publisher_id, nonce)
      );
      INSERT INTO marketplace_nonces (publisher_id, nonce, expires_at)
        VALUES ('legacy-publisher', 'legacynonce000001', ${NOW + 60_000});
      DROP TABLE marketplace_nonces_v2;
      CREATE INDEX marketplace_nonces_expiry
        ON marketplace_nonces (expires_at);
      UPDATE marketplace_state SET schema_version = 1 WHERE id = 1;
    `)
    legacy.close(false)

    const migrated = createSqliteMarketplaceRepository({ path, now: () => NOW })
    expect(
      await migrated.nonces.consume(
        'publisher-request-v2',
        'legacy-publisher',
        'legacynonce000001',
        NOW + 60_000
      )
    ).toBe(false)
    await migrated.close()

    const inspected = new Database(path, { readonly: true, strict: true })
    expect(
      inspected
        .query<{ schema_version: number }, []>(
          'SELECT schema_version FROM marketplace_state WHERE id = 1'
        )
        .get()?.schema_version
    ).toBe(MARKETPLACE_SQLITE_SCHEMA_VERSION)
    expect(
      inspected
        .query<{ count: number }, []>(
          'SELECT COUNT(*) AS count FROM marketplace_publisher_mutation_receipts'
        )
        .get()?.count
    ).toBe(0)
    inspected.close(false)
  })

  test('migrates schema-v2 success receipts before accepting terminal responses', async () => {
    const path = databasePath()
    const initialized = createSqliteMarketplaceRepository({ path, now: () => NOW })
    const committed = await initialized.executePublisherMutation(
      request(),
      NOW,
      async (transaction) => {
        const publisher = await transaction.createPublisher(
          { id: 'sqlite-publisher', displayName: 'SQLite Publisher' },
          { actor: 'publisher:sqlite-publisher', time: '2026-08-27T12:00:00.000Z' }
        )
        return createMarketplacePublisherMutationResponse('publisher.register', publisher)
      }
    )
    await initialized.close()

    const legacy = new Database(path, { strict: true })
    legacy.exec(`
      PRAGMA foreign_keys = OFF;
      DROP TABLE marketplace_publication_completion_receipts;
      DROP TABLE marketplace_publication_reservation;
      ALTER TABLE marketplace_publisher_mutation_receipts
        RENAME TO marketplace_publisher_mutation_receipts_v3;
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
        response_status INTEGER NOT NULL CHECK (response_status IN (200, 201)),
        response_json TEXT NOT NULL,
        response_digest TEXT NOT NULL,
        response_byte_length INTEGER NOT NULL CHECK (response_byte_length > 0),
        committed_at INTEGER NOT NULL,
        PRIMARY KEY (namespace, publisher_id, nonce),
        FOREIGN KEY (namespace, publisher_id, nonce)
          REFERENCES marketplace_nonces (namespace, subject_id, nonce)
          ON DELETE CASCADE
      );
      INSERT INTO marketplace_publisher_mutation_receipts
      SELECT * FROM marketplace_publisher_mutation_receipts_v3;
      DROP TABLE marketplace_publisher_mutation_receipts_v3;
      UPDATE marketplace_state SET schema_version = 2 WHERE id = 1;
    `)
    legacy.close(false)

    const migrated = createSqliteMarketplaceRepository({ path, now: () => NOW })
    const replayed = await migrated.executePublisherMutation(request(), NOW, async () => {
      throw new Error('the migrated success receipt must replay')
    })
    expect(replayed.source).toBe('replayed')
    expect(replayed.response).toEqual(committed.response)
    await migrated.close()

    const inspected = new Database(path, { readonly: true, strict: true })
    expect(
      inspected
        .query<{ schema_version: number }, []>(
          'SELECT schema_version FROM marketplace_state WHERE id = 1'
        )
        .get()?.schema_version
    ).toBe(MARKETPLACE_SQLITE_SCHEMA_VERSION)
    inspected.close(false)
  })

  test('fails closed when a persisted exact response digest is tampered', async () => {
    const path = databasePath()
    const repository = createSqliteMarketplaceRepository({ path, now: () => NOW })
    await repository.executePublisherMutation(request(), NOW, async (transaction) => {
      const publisher = await transaction.createPublisher(
        { id: 'sqlite-publisher', displayName: 'SQLite Publisher' },
        { actor: 'publisher:sqlite-publisher', time: '2026-08-27T12:00:00.000Z' }
      )
      return createMarketplacePublisherMutationResponse('publisher.register', publisher)
    })
    await repository.close()

    const tampered = new Database(path, { strict: true })
    tampered
      .query('UPDATE marketplace_publisher_mutation_receipts SET response_digest = ?')
      .run('A'.repeat(43))
    tampered.close(false)

    const reopened = createSqliteMarketplaceRepository({ path, now: () => NOW })
    await expect(reopened.snapshot()).rejects.toThrow(/response digest/i)
    await reopened.close()
  })

  test('rejects a re-digested arbitrary terminal error string', async () => {
    const path = databasePath()
    const repository = createSqliteMarketplaceRepository({ path, now: () => NOW })
    await repository.executePublisherMutation(request(), NOW, async () => {
      throw new MarketplacePublisherMutationTerminalError('state-conflict')
    })
    await repository.close()

    const arbitrary = JSON.stringify({ error: 'arbitrary internal exception text' })
    const tampered = new Database(path, { strict: true })
    tampered
      .query(
        `UPDATE marketplace_publisher_mutation_receipts
         SET response_json = ?, response_digest = ?, response_byte_length = ?`
      )
      .run(arbitrary, digest(arbitrary), new TextEncoder().encode(arbitrary).byteLength)
    tampered.close(false)

    const reopened = createSqliteMarketplaceRepository({ path, now: () => NOW })
    await expect(reopened.snapshot()).rejects.toThrow(/supported failure/i)
    await reopened.close()
  })

  test('uses server time so a future-skew request cannot evict another live receipt', async () => {
    const path = databasePath()
    const repository = createSqliteMarketplaceRepository({ path, now: () => NOW })
    const earlier = {
      ...request(),
      timestamp: '2026-08-27T11:56:00.000Z',
      freshUntil: NOW + 60_000
    }
    const committed = await repository.executePublisherMutation(
      earlier,
      NOW,
      async (transaction) => {
        const publisher = await transaction.createPublisher(
          { id: 'sqlite-publisher', displayName: 'SQLite Publisher' },
          { actor: 'publisher:sqlite-publisher', time: '2026-08-27T12:00:00.000Z' }
        )
        return createMarketplacePublisherMutationResponse('publisher.register', publisher)
      }
    )
    const futureSkew = {
      ...request(),
      publisherId: 'future-sqlite-publisher',
      keyId: 'future-sqlite-publisher-2026',
      nonce: 'future-sqlite-001',
      timestamp: '2026-08-27T12:04:00.000Z',
      freshUntil: NOW + 540_000,
      requestDigest: digest('future sqlite request'),
      signatureDigest: digest('future sqlite signature')
    }

    expect(await repository.inspectPublisherMutation(futureSkew, NOW)).toBeNull()
    const inspected = new Database(path, { readonly: true, strict: true })
    expect(
      inspected
        .query<{ committed_at: number }, []>(
          'SELECT committed_at FROM marketplace_publisher_mutation_receipts'
        )
        .get()?.committed_at
    ).toBe(NOW)
    inspected.close(false)
    const replayed = await repository.inspectPublisherMutation(earlier, earlier.freshUntil)
    expect(replayed?.source).toBe('replayed')
    expect(replayed?.response).toEqual(committed.response)
    expect(await repository.inspectPublisherMutation(earlier, earlier.freshUntil + 1)).toBeNull()
    await repository.close()
  })

  test('keeps a nonce collision bound through the later signed request freshness window', async () => {
    const path = databasePath()
    const repository = createSqliteMarketplaceRepository({ path, now: () => NOW })
    const original = request()
    await repository.executePublisherMutation(original, NOW, async (transaction) => {
      const publisher = await transaction.createPublisher(
        { id: 'sqlite-publisher', displayName: 'SQLite Publisher' },
        { actor: 'publisher:sqlite-publisher', time: '2026-08-27T12:00:00.000Z' }
      )
      return createMarketplacePublisherMutationResponse('publisher.register', publisher)
    })
    const collision = request({
      timestamp: '2026-08-27T12:04:00.000Z',
      freshUntil: NOW + 9 * 60_000,
      bodyDigest: digest('later collision body'),
      requestDigest: digest('later collision request'),
      signatureDigest: digest('later collision signature')
    })
    const response = await syntheticSuccessResponse()
    let callbackCount = 0

    await expect(
      repository.executePublisherMutation(collision, NOW + 4 * 60_000, async () => {
        callbackCount++
        return response
      })
    ).rejects.toBeInstanceOf(MarketplacePublisherMutationConflictError)
    await expect(
      repository.executePublisherMutation(collision, NOW + 5 * 60_000 + 1, async () => {
        callbackCount++
        return response
      })
    ).rejects.toBeInstanceOf(MarketplacePublisherMutationConflictError)
    expect(callbackCount).toBe(0)
    expect(
      await repository.inspectPublisherMutation(collision, collision.freshUntil + 1)
    ).toBeNull()
    await repository.close()
  })

  test('rejects an exact aggregate-capacity boundary before invoking the mutation callback', async () => {
    const path = databasePath()
    const repository = createSqliteMarketplaceRepository({ path, now: () => NOW })
    await repository.snapshot()
    const responseJSON = JSON.stringify({
      error: 'Marketplace Publisher mutation conflicts with current state'
    })
    const database = new Database(path, { strict: true })
    database
      .query(
        `INSERT INTO marketplace_nonces
           (namespace, subject_id, nonce, expires_at)
         VALUES (?, ?, ?, ?)`
      )
      .run('publisher-request-v2', 'capacity-fixture', 'capacitynonce0001', NOW + 300_000)
    database
      .query(
        `INSERT INTO marketplace_publisher_mutation_receipts
           (namespace, publisher_id, nonce, auth_version, operation, audience, key_id,
            method, target, timestamp, fresh_until, body_digest, request_digest,
            signature_digest, response_status, response_json, response_digest,
            response_byte_length, committed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'publisher-request-v2',
        'capacity-fixture',
        'capacitynonce0001',
        2,
        'publisher.register',
        'openpencil-marketplace',
        'capacity-fixture-key',
        'POST',
        '/v1/publishers/register',
        '2026-08-27T12:00:00.000Z',
        NOW + 300_000,
        digest('capacity body'),
        digest('capacity request'),
        digest('capacity signature'),
        409,
        responseJSON,
        digest(responseJSON),
        MARKETPLACE_PUBLISHER_MUTATION_LIMITS.maxAggregateResponseBytes,
        NOW
      )
    database.close(false)

    let callbackCount = 0
    await expect(
      repository.executePublisherMutation(
        {
          ...request(),
          publisherId: 'next-publisher',
          keyId: 'next-publisher-key',
          nonce: 'nextcapacitynonce1',
          requestDigest: digest('next capacity request'),
          signatureDigest: digest('next capacity signature')
        },
        NOW,
        async () => {
          callbackCount++
          throw new Error('capacity preflight must not invoke the callback')
        }
      )
    ).rejects.toThrow(/capacity/i)
    expect(callbackCount).toBe(0)
    await repository.close()
  })

  test('replays the exact HTTP result after the first response is lost and SQLite restarts', async () => {
    const path = databasePath()
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const body = JSON.stringify({
      publisher: { id: 'restart-publisher', displayName: 'Restart Publisher' },
      key: {
        keyId: 'restart-publisher-2026',
        publisherId: 'restart-publisher',
        publicKeyPem: await exportEd25519PublicKeyPem(pair.publicKey),
        notBefore: '2026-01-01T00:00:00.000Z',
        notAfter: '2027-01-01T00:00:00.000Z'
      }
    })
    const url = 'http://localhost/v1/publishers/register'
    const signed = await signMarketplaceRequest(
      {
        audience: 'openpencil-marketplace',
        publisherId: 'restart-publisher',
        keyId: 'restart-publisher-2026',
        method: 'POST',
        url,
        timestamp: '2026-08-27T12:00:00.000Z',
        nonce: 'restartnonce00001',
        body: new TextEncoder().encode(body)
      },
      pair.privateKey
    )
    const init = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-openpencil-marketplace-audience': signed.audience,
        'x-openpencil-publisher-id': signed.publisherId,
        'x-openpencil-key-id': signed.keyId,
        'x-openpencil-timestamp': signed.timestamp,
        'x-openpencil-nonce': signed.nonce,
        'x-openpencil-signature': signed.signature
      },
      body
    }
    const appFor = (repository: ReturnType<typeof createSqliteMarketplaceRepository>) =>
      createMarketplaceHttpApp({
        service: createMarketplaceService({
          repository,
          artifacts: createMemoryMarketplaceArtifactStore(),
          marketplaceId: 'openpencil-marketplace',
          publicBaseUrl: 'https://plugins.example.com/',
          now: () => new Date(NOW)
        }),
        now: () => NOW
      })

    const firstRepository = createSqliteMarketplaceRepository({ path, now: () => NOW })
    const firstResponse = await appFor(firstRepository).request(url, init)
    const committed = { status: firstResponse.status, body: await firstResponse.text() }
    expect(committed.status).toBe(201)
    const committedAuditCount = (await firstRepository.snapshot()).auditEvents.length
    expect(committedAuditCount).toBe(2)
    await firstRepository.close()

    const reopened = createSqliteMarketplaceRepository({ path, now: () => NOW })
    const replayResponse = await appFor(reopened).request(url, init)
    expect({ status: replayResponse.status, body: await replayResponse.text() }).toEqual(committed)
    expect((await reopened.snapshot()).auditEvents).toHaveLength(committedAuditCount)
    await reopened.close()
  })
})
