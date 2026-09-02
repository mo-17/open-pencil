import { describe, expect, test } from 'bun:test'

import {
  BACKEND_PRODUCTION_GATE_IDS,
  backendReleaseSingleFlightKey,
  type BackendCredentialRef,
  type BackendProductionGateResultV1,
  type BackendReleaseAuthorityV1,
  type MigrationPlan
} from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  BackendHostReleaseApplyError,
  createBackendHostReleaseController,
  type BackendHostReleaseControllerDependencies,
  type BackendHostReleasePrepareApplyInput,
  type BackendHostReleaseRunInput
} from '@/app/plugins/host/deployment/backend/release-controller'
import { createMemoryBackendHostReleaseDispatchJournal } from '@/app/plugins/host/deployment/backend/release-journal'

const NOW = '2026-08-30T08:00:00.000Z'
const CREDENTIAL_REF = 'credential.123e4567-e89b-42d3-a456-426614174000' as BackendCredentialRef

async function digest(label: string): Promise<string> {
  return digestCanonicalManifest({ label })
}

async function authority(
  overrides: Partial<BackendReleaseAuthorityV1> = {}
): Promise<BackendReleaseAuthorityV1> {
  return {
    documentDigest: await digest('document'),
    irDigest: await digest('ir'),
    inspectedSchemaDigest: await digest('schema'),
    compilerVersion: '0.15.0',
    target: 'react',
    environment: 'production',
    projectId: 'project-1',
    accountId: 'account-1',
    grantGeneration: 'grant-1',
    backendProvider: {
      publisherId: 'open-pencil',
      packageDigest: `app-bundle-sha256:${await digest('package')}`,
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
}

async function migrationPlan(): Promise<MigrationPlan> {
  return {
    version: 1,
    planId: 'migration-plan-1',
    targetModelDigest: await digest('target-model'),
    operations: [],
    highestRisk: 'low',
    requiresBackup: false
  }
}

async function passedGates(): Promise<BackendProductionGateResultV1[]> {
  const evidenceDigest = await digest('verification-evidence')
  return BACKEND_PRODUCTION_GATE_IDS.map((gate) => ({
    gate,
    status: 'passed',
    checkedAt: NOW,
    evidenceDigest
  }))
}

async function runInput(): Promise<BackendHostReleaseRunInput> {
  return {
    releaseId: 'host-release-1',
    planId: 'host-plan-1',
    receiptId: 'host-receipt-1',
    requiredArtifactKinds: ['schema'],
    requiredEnvironmentNames: ['SUPABASE_URL'],
    requiredCredentialRefs: [CREDENTIAL_REF]
  }
}

async function fixtureDependencies(
  observedAuthority: BackendReleaseAuthorityV1,
  calls: string[],
  overrides: Partial<BackendHostReleaseControllerDependencies> = {}
): Promise<BackendHostReleaseControllerDependencies> {
  const schemaArtifactDigest = await digest('schema-artifact')
  const inspectedMigrationPlan = await migrationPlan()
  return {
    dispatchJournal: createMemoryBackendHostReleaseDispatchJournal(),
    reconciler: {
      async reconcile() {
        calls.push('reconcile')
        return {
          outcome: 'outcome-unknown',
          code: 'backend-release-reconciliation-pending',
          remoteOperationIds: []
        }
      }
    },
    inspector: {
      async inspect({ stage }) {
        calls.push(`inspect:${stage}`)
        return { authority: observedAuthority, migrationPlan: inspectedMigrationPlan }
      }
    },
    emitter: {
      async emit() {
        calls.push('emit')
        return {
          staticArtifactDigest: null,
          serverArtifactDigest: null,
          schemaArtifactDigest
        }
      }
    },
    reviewer: {
      review() {
        calls.push('review')
        return true
      },
      confirm() {
        calls.push('confirm')
        return []
      }
    },
    executor: {
      async prepareApply() {
        calls.push('prepare')
        return {
          async dispatch() {
            calls.push('apply')
            return { ok: true as const, remoteOperationIds: ['migration-remote-1'] }
          }
        }
      }
    },
    verifier: {
      async verify() {
        calls.push('verify')
        return passedGates()
      }
    },
    now: () => NOW,
    ...overrides
  }
}

describe('Backend Host Release Controller', () => {
  test('runs the injected success lifecycle and records a secret-free receipt', async () => {
    const calls: string[] = []
    const initialAuthority = await authority()
    let prepareInput: BackendHostReleasePrepareApplyInput | undefined
    let dispatchKey: string | undefined
    let latestTransition: { phase: string; dispatch: string } | undefined
    let dispatchedBeforeApply = false
    const dependencies = await fixtureDependencies(initialAuthority, calls, {
      executor: {
        async prepareApply(input) {
          calls.push('prepare')
          prepareInput = input
          return {
            async dispatch({ singleFlightKey }) {
              calls.push('apply')
              dispatchKey = singleFlightKey
              dispatchedBeforeApply =
                latestTransition?.phase === 'apply' && latestTransition.dispatch === 'dispatched'
              return { ok: true, remoteOperationIds: ['migration-remote-1'] }
            }
          }
        }
      }
    })
    let observerCalls = 0
    const state = await createBackendHostReleaseController(dependencies).run({
      ...(await runInput()),
      onTransition(transition) {
        latestTransition = transition
        observerCalls += 1
        if (observerCalls === 1) throw new Error('observer is not release authority')
      }
    })

    expect(calls).toEqual([
      'inspect:initial',
      'emit',
      'review',
      'confirm',
      'prepare',
      'inspect:pre-apply',
      'apply',
      'verify'
    ])
    expect(observerCalls).toBeGreaterThan(1)
    expect(state).toMatchObject({
      phase: 'receipt',
      outcome: 'succeeded',
      dispatch: 'settled',
      automaticRetryAllowed: false,
      reconcileRequired: false,
      releaseReady: true,
      backendDeploymentRequired: false
    })
    expect(state.receipt).toMatchObject({
      receiptId: 'host-receipt-1',
      outcome: 'succeeded',
      requiredCredentialRefs: [CREDENTIAL_REF],
      remoteOperationIds: ['migration-remote-1'],
      failure: null
    })
    expect(prepareInput?.requiredCredentialRefs).toEqual([CREDENTIAL_REF])
    expect(dispatchKey).toBe(
      prepareInput ? backendReleaseSingleFlightKey(prepareInput.plan) : undefined
    )
    expect(dispatchedBeforeApply).toBe(true)
    expect(JSON.stringify(state.receipt)).not.toContain('supabase-service-role-secret')
  })

  test('turns stale pre-apply authority into a failed receipt before executor dispatch', async () => {
    const calls: string[] = []
    const initialAuthority = await authority()
    const staleAuthority = await authority({ inspectedSchemaDigest: await digest('schema-drift') })
    const inspectedMigrationPlan = await migrationPlan()
    let inspections = 0
    let applyCalls = 0
    const dependencies = await fixtureDependencies(initialAuthority, calls, {
      inspector: {
        async inspect({ stage }) {
          calls.push(`inspect:${stage}`)
          inspections += 1
          return {
            authority: inspections === 1 ? initialAuthority : staleAuthority,
            migrationPlan: inspectedMigrationPlan
          }
        }
      },
      executor: {
        async prepareApply() {
          calls.push('prepare')
          return {
            async dispatch() {
              applyCalls += 1
              return { ok: true as const, remoteOperationIds: [] }
            }
          }
        }
      }
    })
    const state = await createBackendHostReleaseController(dependencies).run(await runInput())

    expect(applyCalls).toBe(0)
    expect(calls).toEqual([
      'inspect:initial',
      'emit',
      'review',
      'confirm',
      'prepare',
      'inspect:pre-apply'
    ])
    expect(state).toMatchObject({
      phase: 'receipt',
      outcome: 'failed',
      dispatch: 'not-dispatched',
      automaticRetryAllowed: false,
      reconcileRequired: false,
      failureCode: 'release-plan-stale'
    })
    expect(state.receipt).toMatchObject({
      outcome: 'failed',
      failure: { code: 'release-plan-stale', outcomeUnknown: false }
    })
  })

  test('binds the migration plan returned by Inspect and blocks pre-apply migration drift', async () => {
    const calls: string[] = []
    const initialAuthority = await authority()
    const initialMigrationPlan = await migrationPlan()
    const driftedMigrationPlan = {
      ...initialMigrationPlan,
      targetModelDigest: await digest('target-model-drift')
    }
    let inspections = 0
    let applyCalls = 0
    const dependencies = await fixtureDependencies(initialAuthority, calls, {
      inspector: {
        async inspect({ stage }) {
          calls.push(`inspect:${stage}`)
          inspections += 1
          return {
            authority: initialAuthority,
            migrationPlan: inspections === 1 ? initialMigrationPlan : driftedMigrationPlan
          }
        }
      },
      executor: {
        async prepareApply() {
          calls.push('prepare')
          return {
            async dispatch() {
              applyCalls += 1
              return { ok: true as const, remoteOperationIds: [] }
            }
          }
        }
      }
    })

    const state = await createBackendHostReleaseController(dependencies).run(await runInput())

    expect(applyCalls).toBe(0)
    expect(state).toMatchObject({
      phase: 'receipt',
      outcome: 'failed',
      dispatch: 'not-dispatched',
      failureCode: 'release-plan-stale'
    })
    expect(state.receipt).toMatchObject({
      outcome: 'failed',
      failure: { code: 'release-plan-stale', outcomeUnknown: false }
    })
  })

  test('records a failed receipt when the final pre-apply inspection is unavailable', async () => {
    const calls: string[] = []
    const initialAuthority = await authority()
    const inspectedMigrationPlan = await migrationPlan()
    let applyCalls = 0
    const dependencies = await fixtureDependencies(initialAuthority, calls, {
      inspector: {
        async inspect({ stage }) {
          calls.push(`inspect:${stage}`)
          if (stage === 'pre-apply') throw new Error('remote credential value')
          return { authority: initialAuthority, migrationPlan: inspectedMigrationPlan }
        }
      },
      executor: {
        async prepareApply() {
          calls.push('prepare')
          return {
            async dispatch() {
              applyCalls += 1
              return { ok: true as const, remoteOperationIds: [] }
            }
          }
        }
      }
    })

    const state = await createBackendHostReleaseController(dependencies).run(await runInput())

    expect(applyCalls).toBe(0)
    expect(state).toMatchObject({
      phase: 'receipt',
      outcome: 'failed',
      dispatch: 'not-dispatched',
      failureCode: 'backend-release-reinspection-failed'
    })
    expect(JSON.stringify(state.receipt)).not.toContain('remote credential value')
  })

  test('records a side-effect-free prepare failure without claiming remote dispatch', async () => {
    const calls: string[] = []
    const initialAuthority = await authority()
    const dependencies = await fixtureDependencies(initialAuthority, calls, {
      executor: {
        async prepareApply() {
          calls.push('prepare')
          throw new BackendHostReleaseApplyError('precondition', 'backend-credential-missing')
        }
      }
    })

    const state = await createBackendHostReleaseController(dependencies).run(await runInput())

    expect(calls).toEqual(['inspect:initial', 'emit', 'review', 'confirm', 'prepare'])
    expect(state).toMatchObject({
      phase: 'receipt',
      outcome: 'failed',
      dispatch: 'not-dispatched',
      automaticRetryAllowed: false,
      reconcileRequired: false,
      failureCode: 'backend-credential-missing'
    })
    expect(state.receipt).toMatchObject({
      outcome: 'failed',
      failure: { code: 'backend-credential-missing', outcomeUnknown: false }
    })
  })

  test('records secret-free failures for emit, review, and confirm exceptions', async () => {
    const canary = 'supabase-service-role-secret'
    const failureCodes = {
      emit: 'backend-release-emission-failed',
      review: 'backend-release-review-failed',
      confirm: 'backend-release-confirmation-failed'
    } as const
    for (const stage of ['emit', 'review', 'confirm'] as const) {
      const calls: string[] = []
      const initialAuthority = await authority()
      const reviewer = {
        review() {
          calls.push('review')
          if (stage === 'review') throw new Error(canary)
          return true
        },
        confirm() {
          calls.push('confirm')
          if (stage === 'confirm') throw new Error(canary)
          return []
        }
      }
      const overrides: Partial<BackendHostReleaseControllerDependencies> =
        stage === 'emit'
          ? {
              emitter: {
                async emit() {
                  calls.push('emit')
                  throw new Error(canary)
                }
              }
            }
          : { reviewer }
      const dependencies = await fixtureDependencies(initialAuthority, calls, overrides)
      const state = await createBackendHostReleaseController(dependencies).run({
        ...(await runInput()),
        releaseId: `host-release-${stage}`,
        planId: `host-plan-${stage}`,
        receiptId: `host-receipt-${stage}`
      })
      const code = failureCodes[stage]
      expect(state).toMatchObject({
        phase: 'receipt',
        outcome: 'failed',
        dispatch: 'not-dispatched',
        automaticRetryAllowed: false,
        failureCode: code
      })
      expect(state.receipt).toMatchObject({
        outcome: 'failed',
        failure: { code, outcomeUnknown: false }
      })
      expect(JSON.stringify(state.receipt)).not.toContain(canary)
      expect(calls).not.toContain('prepare')
    }
  })

  test('records a post-dispatch transport failure as outcome-unknown without retry', async () => {
    const calls: string[] = []
    const initialAuthority = await authority()
    let applyCalls = 0
    let verifyCalls = 0
    const dependencies = await fixtureDependencies(initialAuthority, calls, {
      executor: {
        async prepareApply() {
          calls.push('prepare')
          return {
            async dispatch() {
              calls.push('apply')
              applyCalls += 1
              throw new Error('supabase-service-role-secret')
            }
          }
        }
      },
      verifier: {
        async verify() {
          verifyCalls += 1
          return passedGates()
        }
      }
    })
    const state = await createBackendHostReleaseController(dependencies).run(await runInput())

    expect(applyCalls).toBe(1)
    expect(verifyCalls).toBe(0)
    expect(state).toMatchObject({
      phase: 'receipt',
      outcome: 'outcome-unknown',
      dispatch: 'settled',
      automaticRetryAllowed: false,
      reconcileRequired: true,
      failureCode: 'backend-release-apply-transport'
    })
    expect(state.receipt).toMatchObject({
      outcome: 'outcome-unknown',
      failure: { code: 'backend-release-apply-transport', outcomeUnknown: true }
    })
    expect(JSON.stringify(state.receipt)).not.toContain('supabase-service-role-secret')
  })

  test('converts verification exceptions into failed gates and a blocked receipt', async () => {
    const calls: string[] = []
    const initialAuthority = await authority()
    const dependencies = await fixtureDependencies(initialAuthority, calls, {
      verifier: {
        async verify() {
          calls.push('verify')
          throw new Error('verification probe unavailable')
        }
      }
    })
    const state = await createBackendHostReleaseController(dependencies).run(await runInput())

    expect(state).toMatchObject({
      phase: 'receipt',
      outcome: 'blocked',
      dispatch: 'settled',
      automaticRetryAllowed: false,
      releaseReady: false,
      backendDeploymentRequired: true
    })
    expect(state.gates).toHaveLength(BACKEND_PRODUCTION_GATE_IDS.length)
    expect(state.gates.every((gate) => gate.status === 'failed')).toBe(true)
    expect(state.receipt).toMatchObject({
      outcome: 'blocked',
      backendDeploymentRequired: true,
      failure: null
    })
  })

  test('snapshots artifact requirements before the asynchronous initial inspection', async () => {
    const calls: string[] = []
    const initialAuthority = await authority()
    const input = await runInput()
    const mutableKinds: Array<'schema' | 'server'> = ['schema']
    let releaseInspection: (() => void) | undefined
    const inspectionStarted = new Promise<void>((resolve) => {
      releaseInspection = resolve
    })
    let continueInspection: (() => void) | undefined
    const inspectionBarrier = new Promise<void>((resolve) => {
      continueInspection = resolve
    })
    const dependencies = await fixtureDependencies(initialAuthority, calls, {
      inspector: {
        async inspect({ stage }) {
          calls.push(`inspect:${stage}`)
          if (stage === 'initial') {
            releaseInspection?.()
            await inspectionBarrier
          }
          return { authority: initialAuthority, migrationPlan: await migrationPlan() }
        }
      }
    })
    const run = createBackendHostReleaseController(dependencies).run({
      ...input,
      requiredArtifactKinds: mutableKinds
    })
    await inspectionStarted
    mutableKinds.push('server')
    continueInspection?.()
    const state = await run

    expect(state.plan?.requiredArtifactKinds).toEqual(['schema'])
  })
})
