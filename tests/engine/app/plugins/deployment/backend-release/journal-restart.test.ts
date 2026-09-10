/* oxlint-disable eslint(max-lines) -- Restart recovery, tamper, journal-failure, and scope reconciliation scenarios share one lifecycle fixture. */
import { describe, expect, test } from 'bun:test'

import { indexedDB as fakeIndexedDB } from 'fake-indexeddb'

import type { BackendReleaseAuthorityV1, MigrationPlan } from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  createBackendHostReleaseController,
  type BackendHostReleaseAppliedProofV1,
  type BackendHostReleaseApplyResult,
  type BackendHostReleaseControllerDependencies,
  type BackendHostReleaseReconcileInput,
  type BackendHostReleaseReconcileResult
} from '@/app/plugins/host/deployment/backend/release-controller'
import {
  createIdbBackendHostReleaseDispatchJournal,
  createMemoryBackendHostReleaseDispatchJournal,
  type BackendHostReleaseDispatchJournal
} from '@/app/plugins/host/deployment/backend/release-journal'

const NOW = '2026-08-30T10:00:00.000Z'

async function digest(label: string): Promise<string> {
  return digestCanonicalManifest({ label })
}

async function authority(): Promise<BackendReleaseAuthorityV1> {
  return {
    documentDigest: await digest('restart-document'),
    irDigest: await digest('restart-ir'),
    inspectedSchemaDigest: await digest('restart-schema'),
    compilerVersion: '0.15.0',
    target: 'react',
    environment: 'staging',
    projectId: 'restart-project',
    accountId: 'restart-account',
    grantGeneration: 'restart-grant',
    backendProvider: {
      publisherId: 'open-pencil',
      packageDigest: `app-bundle-sha256:${await digest('restart-package')}`,
      pluginId: 'open-pencil.restart-provider',
      contributionId: 'restart-provider',
      providerId: 'restart-provider',
      adapterId: 'restart-adapter',
      adapterVersion: '1.0.0',
      contractVersion: 1,
      supportedModelVersions: [1],
      capabilities: ['migrations.schema'],
      permissions: [],
      outputKinds: ['migration-plan']
    }
  }
}

async function migrationPlan(): Promise<MigrationPlan> {
  return {
    version: 1,
    planId: 'restart-migration-plan',
    targetModelDigest: await digest('restart-target-model'),
    operations: [],
    highestRisk: 'low',
    requiresBackup: false
  }
}

interface FixtureOptions {
  readonly journal: BackendHostReleaseDispatchJournal
  readonly dispatch: () => Promise<BackendHostReleaseApplyResult>
  readonly schemaArtifactDigest?: string
  readonly now?: () => string
  readonly onInspect?: () => void
  readonly onReview?: () => void
  readonly onVerify?: () => void
  readonly reconcile?: (
    input: BackendHostReleaseReconcileInput
  ) => Promise<BackendHostReleaseReconcileResult>
}

async function dependencies(
  options: FixtureOptions
): Promise<BackendHostReleaseControllerDependencies> {
  const releaseAuthority = await authority()
  const releaseMigrationPlan = await migrationPlan()
  const schemaArtifactDigest =
    options.schemaArtifactDigest ?? (await digest('restart-schema-artifact'))
  return {
    dispatchJournal: options.journal,
    reconciler: {
      reconcile:
        options.reconcile ??
        (async () => ({
          outcome: 'outcome-unknown',
          code: 'reconciliation-pending',
          remoteOperationIds: []
        }))
    },
    inspector: {
      async inspect() {
        options.onInspect?.()
        return { authority: releaseAuthority, migrationPlan: releaseMigrationPlan }
      }
    },
    emitter: {
      async emit() {
        return {
          staticArtifactDigest: null,
          serverArtifactDigest: null,
          schemaArtifactDigest
        }
      }
    },
    reviewer: {
      review: () => {
        options.onReview?.()
        return true
      },
      confirm: () => []
    },
    executor: {
      async prepareApply() {
        return { dispatch: options.dispatch }
      }
    },
    verifier: {
      async verify() {
        options.onVerify?.()
        return []
      }
    },
    now: options.now ?? (() => NOW)
  }
}

function runInput(receiptId: string, onTransition?: (dispatch: string) => void) {
  return {
    releaseId: 'restart-release',
    planId: 'restart-plan',
    receiptId,
    requiredArtifactKinds: ['schema'],
    ...(onTransition
      ? { onTransition: (state: { dispatch: string }) => onTransition(state.dispatch) }
      : {})
  }
}

function appliedReconciliation(
  input: BackendHostReleaseReconcileInput,
  remoteOperationIds: readonly string[]
): BackendHostReleaseReconcileResult {
  return {
    outcome: 'applied',
    code: null,
    remoteOperationIds,
    proof: input.attestApplied({ remoteOperationIds })
  }
}

describe('Backend Host Release durable dispatch reconciliation', () => {
  test('durably precommits outcome-unknown before dispatch and keeps the live winner lease', async () => {
    const journal = createMemoryBackendHostReleaseDispatchJournal()
    let dispatchCalls = 0
    let reconcileCalls = 0
    let dispatchStarted!: () => void
    const started = new Promise<void>((resolve) => {
      dispatchStarted = resolve
    })
    let finishDispatch!: (result: BackendHostReleaseApplyResult) => void
    const dispatchResult = new Promise<BackendHostReleaseApplyResult>((resolve) => {
      finishDispatch = resolve
    })
    const firstRun = createBackendHostReleaseController(
      await dependencies({
        journal,
        async dispatch() {
          dispatchCalls += 1
          dispatchStarted()
          return dispatchResult
        }
      })
    ).run(runInput('active-winner-receipt'))
    await started

    const loser = await createBackendHostReleaseController(
      await dependencies({
        journal,
        async dispatch() {
          dispatchCalls += 1
          return { ok: true, remoteOperationIds: ['unexpected-second-dispatch'] }
        },
        async reconcile(input) {
          reconcileCalls += 1
          return appliedReconciliation(input, [])
        }
      })
    ).run(runInput('active-loser-receipt'))

    expect(loser).toMatchObject({
      outcome: 'outcome-unknown',
      failureCode: 'backend-release-dispatch-in-flight',
      reconcileRequired: true
    })
    expect(dispatchCalls).toBe(1)
    expect(reconcileCalls).toBe(0)
    expect(await journal.listPending()).toHaveLength(0)
    expect((await journal.listUnresolved())[0]).toMatchObject({
      ownerId: 'active-winner-receipt',
      outcome: 'outcome-unknown',
      code: 'backend-release-dispatch-outcome-unknown'
    })

    finishDispatch({ ok: true, remoteOperationIds: ['winner-operation'] })
    await expect(firstRun).resolves.toMatchObject({ outcome: 'succeeded' })
  })

  test('does not reconcile a different artifact while the scope winner lease is active', async () => {
    const journal = createMemoryBackendHostReleaseDispatchJournal()
    const firstArtifact = await digest('active-scope-artifact-v1')
    const nextArtifact = await digest('active-scope-artifact-v2')
    let dispatchCalls = 0
    let reconcileCalls = 0
    let dispatchStarted!: () => void
    const started = new Promise<void>((resolve) => {
      dispatchStarted = resolve
    })
    let finishDispatch!: (result: BackendHostReleaseApplyResult) => void
    const dispatchResult = new Promise<BackendHostReleaseApplyResult>((resolve) => {
      finishDispatch = resolve
    })
    const firstRun = createBackendHostReleaseController(
      await dependencies({
        journal,
        schemaArtifactDigest: firstArtifact,
        async dispatch() {
          dispatchCalls += 1
          dispatchStarted()
          return dispatchResult
        }
      })
    ).run(runInput('active-scope-winner-receipt'))
    await started

    const blocked = await createBackendHostReleaseController(
      await dependencies({
        journal,
        schemaArtifactDigest: nextArtifact,
        async dispatch() {
          dispatchCalls += 1
          return { ok: true, remoteOperationIds: ['unexpected-second-dispatch'] }
        },
        async reconcile(input) {
          reconcileCalls += 1
          return appliedReconciliation(input, [])
        }
      })
    ).run(runInput('active-scope-blocked-receipt'))

    expect(blocked).toMatchObject({
      outcome: 'outcome-unknown',
      failureCode: 'backend-release-dispatch-in-flight',
      reconcileRequired: true
    })
    expect(dispatchCalls).toBe(1)
    expect(reconcileCalls).toBe(0)

    finishDispatch({ ok: true, remoteOperationIds: ['winner-operation'] })
    await expect(firstRun).resolves.toMatchObject({ outcome: 'succeeded' })
  })

  test('reconciles only after the pending lease expires and preserves a temporarily unknown result', async () => {
    const journal = createMemoryBackendHostReleaseDispatchJournal()
    let currentTime = NOW
    let dispatchCalls = 0
    let reconcileCalls = 0
    let dispatchStarted!: () => void
    const started = new Promise<void>((resolve) => {
      dispatchStarted = resolve
    })
    let finishDispatch!: (result: BackendHostReleaseApplyResult) => void
    const dispatchResult = new Promise<BackendHostReleaseApplyResult>((resolve) => {
      finishDispatch = resolve
    })
    const firstRun = createBackendHostReleaseController(
      await dependencies({
        journal,
        now: () => currentTime,
        async dispatch() {
          dispatchCalls += 1
          dispatchStarted()
          return dispatchResult
        }
      })
    ).run(runInput('expired-winner-receipt'))
    await started
    currentTime = '2026-08-30T10:06:00.000Z'

    const restarted = await createBackendHostReleaseController(
      await dependencies({
        journal,
        now: () => currentTime,
        async dispatch() {
          dispatchCalls += 1
          return { ok: true, remoteOperationIds: ['unexpected-second-dispatch'] }
        },
        async reconcile() {
          reconcileCalls += 1
          return {
            outcome: 'outcome-unknown',
            code: 'remote-operation-not-visible',
            remoteOperationIds: []
          }
        }
      })
    ).run(runInput('expired-reconciler-receipt'))

    expect(restarted).toMatchObject({
      outcome: 'outcome-unknown',
      failureCode: 'backend-release-dispatch-outcome-unknown',
      reconcileRequired: true
    })
    expect(dispatchCalls).toBe(1)
    expect(reconcileCalls).toBe(1)
    expect(await journal.listPending()).toEqual([])
    expect(await journal.read(restarted.singleFlightKey ?? '')).toMatchObject({
      outcome: 'outcome-unknown',
      code: 'backend-release-dispatch-outcome-unknown'
    })

    finishDispatch({
      ok: false,
      kind: 'transport',
      code: 'remote-operation-not-visible',
      remoteOperationIds: []
    })
    await expect(firstRun).resolves.toMatchObject({ outcome: 'outcome-unknown' })
  })

  test('restarts with a shared journal, re-inspects, reconciles, and never dispatches twice', async () => {
    const journal = createMemoryBackendHostReleaseDispatchJournal()
    let currentTime = NOW
    let dispatchCalls = 0
    const firstDependencies = await dependencies({
      journal,
      now: () => currentTime,
      async dispatch() {
        dispatchCalls += 1
        return {
          ok: false,
          kind: 'transport',
          code: 'remote-outcome-unknown',
          remoteOperationIds: ['remote-operation-1']
        }
      }
    })
    const first = await createBackendHostReleaseController(firstDependencies).run(
      runInput('restart-receipt-1')
    )
    currentTime = '2026-08-30T10:06:00.000Z'

    let reconciledClaimDigest: string | undefined
    let reconciledPlanDigest: string | undefined
    let reconciledSchemaDigest: string | undefined
    let reconciledPlanSchemaDigest: string | undefined
    let reconciledSingleFlightKey: string | undefined
    const secondDispatchStates: string[] = []
    const secondDependencies = await dependencies({
      journal,
      now: () => currentTime,
      async dispatch() {
        dispatchCalls += 1
        return { ok: true, remoteOperationIds: ['unexpected-second-dispatch'] }
      },
      async reconcile(input) {
        reconciledClaimDigest = input.claim.planDigest
        reconciledPlanDigest = input.plan.planDigest
        reconciledSchemaDigest = input.authority.inspectedSchemaDigest
        reconciledPlanSchemaDigest = input.plan.authority.inspectedSchemaDigest
        reconciledSingleFlightKey = input.claim.singleFlightKey
        return appliedReconciliation(input, ['remote-operation-1'])
      }
    })
    const second = await createBackendHostReleaseController(secondDependencies).run(
      runInput('restart-receipt-2', (dispatch) => secondDispatchStates.push(dispatch))
    )

    expect(first).toMatchObject({ outcome: 'outcome-unknown', reconcileRequired: true })
    expect(second).toMatchObject({ outcome: 'succeeded', reconcileRequired: false })
    expect(dispatchCalls).toBe(1)
    expect(secondDispatchStates).not.toContain('dispatched')
    expect(reconciledClaimDigest).toBe(reconciledPlanDigest)
    expect(reconciledSchemaDigest).toBe(reconciledPlanSchemaDigest)
    expect(await journal.read(reconciledSingleFlightKey ?? '')).toMatchObject({
      outcome: 'applied',
      remoteOperationIds: ['remote-operation-1']
    })
  })

  test('rejects a tampered claim before dispatch', async () => {
    const stored = createMemoryBackendHostReleaseDispatchJournal()
    const journal: BackendHostReleaseDispatchJournal = {
      ...stored,
      async claim(input) {
        const result = await stored.claim(input)
        return { ...result, record: { ...result.record, planDigest: await digest('tampered') } }
      }
    }
    let dispatchCalls = 0
    const state = await createBackendHostReleaseController(
      await dependencies({
        journal,
        async dispatch() {
          dispatchCalls += 1
          return { ok: true, remoteOperationIds: [] }
        }
      })
    ).run(runInput('tampered-claim-receipt'))

    expect(dispatchCalls).toBe(0)
    expect(state).toMatchObject({
      outcome: 'failed',
      dispatch: 'not-dispatched',
      failureCode: 'backend-release-journal-claim-failed'
    })
  })

  test('never dispatches when the built-in journal cannot complete startup recovery', async () => {
    const databaseName = `backend-release-controller-startup-${crypto.randomUUID()}`
    const initializer = createIdbBackendHostReleaseDispatchJournal(databaseName, fakeIndexedDB)
    await initializer.listUnresolved()
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = fakeIndexedDB.open(databaseName)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('dispatchTombstones', 'readwrite')
      transaction.objectStore('dispatchTombstones').put({
        format: 'openpencil.backend-release-dispatch-tombstone',
        version: 99,
        singleFlightKey: 'backend-release-v3:restart-provider:restart-project:corrupt',
        record: null,
        evidence: null
      })
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error)
      transaction.onerror = () => reject(transaction.error)
    })
    database.close()

    let dispatchCalls = 0
    const state = await createBackendHostReleaseController(
      await dependencies({
        journal: createIdbBackendHostReleaseDispatchJournal(databaseName, fakeIndexedDB),
        async dispatch() {
          dispatchCalls += 1
          return { ok: true, remoteOperationIds: ['unexpected-dispatch'] }
        }
      })
    ).run(runInput('startup-recovery-failure-receipt'))

    expect(dispatchCalls).toBe(0)
    expect(state).toMatchObject({
      outcome: 'failed',
      dispatch: 'not-dispatched',
      failureCode: 'backend-release-journal-claim-failed'
    })
  })

  test('never dispatches when the durable outcome-unknown precommit cannot be confirmed', async () => {
    const stored = createMemoryBackendHostReleaseDispatchJournal()
    const journal: BackendHostReleaseDispatchJournal = {
      ...stored,
      async settle() {
        throw new Error('simulated durable write failure')
      }
    }
    let dispatchCalls = 0
    const state = await createBackendHostReleaseController(
      await dependencies({
        journal,
        async dispatch() {
          dispatchCalls += 1
          return { ok: true, remoteOperationIds: ['remote-operation-1'] }
        }
      })
    ).run(runInput('settlement-failure-receipt'))

    expect(dispatchCalls).toBe(0)
    expect(state).toMatchObject({
      outcome: 'outcome-unknown',
      dispatch: 'settled',
      reconcileRequired: true,
      failureCode: 'backend-release-dispatch-precommit-failed'
    })
    expect(await stored.listPending()).toHaveLength(1)
  })

  test('keeps the scope fenced when dispatch reports a non-positive provider result', async () => {
    const journal = createMemoryBackendHostReleaseDispatchJournal()
    const firstArtifact = await digest('restart-schema-artifact-v1')
    const correctedArtifact = await digest('restart-schema-artifact-v2')
    let dispatchCalls = 0

    const first = await createBackendHostReleaseController(
      await dependencies({
        journal,
        schemaArtifactDigest: firstArtifact,
        async dispatch() {
          dispatchCalls += 1
          return {
            ok: false,
            kind: 'provider-rejected',
            code: 'previous-artifact-rejected'
          }
        }
      })
    ).run(runInput('artifact-v1-receipt'))

    const correctedDependencies = await dependencies({
      journal,
      schemaArtifactDigest: correctedArtifact,
      async dispatch() {
        dispatchCalls += 1
        return { ok: true, remoteOperationIds: ['corrected-artifact-operation'] }
      }
    })
    const corrected = await createBackendHostReleaseController(correctedDependencies).run(
      runInput('artifact-v2-receipt')
    )
    expect(dispatchCalls).toBe(1)
    expect(first.singleFlightKey).not.toBe(corrected.singleFlightKey)
    expect(first).toMatchObject({
      outcome: 'outcome-unknown',
      failureCode: 'previous-artifact-rejected'
    })
    expect(corrected).toMatchObject({
      outcome: 'outcome-unknown',
      failureCode: 'backend-release-dispatch-in-flight'
    })
    expect(await journal.read(first.singleFlightKey ?? '')).toMatchObject({
      outcome: 'outcome-unknown'
    })
    expect(await journal.read(corrected.singleFlightKey ?? '')).toBeNull()
  })

  test('does not treat a truthy malformed dispatch result as positive Applied evidence', async () => {
    const journal = createMemoryBackendHostReleaseDispatchJournal()
    let verifyCalls = 0
    const state = await createBackendHostReleaseController(
      await dependencies({
        journal,
        onVerify() {
          verifyCalls += 1
        },
        async dispatch() {
          return JSON.parse(
            '{"ok":1,"remoteOperationIds":["malformed-positive-operation"]}'
          ) as BackendHostReleaseApplyResult
        }
      })
    ).run(runInput('malformed-positive-receipt'))

    expect(state).toMatchObject({
      outcome: 'outcome-unknown',
      reconcileRequired: true,
      failureCode: 'backend-release-apply-outcome-unknown'
    })
    expect(verifyCalls).toBe(0)
    expect(await journal.read(state.singleFlightKey ?? '')).toMatchObject({
      outcome: 'outcome-unknown'
    })
  })

  test('does not let generic failed reconciliation release an outcome-unknown scope', async () => {
    const journal = createMemoryBackendHostReleaseDispatchJournal()
    let currentTime = NOW
    const firstArtifact = await digest('scope-recovery-artifact-v1')
    const correctedArtifact = await digest('scope-recovery-artifact-v2')
    let dispatchCalls = 0
    let reconcileCalls = 0

    const first = await createBackendHostReleaseController(
      await dependencies({
        journal,
        now: () => currentTime,
        schemaArtifactDigest: firstArtifact,
        async dispatch() {
          dispatchCalls += 1
          return {
            ok: false,
            kind: 'transport',
            code: 'previous-artifact-outcome-unknown'
          }
        }
      })
    ).run(runInput('scope-recovery-v1-receipt'))
    expect(first).toMatchObject({ outcome: 'outcome-unknown' })
    currentTime = '2026-08-30T10:06:00.000Z'

    const recoveryDependencies = await dependencies({
      journal,
      now: () => currentTime,
      schemaArtifactDigest: correctedArtifact,
      async dispatch() {
        dispatchCalls += 1
        return { ok: true, remoteOperationIds: ['corrected-artifact-operation'] }
      },
      async reconcile(input) {
        reconcileCalls += 1
        expect(input.claim.singleFlightKey).toBe(first.singleFlightKey)
        return {
          outcome: 'failed',
          code: 'previous-artifact-proven-not-applied',
          remoteOperationIds: []
        } as never
      }
    })
    const recovered = await createBackendHostReleaseController(recoveryDependencies).run(
      runInput('scope-recovery-readonly-receipt')
    )

    expect(recovered).toMatchObject({
      outcome: 'outcome-unknown',
      failureCode: 'backend-release-unresolved-scope',
      remoteOperationIds: []
    })
    expect(recovered.singleFlightKey).not.toBe(first.singleFlightKey)
    expect(dispatchCalls).toBe(1)
    expect(reconcileCalls).toBe(1)
    expect(await journal.read(first.singleFlightKey ?? '')).toMatchObject({
      outcome: 'outcome-unknown'
    })
    expect(await journal.read(recovered.singleFlightKey ?? '')).toBeNull()
  })

  test('binds Applied proof to one reconciliation call, claim, and exact operation IDs', async () => {
    const journal = createMemoryBackendHostReleaseDispatchJournal()
    let currentTime = NOW
    let dispatchCalls = 0
    const first = await createBackendHostReleaseController(
      await dependencies({
        journal,
        now: () => currentTime,
        async dispatch() {
          dispatchCalls += 1
          return { ok: false, kind: 'transport', code: 'positive-proof-required' }
        }
      })
    ).run(runInput('proof-binding-first'))
    currentTime = '2026-08-30T10:06:00.000Z'

    let lateAttester: BackendHostReleaseReconcileInput['attestApplied'] | null = null
    await createBackendHostReleaseController(
      await dependencies({
        journal,
        now: () => currentTime,
        async dispatch() {
          dispatchCalls += 1
          return { ok: true, remoteOperationIds: ['unexpected-dispatch'] }
        },
        async reconcile(input) {
          lateAttester = input.attestApplied
          return { outcome: 'outcome-unknown', code: 'still-unknown', remoteOperationIds: [] }
        }
      })
    ).run(runInput('proof-binding-late-attester'))
    expect(() => lateAttester?.({ remoteOperationIds: [] })).toThrow('already issued')

    let burnedProof: BackendHostReleaseAppliedProofV1 | null = null
    const mismatch = await createBackendHostReleaseController(
      await dependencies({
        journal,
        now: () => currentTime,
        async dispatch() {
          dispatchCalls += 1
          return { ok: true, remoteOperationIds: ['unexpected-dispatch'] }
        },
        async reconcile(input) {
          const proof = input.attestApplied({ remoteOperationIds: ['observed-operation'] })
          burnedProof = proof
          return {
            outcome: 'applied',
            code: null,
            remoteOperationIds: ['substituted-operation'],
            proof
          }
        }
      })
    ).run(runInput('proof-binding-mismatch'))
    expect(mismatch).toMatchObject({ outcome: 'outcome-unknown', reconcileRequired: true })

    const replay = await createBackendHostReleaseController(
      await dependencies({
        journal,
        now: () => currentTime,
        async dispatch() {
          dispatchCalls += 1
          return { ok: true, remoteOperationIds: ['unexpected-dispatch'] }
        },
        async reconcile() {
          return {
            outcome: 'applied',
            code: null,
            remoteOperationIds: ['observed-operation'],
            proof: burnedProof as BackendHostReleaseAppliedProofV1
          }
        }
      })
    ).run(runInput('proof-binding-replay'))

    expect(first).toMatchObject({ outcome: 'outcome-unknown' })
    expect(replay).toMatchObject({ outcome: 'outcome-unknown', reconcileRequired: true })
    expect(dispatchCalls).toBe(1)
    expect(await journal.read(first.singleFlightKey ?? '')).toMatchObject({
      outcome: 'outcome-unknown'
    })
  })

  test('rejects an Applied proof borrowed by a concurrent reconciliation invocation', async () => {
    const journal = createMemoryBackendHostReleaseDispatchJournal()
    let currentTime = NOW
    let dispatchCalls = 0
    const first = await createBackendHostReleaseController(
      await dependencies({
        journal,
        now: () => currentTime,
        async dispatch() {
          dispatchCalls += 1
          return { ok: false, kind: 'transport', code: 'positive-proof-required' }
        }
      })
    ).run(runInput('cross-invocation-first'))
    currentTime = '2026-08-30T10:06:00.000Z'

    let borrowedProof: BackendHostReleaseAppliedProofV1 | null = null
    let proofReady!: () => void
    const ready = new Promise<void>((resolve) => {
      proofReady = resolve
    })
    let finishOwner!: () => void
    const ownerGate = new Promise<void>((resolve) => {
      finishOwner = resolve
    })
    const owner = createBackendHostReleaseController(
      await dependencies({
        journal,
        now: () => currentTime,
        async dispatch() {
          dispatchCalls += 1
          return { ok: true, remoteOperationIds: ['unexpected-dispatch'] }
        },
        async reconcile(input) {
          borrowedProof = input.attestApplied({ remoteOperationIds: ['observed-operation'] })
          proofReady()
          await ownerGate
          return { outcome: 'outcome-unknown', code: 'owner-still-unknown', remoteOperationIds: [] }
        }
      })
    ).run(runInput('cross-invocation-owner'))
    await ready

    const borrower = await createBackendHostReleaseController(
      await dependencies({
        journal,
        now: () => currentTime,
        async dispatch() {
          dispatchCalls += 1
          return { ok: true, remoteOperationIds: ['unexpected-dispatch'] }
        },
        async reconcile() {
          return {
            outcome: 'applied',
            code: null,
            remoteOperationIds: ['observed-operation'],
            proof: borrowedProof as BackendHostReleaseAppliedProofV1
          }
        }
      })
    ).run(runInput('cross-invocation-borrower'))
    finishOwner()
    const ownerResult = await owner

    expect(first).toMatchObject({ outcome: 'outcome-unknown' })
    expect(borrower).toMatchObject({ outcome: 'outcome-unknown', reconcileRequired: true })
    expect(ownerResult).toMatchObject({ outcome: 'outcome-unknown', reconcileRequired: true })
    expect(dispatchCalls).toBe(1)
    expect(await journal.read(first.singleFlightKey ?? '')).toMatchObject({
      outcome: 'outcome-unknown'
    })
  })

  test('requires a new reviewed run after a different artifact claim reconciles as applied', async () => {
    const journal = createMemoryBackendHostReleaseDispatchJournal()
    let currentTime = NOW
    const firstArtifact = await digest('scope-applied-artifact-v1')
    const nextArtifact = await digest('scope-applied-artifact-v2')
    let dispatchCalls = 0
    let reconcileCalls = 0
    let reconciledVerifyCalls = 0

    const first = await createBackendHostReleaseController(
      await dependencies({
        journal,
        now: () => currentTime,
        schemaArtifactDigest: firstArtifact,
        async dispatch() {
          dispatchCalls += 1
          return {
            ok: false,
            kind: 'transport',
            code: 'scope-applied-outcome-unknown',
            remoteOperationIds: ['original-operation']
          }
        }
      })
    ).run(runInput('scope-applied-v1-receipt'))
    currentTime = '2026-08-30T10:06:00.000Z'

    const reconciled = await createBackendHostReleaseController(
      await dependencies({
        journal,
        now: () => currentTime,
        schemaArtifactDigest: nextArtifact,
        async dispatch() {
          dispatchCalls += 1
          return { ok: true, remoteOperationIds: ['unexpected-second-dispatch'] }
        },
        async reconcile(input) {
          reconcileCalls += 1
          return appliedReconciliation(input, ['original-operation'])
        },
        onVerify() {
          reconciledVerifyCalls += 1
        }
      })
    ).run(runInput('scope-applied-v2-receipt'))

    expect(reconciled).toMatchObject({
      outcome: 'failed',
      failureCode: 'backend-release-prior-claim-applied-review-required'
    })
    expect(reconciled.singleFlightKey).not.toBe(first.singleFlightKey)
    expect(dispatchCalls).toBe(1)
    expect(reconcileCalls).toBe(1)
    expect(reconciledVerifyCalls).toBe(0)
    expect(await journal.read(first.singleFlightKey ?? '')).toMatchObject({
      outcome: 'applied',
      remoteOperationIds: ['original-operation']
    })
    expect(await journal.read(reconciled.singleFlightKey ?? '')).toBeNull()

    let nextInspectionCalls = 0
    let nextReviewCalls = 0
    const next = await createBackendHostReleaseController(
      await dependencies({
        journal,
        schemaArtifactDigest: nextArtifact,
        async dispatch() {
          dispatchCalls += 1
          return { ok: true, remoteOperationIds: ['next-artifact-operation'] }
        },
        onInspect() {
          nextInspectionCalls += 1
        },
        onReview() {
          nextReviewCalls += 1
        }
      })
    ).run(runInput('scope-applied-v2-reviewed-receipt'))

    expect(next).toMatchObject({ outcome: 'succeeded' })
    expect(next.singleFlightKey).toBe(reconciled.singleFlightKey)
    expect(nextInspectionCalls).toBe(2)
    expect(nextReviewCalls).toBe(1)
    expect(dispatchCalls).toBe(2)
    expect(reconcileCalls).toBe(1)
    expect(await journal.read(next.singleFlightKey ?? '')).toMatchObject({
      outcome: 'applied',
      remoteOperationIds: ['next-artifact-operation']
    })
  })

  test('keeps a different artifact blocked when read-only scope reconciliation stays unknown', async () => {
    const journal = createMemoryBackendHostReleaseDispatchJournal()
    let currentTime = NOW
    const firstArtifact = await digest('scope-unknown-artifact-v1')
    const nextArtifact = await digest('scope-unknown-artifact-v2')
    let dispatchCalls = 0
    let reconcileCalls = 0

    const first = await createBackendHostReleaseController(
      await dependencies({
        journal,
        now: () => currentTime,
        schemaArtifactDigest: firstArtifact,
        async dispatch() {
          dispatchCalls += 1
          return {
            ok: false,
            kind: 'transport',
            code: 'scope-outcome-unknown'
          }
        }
      })
    ).run(runInput('scope-unknown-v1-receipt'))
    currentTime = '2026-08-30T10:06:00.000Z'

    const blocked = await createBackendHostReleaseController(
      await dependencies({
        journal,
        now: () => currentTime,
        schemaArtifactDigest: nextArtifact,
        async dispatch() {
          dispatchCalls += 1
          return { ok: true, remoteOperationIds: ['unexpected-second-dispatch'] }
        },
        async reconcile() {
          reconcileCalls += 1
          return {
            outcome: 'outcome-unknown',
            code: 'remote-state-still-unknown',
            remoteOperationIds: []
          }
        }
      })
    ).run(runInput('scope-unknown-v2-receipt'))

    expect(blocked).toMatchObject({
      outcome: 'outcome-unknown',
      failureCode: 'backend-release-unresolved-scope',
      reconcileRequired: true
    })
    expect(dispatchCalls).toBe(1)
    expect(reconcileCalls).toBe(1)
    expect(await journal.read(first.singleFlightKey ?? '')).toMatchObject({
      outcome: 'outcome-unknown'
    })
    expect(await journal.read(blocked.singleFlightKey ?? '')).toBeNull()
  })

  test('fails closed when same-scope recovery lookup fails or returns multiple records', async () => {
    const firstArtifact = await digest('scope-lookup-artifact-v1')
    const nextArtifact = await digest('scope-lookup-artifact-v2')
    for (const lookup of ['throws', 'multiple'] as const) {
      const stored = createMemoryBackendHostReleaseDispatchJournal()
      let dispatchCalls = 0
      let reconcileCalls = 0
      const first = await createBackendHostReleaseController(
        await dependencies({
          journal: stored,
          schemaArtifactDigest: firstArtifact,
          async dispatch() {
            dispatchCalls += 1
            return {
              ok: false,
              kind: 'transport',
              code: 'scope-lookup-outcome-unknown'
            }
          }
        })
      ).run(runInput(`scope-lookup-${lookup}-v1-receipt`))
      const unresolved = await stored.listUnresolved()
      expect(unresolved).toHaveLength(1)
      const journal: BackendHostReleaseDispatchJournal = {
        ...stored,
        async listUnresolvedForScope() {
          if (lookup === 'throws') throw new Error('simulated scope lookup failure')
          return [
            unresolved[0],
            { ...unresolved[0], singleFlightKey: `${unresolved[0].singleFlightKey}:duplicate` }
          ]
        }
      }
      const blocked = await createBackendHostReleaseController(
        await dependencies({
          journal,
          schemaArtifactDigest: nextArtifact,
          async dispatch() {
            dispatchCalls += 1
            return { ok: true, remoteOperationIds: ['unexpected-second-dispatch'] }
          },
          async reconcile(input) {
            reconcileCalls += 1
            return appliedReconciliation(input, [])
          }
        })
      ).run(runInput(`scope-lookup-${lookup}-v2-receipt`))

      expect(first).toMatchObject({ outcome: 'outcome-unknown' })
      expect(blocked).toMatchObject({
        outcome: 'outcome-unknown',
        failureCode: 'backend-release-unresolved-scope'
      })
      expect(dispatchCalls).toBe(1)
      expect(reconcileCalls).toBe(0)
    }
  })
})
