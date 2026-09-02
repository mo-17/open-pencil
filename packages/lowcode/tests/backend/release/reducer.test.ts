import { describe, expect, test } from 'bun:test'

import {
  BACKEND_PRODUCTION_GATE_IDS,
  assessFrontendDeployment,
  backendReleaseSingleFlightKey,
  createBackendReleasePlan,
  createBackendReleaseReceipt,
  createBackendReleaseState,
  planBackendMigration,
  reduceBackendReleaseState,
  validateBackendReleaseReceipt,
  type BackendProductionGateResultV1,
  type BackendReleaseAuthorityV1,
  type BackendReleaseDestructiveConfirmationV1,
  type BackendReleaseStateV1,
  type VerifiedBackendReleasePlanV1
} from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import { backendModelFixture, stripeSecretCanary } from '../fixture'

const NOW = '2026-08-30T00:00:00Z'

async function digest(label: string): Promise<string> {
  return digestCanonicalManifest({ label })
}

async function fixturePlan(): Promise<VerifiedBackendReleasePlanV1> {
  const authority: BackendReleaseAuthorityV1 = {
    documentDigest: await digest('document'),
    irDigest: await digest('ir'),
    inspectedSchemaDigest: await digest('schema'),
    compilerVersion: '0.15.0',
    target: 'project-main',
    environment: 'production',
    projectId: 'project-1',
    accountId: 'account-1',
    grantGeneration: 'grant-1',
    backendProvider: {
      publisherId: 'open-pencil',
      packageDigest: `app-bundle-sha256:${await digest('package')}`,
      pluginId: 'open-pencil.backend-provider',
      contributionId: 'backend-provider',
      providerId: 'fake-provider',
      adapterId: 'fake-adapter',
      adapterVersion: '1.0.0',
      contractVersion: 1,
      supportedModelVersions: [1],
      capabilities: ['migrations.schema'],
      permissions: [],
      outputKinds: ['database-schema', 'server-runtime']
    }
  }
  const migrationPlan = await planBackendMigration(backendModelFixture(), {
    version: 1,
    entities: [],
    enums: [],
    relations: []
  })
  return createBackendReleasePlan({
    planId: 'plan-1',
    authority,
    migrationPlan,
    requiredArtifactKinds: ['server', 'schema'],
    requiredEnvironmentNames: ['BACKEND_ADMIN_TOKEN'],
    requiredCredentialRefs: ['credential.123e4567-e89b-42d3-a456-426614174000']
  })
}

async function advanceToApply(plan: VerifiedBackendReleasePlanV1): Promise<BackendReleaseStateV1> {
  let state = await advanceToReview(plan)
  const destructiveOperationIds = plan.migration.operations
    .filter((operation) => operation.risk === 'destructive')
    .map((operation) => operation.operationId)
  state = reduceBackendReleaseState(state, {
    type: 'review-completed',
    review: {
      planDigest: plan.planDigest,
      reviewedAt: NOW,
      destructiveOperationIds,
      backupRequired: true
    }
  })
  const confirmations: BackendReleaseDestructiveConfirmationV1[] = destructiveOperationIds.map(
    (operationId) => ({
      planDigest: plan.planDigest,
      operationId,
      confirmed: true,
      backendProviderId: plan.authority.backendProvider.providerId,
      backupDescription: 'Verified snapshot created before dispatch.',
      providerRecoveryDescription: 'Restore snapshot through the provider and then inspect drift.',
      confirmedAt: NOW
    })
  )
  return reduceBackendReleaseState(state, {
    type: 'release-confirmed',
    planDigest: plan.planDigest,
    confirmations
  })
}

async function advanceToReview(plan: VerifiedBackendReleasePlanV1): Promise<BackendReleaseStateV1> {
  let state = createBackendReleaseState('release-1')
  state = reduceBackendReleaseState(state, {
    type: 'inspection-completed',
    authority: plan.authority
  })
  state = reduceBackendReleaseState(state, { type: 'plan-created', plan })
  state = reduceBackendReleaseState(state, {
    type: 'artifacts-emitted',
    planDigest: plan.planDigest,
    artifacts: {
      staticArtifactDigest: null,
      serverArtifactDigest: await digest('server-artifact'),
      schemaArtifactDigest: await digest('schema-artifact')
    }
  })
  return state
}

async function passedGates(): Promise<BackendProductionGateResultV1[]> {
  const evidenceDigest = await digest('gate-evidence')
  return BACKEND_PRODUCTION_GATE_IDS.map((gate) => ({
    gate,
    status: 'passed',
    checkedAt: NOW,
    evidenceDigest
  }))
}

describe('Backend Release pure reducer and receipt', () => {
  test('rejects an unverified plan with tampered migration and unchanged digest', async () => {
    const plan = await fixturePlan()
    const tampered = {
      ...structuredClone(plan),
      migration: {
        ...structuredClone(plan.migration),
        operations: plan.migration.operations.map((operation, index) =>
          index === 0 ? { ...operation, kind: 'rewrite-data' } : operation
        )
      }
    }
    let state = createBackendReleaseState('tampered-release')
    state = reduceBackendReleaseState(state, {
      type: 'inspection-completed',
      authority: plan.authority
    })
    expect(() =>
      Reflect.apply(reduceBackendReleaseState, undefined, [
        state,
        { type: 'plan-created', plan: tampered }
      ])
    ).toThrow('digest-verified and deeply frozen')
  })

  test('rejects false confirmations and accessor or extension data at reducer boundaries', async () => {
    const plan = await fixturePlan()
    const reviewState = await advanceToReview(plan)
    const destructiveOperationIds = plan.migration.operations
      .filter((operation) => operation.risk === 'destructive')
      .map((operation) => operation.operationId)
    expect(destructiveOperationIds.length).toBeGreaterThan(0)
    const review = {
      planDigest: plan.planDigest,
      reviewedAt: NOW,
      destructiveOperationIds,
      backupRequired: true
    }
    expect(() =>
      Reflect.apply(reduceBackendReleaseState, undefined, [
        reviewState,
        {
          type: 'review-completed',
          review: { ...review, secretValue: 'must-not-enter-state' }
        }
      ])
    ).toThrow('unsupported fields')

    let reviewGetterCalls = 0
    const accessorReview = { ...review }
    Object.defineProperty(accessorReview, 'reviewedAt', {
      enumerable: true,
      get() {
        reviewGetterCalls++
        return NOW
      }
    })
    expect(() =>
      Reflect.apply(reduceBackendReleaseState, undefined, [
        reviewState,
        { type: 'review-completed', review: accessorReview }
      ])
    ).toThrow('enumerable data property')
    expect(reviewGetterCalls).toBe(0)

    const confirmState = reduceBackendReleaseState(reviewState, {
      type: 'review-completed',
      review
    })
    const destructiveOperationId = destructiveOperationIds[0]
    if (!destructiveOperationId) throw new Error('Fixture requires a destructive operation')
    const confirmation = {
      planDigest: plan.planDigest,
      operationId: destructiveOperationId,
      confirmed: true as const,
      backendProviderId: plan.authority.backendProvider.providerId,
      backupDescription: 'Verified snapshot created before dispatch.',
      providerRecoveryDescription: 'Restore the provider snapshot, then inspect drift.',
      confirmedAt: NOW
    }
    for (const substituted of [
      { ...confirmation, confirmed: false },
      { ...confirmation, secretValue: 'must-not-enter-state' },
      {
        ...confirmation,
        backupDescription: stripeSecretCanary('0123456789abcdefghijklmnopqrstuvwxyz')
      },
      { ...confirmation, confirmedAt: '2026-02-30T00:00:00Z' }
    ]) {
      expect(() =>
        Reflect.apply(reduceBackendReleaseState, undefined, [
          confirmState,
          {
            type: 'release-confirmed',
            planDigest: plan.planDigest,
            confirmations: [substituted]
          }
        ])
      ).toThrow()
    }
    const sparseConfirmations: unknown[] = []
    sparseConfirmations.length = 1
    expect(() =>
      Reflect.apply(reduceBackendReleaseState, undefined, [
        confirmState,
        {
          type: 'release-confirmed',
          planDigest: plan.planDigest,
          confirmations: sparseConfirmations
        }
      ])
    ).toThrow('enumerable data property')

    let confirmationGetterCalls = 0
    const accessorConfirmation = { ...confirmation }
    Object.defineProperty(accessorConfirmation, 'backupDescription', {
      enumerable: true,
      get() {
        confirmationGetterCalls++
        return confirmation.backupDescription
      }
    })
    expect(() =>
      Reflect.apply(reduceBackendReleaseState, undefined, [
        confirmState,
        {
          type: 'release-confirmed',
          planDigest: plan.planDigest,
          confirmations: [accessorConfirmation]
        }
      ])
    ).toThrow('enumerable data property')
    expect(confirmationGetterCalls).toBe(0)

    let verifyState = await advanceToApply(plan)
    verifyState = reduceBackendReleaseState(verifyState, {
      type: 'apply-reinspection-completed',
      snapshot: { planDigest: plan.planDigest, authority: plan.authority }
    })
    verifyState = reduceBackendReleaseState(verifyState, {
      type: 'apply-dispatched',
      planDigest: plan.planDigest,
      singleFlightKey: backendReleaseSingleFlightKey(plan),
      dispatchedAt: NOW
    })
    verifyState = reduceBackendReleaseState(verifyState, {
      type: 'apply-completed',
      planDigest: plan.planDigest,
      remoteOperationIds: [],
      completedAt: NOW
    })
    const passed = await passedGates()
    const gatesWithExtension = passed.map((gate, index) =>
      index === 0 ? { ...gate, secretValue: 'must-not-enter-state' } : gate
    )
    expect(() =>
      Reflect.apply(reduceBackendReleaseState, undefined, [
        verifyState,
        {
          type: 'verification-completed',
          planDigest: plan.planDigest,
          gates: gatesWithExtension,
          verifiedAt: NOW
        }
      ])
    ).toThrow('unsupported fields')

    let gateGetterCalls = 0
    const accessorGate = { ...passed[0] }
    Object.defineProperty(accessorGate, 'status', {
      enumerable: true,
      get() {
        gateGetterCalls++
        return 'passed'
      }
    })
    expect(() =>
      Reflect.apply(reduceBackendReleaseState, undefined, [
        verifyState,
        {
          type: 'verification-completed',
          planDigest: plan.planDigest,
          gates: [accessorGate, ...passed.slice(1)],
          verifiedAt: NOW
        }
      ])
    ).toThrow('enumerable data property')
    expect(gateGetterCalls).toBe(0)
  })

  test('rejects accessor, symbol, prototype, and sparse data across every event envelope', () => {
    const state = createBackendReleaseState('event-envelope-release')
    const eventFields = [
      ['inspection-completed', 'authority'],
      ['plan-created', 'plan'],
      ['artifacts-emitted', 'artifacts'],
      ['review-completed', 'review'],
      ['release-confirmed', 'confirmations'],
      ['apply-reinspection-completed', 'snapshot'],
      ['apply-dispatched', 'dispatchedAt'],
      ['apply-completed', 'remoteOperationIds'],
      ['apply-reconciled', 'reconciledAt'],
      ['apply-error', 'occurredAt'],
      ['release-error', 'occurredAt'],
      ['cancel-requested', 'cancelledAt'],
      ['verification-completed', 'gates'],
      ['receipt-recorded', 'receipt']
    ] as const
    let getterCalls = 0
    const hostileGetter = () => {
      getterCalls++
      return null
    }
    for (const [type, field] of eventFields) {
      const hostile = { type }
      Object.defineProperty(hostile, field, {
        enumerable: true,
        get: hostileGetter
      })
      expect(() => Reflect.apply(reduceBackendReleaseState, undefined, [state, hostile])).toThrow(
        'enumerable data property'
      )
    }
    expect(getterCalls).toBe(0)

    const symbolEvent = {
      type: 'cancel-requested',
      reasonCode: 'operator-cancelled',
      cancelledAt: NOW
    }
    Object.defineProperty(symbolEvent, Symbol('secret'), { enumerable: true, value: 'hidden' })
    expect(() => Reflect.apply(reduceBackendReleaseState, undefined, [state, symbolEvent])).toThrow(
      'symbol keys'
    )

    const inheritedEvent = {
      type: 'cancel-requested',
      reasonCode: 'operator-cancelled',
      cancelledAt: NOW
    }
    Object.setPrototypeOf(inheritedEvent, { inherited: true })
    expect(() =>
      Reflect.apply(reduceBackendReleaseState, undefined, [state, inheritedEvent])
    ).toThrow('plain data object')
  })

  test('permits safe pre-dispatch cancel but rejects cancellation after dispatch', async () => {
    const plan = await fixturePlan()
    const beforeDispatch = await advanceToApply(plan)
    const cancelled = reduceBackendReleaseState(beforeDispatch, {
      type: 'cancel-requested',
      reasonCode: 'operator-cancelled',
      cancelledAt: NOW
    })
    expect(cancelled).toMatchObject({
      phase: 'receipt',
      outcome: 'cancelled',
      dispatch: 'not-dispatched',
      automaticRetryAllowed: false
    })

    let dispatched = reduceBackendReleaseState(beforeDispatch, {
      type: 'apply-reinspection-completed',
      snapshot: { planDigest: plan.planDigest, authority: plan.authority }
    })
    dispatched = reduceBackendReleaseState(dispatched, {
      type: 'apply-dispatched',
      planDigest: plan.planDigest,
      singleFlightKey: backendReleaseSingleFlightKey(plan),
      dispatchedAt: NOW
    })
    expect(() =>
      reduceBackendReleaseState(dispatched, {
        type: 'cancel-requested',
        reasonCode: 'too-late',
        cancelledAt: NOW
      })
    ).toThrow('unknown remote outcome')
    expect(() =>
      reduceBackendReleaseState(dispatched, {
        type: 'release-error',
        planDigest: plan.planDigest,
        code: 'too-late',
        occurredAt: NOW
      })
    ).toThrow('post-dispatch failure')
  })

  test('requires fresh authority and a project/account/grant scoped single-flight key', async () => {
    const plan = await fixturePlan()
    const state = await advanceToApply(plan)
    expect(() =>
      reduceBackendReleaseState(state, {
        type: 'apply-reinspection-completed',
        snapshot: {
          planDigest: plan.planDigest,
          authority: { ...plan.authority, target: 'stale-target' }
        }
      })
    ).toThrow('stale authority: target')

    const inspected = reduceBackendReleaseState(state, {
      type: 'apply-reinspection-completed',
      snapshot: { planDigest: plan.planDigest, authority: plan.authority }
    })
    expect(() =>
      reduceBackendReleaseState(inspected, {
        type: 'apply-dispatched',
        planDigest: plan.planDigest,
        singleFlightKey: 'backend-release-v1:wrong',
        dispatchedAt: NOW
      })
    ).toThrow('Single-flight key')
    expect(backendReleaseSingleFlightKey(plan)).toContain('project-1:account-1:grant-1')
  })

  test('maps post-dispatch timeout to outcome-unknown and records no secret-bearing receipt fields', async () => {
    const plan = await fixturePlan()
    let state = await advanceToApply(plan)
    state = reduceBackendReleaseState(state, {
      type: 'apply-reinspection-completed',
      snapshot: { planDigest: plan.planDigest, authority: plan.authority }
    })
    state = reduceBackendReleaseState(state, {
      type: 'apply-dispatched',
      planDigest: plan.planDigest,
      singleFlightKey: backendReleaseSingleFlightKey(plan),
      dispatchedAt: NOW
    })
    state = reduceBackendReleaseState(state, {
      type: 'apply-error',
      planDigest: plan.planDigest,
      kind: 'timeout',
      code: 'provider-timeout',
      occurredAt: NOW,
      remoteOperationIds: ['remote-op-1']
    })
    expect(state).toMatchObject({
      phase: 'receipt',
      outcome: 'outcome-unknown',
      automaticRetryAllowed: false,
      reconcileRequired: true,
      backendDeploymentRequired: true
    })

    const receipt = createBackendReleaseReceipt(state, { receiptId: 'receipt-1' })
    expect(validateBackendReleaseReceipt(receipt).ok).toBe(true)
    const serialized = JSON.stringify(receipt)
    expect(serialized).not.toContain('Verified snapshot created')
    expect(serialized).not.toContain('Restore snapshot')
    expect(serialized).not.toContain('secretValue')
    expect(receipt.failure).toEqual({ code: 'provider-timeout', outcomeUnknown: true })

    const unsafe = { ...receipt, secretValue: 'must-not-be-recorded' }
    expect(validateBackendReleaseReceipt(unsafe).ok).toBe(false)
  })

  test('blocks production receipt on unknown gates and succeeds only after all gates pass', async () => {
    const plan = await fixturePlan()
    let applied = await advanceToApply(plan)
    applied = reduceBackendReleaseState(applied, {
      type: 'apply-reinspection-completed',
      snapshot: { planDigest: plan.planDigest, authority: plan.authority }
    })
    applied = reduceBackendReleaseState(applied, {
      type: 'apply-dispatched',
      planDigest: plan.planDigest,
      singleFlightKey: backendReleaseSingleFlightKey(plan),
      dispatchedAt: NOW
    })
    applied = reduceBackendReleaseState(applied, {
      type: 'apply-completed',
      planDigest: plan.planDigest,
      remoteOperationIds: ['remote-op-1'],
      completedAt: NOW
    })

    const blocked = reduceBackendReleaseState(applied, {
      type: 'verification-completed',
      planDigest: plan.planDigest,
      gates: [],
      verifiedAt: NOW
    })
    expect(blocked).toMatchObject({ outcome: 'blocked', releaseReady: false })
    expect(
      blocked.gates.find((gate) => gate.gate === 'target-capabilities-supported')
    ).toMatchObject({ status: 'unknown' })

    const succeeded = reduceBackendReleaseState(applied, {
      type: 'verification-completed',
      planDigest: plan.planDigest,
      gates: await passedGates(),
      verifiedAt: NOW
    })
    expect(succeeded).toMatchObject({
      phase: 'receipt',
      outcome: 'succeeded',
      releaseReady: true,
      backendDeploymentRequired: false
    })
    const receipt = createBackendReleaseReceipt(succeeded, { receiptId: 'receipt-success' })
    const recorded = reduceBackendReleaseState(succeeded, {
      type: 'receipt-recorded',
      receipt
    })
    expect(recorded.receipt?.receiptId).toBe('receipt-success')

    const substitutedOperationDigest = await digest('substituted-operation')
    const substitutedReceipts = [
      {
        ...receipt,
        backendProvider: {
          ...receipt.backendProvider,
          packageDigest: `sha256:${await digest('substituted-package')}`
        }
      },
      {
        ...receipt,
        artifacts: {
          ...receipt.artifacts,
          schemaArtifactDigest: await digest('substituted-schema-artifact')
        }
      },
      {
        ...receipt,
        migration: {
          ...receipt.migration,
          operations: receipt.migration.operations.map((operation, index) =>
            index === 0 ? { ...operation, checksum: substitutedOperationDigest } : operation
          )
        }
      }
    ]
    for (const substituted of substitutedReceipts) {
      expect(validateBackendReleaseReceipt(substituted).ok).toBe(true)
      expect(() =>
        reduceBackendReleaseState(succeeded, {
          type: 'receipt-recorded',
          receipt: substituted
        })
      ).toThrow('does not bind this release state')
    }
  })

  test('never reports a frontend-only deployment as a complete application release', () => {
    expect(
      assessFrontendDeployment({
        frontendHostingProvider: 'static-host',
        backendProvider: 'fake-provider',
        frontendDeployed: true,
        backendRequired: true,
        backendDeployed: false
      })
    ).toEqual({
      frontendHostingProvider: 'static-host',
      backendProvider: 'fake-provider',
      frontendDeployed: true,
      backendDeploymentRequired: true,
      applicationReleaseComplete: false
    })
  })
})
