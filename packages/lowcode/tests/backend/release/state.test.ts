import { describe, expect, test } from 'bun:test'

import {
  BACKEND_PRODUCTION_GATE_IDS,
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
    documentDigest: await digest('state-document'),
    irDigest: await digest('state-ir'),
    inspectedSchemaDigest: await digest('state-schema'),
    compilerVersion: '0.15.0',
    target: 'project-main',
    environment: 'production',
    projectId: 'project-1',
    accountId: 'account-1',
    grantGeneration: 'grant-1',
    backendProvider: {
      publisherId: 'open-pencil',
      packageDigest: `app-bundle-sha256:${await digest('state-package')}`,
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
    planId: 'state-plan-1',
    authority,
    migrationPlan,
    requiredArtifactKinds: ['server', 'schema'],
    requiredEnvironmentNames: ['BACKEND_ADMIN_TOKEN'],
    requiredCredentialRefs: ['credential.123e4567-e89b-42d3-a456-426614174000']
  })
}

async function passedGates(): Promise<BackendProductionGateResultV1[]> {
  const evidenceDigest = await digest('state-gate-evidence')
  return BACKEND_PRODUCTION_GATE_IDS.map((gate) => ({
    gate,
    status: 'passed',
    checkedAt: NOW,
    evidenceDigest
  }))
}

function expectDeepFrozen(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  expect(Object.isFrozen(value)).toBe(true)
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if ('value' in descriptor) expectDeepFrozen(descriptor.value, seen)
  }
}

async function releaseLifecycle() {
  const plan = await fixturePlan()
  const initial = createBackendReleaseState('state-release-1')
  const inspected = reduceBackendReleaseState(initial, {
    type: 'inspection-completed',
    authority: plan.authority
  })
  const planned = reduceBackendReleaseState(inspected, { type: 'plan-created', plan })
  const emitted = reduceBackendReleaseState(planned, {
    type: 'artifacts-emitted',
    planDigest: plan.planDigest,
    artifacts: {
      staticArtifactDigest: null,
      serverArtifactDigest: await digest('state-server-artifact'),
      schemaArtifactDigest: await digest('state-schema-artifact')
    }
  })
  const destructiveOperationIds = plan.migration.operations
    .filter((operation) => operation.risk === 'destructive')
    .map((operation) => operation.operationId)
  const reviewed = reduceBackendReleaseState(emitted, {
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
      providerRecoveryDescription: 'Restore the snapshot and inspect drift before another Apply.',
      confirmedAt: NOW
    })
  )
  const confirmed = reduceBackendReleaseState(reviewed, {
    type: 'release-confirmed',
    planDigest: plan.planDigest,
    confirmations
  })
  const reinspected = reduceBackendReleaseState(confirmed, {
    type: 'apply-reinspection-completed',
    snapshot: { planDigest: plan.planDigest, authority: plan.authority }
  })
  const dispatched = reduceBackendReleaseState(reinspected, {
    type: 'apply-dispatched',
    planDigest: plan.planDigest,
    singleFlightKey: backendReleaseSingleFlightKey(plan),
    dispatchedAt: NOW
  })
  const applied = reduceBackendReleaseState(dispatched, {
    type: 'apply-completed',
    planDigest: plan.planDigest,
    remoteOperationIds: ['remote-operation-1'],
    completedAt: NOW
  })
  const verified = reduceBackendReleaseState(applied, {
    type: 'verification-completed',
    planDigest: plan.planDigest,
    gates: await passedGates(),
    verifiedAt: NOW
  })
  const receipt = createBackendReleaseReceipt(verified, { receiptId: 'state-receipt-1' })
  const recorded = reduceBackendReleaseState(verified, { type: 'receipt-recorded', receipt })
  const cancelled = reduceBackendReleaseState(confirmed, {
    type: 'cancel-requested',
    reasonCode: 'operator-cancelled',
    cancelledAt: NOW
  })
  const uncertain = reduceBackendReleaseState(dispatched, {
    type: 'apply-error',
    planDigest: plan.planDigest,
    kind: 'transport',
    code: 'provider-transport-error',
    occurredAt: NOW,
    remoteOperationIds: ['remote-operation-1']
  })
  return {
    plan,
    initial,
    inspected,
    planned,
    emitted,
    reviewed,
    confirmed,
    reinspected,
    dispatched,
    applied,
    verified,
    recorded,
    cancelled,
    uncertain,
    receipt
  }
}

describe('Backend Release state authority and receipt semantics', () => {
  test('deep-freezes the initial state and every reducer transition', async () => {
    const lifecycle = await releaseLifecycle()
    const states: BackendReleaseStateV1[] = [
      lifecycle.initial,
      lifecycle.inspected,
      lifecycle.planned,
      lifecycle.emitted,
      lifecycle.reviewed,
      lifecycle.confirmed,
      lifecycle.reinspected,
      lifecycle.dispatched,
      lifecycle.applied,
      lifecycle.verified,
      lifecycle.recorded,
      lifecycle.cancelled,
      lifecycle.uncertain
    ]
    for (const state of states) expectDeepFrozen(state)

    expect(lifecycle.applied.backendDeploymentRequired).toBe(true)
    expect(lifecycle.verified.backendDeploymentRequired).toBe(false)
    expect(Object.isFrozen(lifecycle.confirmed.confirmations)).toBe(true)
    expect(Object.isFrozen(lifecycle.confirmed.confirmations[0])).toBe(true)
    expect(Reflect.set(lifecycle.initial, 'phase', 'apply')).toBe(false)
    expect(() =>
      Reflect.apply(Array.prototype.push, lifecycle.confirmed.confirmations, [{}])
    ).toThrow()
    const confirmation = lifecycle.confirmed.confirmations[0]
    expect(confirmation).toBeDefined()
    if (confirmation) expect(Reflect.set(confirmation, 'confirmed', false)).toBe(false)
  })

  test('rejects cloned, tampered, and manually forged incoming states', async () => {
    const publicAPI = await import('@open-pencil/lowcode/backend')
    expect('sealBackendReleaseState' in publicAPI).toBe(false)
    expect('rehydrateBackendReleaseState' in publicAPI).toBe(false)

    const initial = createBackendReleaseState('state-authority-release')
    const event = {
      type: 'cancel-requested' as const,
      reasonCode: 'operator-cancelled',
      cancelledAt: NOW
    }
    const cloned = structuredClone(initial)
    expect(() => reduceBackendReleaseState(cloned, event)).toThrow('authenticated live state')

    const forged = Object.freeze({ ...initial })
    expect(Object.isFrozen(forged)).toBe(true)
    expect(() => reduceBackendReleaseState(forged, event)).toThrow('authenticated live state')

    const tampered = structuredClone(initial)
    expect(Reflect.set(tampered, 'phase', 'apply')).toBe(true)
    Object.freeze(tampered)
    expect(() => reduceBackendReleaseState(tampered, event)).toThrow('authenticated live state')

    const lifecycle = await releaseLifecycle()
    expect(() =>
      createBackendReleaseReceipt(structuredClone(lifecycle.verified), {
        receiptId: 'forged-state-receipt'
      })
    ).toThrow('authenticated live Backend Release state')
  })

  test('rejects contradictory release readiness in the public receipt validator', async () => {
    const { receipt } = await releaseLifecycle()
    expect(validateBackendReleaseReceipt(receipt).ok).toBe(true)
    const secretCanary = `credential.${stripeSecretCanary('0123456789abcdefghijklmnopqrstuvwxyz')}`
    const secretBearing = { ...receipt, requiredCredentialRefs: [secretCanary] }
    const secretResult = validateBackendReleaseReceipt(secretBearing)
    expect(secretResult.ok).toBe(false)
    expect(JSON.stringify(secretResult)).not.toContain(secretCanary)
    for (const secretField of [
      { ...receipt, receiptId: secretCanary },
      { ...receipt, remoteOperationIds: [secretCanary] }
    ]) {
      const result = validateBackendReleaseReceipt(secretField)
      expect(result.ok).toBe(false)
      expect(JSON.stringify(result)).not.toContain(secretCanary)
    }
    const unknownGates = receipt.gates.map((gate, index) =>
      index === 0
        ? { ...gate, status: 'unknown' as const, checkedAt: null, evidenceDigest: null }
        : gate
    )
    const contradictoryReceipts = [
      { ...receipt, gates: unknownGates },
      { ...receipt, backendDeploymentRequired: true },
      {
        ...receipt,
        outcome: 'blocked' as const,
        backendDeploymentRequired: true
      },
      {
        ...receipt,
        outcome: 'outcome-unknown' as const,
        backendDeploymentRequired: true,
        verifiedAt: null,
        failure: { code: 'provider-timeout', outcomeUnknown: true }
      },
      {
        ...receipt,
        outcome: 'blocked' as const,
        gates: unknownGates,
        backendDeploymentRequired: false
      }
    ]
    for (const contradictory of contradictoryReceipts) {
      const result = validateBackendReleaseReceipt(contradictory)
      expect(result.ok).toBe(false)
      expect(result.diagnostics[0]?.code).toBe('backend-release-receipt-invalid')
    }
  })

  test('does not invoke receipt accessors or echo secret-like object keys', async () => {
    const { receipt } = await releaseLifecycle()
    let getterCalls = 0
    const hostile = { ...receipt }
    Object.defineProperty(hostile, 'backendProvider', {
      enumerable: true,
      get() {
        getterCalls++
        return receipt.backendProvider
      }
    })
    expect(validateBackendReleaseReceipt(hostile).ok).toBe(false)
    expect(getterCalls).toBe(0)

    const secretKeyCanary = stripeSecretCanary('receiptobjectkey1234567890')
    let secretKeyGetterCalls = 0
    const hostileKey = { ...receipt }
    Object.defineProperty(hostileKey, secretKeyCanary, {
      enumerable: true,
      get() {
        secretKeyGetterCalls++
        return 'must-not-be-read'
      }
    })
    const secretKeyResult = validateBackendReleaseReceipt(hostileKey)
    expect(secretKeyResult.ok).toBe(false)
    expect(JSON.stringify(secretKeyResult)).not.toContain(secretKeyCanary)
    expect(secretKeyGetterCalls).toBe(0)
  })
})
