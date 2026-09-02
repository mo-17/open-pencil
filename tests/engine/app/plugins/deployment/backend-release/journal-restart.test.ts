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
  readonly now?: () => string
  readonly reconcile?: (
    input: BackendHostReleaseReconcileInput
  ) => Promise<BackendHostReleaseReconcileResult>
}

async function dependencies(
  options: FixtureOptions
): Promise<BackendHostReleaseControllerDependencies> {
  const releaseAuthority = await authority()
  const releaseMigrationPlan = await migrationPlan()
  const schemaArtifactDigest = await digest('restart-schema-artifact')
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
      review: () => true,
      confirm: () => []
    },
    executor: {
      async prepareApply() {
        return { dispatch: options.dispatch }
      }
    },
    verifier: {
      async verify() {
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
})
