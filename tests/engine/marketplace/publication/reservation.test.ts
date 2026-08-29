/* eslint-disable max-lines -- Memory, SQLite, migration, reopen, and race invariants form one reservation suite. */
import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, test } from 'bun:test'
import { createHash, randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  MARKETPLACE_SQLITE_SCHEMA_VERSION,
  MarketplacePublicationCompletionConflictError,
  MarketplacePublicationQuiescedError,
  MarketplacePublicationReservationConflictError,
  createMarketplacePublicationRequest,
  createMemoryMarketplaceRepository,
  createSqliteMarketplaceRepository,
  marketplacePublicationRequestDigest,
  marketplacePublicationReservationFromRequest,
  marketplacePublicationStateDigest,
  verifyMarketplaceSqlitePublicationCompletions,
  verifyMarketplaceSqlitePublicationReservation,
  type MarketplacePublicationReservationV1,
  type MarketplacePublicationReservationRepository,
  type MarketplaceVerifiedPublisherMutationRequest
} from '@open-pencil/marketplace'
import {
  MARKETPLACE_SNAPSHOT_FORMAT,
  MARKETPLACE_SNAPSHOT_SCHEMA_VERSION,
  PLUGIN_CATALOG_FORMAT,
  PLUGIN_CATALOG_SCHEMA_VERSION
} from '@open-pencil/plugin-contracts'

const NOW = Date.parse('2026-08-28T12:00:00.000Z')
const temporaryDirectories: string[] = []

function digest(value: string): string {
  return createHash('sha256').update(value).digest('base64url')
}

function databasePath(): string {
  const directory = join(tmpdir(), `openpencil-publication-reservation-${randomUUID()}`)
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

async function seed(repository: MarketplacePublicationReservationRepository): Promise<void> {
  await repository.transaction((transaction) =>
    transaction.createPublisher(
      { id: 'reservation-seed', displayName: 'Reservation Seed' },
      { actor: 'operator:test', time: '2026-08-28T12:00:00.000Z' }
    )
  )
}

async function reservation(
  repository: MarketplacePublicationReservationRepository,
  requestLabel = 'publication-request-1'
): Promise<MarketplacePublicationReservationV1> {
  const state = await repository.snapshot()
  const auditHead = state.auditEvents.at(-1)?.eventHash
  if (!auditHead) throw new Error('reservation fixture requires an audit head')
  return Object.freeze({
    requestDigest: digest(requestLabel),
    stateDigest: marketplacePublicationStateDigest(state),
    auditSequence: state.auditEvents.length,
    auditHead,
    expectedNextSequence: (state.publications.at(-1)?.sequence ?? 0) + 1
  })
}

function publisherRequest(): MarketplaceVerifiedPublisherMutationRequest {
  return {
    authVersion: 2,
    operation: 'publisher.register',
    audience: 'openpencil-marketplace',
    publisherId: 'blocked-publisher',
    keyId: 'blocked-publisher-2026',
    method: 'POST',
    target: '/v1/publishers/register',
    timestamp: '2026-08-28T12:00:00.000Z',
    nonce: 'blockednonce00001',
    bodyDigest: digest('blocked-body'),
    requestDigest: digest('blocked-request'),
    signatureDigest: digest('blocked-signature'),
    freshUntil: NOW + 300_000
  }
}

function publicationRecord(label = 'publication-1') {
  const value = digest(label)
  return {
    snapshotDigest: value,
    snapshotArtifactDigest: value,
    catalogs: [{ channel: 'stable' as const, catalogDigest: value, artifactDigest: value }]
  }
}

async function expectQuiesced(
  repository: MarketplacePublicationReservationRepository
): Promise<void> {
  const before = await repository.snapshot()
  let transactionInvocations = 0
  await expect(
    repository.transaction(async () => {
      transactionInvocations++
      throw new Error('ordinary transaction callback must not run')
    })
  ).rejects.toBeInstanceOf(MarketplacePublicationQuiescedError)
  expect(transactionInvocations).toBe(0)

  let publisherInvocations = 0
  await expect(
    repository.executePublisherMutation(publisherRequest(), NOW, async () => {
      publisherInvocations++
      throw new Error('Publisher mutation callback must not run')
    })
  ).rejects.toBeInstanceOf(MarketplacePublicationQuiescedError)
  expect(publisherInvocations).toBe(0)
  expect(await repository.inspectPublisherMutation(publisherRequest(), NOW)).toBeNull()
  expect(await repository.snapshot()).toEqual(before)
}

async function complete(
  repository: MarketplacePublicationReservationRepository,
  active: MarketplacePublicationReservationV1,
  label = 'publication-1'
) {
  return repository.completePublication(active, digest(`bundle:${label}`), (transaction) =>
    transaction.recordPublication(publicationRecord(label), {
      actor: 'offline-import:test',
      time: '2026-08-28T12:00:01.000Z',
      correlationId: active.requestDigest
    })
  )
}

async function exactReservationFromRequest(
  repository: MarketplacePublicationReservationRepository
): Promise<MarketplacePublicationReservationV1> {
  const state = await repository.snapshot()
  const auditHead = state.auditEvents.at(-1)?.eventHash
  if (!auditHead) throw new Error('publication request fixture requires an audit head')
  const marketplaceId = 'reservation-marketplace'
  const generatedAt = '2026-08-28T12:00:01.000Z'
  const expiresAt = '2026-08-29T12:00:01.000Z'
  const plan = {
    catalogs: (['stable', 'beta'] as const).map((channel) => ({
      channel,
      catalog: {
        format: PLUGIN_CATALOG_FORMAT,
        schemaVersion: PLUGIN_CATALOG_SCHEMA_VERSION,
        catalogId: `${marketplaceId}-${channel}`,
        version: '1.0.1',
        generatedAt,
        expiresAt,
        entries: []
      }
    })),
    runtimeIndex: null,
    snapshot: {
      format: MARKETPLACE_SNAPSHOT_FORMAT,
      schemaVersion: MARKETPLACE_SNAPSHOT_SCHEMA_VERSION,
      marketplaceId,
      version: '1.0.1',
      sequence: 1,
      generatedAt,
      expiresAt,
      publisherDirectory: { publishers: [], ownerships: [] },
      listings: [],
      auditHead: {
        sequence: state.auditEvents.length,
        headDigest: auditHead,
        url: 'https://plugins.example.com/v1/audit'
      }
    }
  }
  const request = createMarketplacePublicationRequest({
    state,
    purpose: 'routine',
    marketplaceId,
    rootKeyId: 'reservation-root-2026',
    publicBaseUrl: 'https://plugins.example.com/',
    baseline: null,
    plan
  })
  const mapped = marketplacePublicationReservationFromRequest(request)
  expect(mapped).toEqual({
    requestDigest: marketplacePublicationRequestDigest(request),
    stateDigest: request.stateDigest,
    auditSequence: request.auditSequence,
    auditHead: request.auditHead,
    expectedNextSequence: request.expectedNextSequence
  })
  expect(() =>
    marketplacePublicationReservationFromRequest({ ...request, unsupported: true })
  ).toThrow(/unsupported fields/i)
  return mapped
}

describe('memory Marketplace publication reservation', () => {
  test('strictly derives the exact reservation binding from a publication request', async () => {
    const repository = createMemoryMarketplaceRepository({ now: () => NOW })
    await seed(repository)
    const mapped = await exactReservationFromRequest(repository)
    expect((await repository.reservePublication(mapped)).source).toBe('reserved')
  })

  test('establishes one exact CAS reservation and replays only the identical binding', async () => {
    const repository = createMemoryMarketplaceRepository({ now: () => NOW })
    await seed(repository)
    const active = await reservation(repository)

    const [left, right] = await Promise.all([
      repository.reservePublication(active),
      repository.reservePublication(active)
    ])
    expect([left.source, right.source].sort()).toEqual(['replayed', 'reserved'])
    expect(left.reservation).toEqual(active)
    expect(right.reservation).toEqual(active)
    expect(await repository.inspectPublicationReservation()).toEqual(active)

    for (const candidate of [
      { ...active, requestDigest: digest('different-request') },
      { ...active, stateDigest: digest('different-state') },
      { ...active, auditSequence: active.auditSequence + 1 },
      { ...active, auditHead: digest('different-audit-head') },
      { ...active, expectedNextSequence: active.expectedNextSequence + 1 }
    ]) {
      await expect(repository.reservePublication(candidate)).rejects.toBeInstanceOf(
        MarketplacePublicationReservationConflictError
      )
    }
    await expect(
      repository.reservePublication({ ...active, unsupported: true } as never)
    ).rejects.toThrow()
  })

  test('quiesces every ordinary mutation and clears only after exact publication completion', async () => {
    const repository = createMemoryMarketplaceRepository({ now: () => NOW })
    await seed(repository)
    const active = await reservation(repository)
    await repository.reservePublication(active)
    await expectQuiesced(repository)

    const before = await repository.snapshot()
    await expect(
      repository.completePublication(active, digest('bundle:rolled-back'), async (transaction) => {
        await transaction.recordPublication(publicationRecord('rolled-back'), {
          actor: 'offline-import:test',
          time: '2026-08-28T12:00:01.000Z',
          correlationId: active.requestDigest
        })
        throw new Error('crash after recordPublication')
      })
    ).rejects.toThrow('crash after recordPublication')
    expect(await repository.snapshot()).toEqual(before)
    expect(await repository.inspectPublicationReservation()).toEqual(active)

    await expect(
      repository.completePublication(active, digest('bundle:wrong-correlation'), (transaction) =>
        transaction.recordPublication(publicationRecord('wrong-correlation'), {
          actor: 'offline-import:test',
          time: '2026-08-28T12:00:01.000Z',
          correlationId: digest('wrong-correlation')
        })
      )
    ).rejects.toBeInstanceOf(MarketplacePublicationReservationConflictError)
    expect(await repository.inspectPublicationReservation()).toEqual(active)

    const completion = await complete(repository, active)
    expect(completion.source).toBe('committed')
    const publication = completion.publication
    expect(publication.sequence).toBe(active.expectedNextSequence)
    expect(publication.auditSequence).toBe(active.auditSequence)
    expect(publication.auditHead).toBe(active.auditHead)
    expect(await repository.inspectPublicationReservation()).toBeNull()
    const committed = await repository.snapshot()
    const event = committed.auditEvents[active.auditSequence]
    const context = committed.auditContexts.find(({ sequence }) => sequence === event?.sequence)
    expect(event?.action).toBe('publication.recorded')
    expect(context).toMatchObject({ correlationId: active.requestDigest, reason: null })

    let replayInvocations = 0
    const replay = await repository.completePublication(
      active,
      digest('bundle:publication-1'),
      async () => {
        replayInvocations++
        throw new Error('completion replay callback must not run')
      }
    )
    expect(replay.source).toBe('replayed')
    expect(replay.publication).toEqual(publication)
    expect(replayInvocations).toBe(0)
    await expect(
      repository.completePublication(active, digest('different-bundle'), async () => {
        throw new Error('conflicting completion callback must not run')
      })
    ).rejects.toBeInstanceOf(MarketplacePublicationCompletionConflictError)
    await expect(
      repository.cancelPublication(active, active.requestDigest, {
        actor: 'operator:recovery',
        time: '2026-08-28T12:00:02.000Z',
        reason: 'Must not cancel a completed publication',
        correlationId: active.requestDigest
      })
    ).rejects.toBeInstanceOf(MarketplacePublicationReservationConflictError)
    expect(
      await repository.inspectPublicationCompletion(
        active.requestDigest,
        digest('bundle:publication-1')
      )
    ).toMatchObject({ publication })
    await repository.transaction((transaction) =>
      transaction.createPublisher(
        { id: 'after-publication', displayName: 'After Publication' },
        { actor: 'operator:test', time: '2026-08-28T12:00:02.000Z' }
      )
    )
    expect(
      await repository.inspectPublicationCompletion(
        active.requestDigest,
        digest('bundle:publication-1')
      )
    ).toMatchObject({ publication })
  })

  test('cancels only one exact manually confirmed reservation with durable audit evidence', async () => {
    const repository = createMemoryMarketplaceRepository({ now: () => NOW })
    await seed(repository)
    const active = await reservation(repository, 'cancel-request')
    await repository.reservePublication(active)

    await expect(
      repository.cancelPublication(active, digest('wrong-confirmation'), {
        actor: 'operator:recovery',
        time: '2026-08-28T12:00:01.000Z',
        reason: 'Lost durable handoff',
        correlationId: active.requestDigest
      })
    ).rejects.toBeInstanceOf(MarketplacePublicationReservationConflictError)
    await expect(
      repository.cancelPublication(active, active.requestDigest, {
        actor: 'operator:recovery',
        time: '2026-08-28T12:00:01.000Z',
        correlationId: active.requestDigest
      })
    ).rejects.toThrow(/reason/i)
    expect(await repository.inspectPublicationReservation()).toEqual(active)

    const cancelled = await repository.cancelPublication(active, active.requestDigest, {
      actor: 'operator:recovery',
      time: '2026-08-28T12:00:01.000Z',
      reason: 'Lost durable handoff',
      correlationId: active.requestDigest
    })
    expect(cancelled.action).toBe('publication.reservation_cancelled')
    expect(cancelled.subject).toBe(`publication-reservation:${active.requestDigest}`)
    expect(await repository.inspectPublicationReservation()).toBeNull()
    const state = await repository.snapshot()
    expect(state.auditContexts.at(-1)).toMatchObject({
      reason: 'Lost durable handoff',
      correlationId: active.requestDigest
    })
    await repository.transaction((transaction) =>
      transaction.createPublisher(
        { id: 'after-cancel', displayName: 'After Cancel' },
        { actor: 'operator:test', time: '2026-08-28T12:00:02.000Z' }
      )
    )
  })
})

describe('SQLite Marketplace publication reservation', () => {
  test('serializes exact reservation CAS across connections and persists quiesce through reopen', async () => {
    const path = databasePath()
    const first = createSqliteMarketplaceRepository({ path, now: () => NOW })
    await seed(first)
    const active = await reservation(first)
    const second = createSqliteMarketplaceRepository({ path, now: () => NOW })
    await second.snapshot()

    const [left, right] = await Promise.all([
      first.reservePublication(active),
      second.reservePublication(active)
    ])
    expect([left.source, right.source].sort()).toEqual(['replayed', 'reserved'])
    await expectQuiesced(first)
    await expectQuiesced(second)
    await Promise.all([first.close(), second.close()])

    const reopened = createSqliteMarketplaceRepository({ path, now: () => NOW })
    expect(await reopened.inspectPublicationReservation()).toEqual(active)
    await expectQuiesced(reopened)
    await reopened.close()
  })

  test('retains reservation and state after a failed completion, checkpoint, and reopen', async () => {
    const path = databasePath()
    const repository = createSqliteMarketplaceRepository({ path, now: () => NOW })
    await seed(repository)
    const active = await reservation(repository)
    await repository.reservePublication(active)
    const before = await repository.snapshot()

    await expect(
      repository.completePublication(
        active,
        digest('bundle:sqlite-rolled-back'),
        async (transaction) => {
          await transaction.recordPublication(publicationRecord('sqlite-rolled-back'), {
            actor: 'offline-import:test',
            time: '2026-08-28T12:00:01.000Z',
            correlationId: active.requestDigest
          })
          throw new Error('simulated importer crash')
        }
      )
    ).rejects.toThrow('simulated importer crash')
    expect(await repository.snapshot()).toEqual(before)
    expect(await repository.inspectPublicationReservation()).toEqual(active)

    const checkpoint = await repository.checkpoint()
    const backup = Database.deserialize(checkpoint.databaseBytes, { readonly: true, strict: true })
    expect(
      backup
        .query<{ request_digest: string }, []>(
          'SELECT request_digest FROM marketplace_publication_reservation WHERE id = 1'
        )
        .get()?.request_digest
    ).toBe(active.requestDigest)
    verifyMarketplaceSqlitePublicationReservation(backup, checkpoint.state)
    verifyMarketplaceSqlitePublicationCompletions(backup, checkpoint.state)
    backup.close(false)
    await repository.close()

    const reopened = createSqliteMarketplaceRepository({ path, now: () => NOW })
    expect(await reopened.inspectPublicationReservation()).toEqual(active)
    const completion = await complete(reopened, active, 'sqlite-publication')
    const publication = completion.publication
    expect(publication.sequence).toBe(active.expectedNextSequence)
    expect(await reopened.inspectPublicationReservation()).toBeNull()
    await reopened.close()

    const database = new Database(path, { readonly: true, strict: true })
    expect(
      database
        .query<{ count: number }, []>(
          'SELECT COUNT(*) AS count FROM marketplace_publication_reservation'
        )
        .get()?.count
    ).toBe(0)
    const state = JSON.parse(
      database
        .query<{ state_json: string }, []>('SELECT state_json FROM marketplace_state WHERE id = 1')
        .get()?.state_json ?? '{}'
    )
    expect(state.publications).toHaveLength(1)
    database.close(false)

    const replayed = createSqliteMarketplaceRepository({ path, now: () => NOW })
    await replayed.transaction((transaction) =>
      transaction.createPublisher(
        { id: 'after-reopen', displayName: 'After Reopen' },
        { actor: 'operator:test', time: '2026-08-28T12:00:02.000Z' }
      )
    )
    let replayInvocations = 0
    const replay = await replayed.completePublication(
      active,
      digest('bundle:sqlite-publication'),
      async () => {
        replayInvocations++
        throw new Error('SQLite completion replay callback must not run')
      }
    )
    expect(replay.source).toBe('replayed')
    expect(replay.publication).toEqual(publication)
    expect(replayInvocations).toBe(0)
    await replayed.close()
  })

  test('atomically races exact completion against manual cancellation across connections', async () => {
    const path = databasePath()
    const first = createSqliteMarketplaceRepository({ path, now: () => NOW })
    await seed(first)
    const active = await reservation(first, 'cancel-race')
    await first.reservePublication(active)
    const second = createSqliteMarketplaceRepository({ path, now: () => NOW })
    await second.snapshot()

    const outcomes = await Promise.allSettled([
      complete(first, active, 'cancel-race'),
      second.cancelPublication(active, active.requestDigest, {
        actor: 'operator:recovery',
        time: '2026-08-28T12:00:01.000Z',
        reason: 'Operator confirmed recovery cancellation',
        correlationId: active.requestDigest
      })
    ])
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1)
    const state = await first.snapshot()
    const completed = state.publications.length === 1
    expect(
      state.auditEvents.filter(({ action }) =>
        ['publication.recorded', 'publication.reservation_cancelled'].includes(action)
      )
    ).toHaveLength(1)
    expect(await first.inspectPublicationReservation()).toBeNull()
    expect(
      await first.inspectPublicationCompletion(active.requestDigest, digest('bundle:cancel-race'))
    ).toEqual(completed ? expect.objectContaining({ publication: state.publications[0] }) : null)
    await Promise.all([first.close(), second.close()])
  })

  test('migrates exact schema-v3 and schema-v4 layouts and rejects corrupt persisted evidence', async () => {
    const path = databasePath()
    const original = createSqliteMarketplaceRepository({ path, now: () => NOW })
    await seed(original)
    await original.close()

    const legacy = new Database(path, { strict: true })
    legacy.exec(`
      DROP TABLE marketplace_publication_completion_receipts;
      DROP TABLE marketplace_publication_reservation;
      UPDATE marketplace_state SET schema_version = 3 WHERE id = 1;
    `)
    legacy.close(false)

    const migrated = createSqliteMarketplaceRepository({ path, now: () => NOW })
    expect((await migrated.snapshot()).publishers.map(({ id }) => id)).toEqual(['reservation-seed'])
    expect(await migrated.inspectPublicationReservation()).toBeNull()
    const active = await reservation(migrated)
    await migrated.reservePublication(active)
    await migrated.close()

    const database = new Database(path, { strict: true })
    expect(
      database
        .query<{ schema_version: number }, []>(
          'SELECT schema_version FROM marketplace_state WHERE id = 1'
        )
        .get()?.schema_version
    ).toBe(MARKETPLACE_SQLITE_SCHEMA_VERSION)
    database
      .query('UPDATE marketplace_publication_reservation SET state_digest = ? WHERE id = 1')
      .run(digest('wrong-reservation-state'))
    database.close(false)

    const corrupt = createSqliteMarketplaceRepository({ path, now: () => NOW })
    await expect(corrupt.snapshot()).rejects.toThrow(/reservation/i)
    await corrupt.close()

    const v4Path = databasePath()
    const current = createSqliteMarketplaceRepository({ path: v4Path, now: () => NOW })
    await seed(current)
    await current.close()
    const v4 = new Database(v4Path, { strict: true })
    v4.exec(`
      DROP TABLE marketplace_publication_completion_receipts;
      UPDATE marketplace_state SET schema_version = 4 WHERE id = 1;
    `)
    v4.close(false)
    const migratedV4 = createSqliteMarketplaceRepository({ path: v4Path, now: () => NOW })
    expect((await migratedV4.snapshot()).publishers).toHaveLength(1)
    expect(
      await migratedV4.inspectPublicationCompletion(digest('missing'), digest('missing-bundle'))
    ).toBeNull()
    await migratedV4.close()

    const receiptPath = databasePath()
    const receiptRepository = createSqliteMarketplaceRepository({
      path: receiptPath,
      now: () => NOW
    })
    await seed(receiptRepository)
    const receiptReservation = await reservation(receiptRepository, 'corrupt-receipt')
    await receiptRepository.reservePublication(receiptReservation)
    await complete(receiptRepository, receiptReservation, 'corrupt-receipt')
    await receiptRepository.close()
    const receiptDatabase = new Database(receiptPath, { strict: true })
    receiptDatabase
      .query(
        'UPDATE marketplace_publication_completion_receipts SET completion_event_hash = ? WHERE request_digest = ?'
      )
      .run(digest('wrong-completion-event'), receiptReservation.requestDigest)
    receiptDatabase.close(false)
    const corruptReceipt = createSqliteMarketplaceRepository({
      path: receiptPath,
      now: () => NOW
    })
    await expect(corruptReceipt.snapshot()).rejects.toThrow(/completion receipt/i)
    await corruptReceipt.close()
  })
})
