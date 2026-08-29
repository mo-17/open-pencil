import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  MARKETPLACE_PUBLIC_AUDIT_PAGE_LIMITS,
  createEmptyMarketplaceState,
  createMarketplaceHttpApp,
  createMarketplaceService,
  createMemoryMarketplaceArtifactStore,
  createMemoryMarketplaceNonceStore,
  createMemoryMarketplaceRepository,
  createSqliteMarketplaceRepository,
  marketplaceAuditEventHash,
  marketplaceAuditPayloadDigest,
  parseMarketplaceState,
  type MarketplaceAuditEventV1,
  type MarketplaceStateV1
} from '@open-pencil/marketplace'

const NOW = '2026-08-24T00:00:00.000Z'
const SOURCE_ROOT = fileURLToPath(new URL('../../../packages/marketplace/src/', import.meta.url))
const temporaryDirectories: string[] = []

interface Deferred<Value> {
  readonly promise: Promise<Value>
  resolve(value: Value): void
  reject(error: unknown): void
}

interface PublicAuditResponse {
  events: MarketplaceAuditEventV1[]
  head: string | null
  nextAfter?: number
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((accept, decline) => {
    resolve = accept
    reject = decline
  })
  return { promise, resolve, reject }
}

async function within<Value>(
  value: Value | PromiseLike<Value>,
  milliseconds = 250
): Promise<Value> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve(value),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Public immutable read waited for the mutation queue')),
          milliseconds
        )
      })
    ])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

function databasePath(): string {
  const directory = join(tmpdir(), `openpencil-marketplace-resource-${randomUUID()}`)
  temporaryDirectories.push(directory)
  return join(directory, 'marketplace.sqlite')
}

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex + start.length)
  if (startIndex === -1 || endIndex === -1)
    throw new Error(`Source boundary ${start} -> ${end} is missing`)
  return source.slice(startIndex, endIndex)
}

async function auditState(count: number): Promise<MarketplaceStateV1> {
  const payloadDigest = await marketplaceAuditPayloadDigest({ fixture: 'bounded-public-audit' })
  const events: MarketplaceAuditEventV1[] = []
  let previousHash: string | null = null
  for (let sequence = 1; sequence <= count; sequence += 1) {
    const fields: Omit<MarketplaceAuditEventV1, 'eventHash'> = {
      sequence,
      time: NOW,
      actor: 'system:resource-regression',
      action: 'publication.recorded' as const,
      subject: `publication:resource-${sequence}`,
      payloadDigest,
      previousHash
    }
    const event: MarketplaceAuditEventV1 = Object.freeze({
      ...fields,
      eventHash: await marketplaceAuditEventHash(fields)
    })
    events.push(event)
    previousHash = event.eventHash
  }
  return parseMarketplaceState({
    ...createEmptyMarketplaceState(),
    auditEvents: events
  })
}

function serviceForState(state: MarketplaceStateV1) {
  const repository = createMemoryMarketplaceRepository({ initialState: state })
  const service = createMarketplaceService({
    repository,
    artifacts: createMemoryMarketplaceArtifactStore(),
    marketplaceId: 'resource-regression-marketplace',
    publicBaseUrl: 'https://plugins.example.com/',
    now: () => new Date(NOW)
  })
  return {
    repository,
    service,
    app: createMarketplaceHttpApp({
      service,
      nonces: createMemoryMarketplaceNonceStore(() => Date.parse(NOW)),
      now: () => Date.parse(NOW)
    })
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('Marketplace anonymous-read resource bounds', () => {
  test('serves the prior immutable state during a transaction and publishes the new state on commit', async () => {
    const repository = createSqliteMarketplaceRepository({ path: ':memory:' })
    const service = createMarketplaceService({
      repository,
      artifacts: createMemoryMarketplaceArtifactStore(),
      marketplaceId: 'resource-regression-marketplace',
      publicBaseUrl: 'https://plugins.example.com/',
      now: () => new Date(NOW)
    })
    const app = createMarketplaceHttpApp({
      service,
      nonces: repository.nonces,
      now: () => Date.parse(NOW)
    })
    const entered = deferred<true>()
    const release = deferred<true>()
    let transaction: Promise<void> | undefined
    try {
      const before = await repository.immutableSnapshot?.()
      if (!before) throw new Error('SQLite repository must provide an immutable snapshot')
      expect(Object.isFrozen(before)).toBe(true)
      expect(Object.isFrozen(before.publishers)).toBe(true)
      expect(await repository.immutableSnapshot?.()).toBe(before)

      transaction = repository.transaction(async (writer) => {
        await writer.createPublisher(
          { id: 'acme', displayName: 'Acme Plugins' },
          { actor: 'admin:resource-regression', time: NOW }
        )
        entered.resolve(true)
        await release.promise
      })
      await entered.promise

      const during = await within(
        repository.immutableSnapshot?.() ??
          Promise.reject(new Error('SQLite immutable snapshot is unavailable'))
      )
      expect(during).toBe(before)
      const publicAudit = await within(app.request('http://localhost/v1/audit'))
      expect(publicAudit.status).toBe(200)
      expect((await publicAudit.json()).events).toEqual([])

      release.resolve(true)
      await transaction
      transaction = undefined

      const committed = await repository.immutableSnapshot?.()
      if (!committed) throw new Error('SQLite repository must provide an immutable snapshot')
      expect(committed).not.toBe(before)
      expect(committed.publishers.map(({ id }) => id)).toEqual(['acme'])
      expect(Object.isFrozen(committed.publishers[0])).toBe(true)
      expect((await app.request('http://localhost/v1/audit')).status).toBe(200)

      await expect(
        repository.transaction(async (writer) => {
          await writer.createPublisher(
            { id: 'rollback', displayName: 'Rollback Publisher' },
            { actor: 'admin:resource-regression', time: NOW }
          )
          throw new Error('rollback fixture')
        })
      ).rejects.toThrow('rollback fixture')
      expect(await repository.immutableSnapshot?.()).toBe(committed)
    } finally {
      release.resolve(true)
      await transaction?.catch(() => undefined)
      await repository.close()
    }
  })

  test('detects externally corrupted cached SQLite state at checkpoint and reopen', async () => {
    const path = databasePath()
    const repository = createSqliteMarketplaceRepository({ path })
    try {
      await repository.snapshot()
      const external = new Database(path, { strict: true })
      try {
        external
          .query('UPDATE marketplace_state SET state_json = ? WHERE id = 1')
          .run(JSON.stringify({ corrupted: true }))
      } finally {
        external.close(false)
      }
      if (!repository.immutableSnapshot) {
        throw new Error('SQLite repository must provide an immutable snapshot')
      }
      await expect(repository.immutableSnapshot()).rejects.toThrow(/marketplace|state/i)
      await expect(repository.checkpoint()).rejects.toThrow(/marketplace|state/i)
    } finally {
      await repository.close()
    }

    const reopened = createSqliteMarketplaceRepository({ path })
    try {
      await expect(reopened.snapshot()).rejects.toThrow(/marketplace|state/i)
    } finally {
      await reopened.close()
    }
  })

  test('paginates the public audit chain with a bounded compatible first page', async () => {
    const count = MARKETPLACE_PUBLIC_AUDIT_PAGE_LIMITS.maxPageSize + 1
    const state = await auditState(count)
    const { app } = serviceForState(state)

    const first = await app.request('http://localhost/v1/audit')
    expect(first.status).toBe(200)
    expect(first.headers.get('cache-control')).toBe('no-store')
    const firstPage = (await first.json()) as PublicAuditResponse
    expect(firstPage.events).toHaveLength(MARKETPLACE_PUBLIC_AUDIT_PAGE_LIMITS.defaultPageSize)
    expect(firstPage.nextAfter).toBe(MARKETPLACE_PUBLIC_AUDIT_PAGE_LIMITS.defaultPageSize)
    expect(firstPage.head).toBe(state.auditEvents.at(-1)?.eventHash)

    const second = await app.request(
      `http://localhost/v1/audit?after=${firstPage.nextAfter}&limit=1`
    )
    expect(second.status).toBe(200)
    const secondPage = (await second.json()) as PublicAuditResponse
    expect(secondPage.events).toHaveLength(1)
    expect(secondPage.events[0]?.previousHash).toBe(firstPage.events.at(-1)?.eventHash)
    expect(secondPage.nextAfter).toBeUndefined()
    expect(secondPage.head).toBe(firstPage.head)

    for (const query of [
      `limit=${MARKETPLACE_PUBLIC_AUDIT_PAGE_LIMITS.maxPageSize + 1}`,
      'limit=0',
      'limit=1&limit=2',
      'unknown=true',
      `after=${count + 1}`
    ]) {
      expect((await app.request(`http://localhost/v1/audit?${query}`)).status).toBe(400)
    }

    const empty = serviceForState(createEmptyMarketplaceState())
    const compatible = await empty.app.request('http://localhost/v1/audit')
    expect(await compatible.json()).toEqual({ events: [], head: null })
  })

  test('keeps snapshot verification and submission evidence indexing structurally linear', async () => {
    const [repositorySource, sqliteSource, typesSource] = await Promise.all([
      readFile(join(SOURCE_ROOT, 'repository.ts'), 'utf8'),
      readFile(join(SOURCE_ROOT, 'sqlite-repository.ts'), 'utf8'),
      readFile(join(SOURCE_ROOT, 'types.ts'), 'utf8')
    ])

    const sqliteFactory = sourceBetween(
      sqliteSource,
      'export function createSqliteMarketplaceRepository(',
      '\n}'
    )
    const snapshot = sourceBetween(sqliteFactory, 'snapshot() {', 'async immutableSnapshot()')
    const transaction = sourceBetween(
      sqliteFactory,
      'transaction(operation) {',
      'inspectPublisherMutation('
    )
    const publisherMutation = sourceBetween(
      sqliteFactory,
      'executePublisherMutation(',
      'checkpoint() {'
    )
    expect(snapshot).toContain('currentVerifiedState')
    expect(snapshot).not.toContain('verifiedState(parseStateRow')
    expect(transaction.indexOf('verifiedState(next)')).toBeLessThan(
      transaction.indexOf('updateStateRow.run')
    )
    expect(transaction.indexOf("database.exec('COMMIT')")).toBeLessThan(
      transaction.indexOf('cachedState = verifiedNext')
    )
    expect(transaction.indexOf('const committedDataVersion = dataVersion()')).toBeLessThan(
      transaction.indexOf("database.exec('COMMIT')")
    )
    expect(
      transaction.slice(transaction.indexOf("database.exec('COMMIT')")).includes('dataVersion()')
    ).toBe(false)
    expect(publisherMutation.indexOf('const committedDataVersion = dataVersion()')).toBeLessThan(
      publisherMutation.lastIndexOf("database.exec('COMMIT')")
    )
    expect(
      publisherMutation
        .slice(publisherMutation.lastIndexOf("database.exec('COMMIT')"))
        .includes('dataVersion()')
    ).toBe(false)
    expect(repositorySource).toContain('immutableSnapshot?(): Promise<MarketplaceStateV1>')

    const index = sourceBetween(
      typesSource,
      'function submissionAuditEventsById(',
      'function releaseAuditEventsByCoordinate('
    )
    const assertion = sourceBetween(
      typesSource,
      'function assertSubmissionAuditEvidence(',
      'function assertPublicationLinks('
    )
    expect(index).toContain('submissionByReleaseSubject')
    expect(index).toContain('latestLifecycle')
    expect(assertion).toContain('releasesBySubmissionId')
    expect(assertion).not.toContain('releases.find')
    expect(typesSource).not.toContain('function latestSubmissionLifecycleAudit(')
  })
})
