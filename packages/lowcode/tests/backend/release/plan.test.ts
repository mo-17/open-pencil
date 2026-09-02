import { describe, expect, test } from 'bun:test'

import {
  BACKEND_PRODUCTION_GATE_IDS,
  createBackendReleasePlan,
  evaluateDestructiveMigrationConfirmations,
  evaluateProductionReleaseGates,
  inspectBackendReleasePlanFreshness,
  isVerifiedBackendReleasePlan,
  planBackendMigration,
  verifyBackendReleasePlanDigest,
  verifyBackendReleasePlan,
  type BackendProductionGateResultV1,
  type BackendReleaseAuthorityV1,
  type BackendReleaseDestructiveConfirmationV1,
  type BackendReleasePlanV1,
  type BackendReleaseStaleField
} from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import { backendModelFixture, stripeSecretCanary } from '../fixture'

const NOW = '2026-08-30T00:00:00Z'

async function digest(label: string): Promise<string> {
  return digestCanonicalManifest({ label })
}

async function authority(): Promise<BackendReleaseAuthorityV1> {
  return {
    documentDigest: await digest('document'),
    irDigest: await digest('ir'),
    inspectedSchemaDigest: await digest('schema'),
    compilerVersion: '0.15.0',
    target: 'project-main',
    environment: 'production',
    projectId: 'project-1',
    accountId: 'account-1',
    grantGeneration: 'grant-7',
    backendProvider: {
      publisherId: 'open-pencil',
      packageDigest: `app-bundle-sha256:${await digest('package')}`,
      pluginId: 'open-pencil.backend-provider',
      contributionId: 'backend-provider',
      providerId: 'fake-provider',
      adapterId: 'fake-provider-v1',
      adapterVersion: '1.2.3',
      contractVersion: 1,
      supportedModelVersions: [1],
      capabilities: ['migrations.schema', 'data.read'],
      permissions: [],
      outputKinds: ['database-schema', 'server-runtime']
    }
  }
}

async function destructivePlan(): Promise<BackendReleasePlanV1> {
  const migration = await planBackendMigration(backendModelFixture(), {
    version: 1,
    entities: [],
    enums: [],
    relations: []
  })
  return createBackendReleasePlan({
    planId: 'release-plan-1',
    authority: await authority(),
    migrationPlan: migration,
    requiredArtifactKinds: ['schema', 'server'],
    requiredEnvironmentNames: ['BACKEND_ADMIN_TOKEN'],
    requiredCredentialRefs: ['credential.123e4567-e89b-42d3-a456-426614174000']
  })
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

describe('Backend Release plan authority and strict gates', () => {
  test('creates deterministic plan and migration checksums without provider executors', async () => {
    const left = await destructivePlan()
    const right = await destructivePlan()
    expect(left).toEqual(right)
    expect(await verifyBackendReleasePlanDigest(left)).toBe(true)
    expect(left.authority.backendProvider.capabilities).toEqual(['data.read', 'migrations.schema'])
    expect(left.migration.operations[0]?.risk).toBe('destructive')
    expect(left.migration.operations[0]?.checksum).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(JSON.stringify(left).toLowerCase()).not.toContain('secretvalue')
  })

  test('rejects credential values passed directly to release plan creation or verification', async () => {
    const secretCanary = `credential.${stripeSecretCanary('0123456789abcdefghijklmnopqrstuvwxyz')}`
    const input = {
      planId: 'release-plan-secret-test',
      authority: await authority(),
      migrationPlan: await planBackendMigration(backendModelFixture(), backendModelFixture()),
      requiredArtifactKinds: ['schema'] as const,
      requiredCredentialRefs: []
    }
    Reflect.set(input, 'requiredCredentialRefs', [secretCanary])
    await expect(createBackendReleasePlan(input)).rejects.toThrow(
      'host-issued opaque credential UUID handle'
    )

    const forged = structuredClone(await destructivePlan())
    Reflect.set(forged, 'requiredCredentialRefs', [secretCanary])
    const verified = await verifyBackendReleasePlan(forged)
    expect(verified.ok).toBe(false)
    expect(JSON.stringify(verified)).not.toContain(secretCanary)
  })

  test('rejects accessor-backed public authority input without invoking accessors', async () => {
    const accessorAuthority = await authority()
    const canary = stripeSecretCanary('releaseauthoritygetter1234567890')
    let getterCalls = 0
    Object.defineProperty(accessorAuthority, 'documentDigest', {
      enumerable: true,
      get() {
        getterCalls += 1
        return canary
      }
    })

    let rejection: unknown
    try {
      await createBackendReleasePlan({
        planId: 'release-plan-accessor-test',
        authority: accessorAuthority,
        migrationPlan: await planBackendMigration(backendModelFixture(), backendModelFixture()),
        requiredArtifactKinds: ['schema']
      })
    } catch (error) {
      rejection = error
    }

    expect(rejection).toBeInstanceOf(TypeError)
    expect(String(rejection)).toContain(
      '$.authority must contain enumerable data property values only'
    )
    expect(String(rejection)).not.toContain(canary)
    expect(getterCalls).toBe(0)
  })

  test('fails freshness for digest, target, provider, environment, adapter, and package drift', async () => {
    const plan = await destructivePlan()
    const cases: Array<[BackendReleaseStaleField, BackendReleaseAuthorityV1]> = [
      [
        'schemaDigest',
        { ...plan.authority, inspectedSchemaDigest: await digest('changed-schema') }
      ],
      ['target', { ...plan.authority, target: 'project-other' }],
      ['environment', { ...plan.authority, environment: 'staging' }],
      [
        'providerId',
        {
          ...plan.authority,
          backendProvider: {
            ...plan.authority.backendProvider,
            providerId: 'other-provider'
          }
        }
      ],
      [
        'adapterVersion',
        {
          ...plan.authority,
          backendProvider: {
            ...plan.authority.backendProvider,
            adapterVersion: '2.0.0'
          }
        }
      ],
      [
        'packageDigest',
        {
          ...plan.authority,
          backendProvider: {
            ...plan.authority.backendProvider,
            packageDigest: `sha256:${await digest('other-package')}`
          }
        }
      ]
    ]
    for (const [field, changed] of cases) {
      const result = await inspectBackendReleasePlanFreshness(plan, {
        planDigest: plan.planDigest,
        authority: changed
      })
      expect(result.stale).toBe(true)
      expect(result.issues.map((issue) => issue.field)).toContain(field)
    }

    const stalePlanDigest = await inspectBackendReleasePlanFreshness(plan, {
      planDigest: await digest('other-plan'),
      authority: plan.authority
    })
    expect(stalePlanDigest.issues.map((issue) => issue.field)).toContain('planDigest')

    const tampered = { ...plan, target: 'ignored' } as BackendReleasePlanV1
    const payloadTampered = {
      ...plan,
      authority: { ...plan.authority, target: 'tampered-target' }
    }
    expect(await verifyBackendReleasePlanDigest(tampered)).toBe(false)
    expect(await verifyBackendReleasePlanDigest(payloadTampered)).toBe(false)
  })

  test('seals verified plans and rejects unchanged digests after migration tampering', async () => {
    const plan = await destructivePlan()
    expect(Object.isFrozen(plan)).toBe(true)
    expect(Object.isFrozen(plan.authority)).toBe(true)
    expect(Object.isFrozen(plan.migration.operations)).toBe(true)
    expect(Object.isFrozen(plan.migration.operations[0] ?? {})).toBe(true)
    expect(isVerifiedBackendReleasePlan(plan)).toBe(true)

    const tampered: BackendReleasePlanV1 = {
      ...structuredClone(plan),
      migration: {
        ...structuredClone(plan.migration),
        operations: plan.migration.operations.map((operation, index) =>
          index === 0 ? { ...operation, kind: 'rewrite-data' } : operation
        )
      }
    }
    expect(tampered.planDigest).toBe(plan.planDigest)
    const forged = Object.freeze(tampered)
    expect(isVerifiedBackendReleasePlan(forged)).toBe(false)
    expect((await verifyBackendReleasePlan(tampered)).ok).toBe(false)
  })

  test('fails closed on future or unknown provider authority vocabulary', async () => {
    const migration = await planBackendMigration(backendModelFixture(), backendModelFixture())
    const unsafeAuthority = await authority()
    for (const [patch, message] of [
      [{ permissions: ['network.connect'] }, 'does not grant permissions'],
      [{ contractVersion: 2 }, 'contractVersion is not supported'],
      [{ supportedModelVersions: [999] }, 'supportedModelVersions is not supported'],
      [{ capabilities: ['database.root'] }, 'supported contract v1 values'],
      [{ outputKinds: ['shell'] }, 'supported contract v1 values']
    ] as const) {
      await expect(
        createBackendReleasePlan({
          planId: 'authority-plan',
          authority: {
            ...unsafeAuthority,
            backendProvider: { ...unsafeAuthority.backendProvider, ...patch }
          },
          migrationPlan: migration,
          requiredArtifactKinds: ['schema']
        })
      ).rejects.toThrow(message)
    }
  })

  test('blocks every unknown, missing, or failed production gate including target support', async () => {
    const missing = evaluateProductionReleaseGates([], NOW)
    expect(missing.releaseReady).toBe(false)
    expect(missing.blockers).toHaveLength(BACKEND_PRODUCTION_GATE_IDS.length)
    expect(missing.blockers).toContainEqual(
      expect.objectContaining({
        gate: 'target-capabilities-supported',
        status: 'unknown'
      })
    )

    const allPassed = await passedGates()
    expect(evaluateProductionReleaseGates(allPassed, NOW).releaseReady).toBe(true)

    const failedTarget = allPassed.map((gate) =>
      gate.gate === 'target-capabilities-supported'
        ? { ...gate, status: 'failed' as const, checkedAt: NOW, evidenceDigest: null }
        : gate
    )
    const failed = evaluateProductionReleaseGates(failedTarget, NOW)
    expect(failed.releaseReady).toBe(false)
    expect(failed.blockers).toContainEqual(
      expect.objectContaining({ gate: 'target-capabilities-supported', status: 'failed' })
    )

    const unknownTarget = allPassed.map((gate) =>
      gate.gate === 'target-capabilities-supported'
        ? { ...gate, status: 'unknown' as const, checkedAt: null, evidenceDigest: null }
        : gate
    )
    expect(evaluateProductionReleaseGates(unknownTarget, NOW).releaseReady).toBe(false)

    const futureDated = allPassed.map((gate) => ({
      ...gate,
      checkedAt: '2026-08-30T00:00:01Z'
    }))
    expect(evaluateProductionReleaseGates(futureDated, NOW).releaseReady).toBe(false)
    expect(() => evaluateProductionReleaseGates(allPassed, '2026-02-30T00:00:00Z')).toThrow(
      'UTC RFC 3339 timestamp'
    )
  })

  test('requires one backup and provider-specific recovery confirmation per destructive operation', async () => {
    const plan = await destructivePlan()
    const operation = plan.migration.operations.find((entry) => entry.risk === 'destructive')
    expect(operation).toBeDefined()
    if (!operation) return

    expect(evaluateDestructiveMigrationConfirmations(plan, []).ready).toBe(false)
    const incomplete: BackendReleaseDestructiveConfirmationV1 = {
      planDigest: plan.planDigest,
      operationId: operation.operationId,
      confirmed: true,
      backendProviderId: plan.authority.backendProvider.providerId,
      backupDescription: '',
      providerRecoveryDescription: '',
      confirmedAt: NOW
    }
    const incompleteResult = evaluateDestructiveMigrationConfirmations(plan, [incomplete])
    expect(incompleteResult.ready).toBe(false)
    expect(incompleteResult.blockers).toContainEqual(
      expect.objectContaining({ code: 'destructive-confirmation-invalid' })
    )

    const complete = {
      ...incomplete,
      backupDescription: 'Create and verify a provider snapshot before this operation.',
      providerRecoveryDescription:
        'Restore the provider snapshot and reconcile the schema before another Apply.'
    }
    expect(evaluateDestructiveMigrationConfirmations(plan, [complete]).ready).toBe(true)
    const falselyConfirmed = { ...complete, confirmed: false }
    const falseResult = Reflect.apply(evaluateDestructiveMigrationConfirmations, undefined, [
      plan,
      [falselyConfirmed]
    ])
    expect(falseResult.ready).toBe(false)
    expect(falseResult.blockers).toContainEqual(
      expect.objectContaining({ code: 'destructive-confirmation-invalid' })
    )
  })
})
