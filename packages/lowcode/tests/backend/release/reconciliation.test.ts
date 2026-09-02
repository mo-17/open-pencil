import { describe, expect, test } from 'bun:test'

import {
  backendReleaseSingleFlightKey,
  createBackendReleasePlan,
  createBackendReleaseState,
  reduceBackendReleaseState,
  type BackendReleaseAuthorityV1,
  type BackendReleaseStateV1,
  type VerifiedBackendReleasePlanV1
} from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

const NOW = '2026-08-30T10:00:00.000Z'

async function digest(label: string): Promise<string> {
  return digestCanonicalManifest({ label })
}

async function plan(): Promise<VerifiedBackendReleasePlanV1> {
  const authority: BackendReleaseAuthorityV1 = {
    documentDigest: await digest('reconcile-document'),
    irDigest: await digest('reconcile-ir'),
    inspectedSchemaDigest: await digest('reconcile-schema'),
    compilerVersion: '0.15.0',
    target: 'react',
    environment: 'staging',
    projectId: 'reconcile-project',
    accountId: 'reconcile-account',
    grantGeneration: 'reconcile-grant',
    backendProvider: {
      publisherId: 'open-pencil',
      packageDigest: `app-bundle-sha256:${await digest('reconcile-package')}`,
      pluginId: 'open-pencil.reconcile-provider',
      contributionId: 'reconcile-provider',
      providerId: 'reconcile-provider',
      adapterId: 'reconcile-adapter',
      adapterVersion: '1.0.0',
      contractVersion: 1,
      supportedModelVersions: [1],
      capabilities: ['migrations.schema'],
      permissions: [],
      outputKinds: ['migration-plan']
    }
  }
  return createBackendReleasePlan({
    planId: 'reconcile-plan',
    authority,
    migrationPlan: {
      version: 1,
      planId: 'reconcile-migration-plan',
      targetModelDigest: await digest('reconcile-target'),
      operations: [],
      highestRisk: 'low',
      requiresBackup: false
    },
    requiredArtifactKinds: ['schema']
  })
}

async function applyState(
  releasePlan: VerifiedBackendReleasePlanV1
): Promise<BackendReleaseStateV1> {
  let state = createBackendReleaseState('reconcile-release')
  state = reduceBackendReleaseState(state, {
    type: 'inspection-completed',
    authority: releasePlan.authority
  })
  state = reduceBackendReleaseState(state, { type: 'plan-created', plan: releasePlan })
  state = reduceBackendReleaseState(state, {
    type: 'artifacts-emitted',
    planDigest: releasePlan.planDigest,
    artifacts: {
      staticArtifactDigest: null,
      serverArtifactDigest: null,
      schemaArtifactDigest: await digest('reconcile-schema-artifact')
    }
  })
  state = reduceBackendReleaseState(state, {
    type: 'review-completed',
    review: {
      planDigest: releasePlan.planDigest,
      reviewedAt: NOW,
      destructiveOperationIds: [],
      backupRequired: false
    }
  })
  state = reduceBackendReleaseState(state, {
    type: 'release-confirmed',
    planDigest: releasePlan.planDigest,
    confirmations: []
  })
  return reduceBackendReleaseState(state, {
    type: 'apply-reinspection-completed',
    snapshot: { planDigest: releasePlan.planDigest, authority: releasePlan.authority }
  })
}

describe('Backend Release reconciled Apply state', () => {
  test('moves an already-applied journal claim directly to Verify without a dispatch event', async () => {
    const releasePlan = await plan()
    const state = reduceBackendReleaseState(await applyState(releasePlan), {
      type: 'apply-reconciled',
      planDigest: releasePlan.planDigest,
      singleFlightKey: backendReleaseSingleFlightKey(releasePlan),
      outcome: 'applied',
      code: null,
      remoteOperationIds: ['remote-1'],
      reconciledAt: NOW
    })

    expect(state).toMatchObject({
      phase: 'verify',
      outcome: 'pending',
      dispatch: 'settled',
      automaticRetryAllowed: false,
      reconcileRequired: false,
      remoteOperationIds: ['remote-1']
    })
  })

  test('keeps failed and unknown journal results terminal and fail closed', async () => {
    const releasePlan = await plan()
    for (const outcome of ['failed', 'outcome-unknown'] as const) {
      const state = reduceBackendReleaseState(await applyState(releasePlan), {
        type: 'apply-reconciled',
        planDigest: releasePlan.planDigest,
        singleFlightKey: backendReleaseSingleFlightKey(releasePlan),
        outcome,
        code: `reconciled-${outcome}`,
        remoteOperationIds: [],
        reconciledAt: NOW
      })
      expect(state).toMatchObject({
        phase: 'receipt',
        outcome,
        dispatch: 'settled',
        reconcileRequired: outcome === 'outcome-unknown'
      })
    }
  })
})
