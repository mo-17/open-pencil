import { describe, expect, test } from 'bun:test'

import { indexedDB as fakeIndexedDB } from 'fake-indexeddb'

import {
  backendReleaseDispatchScopeKey,
  backendReleaseSingleFlightKey,
  createBackendReleasePlan,
  planBackendMigration,
  type BackendReleaseAuthorityV1,
  type DataModelIR
} from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  BACKEND_RELEASE_DISPATCH_JOURNAL_FORMAT,
  BackendHostReleaseJournalConflictError,
  BackendHostReleaseUnresolvedScopeError,
  createIdbBackendHostReleaseDispatchJournal,
  createMemoryBackendHostReleaseDispatchJournal,
  parseBackendHostReleaseDispatchEvidenceRecord,
  parseBackendHostReleaseDispatchJournalRecord,
  type BackendHostReleaseDispatchClaimInput
} from '@/app/plugins/host/deployment/backend/release-journal'

const CLAIMED_AT = '2026-08-30T08:00:00.000Z'
const LEASE_EXPIRES_AT = '2026-08-30T08:05:00.000Z'
const SETTLED_AT = '2026-08-30T08:01:00.000Z'

async function digest(label: string): Promise<string> {
  return digestCanonicalManifest({ label })
}

async function releaseKeys(overrides: Partial<BackendReleaseAuthorityV1> = {}) {
  const model: DataModelIR = { version: 1, entities: [], enums: [], relations: [] }
  const migrationPlan = await planBackendMigration(model, model)
  const authority: BackendReleaseAuthorityV1 = {
    documentDigest: await digest('journal-document'),
    irDigest: await digest('journal-ir'),
    inspectedSchemaDigest: await digest('journal-schema'),
    compilerVersion: '0.15.0',
    target: 'react',
    environment: 'staging',
    projectId: 'project',
    accountId: 'account',
    grantGeneration: 'grant-1',
    backendProvider: {
      publisherId: 'open-pencil',
      packageDigest: `app-bundle-sha256:${await digest('journal-package')}`,
      pluginId: 'open-pencil.supabase-backend',
      contributionId: 'supabase-backend',
      providerId: 'supabase',
      adapterId: 'supabase-v1',
      adapterVersion: '1.0.0',
      contractVersion: 1,
      supportedModelVersions: [1],
      capabilities: ['migrations.schema'],
      permissions: [],
      outputKinds: ['database-schema', 'migration-plan']
    },
    ...overrides
  }
  const plan = await createBackendReleasePlan({
    planId: `journal-${authority.environment}-${authority.target}`,
    authority,
    migrationPlan,
    requiredArtifactKinds: ['schema'],
    requiredEnvironmentNames: [],
    requiredCredentialRefs: []
  })
  return {
    singleFlightKey: backendReleaseSingleFlightKey(plan, {
      staticArtifactDigest: null,
      serverArtifactDigest: null,
      schemaArtifactDigest: await digest('journal-schema-artifact')
    }),
    dispatchScopeKey: backendReleaseDispatchScopeKey(plan)
  }
}

function claim(overrides: Partial<BackendHostReleaseDispatchClaimInput> = {}) {
  return {
    singleFlightKey: 'backend-release-v3:supabase:project:account:semantic',
    dispatchScopeKey: 'backend-release-dispatch-scope-v1:supabase:project',
    releaseId: 'release-1',
    ownerId: 'receipt-owner-1',
    planDigest: 'plan-digest-1',
    claimedAt: CLAIMED_AT,
    leaseExpiresAt: LEASE_EXPIRES_AT,
    ...overrides
  }
}

function evidenceClaim() {
  const value = claim()
  return {
    singleFlightKey: value.singleFlightKey,
    dispatchScopeKey: value.dispatchScopeKey,
    releaseId: value.releaseId,
    planDigest: value.planDigest
  }
}

function legacyRecord(
  singleFlightKey: string,
  outcome: 'pending' | 'applied' | 'failed' | 'outcome-unknown' = 'pending'
) {
  const pending = outcome === 'pending'
  return {
    format: BACKEND_RELEASE_DISPATCH_JOURNAL_FORMAT,
    version: 1,
    singleFlightKey,
    releaseId: 'legacy-release',
    ownerId: 'legacy-owner',
    planDigest: 'legacy-plan-digest',
    claimedAt: CLAIMED_AT,
    leaseExpiresAt: LEASE_EXPIRES_AT,
    settledAt: pending ? null : SETTLED_AT,
    outcome,
    code: pending || outcome === 'applied' ? null : 'legacy-settlement',
    remoteOperationIds: []
  }
}

async function seedLegacyRecord(databaseName: string, record: ReturnType<typeof legacyRecord>) {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = fakeIndexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('dispatchClaims', { keyPath: 'singleFlightKey' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('dispatchClaims', 'readwrite')
    transaction.objectStore('dispatchClaims').put(record)
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error)
    transaction.onerror = () => reject(transaction.error)
  })
  database.close()
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
    expect(() =>
      parseBackendHostReleaseDispatchJournalRecord({
        ...first.record,
        settledAt: '2026-08-30T07:59:59.999Z',
        outcome: 'failed',
        code: 'clock-regressed'
      })
    ).toThrow('settlement cannot precede its claim')
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

  test('atomically blocks a different claim while the same provider project scope is unresolved', async () => {
    const first = await releaseKeys()
    const second = await releaseKeys({
      target: 'vue',
      environment: 'preview',
      accountId: 'transferred-account',
      grantGeneration: 'grant-2',
      documentDigest: await digest('changed-journal-document')
    })
    const otherProject = await releaseKeys({ projectId: 'other-project' })
    expect(second.dispatchScopeKey).toBe(first.dispatchScopeKey)
    expect(second.singleFlightKey).not.toBe(first.singleFlightKey)
    const journal = createMemoryBackendHostReleaseDispatchJournal()
    await journal.claim(claim(first))

    await expect(
      journal.claim(
        claim({
          ...otherProject,
          releaseId: 'release-other-project',
          planDigest: 'plan-digest-other-project'
        })
      )
    ).resolves.toMatchObject({ claimed: true })

    await expect(
      journal.claim(
        claim({
          ...second,
          releaseId: 'release-2',
          planDigest: 'plan-digest-2'
        })
      )
    ).rejects.toBeInstanceOf(BackendHostReleaseUnresolvedScopeError)

    await journal.settle({
      ...claim(first),
      settledAt: SETTLED_AT,
      outcome: 'outcome-unknown',
      code: 'transport-timeout',
      remoteOperationIds: []
    })
    await expect(
      journal.claim(
        claim({
          ...second,
          releaseId: 'release-2',
          planDigest: 'plan-digest-2'
        })
      )
    ).rejects.toBeInstanceOf(BackendHostReleaseUnresolvedScopeError)
    expect(await journal.listUnresolved()).toHaveLength(2)

    await journal.settle({
      ...claim(first),
      settledAt: '2026-08-30T08:02:00.000Z',
      outcome: 'failed',
      code: 'provider-rejected',
      remoteOperationIds: []
    })
    await expect(
      journal.claim(
        claim({
          ...second,
          releaseId: 'release-2',
          planDigest: 'plan-digest-2'
        })
      )
    ).resolves.toMatchObject({ claimed: true })
  })

  test('blocks an exact terminal-key replay while another key in its scope is unresolved', async () => {
    const memory = createMemoryBackendHostReleaseDispatchJournal()
    const databaseName = `backend-release-terminal-replay-${crypto.randomUUID()}`
    const idbWriter = createIdbBackendHostReleaseDispatchJournal(databaseName, fakeIndexedDB)
    const idbReplayer = createIdbBackendHostReleaseDispatchJournal(databaseName, fakeIndexedDB)
    const terminal = claim({
      singleFlightKey: 'backend-release-v3:supabase:project:account:terminal-artifact'
    })
    const unresolved = claim({
      singleFlightKey: 'backend-release-v3:supabase:project:account:unresolved-artifact',
      releaseId: 'release-unresolved',
      ownerId: 'receipt-owner-unresolved',
      planDigest: 'plan-digest-unresolved'
    })

    for (const [writer, replayer] of [
      [memory, memory],
      [idbWriter, idbReplayer]
    ] as const) {
      await writer.claim(terminal)
      await writer.settle({
        ...terminal,
        settledAt: SETTLED_AT,
        outcome: 'applied',
        code: null,
        remoteOperationIds: []
      })
      await writer.claim(unresolved)

      await expect(replayer.claim(terminal)).rejects.toBeInstanceOf(
        BackendHostReleaseUnresolvedScopeError
      )
      expect(await replayer.read(terminal.singleFlightKey)).toMatchObject({ outcome: 'applied' })
      expect(await replayer.listUnresolvedForScope(terminal.dispatchScopeKey)).toMatchObject([
        { singleFlightKey: unresolved.singleFlightKey, outcome: 'pending' }
      ])
    }
  })

  test('allows a v3 artifact claim after a terminal v2 failure but blocks it while v2 is unresolved', async () => {
    const corrected = await releaseKeys()
    expect(corrected.singleFlightKey).toStartWith('backend-release-v3:')
    const previous = {
      ...corrected,
      singleFlightKey: 'backend-release-v2:supabase:project:account:previous-artifact'
    }

    const settledJournal = createMemoryBackendHostReleaseDispatchJournal()
    await settledJournal.claim(claim(previous))
    await settledJournal.settle({
      ...claim(previous),
      settledAt: SETTLED_AT,
      outcome: 'failed',
      code: 'previous-artifact-rejected',
      remoteOperationIds: []
    })
    await expect(settledJournal.claim(claim(corrected))).resolves.toMatchObject({
      claimed: true
    })

    const unresolvedJournal = createMemoryBackendHostReleaseDispatchJournal()
    await unresolvedJournal.claim(claim(previous))
    await expect(unresolvedJournal.claim(claim(corrected))).rejects.toBeInstanceOf(
      BackendHostReleaseUnresolvedScopeError
    )
  })

  test('lists unresolved records only for the requested canonical provider project scope', async () => {
    const requested = await releaseKeys()
    const previous = {
      ...requested,
      singleFlightKey: 'backend-release-v2:supabase:project:account:previous-artifact'
    }
    const otherProject = await releaseKeys({ projectId: 'other-project' })
    const journal = createMemoryBackendHostReleaseDispatchJournal()
    await journal.claim(claim(previous))
    await journal.claim(
      claim({
        ...otherProject,
        releaseId: 'release-other-project',
        planDigest: 'plan-digest-other-project'
      })
    )

    const records = await journal.listUnresolvedForScope(requested.dispatchScopeKey)
    expect(records.map((record) => record.singleFlightKey)).toEqual([previous.singleFlightKey])
    expect(Object.isFrozen(records)).toBe(true)
    expect(Object.isFrozen(records[0])).toBe(true)
    expect(Object.isFrozen(records[0]?.remoteOperationIds)).toBe(true)
    expect(await journal.listUnresolvedForScope(otherProject.dispatchScopeKey)).toHaveLength(1)
    await expect(
      journal.listUnresolvedForScope('backend-release-dispatch-scope-v1:%73upabase:project')
    ).rejects.toThrow('dispatchScopeKey is not canonically encoded')
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

  test('atomically permits only one of two different IndexedDB keys in one unresolved scope', async () => {
    const databaseName = `backend-release-scope-${crypto.randomUUID()}`
    const firstJournal = createIdbBackendHostReleaseDispatchJournal(databaseName, fakeIndexedDB)
    const secondJournal = createIdbBackendHostReleaseDispatchJournal(databaseName, fakeIndexedDB)
    const first = await releaseKeys()
    const second = await releaseKeys({ target: 'vue', accountId: 'transferred-account' })
    const results = await Promise.allSettled([
      firstJournal.claim(claim(first)),
      secondJournal.claim(
        claim({
          ...second,
          releaseId: 'release-2',
          planDigest: 'plan-digest-2'
        })
      )
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((result) => result.status === 'rejected')
    expect(rejected?.status).toBe('rejected')
    if (rejected?.status === 'rejected') {
      expect(rejected.reason).toBeInstanceOf(BackendHostReleaseUnresolvedScopeError)
    }
  })

  test('conservatively blocks a v2 claim behind unresolved legacy project authority', async () => {
    const databaseName = `backend-release-legacy-${crypto.randomUUID()}`
    const legacyKey = 'backend-release-v1:project:legacy-account:legacy-grant:legacy-digest'
    await seedLegacyRecord(databaseName, legacyRecord(legacyKey))
    const journal = createIdbBackendHostReleaseDispatchJournal(databaseName, fakeIndexedDB)
    const candidate = await releaseKeys({ accountId: 'transferred-account' })

    await expect(journal.claim(claim(candidate))).rejects.toBeInstanceOf(
      BackendHostReleaseUnresolvedScopeError
    )
    await journal.settle({
      singleFlightKey: legacyKey,
      releaseId: 'legacy-release',
      planDigest: 'legacy-plan-digest',
      settledAt: SETTLED_AT,
      outcome: 'outcome-unknown',
      code: 'legacy-settlement',
      remoteOperationIds: []
    })
    expect(await journal.listUnresolved()).toHaveLength(1)
    await expect(journal.claim(claim(candidate))).rejects.toBeInstanceOf(
      BackendHostReleaseUnresolvedScopeError
    )
    await journal.settle({
      singleFlightKey: legacyKey,
      releaseId: 'legacy-release',
      planDigest: 'legacy-plan-digest',
      settledAt: '2026-08-30T08:02:00.000Z',
      outcome: 'failed',
      code: 'legacy-failed',
      remoteOperationIds: []
    })
    await expect(journal.claim(claim(candidate))).resolves.toMatchObject({ claimed: true })
  })

  test('lists only safely scoped unresolved legacy records in deterministic order', async () => {
    const databaseName = `backend-release-legacy-list-${crypto.randomUUID()}`
    const secondKey = 'backend-release-v1:project:legacy-account-b:legacy-grant:legacy-digest-b'
    const firstKey = 'backend-release-v1:project:legacy-account-a:legacy-grant:legacy-digest-a'
    await seedLegacyRecord(databaseName, legacyRecord(secondKey))
    await seedLegacyRecord(databaseName, legacyRecord(firstKey, 'outcome-unknown'))
    const journal = createIdbBackendHostReleaseDispatchJournal(databaseName, fakeIndexedDB)

    const records = await journal.listUnresolvedForScope(
      'backend-release-dispatch-scope-v1:supabase:project'
    )
    expect(records.map((record) => record.singleFlightKey)).toEqual([firstKey, secondKey])
    expect(
      await journal.listUnresolvedForScope(
        'backend-release-dispatch-scope-v1:supabase:other-project'
      )
    ).toEqual([])
  })

  test('does not let settled legacy audit history block a different release', async () => {
    const databaseName = `backend-release-legacy-settled-${crypto.randomUUID()}`
    await seedLegacyRecord(
      databaseName,
      legacyRecord('backend-release-v1:project:legacy-account:legacy-grant:legacy-digest', 'failed')
    )
    const journal = createIdbBackendHostReleaseDispatchJournal(databaseName, fakeIndexedDB)
    await expect(journal.claim(claim(await releaseKeys()))).resolves.toMatchObject({
      claimed: true
    })
  })

  test('fails closed when an unresolved legacy scope cannot be parsed', async () => {
    const databaseName = `backend-release-legacy-malformed-${crypto.randomUUID()}`
    await seedLegacyRecord(databaseName, legacyRecord('malformed-legacy-key'))
    const journal = createIdbBackendHostReleaseDispatchJournal(databaseName, fakeIndexedDB)
    await expect(journal.claim(claim(await releaseKeys()))).rejects.toThrow(
      'Unresolved legacy Backend Release scope cannot be determined safely'
    )
    await expect(
      journal.listUnresolvedForScope('backend-release-dispatch-scope-v1:supabase:project')
    ).rejects.toThrow('Unresolved legacy Backend Release scope cannot be determined safely')
  })

  test('preserves scope-aware unresolved listing across IndexedDB journal restarts', async () => {
    const databaseName = `backend-release-scope-list-restart-${crypto.randomUUID()}`
    const keys = await releaseKeys()
    const journal = createIdbBackendHostReleaseDispatchJournal(databaseName, fakeIndexedDB)
    await journal.claim(claim(keys))
    await journal.settle({
      ...claim(keys),
      settledAt: SETTLED_AT,
      outcome: 'outcome-unknown',
      code: 'transport-timeout',
      remoteOperationIds: []
    })

    const beforeRestart = await journal.listUnresolvedForScope(keys.dispatchScopeKey)
    const restarted = createIdbBackendHostReleaseDispatchJournal(databaseName, fakeIndexedDB)
    const afterRestart = await restarted.listUnresolvedForScope(keys.dispatchScopeKey)
    expect(afterRestart).toEqual(beforeRestart)
    expect(afterRestart).toHaveLength(1)
    expect(afterRestart[0]?.outcome).toBe('outcome-unknown')
  })

  test('binds secret-free progress and immutable final evidence to the exact claim', async () => {
    const journal = createMemoryBackendHostReleaseDispatchJournal()
    await journal.claim(claim())
    const progress = {
      stage: 'edge-deployed',
      versionId: '7',
      operationId: `edge-deploy-${'A1b2'.repeat(8)}`
    }
    const progressPayload = JSON.stringify(progress)
    await expect(
      journal.recordEvidence({
        ...evidenceClaim(),
        phase: 'progress',
        payload: progressPayload,
        payloadDigest: await digestCanonicalManifest(progress),
        recordedAt: CLAIMED_AT
      })
    ).resolves.toMatchObject({ phase: 'progress', payload: progressPayload })

    await expect(
      journal.recordEvidence({
        ...evidenceClaim(),
        phase: 'progress',
        payload: JSON.stringify({
          accessToken: `eyJ${'a'.repeat(20)}.eyJ${'b'.repeat(20)}.${'c'.repeat(20)}`
        }),
        payloadDigest: await digest('forbidden-evidence'),
        recordedAt: SETTLED_AT
      })
    ).rejects.toThrow('secret-like material')

    await journal.settle({
      ...claim(),
      settledAt: SETTLED_AT,
      outcome: 'outcome-unknown',
      code: 'provider-reconciliation-required',
      remoteOperationIds: [progress.operationId]
    })
    const final = { outcome: 'succeeded', versionId: '7' }
    const finalPayload = JSON.stringify(final)
    const stored = await journal.recordEvidence({
      ...evidenceClaim(),
      phase: 'final',
      payload: finalPayload,
      payloadDigest: await digestCanonicalManifest(final),
      recordedAt: SETTLED_AT
    })
    expect(parseBackendHostReleaseDispatchEvidenceRecord(stored)).toMatchObject({
      phase: 'final',
      payload: finalPayload
    })
    await expect(
      journal.recordEvidence({
        ...evidenceClaim(),
        phase: 'final',
        payload: JSON.stringify({ outcome: 'failed', versionId: '8' }),
        payloadDigest: await digest('tampered-final-evidence'),
        recordedAt: SETTLED_AT
      })
    ).rejects.toBeInstanceOf(BackendHostReleaseJournalConflictError)
  })

  test('preserves evidence across an IndexedDB restart and upgrades a legacy database safely', async () => {
    const databaseName = `backend-release-evidence-restart-${crypto.randomUUID()}`
    await seedLegacyRecord(
      databaseName,
      legacyRecord('backend-release-v1:other-project:legacy-account:legacy-grant:legacy-digest')
    )
    const writer = createIdbBackendHostReleaseDispatchJournal(databaseName, fakeIndexedDB)
    await writer.claim(claim())
    const payload = JSON.stringify({
      stage: 'storage-pre-dispatch',
      residualObjectPaths: ['users/actor/probe-1.bin']
    })
    const stored = await writer.recordEvidence({
      ...evidenceClaim(),
      phase: 'progress',
      payload,
      payloadDigest: await digestCanonicalManifest(JSON.parse(payload)),
      recordedAt: CLAIMED_AT
    })

    const restarted = createIdbBackendHostReleaseDispatchJournal(databaseName, fakeIndexedDB)
    expect(await restarted.readEvidence(claim().singleFlightKey)).toEqual(stored)
    expect(await restarted.listUnresolvedForScope(claim().dispatchScopeKey)).toHaveLength(1)
  })
})
