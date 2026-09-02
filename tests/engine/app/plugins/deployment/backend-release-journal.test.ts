import { describe, expect, test } from 'bun:test'

import { indexedDB as fakeIndexedDB } from 'fake-indexeddb'

import {
  BackendHostReleaseJournalConflictError,
  createIdbBackendHostReleaseDispatchJournal,
  createMemoryBackendHostReleaseDispatchJournal,
  parseBackendHostReleaseDispatchJournalRecord,
  type BackendHostReleaseDispatchClaimInput
} from '@/app/plugins/host/deployment/backend/release-journal'

const CLAIMED_AT = '2026-08-30T08:00:00.000Z'
const LEASE_EXPIRES_AT = '2026-08-30T08:05:00.000Z'
const SETTLED_AT = '2026-08-30T08:01:00.000Z'

function claim(overrides: Partial<BackendHostReleaseDispatchClaimInput> = {}) {
  return {
    singleFlightKey: 'backend-release-v1:project:account:grant:digest',
    releaseId: 'release-1',
    ownerId: 'receipt-owner-1',
    planDigest: 'plan-digest-1',
    claimedAt: CLAIMED_AT,
    leaseExpiresAt: LEASE_EXPIRES_AT,
    ...overrides
  }
}

describe('Backend Host Release dispatch journal', () => {
  test('stores only the bounded secret-free claim contract', async () => {
    const journal = createMemoryBackendHostReleaseDispatchJournal()
    const first = await journal.claim(claim())
    const second = await journal.claim(claim({ releaseId: 'forged-release' }))

    expect(first).toMatchObject({
      claimed: true,
      record: {
        ownerId: 'receipt-owner-1',
        outcome: 'pending',
        leaseExpiresAt: LEASE_EXPIRES_AT,
        settledAt: null,
        code: null,
        remoteOperationIds: []
      }
    })
    expect(second.claimed).toBe(false)
    expect(second.record.releaseId).toBe('release-1')
    expect(second.record.ownerId).toBe('receipt-owner-1')
    expect(JSON.stringify(second.record)).not.toContain('secret')
    expect(() =>
      parseBackendHostReleaseDispatchJournalRecord({
        ...first.record,
        credentialValue: 'must-not-persist'
      })
    ).toThrow('shape is invalid')
    expect(() =>
      parseBackendHostReleaseDispatchJournalRecord({
        ...first.record,
        leaseExpiresAt: '2026-08-30T08:06:00.000Z'
      })
    ).toThrow('lease duration is invalid')
  })

  test('settles idempotently and rejects conflicting replay authority', async () => {
    const journal = createMemoryBackendHostReleaseDispatchJournal()
    await journal.claim(claim())
    const settlement = {
      ...claim(),
      settledAt: SETTLED_AT,
      outcome: 'applied' as const,
      code: null,
      remoteOperationIds: ['migration-remote-1']
    }
    const first = await journal.settle(settlement)
    const replay = await journal.settle(settlement)

    expect(first).toEqual(replay)
    expect(await journal.listPending()).toEqual([])
    await expect(
      journal.settle({
        ...settlement,
        outcome: 'failed',
        code: 'different-outcome',
        remoteOperationIds: []
      })
    ).rejects.toBeInstanceOf(BackendHostReleaseJournalConflictError)
  })

  test('allows only outcome-unknown reconciliation to advance into a terminal outcome', async () => {
    for (const outcome of ['applied', 'failed'] as const) {
      const journal = createMemoryBackendHostReleaseDispatchJournal()
      await journal.claim(claim())
      await journal.settle({
        ...claim(),
        settledAt: SETTLED_AT,
        outcome: 'outcome-unknown',
        code: 'transport-timeout',
        remoteOperationIds: ['remote-1']
      })
      const reconciled = await journal.settle({
        ...claim(),
        settledAt: '2026-08-30T08:02:00.000Z',
        outcome,
        code: outcome === 'applied' ? null : 'provider-rejected',
        remoteOperationIds: ['remote-1']
      })
      expect(reconciled.outcome).toBe(outcome)
      await expect(
        journal.settle({
          ...claim(),
          settledAt: '2026-08-30T08:03:00.000Z',
          outcome: outcome === 'applied' ? 'failed' : 'applied',
          code: outcome === 'applied' ? 'changed' : null,
          remoteOperationIds: []
        })
      ).rejects.toBeInstanceOf(BackendHostReleaseJournalConflictError)
    }
  })

  test('atomically preserves one claim across independent IndexedDB journal instances', async () => {
    const databaseName = `backend-release-journal-${crypto.randomUUID()}`
    const firstJournal = createIdbBackendHostReleaseDispatchJournal(databaseName, fakeIndexedDB)
    const secondJournal = createIdbBackendHostReleaseDispatchJournal(databaseName, fakeIndexedDB)
    const results = await Promise.all([firstJournal.claim(claim()), secondJournal.claim(claim())])

    expect(results.filter((result) => result.claimed)).toHaveLength(1)
    expect(results.filter((result) => !result.claimed)).toHaveLength(1)
    expect(await secondJournal.listPending()).toHaveLength(1)

    const restartedJournal = createIdbBackendHostReleaseDispatchJournal(databaseName, fakeIndexedDB)
    expect(await restartedJournal.read(claim().singleFlightKey)).toMatchObject({
      releaseId: 'release-1',
      outcome: 'pending'
    })
    await restartedJournal.settle({
      ...claim(),
      settledAt: SETTLED_AT,
      outcome: 'outcome-unknown',
      code: 'transport-timeout',
      remoteOperationIds: []
    })

    const afterRestart = createIdbBackendHostReleaseDispatchJournal(databaseName, fakeIndexedDB)
    expect(await afterRestart.listPending()).toEqual([])
    expect(await afterRestart.read(claim().singleFlightKey)).toMatchObject({
      outcome: 'outcome-unknown',
      code: 'transport-timeout'
    })
  })
})
