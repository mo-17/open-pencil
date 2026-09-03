import { describe, expect, test } from 'bun:test'

import {
  backendReleaseDispatchScopeKey,
  backendReleaseSingleFlightKey,
  createBackendReleasePlan,
  planBackendMigration,
  type BackendReleaseArtifactsV1,
  type BackendReleaseAuthorityV1,
  type DataModelIR
} from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import type { BackendHostReleaseReconcileInput } from '@/app/plugins/host/deployment/backend/release-controller'
import {
  BACKEND_RELEASE_DISPATCH_JOURNAL_FORMAT,
  type BackendHostReleaseDispatchJournalRecordV2
} from '@/app/plugins/host/deployment/backend/release-journal'
import { reconcileSupabaseStagingBaseline } from '@/app/plugins/host/deployment/supabase/staging-reconciliation'

const CLAIMED_AT = '2026-09-03T08:00:00.000Z'
const LEASE_EXPIRES_AT = '2026-09-03T08:05:00.000Z'
const SETTLED_AT = '2026-09-03T08:06:00.000Z'
const OBSERVED_AT = '2026-09-03T08:16:00.000Z'
const UNKNOWN = {
  outcome: 'outcome-unknown',
  code: 'supabase-staging-apply-outcome-not-provable',
  remoteOperationIds: []
}
async function digest(label: string): Promise<string> {
  return digestCanonicalManifest({ label })
}

async function fixture(): Promise<BackendHostReleaseReconcileInput> {
  const model: DataModelIR = { version: 1, entities: [], enums: [], relations: [] }
  const migrationPlan = await planBackendMigration(model, model)
  const authority: BackendReleaseAuthorityV1 = {
    documentDigest: await digest('staging-reconcile-document'),
    irDigest: await digest('staging-reconcile-ir'),
    inspectedSchemaDigest: await digest('staging-reconcile-baseline'),
    compilerVersion: '0.15.0',
    target: 'react',
    environment: 'staging',
    projectId: 'project-ref',
    accountId: 'account-id',
    grantGeneration: 'grant-generation-1',
    backendProvider: {
      publisherId: 'open-pencil',
      packageDigest: `app-bundle-sha256:${await digest('staging-reconcile-package')}`,
      pluginId: 'open-pencil.supabase-backend',
      contributionId: 'supabase-backend',
      providerId: 'supabase',
      adapterId: 'supabase-v1',
      adapterVersion: '1.0.0',
      contractVersion: 1,
      supportedModelVersions: [1],
      capabilities: ['migrations.schema', 'transactions.atomic'],
      permissions: [],
      outputKinds: ['database-schema', 'migration-plan']
    }
  }
  const plan = await createBackendReleasePlan({
    planId: 'staging-reconcile-plan',
    authority,
    migrationPlan,
    requiredArtifactKinds: ['schema'],
    requiredEnvironmentNames: [],
    requiredCredentialRefs: []
  })
  const artifacts: BackendReleaseArtifactsV1 = {
    staticArtifactDigest: null,
    serverArtifactDigest: null,
    schemaArtifactDigest: await digest('staging-reconcile-schema-artifact')
  }
  const singleFlightKey = backendReleaseSingleFlightKey(plan, artifacts)
  const claim: BackendHostReleaseDispatchJournalRecordV2 = {
    format: BACKEND_RELEASE_DISPATCH_JOURNAL_FORMAT,
    version: 2,
    singleFlightKey,
    dispatchScopeKey: backendReleaseDispatchScopeKey(plan),
    releaseId: 'prior-release',
    ownerId: 'prior-receipt',
    planDigest: plan.planDigest,
    claimedAt: CLAIMED_AT,
    leaseExpiresAt: LEASE_EXPIRES_AT,
    settledAt: SETTLED_AT,
    outcome: 'outcome-unknown',
    code: 'transport-timeout',
    remoteOperationIds: []
  }
  return {
    plan,
    migrationPlan,
    requiredEnvironmentNames: plan.requiredEnvironmentNames,
    requiredCredentialRefs: plan.requiredCredentialRefs,
    artifacts,
    authority,
    claim
  }
}

function replaceKeyPart(key: string, index: number, value: string): string {
  const parts = key.split(':')
  parts[index] = encodeURIComponent(value)
  return parts.join(':')
}

function v2Key(v3Key: string): string {
  const parts = v3Key.split(':').slice(0, 20)
  parts[0] = 'backend-release-v2'
  return parts.join(':')
}

function withClaim(
  input: BackendHostReleaseReconcileInput,
  overrides: Partial<BackendHostReleaseDispatchJournalRecordV2>
): BackendHostReleaseReconcileInput {
  return { ...input, claim: { ...input.claim, ...overrides, version: 2 } }
}

function reconcile(input: BackendHostReleaseReconcileInput, observedAt = OBSERVED_AT) {
  return reconcileSupabaseStagingBaseline(input, observedAt)
}

describe('Supabase staging baseline reconciliation', () => {
  test('keeps canonical v2 and v3 claims unknown when the inspected baseline is unchanged', async () => {
    const input = await fixture()

    expect(reconcile(input)).toEqual(UNKNOWN)
    expect(
      reconcile(withClaim(input, { singleFlightKey: v2Key(input.claim.singleFlightKey) }))
    ).toEqual(UNKNOWN)
  })

  test('does not let corrected migration or artifact bytes unlock the old claim', async () => {
    const input = await fixture()
    const differentMigrationDigest = await digest('corrected-migration')
    const differentSchemaArtifactDigest = await digest('corrected-schema-artifact')
    let oldKey = replaceKeyPart(input.claim.singleFlightKey, 19, differentMigrationDigest)
    oldKey = replaceKeyPart(oldKey, 25, differentSchemaArtifactDigest)

    expect(reconcile(withClaim(input, { singleFlightKey: oldKey }))).toEqual(UNKNOWN)
  })

  test('keeps a changed baseline outcome unknown', async () => {
    const input = await fixture()
    const oldBaseline = await digest('different-old-baseline')

    expect(
      reconcile(
        withClaim(input, {
          singleFlightKey: replaceKeyPart(input.claim.singleFlightKey, 8, oldBaseline)
        })
      )
    ).toEqual(UNKNOWN)
  })

  test('keeps project, document, and provider authority mismatches outcome unknown', async () => {
    const input = await fixture()
    const otherDocument = await digest('other-document')
    const mismatches = [
      replaceKeyPart(input.claim.singleFlightKey, 2, 'other-project'),
      replaceKeyPart(input.claim.singleFlightKey, 6, otherDocument),
      replaceKeyPart(input.claim.singleFlightKey, 16, 'other-adapter')
    ]

    for (const singleFlightKey of mismatches) {
      expect(reconcile(withClaim(input, { singleFlightKey }))).toEqual(UNKNOWN)
    }
  })

  test('requires the complete current provider authority to match the release plan', async () => {
    const input = await fixture()
    const authority: BackendReleaseAuthorityV1 = {
      ...input.authority,
      backendProvider: {
        ...input.authority.backendProvider,
        capabilities: [...input.authority.backendProvider.capabilities, 'policy.row-level']
      }
    }

    expect(reconcile({ ...input, authority })).toEqual(UNKNOWN)
  })

  test('rejects malformed, non-canonical, and structurally invalid release keys', async () => {
    const input = await fixture()
    const malformed = [
      `${input.claim.singleFlightKey}:extra`,
      input.claim.singleFlightKey.replace(':react:', ':re%61ct:'),
      replaceKeyPart(input.claim.singleFlightKey, 20, 'not-static'),
      replaceKeyPart(input.claim.singleFlightKey, 25, 'not-a-digest')
    ]

    for (const singleFlightKey of malformed) {
      expect(reconcile(withClaim(input, { singleFlightKey }))).toEqual(UNKNOWN)
    }
  })

  test('requires an unresolved claim without remote operation IDs', async () => {
    const input = await fixture()

    expect(reconcile(withClaim(input, { remoteOperationIds: ['operation-1'] }))).toEqual(UNKNOWN)
    expect(
      reconcile(
        withClaim(input, {
          outcome: 'failed',
          settledAt: SETTLED_AT,
          code: 'already-failed'
        })
      )
    ).toEqual(UNKNOWN)
  })

  test('never settles a pending claim or uses elapsed local time as terminal evidence', async () => {
    const input = await fixture()
    expect(
      reconcile(
        withClaim(input, {
          outcome: 'pending',
          settledAt: null,
          code: null
        })
      )
    ).toEqual(UNKNOWN)
    expect(reconcile(input, '2026-09-03T08:15:59.999Z')).toEqual(UNKNOWN)
    expect(reconcile(input, '2126-09-03T08:16:00.000Z')).toEqual(UNKNOWN)
  })

  test('rejects malformed reconciliation timestamps', async () => {
    const input = await fixture()
    expect(reconcile(input, '2026-09-03T08:16:00Z')).toEqual(UNKNOWN)
    expect(reconcile(withClaim(input, { settledAt: 'not-a-time' }))).toEqual(UNKNOWN)
  })
})
