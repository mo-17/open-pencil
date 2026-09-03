import { describe, expect, test } from 'bun:test'

import {
  createSupabaseInspectedMigrationReview,
  createSupabaseInspectedMigrationSnapshot,
  type BackendCapabilityDecision,
  type CreateSupabaseInspectedMigrationSnapshotInputV1
} from '@open-pencil/compiler/backend'
import type {
  BackendApplicationSpecV1,
  BackendReleaseProviderAuthorityV1
} from '@open-pencil/lowcode/backend'
import { digestBackendApplication } from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import type { SupabaseEdgeFunctionReleaseReceipt } from '@/app/plugins/host/deployment/supabase/edge-function-release'
import {
  verifySupabaseStagingRelease,
  type SupabaseStagingVerificationInput
} from '@/app/plugins/host/deployment/supabase/staging-verifier'
import type { SupabaseStorageIsolationReceipt } from '@/app/plugins/host/deployment/supabase/storage-isolation-verifier'

const NOW = '2026-09-02T02:00:00.000Z'
const EDGE_ARTIFACT_DIGEST = 'E'.repeat(43)
const EDGE_HEALTH_IDENTITY = 'H'.repeat(43)
const EDGE_SECRET_NAMES = Object.freeze([
  'EMAIL_API_TOKEN',
  'SUPABASE_PUBLISHABLE_KEYS',
  'SUPABASE_URL'
])
const STORAGE_POLICY_DIGEST = 'S'.repeat(43)
const EVIDENCE_DIGEST = 'V'.repeat(43)
const STORAGE_CHECK_IDS = [
  'owner-create',
  'owner-read',
  'owner-update',
  'owner-upsert',
  'anonymous-read-denied',
  'second-user-read-denied',
  'second-user-update-denied',
  'second-user-delete-denied',
  'second-user-create-owner-path-denied',
  'path-prefix-escape-denied',
  'mime-limit-denied',
  'size-limit-denied',
  'owner-delete'
] as const

const PROVIDER: BackendReleaseProviderAuthorityV1 = {
  publisherId: 'open-pencil',
  packageDigest: `app-bundle-sha256:${'A'.repeat(43)}`,
  pluginId: 'open-pencil.supabase-backend-provider',
  contributionId: 'supabase',
  providerId: 'supabase',
  adapterId: 'supabase',
  adapterVersion: '1.0.0',
  contractVersion: 1,
  supportedModelVersions: [1],
  capabilities: ['migrations.schema'],
  permissions: [],
  outputKinds: ['database-schema', 'migration-plan']
}

const COVERAGE = {
  schemas: 'complete',
  tables: 'complete',
  columns: 'complete',
  enums: 'complete',
  constraints: 'complete',
  indexes: 'complete',
  sequences: 'complete',
  views: 'complete',
  functions: 'complete',
  roles: 'complete',
  roleMemberships: 'complete',
  rls: 'complete',
  policies: 'complete',
  storageBuckets: 'complete',
  storagePolicies: 'complete',
  privileges: 'complete'
} as const

function emptySnapshot(): CreateSupabaseInspectedMigrationSnapshotInputV1 {
  return {
    provenance: {
      projectRef: 'enekobitnhobuiuamvqj',
      accountId: 'org-123',
      querySchemaVersion: 'catalog-v1',
      databaseRole: 'postgres',
      observedAt: NOW,
      completeness: 'complete',
      truncated: false
    },
    currentModel: { version: 1, entities: [], enums: [], relations: [] },
    coverage: COVERAGE,
    objects: [],
    columns: [],
    constraints: [],
    indexes: [],
    roles: [
      { roleName: 'postgres', superuser: true, bypassRls: true, inherit: true },
      { roleName: 'anon', superuser: false, bypassRls: false, inherit: true },
      { roleName: 'authenticated', superuser: false, bypassRls: false, inherit: true }
    ],
    roleMemberships: [],
    policies: [],
    storageBuckets: [],
    storagePolicies: [],
    privileges: [],
    defaultPrivileges: []
  }
}

function application(withTable = false): BackendApplicationSpecV1 {
  return {
    format: 'openpencil.backend-application',
    version: 1,
    applicationId: 'staging-verifier',
    dataModel: {
      version: 1,
      entities: withTable
        ? [
            {
              id: 'tasks',
              name: 'tasks',
              management: 'managed',
              fields: [{ id: 'id', name: 'id', type: 'uuid', nullable: false }],
              primaryKey: { fields: ['id'] },
              indexes: []
            }
          ]
        : [],
      enums: [],
      relations: []
    },
    auth: { version: 1, identities: [], roles: [], ownership: [], tenants: [], rowAccess: [] },
    workflows: { version: 1, workflows: [] },
    capabilities: [],
    secrets: []
  }
}

function receiptApplication(): BackendApplicationSpecV1 {
  return {
    ...application(),
    storage: {
      version: 1,
      buckets: [
        {
          id: 'user-assets',
          name: 'user-assets',
          access: 'private',
          maxObjectBytes: 64,
          allowedMimeTypes: ['image/png'],
          pathRules: [
            {
              id: 'owner-files',
              prefix: ['users'],
              principal: { kind: 'owner' },
              operations: ['read', 'create', 'update', 'delete', 'upsert']
            },
            {
              id: 'owner-avatars',
              prefix: ['avatars'],
              principal: { kind: 'owner' },
              operations: ['read', 'create', 'update', 'delete', 'upsert']
            }
          ]
        }
      ]
    },
    capabilities: [
      { capability: 'server.functions', required: true },
      { capability: 'storage.objects', required: true }
    ]
  }
}

function includedCapability(
  capability: 'server.functions' | 'storage.objects'
): BackendCapabilityDecision {
  return {
    capability,
    required: true,
    providerSupported: true,
    targetStatus: capability === 'server.functions' ? 'requires-server-bridge' : 'supported',
    resolution: 'supported',
    included: true
  }
}

function receiptProvider(): BackendReleaseProviderAuthorityV1 {
  return {
    ...PROVIDER,
    packageDigest: `app-bundle-sha256:${'A'.repeat(43)}`,
    capabilities: ['migrations.schema', 'server.functions', 'storage.objects'],
    outputKinds: ['database-schema', 'migration-plan', 'security-policy', 'server-runtime']
  }
}

async function edgeReceipt(
  provider: BackendReleaseProviderAuthorityV1,
  overrides: Partial<SupabaseEdgeFunctionReleaseReceipt> = {}
): Promise<SupabaseEdgeFunctionReleaseReceipt> {
  const secretInspectionDigest = await digestCanonicalManifest({
    format: 'openpencil.supabase-edge-secret-inspection-evidence.v1',
    version: 1,
    projectRef: 'enekobitnhobuiuamvqj',
    accountId: 'org-123',
    grantGeneration: '123e4567-e89b-42d3-a456-426614174000',
    providerId: 'supabase',
    functionSlug: 'openpencil-runtime',
    artifactDigest: EDGE_ARTIFACT_DIGEST,
    requiredSecretNames: EDGE_SECRET_NAMES,
    checkedAt: NOW
  })
  const healthEvidenceDigest = await digestCanonicalManifest({
    format: 'openpencil.supabase-edge-health-evidence.v1',
    version: 1,
    projectRef: 'enekobitnhobuiuamvqj',
    accountId: 'org-123',
    grantGeneration: '123e4567-e89b-42d3-a456-426614174000',
    functionSlug: 'openpencil-runtime',
    functionId: 'function-1',
    versionId: 'version-1',
    expectedHealthIdentity: EDGE_HEALTH_IDENTITY,
    authenticated: true,
    healthy: true,
    checkedAt: NOW
  })
  const healthOperationId = `edge-health-${healthEvidenceDigest.slice(0, 32)}`
  return {
    format: 'openpencil.supabase-edge-function-deployment-receipt',
    version: 1,
    releaseId: 'edge-release-1',
    environment: 'staging',
    projectRef: 'enekobitnhobuiuamvqj',
    accountId: 'org-123',
    grantGeneration: '123e4567-e89b-42d3-a456-426614174000',
    provider,
    artifactDigest: EDGE_ARTIFACT_DIGEST,
    healthIdentity: EDGE_HEALTH_IDENTITY,
    functionSlug: 'openpencil-runtime',
    verifyJwt: true,
    requiredSecretNames: EDGE_SECRET_NAMES,
    secretInspection: {
      projectRef: 'enekobitnhobuiuamvqj',
      accountId: 'org-123',
      grantGeneration: '123e4567-e89b-42d3-a456-426614174000',
      providerId: 'supabase',
      functionSlug: 'openpencil-runtime',
      artifactDigest: EDGE_ARTIFACT_DIGEST,
      requiredSecretNames: EDGE_SECRET_NAMES,
      evidenceDigest: secretInspectionDigest,
      checkedAt: NOW
    },
    dispatch: 'dispatched',
    outcome: 'succeeded',
    remote: {
      functionId: 'function-1',
      versionId: 'version-1',
      operationIds: ['deploy-1', healthOperationId]
    },
    health: {
      status: 200,
      authenticated: true,
      healthy: true,
      healthIdentity: EDGE_HEALTH_IDENTITY,
      evidenceDigest: healthEvidenceDigest,
      operationId: healthOperationId,
      checkedAt: NOW
    },
    failureCode: null,
    recordedAt: NOW,
    ...overrides
  }
}

function storageReceipt(
  provider: BackendReleaseProviderAuthorityV1,
  applicationDigest: string,
  ruleId: 'owner-files' | 'owner-avatars',
  overrides: Partial<SupabaseStorageIsolationReceipt> = {}
): SupabaseStorageIsolationReceipt {
  const checkOperationIds = STORAGE_CHECK_IDS.map((_, index) => `probe-${index + 1}`)
  return {
    format: 'openpencil.supabase-storage-isolation-receipt',
    version: 1,
    verificationId: `verify-${ruleId}`,
    environment: 'staging',
    projectRef: 'enekobitnhobuiuamvqj',
    accountId: 'org-123',
    grantGeneration: '123e4567-e89b-42d3-a456-426614174000',
    provider,
    applicationDigest,
    storagePolicyArtifactDigest: STORAGE_POLICY_DIGEST,
    bucketId: 'user-assets',
    bucketName: 'user-assets',
    ruleId,
    principal: 'owner',
    actorEvidenceDigest: EVIDENCE_DIGEST,
    bucketEvidenceDigest: EVIDENCE_DIGEST,
    checks: STORAGE_CHECK_IDS.map((check, index) => ({
      check,
      passed: true,
      evidenceDigest: EVIDENCE_DIGEST,
      operationId: checkOperationIds[index]
    })),
    remoteOperationIds: [
      'inspect-bucket',
      'resolve-actors-initial',
      ...checkOperationIds,
      'resolve-actors-final'
    ],
    residualObjectPaths: [],
    dispatch: 'dispatched',
    outcome: 'succeeded',
    failureCode: null,
    checkedAt: NOW,
    ...overrides
  }
}

async function verificationInputFor(
  app: BackendApplicationSpecV1,
  overrides: Partial<SupabaseStagingVerificationInput> = {}
): Promise<SupabaseStagingVerificationInput> {
  const snapshot = await createSupabaseInspectedMigrationSnapshot(emptySnapshot())
  const reviewed = await createSupabaseInspectedMigrationReview({
    application: app,
    snapshot,
    expectedProjectRef: 'enekobitnhobuiuamvqj',
    expectedAccountId: 'org-123',
    expectedInspectedSchemaDigest: snapshot.inspectedSchemaDigest
  })
  const edgeFunctionReceipt = overrides.edgeFunctionReceipt
  const storageIsolationReceipts = overrides.storageIsolationReceipts ?? []
  const receiptAuthority =
    edgeFunctionReceipt || storageIsolationReceipts.length > 0
      ? {
          startedAt: NOW,
          edgeFunctionReleaseId: edgeFunctionReceipt?.releaseId ?? null,
          storageVerificationIds: storageIsolationReceipts.map((receipt) => ({
            bucketId: receipt.bucketId,
            ruleId: receipt.ruleId,
            verificationId: receipt.verificationId
          }))
        }
      : undefined
  return {
    application: app,
    capabilities: [],
    backendProvider: PROVIDER,
    reviewedBackendProvider: overrides.backendProvider ?? PROVIDER,
    projectRef: 'enekobitnhobuiuamvqj',
    accountId: 'org-123',
    grantGeneration: '123e4567-e89b-42d3-a456-426614174000',
    planDigest: 'b'.repeat(43),
    reviewedArtifactDigest: 'c'.repeat(43),
    expectedReviewedArtifactDigest: 'c'.repeat(43),
    reviewed,
    postApplySnapshot: snapshot,
    expectedPostApplySchemaDigest: snapshot.inspectedSchemaDigest,
    remoteOperationIds: [],
    requiredEnvironmentNames: [],
    requiredCredentialRefs: [],
    expectedEdgeFunctionHealthIdentity: overrides.edgeFunctionReceipt
      ? EDGE_HEALTH_IDENTITY
      : undefined,
    expectedEdgeFunctionRequiredSecretNames: overrides.edgeFunctionReceipt
      ? EDGE_SECRET_NAMES
      : undefined,
    ...(receiptAuthority ? { receiptAuthority } : {}),
    checkedAt: NOW,
    ...overrides
  }
}

async function verificationInput(withTable = false): Promise<SupabaseStagingVerificationInput> {
  return verificationInputFor(application(withTable))
}

describe('Supabase staging catalog verifier', () => {
  test('emits complete digest-bound evidence for a no-drift migration-only target', async () => {
    const result = await verifySupabaseStagingRelease(await verificationInput())

    expect(result.schemaApplied).toBe(true)
    expect(result.gates).toHaveLength(10)
    expect(result.gates.every((gate) => gate.status === 'passed')).toBe(true)
    expect(result.gates.every((gate) => gate.checkedAt === NOW)).toBe(true)
    expect(result.gates.every((gate) => gate.evidenceDigest?.length === 43)).toBe(true)
  })

  test('fails schema gates when the post-Apply catalog still has the baseline model', async () => {
    const result = await verifySupabaseStagingRelease(await verificationInput(true))
    const byId = new Map(result.gates.map((gate) => [gate.gate, gate]))

    expect(result.schemaApplied).toBe(false)
    expect(byId.get('migration-applied')?.status).toBe('failed')
    expect(byId.get('schema-drift-none')?.status).toBe('failed')
    expect(byId.get('backend-health-check')?.status).toBe('passed')
  })

  test('fails Provider authority when it is malformed, differs from review, or lacks a required capability', async () => {
    const malformed = await verifySupabaseStagingRelease(
      await verificationInputFor(application(), {
        backendProvider: { ...PROVIDER, outputKinds: ['schema'] },
        reviewedBackendProvider: PROVIDER
      })
    )
    expect(malformed.gates.find((gate) => gate.gate === 'provider-authority-valid')?.status).toBe(
      'failed'
    )

    const changed = await verifySupabaseStagingRelease(
      await verificationInputFor(application(), {
        backendProvider: PROVIDER,
        reviewedBackendProvider: {
          ...PROVIDER,
          packageDigest: `app-bundle-sha256:${`${'B'.repeat(42)}A`}`
        }
      })
    )
    expect(changed.gates.find((gate) => gate.gate === 'provider-authority-valid')?.status).toBe(
      'failed'
    )

    const unsupported = await verifySupabaseStagingRelease(
      await verificationInputFor(application(), {
        capabilities: [includedCapability('storage.objects')]
      })
    )
    expect(unsupported.gates.find((gate) => gate.gate === 'provider-authority-valid')?.status).toBe(
      'failed'
    )
  })

  test('passes Edge deployment, authenticated health, secret, and every private Storage rule from exact receipts', async () => {
    const app = receiptApplication()
    const provider = receiptProvider()
    const applicationDigest = await digestBackendApplication(app)
    const input = await verificationInputFor(app, {
      backendProvider: provider,
      capabilities: [includedCapability('server.functions'), includedCapability('storage.objects')],
      requiredEnvironmentNames: ['EMAIL_API_TOKEN'],
      expectedEdgeFunctionArtifactDigest: EDGE_ARTIFACT_DIGEST,
      edgeFunctionReceipt: await edgeReceipt(provider),
      expectedStoragePolicyArtifactDigest: STORAGE_POLICY_DIGEST,
      storageIsolationReceipts: [
        storageReceipt(provider, applicationDigest, 'owner-files'),
        storageReceipt(provider, applicationDigest, 'owner-avatars')
      ]
    })
    const result = await verifySupabaseStagingRelease(input)
    const byId = new Map(result.gates.map((gate) => [gate.gate, gate]))

    expect(byId.get('server-workflows-deployed')?.status).toBe('passed')
    expect(byId.get('required-secrets-present')?.status).toBe('passed')
    expect(byId.get('storage-policy-verified')?.status).toBe('passed')
    expect(byId.get('backend-health-check')?.status).toBe('passed')
    expect(byId.get('server-workflows-deployed')?.evidenceDigest).toHaveLength(43)
    expect(byId.get('storage-policy-verified')?.evidenceDigest).toHaveLength(43)
  })

  test('rejects replayed receipts that are not bound to exact operation IDs and time window', async () => {
    const app = receiptApplication()
    const provider = receiptProvider()
    const applicationDigest = await digestBackendApplication(app)
    const edge = await edgeReceipt(provider)
    const storage = [
      storageReceipt(provider, applicationDigest, 'owner-files'),
      storageReceipt(provider, applicationDigest, 'owner-avatars')
    ]
    const result = await verifySupabaseStagingRelease(
      await verificationInputFor(app, {
        backendProvider: provider,
        capabilities: [
          includedCapability('server.functions'),
          includedCapability('storage.objects')
        ],
        requiredEnvironmentNames: ['EMAIL_API_TOKEN'],
        expectedEdgeFunctionArtifactDigest: EDGE_ARTIFACT_DIGEST,
        edgeFunctionReceipt: edge,
        expectedStoragePolicyArtifactDigest: STORAGE_POLICY_DIGEST,
        storageIsolationReceipts: storage,
        checkedAt: '2026-09-02T02:00:02.000Z',
        receiptAuthority: {
          startedAt: '2026-09-02T02:00:01.000Z',
          edgeFunctionReleaseId: 'different-edge-release',
          storageVerificationIds: storage.map((receipt, index) => ({
            bucketId: receipt.bucketId,
            ruleId: receipt.ruleId,
            verificationId: index === 0 ? 'different-storage-verification' : receipt.verificationId
          }))
        }
      })
    )
    const byId = new Map(result.gates.map((gate) => [gate.gate, gate]))

    expect(byId.get('server-workflows-deployed')?.status).toBe('failed')
    expect(byId.get('backend-health-check')?.status).toBe('failed')
    expect(byId.get('storage-policy-verified')?.status).toBe('failed')
  })

  test('keeps receipt-dependent gates unknown when live Edge and Storage evidence is absent', async () => {
    const app = receiptApplication()
    const provider = receiptProvider()
    const result = await verifySupabaseStagingRelease(
      await verificationInputFor(app, {
        backendProvider: provider,
        capabilities: [
          includedCapability('server.functions'),
          includedCapability('storage.objects')
        ],
        requiredEnvironmentNames: ['EMAIL_API_TOKEN'],
        expectedEdgeFunctionArtifactDigest: EDGE_ARTIFACT_DIGEST,
        expectedStoragePolicyArtifactDigest: STORAGE_POLICY_DIGEST
      })
    )
    const byId = new Map(result.gates.map((gate) => [gate.gate, gate]))

    expect(byId.get('server-workflows-deployed')?.status).toBe('unknown')
    expect(byId.get('required-secrets-present')?.status).toBe('unknown')
    expect(byId.get('storage-policy-verified')?.status).toBe('unknown')
    expect(byId.get('backend-health-check')?.status).toBe('unknown')
  })

  test('fails closed for stale authority, artifact, health, incomplete secrets, and partial Storage coverage', async () => {
    const app = receiptApplication()
    const provider = receiptProvider()
    const applicationDigest = await digestBackendApplication(app)
    const staleEdge = await edgeReceipt(provider, {
      projectRef: 'different-project',
      artifactDigest: 'X'.repeat(43),
      requiredSecretNames: ['SUPABASE_URL'],
      health: {
        status: 200,
        authenticated: false,
        healthy: true,
        healthIdentity: EDGE_HEALTH_IDENTITY,
        evidenceDigest: EVIDENCE_DIGEST,
        operationId: 'health-1',
        checkedAt: NOW
      }
    } as Partial<SupabaseEdgeFunctionReleaseReceipt>)
    const result = await verifySupabaseStagingRelease(
      await verificationInputFor(app, {
        backendProvider: provider,
        capabilities: [
          includedCapability('server.functions'),
          includedCapability('storage.objects')
        ],
        requiredEnvironmentNames: ['EMAIL_API_TOKEN'],
        expectedEdgeFunctionArtifactDigest: EDGE_ARTIFACT_DIGEST,
        edgeFunctionReceipt: staleEdge,
        expectedStoragePolicyArtifactDigest: STORAGE_POLICY_DIGEST,
        storageIsolationReceipts: [storageReceipt(provider, applicationDigest, 'owner-files')]
      })
    )
    const byId = new Map(result.gates.map((gate) => [gate.gate, gate]))

    expect(byId.get('server-workflows-deployed')?.status).toBe('failed')
    expect(byId.get('required-secrets-present')?.status).toBe('failed')
    expect(byId.get('backend-health-check')?.status).toBe('failed')
    expect(byId.get('storage-policy-verified')?.status).toBe('failed')
  })

  test('fails Storage verification for a receipt bound to another policy artifact', async () => {
    const app = receiptApplication()
    const provider = receiptProvider()
    const applicationDigest = await digestBackendApplication(app)
    const result = await verifySupabaseStagingRelease(
      await verificationInputFor(app, {
        backendProvider: provider,
        capabilities: [includedCapability('storage.objects')],
        expectedStoragePolicyArtifactDigest: STORAGE_POLICY_DIGEST,
        storageIsolationReceipts: [
          storageReceipt(provider, applicationDigest, 'owner-files'),
          storageReceipt(provider, applicationDigest, 'owner-avatars', {
            storagePolicyArtifactDigest: 'X'.repeat(43)
          })
        ]
      })
    )
    const storageGate = result.gates.find((gate) => gate.gate === 'storage-policy-verified')

    expect(storageGate?.status).toBe('failed')
  })

  test('does not let an Edge receipt prove host credential references', async () => {
    const app = receiptApplication()
    const provider = receiptProvider()
    const result = await verifySupabaseStagingRelease(
      await verificationInputFor(app, {
        backendProvider: provider,
        capabilities: [includedCapability('server.functions')],
        requiredEnvironmentNames: ['EMAIL_API_TOKEN'],
        requiredCredentialRefs: ['credential.123e4567-e89b-42d3-a456-426614174000'],
        expectedEdgeFunctionArtifactDigest: EDGE_ARTIFACT_DIGEST,
        edgeFunctionReceipt: await edgeReceipt(provider)
      })
    )
    const secretGate = result.gates.find((gate) => gate.gate === 'required-secrets-present')

    expect(secretGate?.status).toBe('unknown')
  })

  test('rejects future receipts and health evidence recorded after its deployment receipt', async () => {
    const app = receiptApplication()
    const provider = receiptProvider()
    const verifierTime = '2026-09-02T02:00:02.000Z'
    const healthAfterReceipt = await edgeReceipt(provider, {
      health: {
        status: 200,
        authenticated: true,
        healthy: true,
        healthIdentity: EDGE_HEALTH_IDENTITY,
        evidenceDigest: EVIDENCE_DIGEST,
        operationId: 'health-1',
        checkedAt: '2026-09-02T02:00:01.000Z'
      }
    })
    const healthResult = await verifySupabaseStagingRelease(
      await verificationInputFor(app, {
        backendProvider: provider,
        capabilities: [includedCapability('server.functions')],
        checkedAt: verifierTime,
        expectedEdgeFunctionArtifactDigest: EDGE_ARTIFACT_DIGEST,
        edgeFunctionReceipt: healthAfterReceipt
      })
    )
    expect(healthResult.gates.find((gate) => gate.gate === 'backend-health-check')?.status).toBe(
      'failed'
    )

    const futureReceiptResult = await verifySupabaseStagingRelease(
      await verificationInputFor(app, {
        backendProvider: provider,
        capabilities: [includedCapability('server.functions')],
        checkedAt: verifierTime,
        expectedEdgeFunctionArtifactDigest: EDGE_ARTIFACT_DIGEST,
        edgeFunctionReceipt: await edgeReceipt(provider, {
          recordedAt: '2026-09-02T02:00:03.000Z',
          health: {
            status: 200,
            authenticated: true,
            healthy: true,
            healthIdentity: EDGE_HEALTH_IDENTITY,
            evidenceDigest: EVIDENCE_DIGEST,
            operationId: 'health-1',
            checkedAt: '2026-09-02T02:00:03.000Z'
          }
        })
      })
    )
    expect(
      futureReceiptResult.gates.find((gate) => gate.gate === 'server-workflows-deployed')?.status
    ).toBe('failed')

    const applicationDigest = await digestBackendApplication(app)
    const storageResult = await verifySupabaseStagingRelease(
      await verificationInputFor(app, {
        backendProvider: provider,
        capabilities: [includedCapability('storage.objects')],
        checkedAt: verifierTime,
        expectedStoragePolicyArtifactDigest: STORAGE_POLICY_DIGEST,
        storageIsolationReceipts: [
          storageReceipt(provider, applicationDigest, 'owner-files', {
            checkedAt: '2026-09-02T02:00:03.000Z'
          }),
          storageReceipt(provider, applicationDigest, 'owner-avatars')
        ]
      })
    )
    expect(
      storageResult.gates.find((gate) => gate.gate === 'storage-policy-verified')?.status
    ).toBe('failed')
  })

  test('fails Storage when any bucket is public-read or any private rule lacks full CRUD/upsert coverage', async () => {
    const provider = receiptProvider()
    const publicApp = structuredClone(receiptApplication())
    publicApp.storage?.buckets.push({
      id: 'public-assets',
      name: 'public-assets',
      access: 'public-read',
      maxObjectBytes: 64,
      allowedMimeTypes: ['image/png'],
      pathRules: [
        {
          id: 'public-owner-files',
          prefix: ['users'],
          principal: { kind: 'owner' },
          operations: ['read', 'create', 'update', 'delete', 'upsert']
        }
      ]
    })
    const publicDigest = await digestBackendApplication(publicApp)
    const publicResult = await verifySupabaseStagingRelease(
      await verificationInputFor(publicApp, {
        backendProvider: provider,
        capabilities: [includedCapability('storage.objects')],
        expectedStoragePolicyArtifactDigest: STORAGE_POLICY_DIGEST,
        storageIsolationReceipts: [
          storageReceipt(provider, publicDigest, 'owner-files'),
          storageReceipt(provider, publicDigest, 'owner-avatars')
        ]
      })
    )
    expect(publicResult.gates.find((gate) => gate.gate === 'storage-policy-verified')?.status).toBe(
      'failed'
    )

    const incompleteApp = structuredClone(receiptApplication())
    const incompleteRule = incompleteApp.storage?.buckets[0]?.pathRules[1]
    if (!incompleteRule) throw new Error('Expected incomplete Storage rule fixture.')
    incompleteRule.operations = ['read']
    const incompleteDigest = await digestBackendApplication(incompleteApp)
    const incompleteResult = await verifySupabaseStagingRelease(
      await verificationInputFor(incompleteApp, {
        backendProvider: provider,
        capabilities: [includedCapability('storage.objects')],
        expectedStoragePolicyArtifactDigest: STORAGE_POLICY_DIGEST,
        storageIsolationReceipts: [storageReceipt(provider, incompleteDigest, 'owner-files')]
      })
    )
    expect(
      incompleteResult.gates.find((gate) => gate.gate === 'storage-policy-verified')?.status
    ).toBe('failed')
  })
})
