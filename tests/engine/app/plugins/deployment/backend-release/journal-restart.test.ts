import { describe, expect, test } from 'bun:test'

import type { BackendReleaseAuthorityV1, MigrationPlan } from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  createBackendHostReleaseController,
  type BackendHostReleaseApplyResult,
  type BackendHostReleaseControllerDependencies,
  type BackendHostReleaseReconcileInput,
  type BackendHostReleaseReconcileResult
} from '@/app/plugins/host/deployment/backend/release-controller'
import {
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

describe('Backend Host Release durable dispatch reconciliation', () => {
  test('keeps a live winner lease pending without loser reconciliation or settlement', async () => {
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
        async reconcile() {
          reconcileCalls += 1
          return { outcome: 'applied', code: null, remoteOperationIds: [] }
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
    expect(await journal.listPending()).toHaveLength(1)
    expect((await journal.listPending())[0]).toMatchObject({
      ownerId: 'active-winner-receipt',
      outcome: 'pending'
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
        async reconcile() {
          reconcileCalls += 1
          return { outcome: 'applied', code: null, remoteOperationIds: [] }
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
      failureCode: 'remote-operation-not-visible',
      reconcileRequired: true
    })
    expect(dispatchCalls).toBe(1)
    expect(reconcileCalls).toBe(1)
    expect(await journal.listPending()).toEqual([])
    expect(await journal.read(restarted.singleFlightKey ?? '')).toMatchObject({
      outcome: 'outcome-unknown',
      code: 'remote-operation-not-visible'
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
    let dispatchCalls = 0
    const firstDependencies = await dependencies({
      journal,
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

    let reconciledClaimDigest: string | undefined
    let reconciledPlanDigest: string | undefined
    let reconciledSchemaDigest: string | undefined
    let reconciledPlanSchemaDigest: string | undefined
    let reconciledSingleFlightKey: string | undefined
    const secondDispatchStates: string[] = []
    const secondDependencies = await dependencies({
      journal,
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
        return { outcome: 'applied', code: null, remoteOperationIds: ['remote-operation-1'] }
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

  test('turns a settlement write failure into outcome-unknown without redispatch', async () => {
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

    expect(dispatchCalls).toBe(1)
    expect(state).toMatchObject({
      outcome: 'outcome-unknown',
      dispatch: 'settled',
      reconcileRequired: true,
      failureCode: 'backend-release-journal-settle-failed'
    })
    expect(await stored.listPending()).toHaveLength(1)
  })

  test('dispatches a corrected artifact after a known failure and still deduplicates identical bytes', async () => {
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
    expect(first).toMatchObject({ outcome: 'failed', failureCode: 'previous-artifact-rejected' })

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
    const duplicate = await createBackendHostReleaseController(correctedDependencies).run(
      runInput('artifact-v2-duplicate-receipt')
    )

    expect(dispatchCalls).toBe(2)
    expect(first.singleFlightKey).not.toBe(corrected.singleFlightKey)
    expect(duplicate.singleFlightKey).toBe(corrected.singleFlightKey)
    expect(await journal.read(first.singleFlightKey ?? '')).toMatchObject({ outcome: 'failed' })
    expect(await journal.read(corrected.singleFlightKey ?? '')).toMatchObject({
      outcome: 'applied'
    })
  })

  test('read-only reconciles a different artifact claim to failed before a later run dispatches', async () => {
    const journal = createMemoryBackendHostReleaseDispatchJournal()
    const firstArtifact = await digest('scope-recovery-artifact-v1')
    const correctedArtifact = await digest('scope-recovery-artifact-v2')
    let dispatchCalls = 0
    let reconcileCalls = 0

    const first = await createBackendHostReleaseController(
      await dependencies({
        journal,
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

    const recoveryDependencies = await dependencies({
      journal,
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
        }
      }
    })
    const recovered = await createBackendHostReleaseController(recoveryDependencies).run(
      runInput('scope-recovery-readonly-receipt')
    )

    expect(recovered).toMatchObject({
      outcome: 'failed',
      failureCode: 'backend-release-prior-claim-failed-review-required',
      remoteOperationIds: []
    })
    expect(recovered.singleFlightKey).not.toBe(first.singleFlightKey)
    expect(dispatchCalls).toBe(1)
    expect(reconcileCalls).toBe(1)
    expect(await journal.read(first.singleFlightKey ?? '')).toMatchObject({ outcome: 'failed' })
    expect(await journal.read(recovered.singleFlightKey ?? '')).toBeNull()

    const dispatched = await createBackendHostReleaseController(recoveryDependencies).run(
      runInput('scope-recovery-v2-receipt')
    )
    expect(dispatchCalls).toBe(2)
    expect(reconcileCalls).toBe(1)
    expect(dispatched.singleFlightKey).toBe(recovered.singleFlightKey)
    expect(await journal.read(dispatched.singleFlightKey ?? '')).toMatchObject({
      outcome: 'applied'
    })
  })

  test('requires a new reviewed run after a different artifact claim reconciles as applied', async () => {
    const journal = createMemoryBackendHostReleaseDispatchJournal()
    const firstArtifact = await digest('scope-applied-artifact-v1')
    const nextArtifact = await digest('scope-applied-artifact-v2')
    let dispatchCalls = 0
    let reconcileCalls = 0
    let reconciledVerifyCalls = 0

    const first = await createBackendHostReleaseController(
      await dependencies({
        journal,
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

    const reconciled = await createBackendHostReleaseController(
      await dependencies({
        journal,
        schemaArtifactDigest: nextArtifact,
        async dispatch() {
          dispatchCalls += 1
          return { ok: true, remoteOperationIds: ['unexpected-second-dispatch'] }
        },
        async reconcile() {
          reconcileCalls += 1
          return {
            outcome: 'applied',
            code: null,
            remoteOperationIds: ['original-operation']
          }
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
    const firstArtifact = await digest('scope-unknown-artifact-v1')
    const nextArtifact = await digest('scope-unknown-artifact-v2')
    let dispatchCalls = 0
    let reconcileCalls = 0

    const first = await createBackendHostReleaseController(
      await dependencies({
        journal,
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

    const blocked = await createBackendHostReleaseController(
      await dependencies({
        journal,
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
          async reconcile() {
            reconcileCalls += 1
            return { outcome: 'applied', code: null, remoteOperationIds: [] }
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
