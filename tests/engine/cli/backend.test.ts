/* eslint-disable max-lines -- Backend CLI authority, local emission, audit, and ledger integration scenarios share one end-to-end harness. */
import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { SUPABASE_BACKEND_PROVIDER_DESCRIPTOR } from '@open-pencil/compiler/backend'
import {
  BACKEND_PRODUCTION_GATE_IDS,
  SOURCE_MIGRATION_AUTHORITY_REBIND_RECEIPT_FORMAT,
  SOURCE_MIGRATION_DRIFT_RECEIPT_FORMAT,
  STAGED_MIGRATION_EXECUTION_FORMAT,
  digestSourceMigrationAuthorityRebindReceipt,
  digestSourceMigrationDriftReceipt,
  digestStagedMigrationExecutionPlan,
  type SourceMigrationAuthorityRebindReceiptV1,
  type SourceMigrationDriftReceiptV1,
  type StagedMigrationExecutionTargetAuthorityV1,
  type StagedMigrationExecutionPlanV1
} from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import { runOpenPencilCLI } from '#tests/helpers/cli'

const temporaryDirectories: string[] = []

function backendApplicationFixture() {
  return {
    format: 'openpencil.backend-application',
    version: 1,
    applicationId: 'notes-app',
    dataModel: {
      version: 1,
      entities: [
        {
          id: 'notes',
          name: 'notes',
          management: 'managed',
          fields: [
            { id: 'id', name: 'id', type: 'uuid', nullable: false },
            { id: 'owner_id', name: 'owner_id', type: 'uuid', nullable: false },
            { id: 'title', name: 'title', type: 'string', nullable: true }
          ],
          primaryKey: { fields: ['id'] },
          indexes: [{ id: 'notes_owner_idx', fields: ['owner_id'] }]
        }
      ],
      enums: [],
      relations: []
    },
    auth: {
      version: 1,
      identities: [{ id: 'user', kind: 'user' }],
      roles: [],
      ownership: [{ id: 'note-owner', entityId: 'notes', identityFieldId: 'owner_id' }],
      tenants: [],
      rowAccess: [
        {
          id: 'owner-access',
          entityId: 'notes',
          effect: 'allow',
          operations: ['select', 'insert', 'update', 'delete'],
          principal: { kind: 'owner', ownershipId: 'note-owner' }
        }
      ]
    },
    workflows: { version: 1, workflows: [] },
    capabilities: [
      { capability: 'auth.identity', required: true },
      { capability: 'data.read', required: true },
      { capability: 'data.write', required: true },
      { capability: 'migrations.schema', required: true },
      { capability: 'policy.row-level', required: true }
    ],
    secrets: [
      {
        kind: 'environment',
        name: 'BACKEND_PUBLIC_KEY',
        exposure: 'client-public',
        required: true
      }
    ]
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  )
})

async function workspace(): Promise<{ root: string; application: string }> {
  const root = await mkdtemp(join(tmpdir(), 'openpencil-backend-cli-'))
  temporaryDirectories.push(root)
  const application = join(root, 'application.json')
  await writeFile(application, JSON.stringify(backendApplicationFixture()), 'utf8')
  return { root, application }
}

async function passedGateValues() {
  const checkedAt = '2026-08-30T00:00:00Z'
  return Promise.all(
    BACKEND_PRODUCTION_GATE_IDS.map(async (gate) => ({
      gate,
      status: 'passed' as const,
      checkedAt,
      evidenceDigest: await digestCanonicalManifest({ gate, checkedAt })
    }))
  )
}

async function passedGates(path: string): Promise<string> {
  const gates = await passedGateValues()
  await writeFile(path, JSON.stringify(gates), 'utf8')
  return path
}

interface BackendCLIReport {
  [key: string]: unknown
}

function jsonReport(stdout: string): BackendCLIReport {
  const parsed: unknown = JSON.parse(stdout)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('CLI report must be a JSON object')
  }
  return parsed as BackendCLIReport
}

function sourceDigest(content: string): string {
  return createHash('sha256').update(content).digest('base64url')
}

describe('CLI backend local-only workflow', () => {
  test('initializes, transitions, and inspects a source migration ledger without remote authority', async () => {
    const { root } = await workspace()
    const ledgerPath = join(root, 'migration-ledger.json')
    const initialized = await runOpenPencilCLI([
      'backend',
      'ledger',
      'init',
      '--ledger-id',
      'supabase:project-test:promotion',
      '--created-at',
      '2026-09-04T00:00:00.000Z',
      '--output',
      ledgerPath,
      '--json'
    ])
    expect(initialized.exitCode).toBe(0)
    expect(jsonReport(initialized.stdout)).toMatchObject({
      operation: 'init',
      ledgerId: 'supabase:project-test:promotion',
      entries: 0,
      networkPerformed: false,
      applyPerformed: false,
      deployPerformed: false
    })

    const planDigest = await digestCanonicalManifest({ plan: 'source-plan' })
    const reviewManifestDigest = await digestCanonicalManifest({ review: 'source-review' })
    const fromModelDigest = await digestCanonicalManifest({ model: 'before' })
    const targetModelDigest = await digestCanonicalManifest({ model: 'after' })
    const registeredAt = '2026-09-04T00:01:00.000Z'
    const migrationSourcePath = 'supabase/migrations/20260904000100_expand-title.sql'
    const migrationSource =
      'BEGIN;\nALTER TABLE "public"."tasks" ADD COLUMN "title" text;\nCOMMIT;\n'
    const executionPlan: StagedMigrationExecutionPlanV1 = {
      format: STAGED_MIGRATION_EXECUTION_FORMAT,
      version: 1,
      executionId: 'execution:expand-title',
      changeId: 'change:title',
      sourceMigrationPlan: {
        version: 1,
        planId: 'migration:title',
        planDigest,
        fromModelDigest,
        targetModelDigest
      },
      phase: 'expand',
      predecessor: null,
      operations: [
        {
          operation: {
            id: 'reviewed:add-title',
            kind: 'apply-reviewed-migration',
            sourceOperationIds: ['op-0001'],
            reviewManifestDigest,
            migrationPlanDigest: planDigest,
            sqlDigest: sourceDigest(migrationSource),
            appliesTo: 'reviewed-source-sql'
          },
          risk: 'low'
        }
      ],
      highestRisk: 'low',
      requiresHumanApproval: false
    }
    const migrationSourceFile = join(root, migrationSourcePath)
    await mkdir(dirname(migrationSourceFile), { recursive: true })
    await writeFile(migrationSourceFile, migrationSource, 'utf8')
    const eventPath = join(root, 'register-event.json')
    await writeFile(
      eventPath,
      JSON.stringify({
        type: 'register-migration',
        entry: {
          migrationId: 'migration:0001:expand-title',
          sequence: 1,
          name: 'expand title',
          source: {
            path: migrationSourcePath,
            digest: sourceDigest(migrationSource)
          },
          executionPlan,
          executionPlanDigest: await digestStagedMigrationExecutionPlan(executionPlan),
          registeredAt
        },
        occurredAt: registeredAt
      }),
      'utf8'
    )
    const transitionedPath = join(root, 'migration-ledger-next.json')
    const transitioned = await runOpenPencilCLI([
      'backend',
      'ledger',
      'transition',
      ledgerPath,
      '--event',
      eventPath,
      '--source-root',
      root,
      '--output',
      transitionedPath,
      '--json'
    ])
    expect(transitioned.exitCode).toBe(0)
    expect(jsonReport(transitioned.stdout)).toMatchObject({
      operation: 'transition',
      entries: 1,
      eventType: 'register-migration',
      sourceFilesVerified: true,
      sourceFileCount: 1,
      sourceFileBytes: Buffer.byteLength(migrationSource),
      networkPerformed: false,
      applyPerformed: false,
      deployPerformed: false
    })

    const inspected = await runOpenPencilCLI([
      'backend',
      'ledger',
      'inspect',
      transitionedPath,
      '--source-root',
      root,
      '--json'
    ])
    expect(inspected.exitCode).toBe(0)
    expect(jsonReport(inspected.stdout)).toMatchObject({
      operation: 'inspect',
      entries: 1,
      promotions: 0,
      driftRecords: 0,
      recoveryRecords: 0,
      sourceFilesVerified: true,
      sourceFileCount: 1,
      sourceFileBytes: Buffer.byteLength(migrationSource),
      environments: [
        { environment: 'dev', drift: 'unknown' },
        { environment: 'staging', drift: 'unknown' },
        { environment: 'production', drift: 'unknown' }
      ]
    })

    const repeated = await runOpenPencilCLI([
      'backend',
      'ledger',
      'transition',
      ledgerPath,
      '--event',
      eventPath,
      '--source-root',
      root,
      '--output',
      transitionedPath,
      '--json'
    ])
    expect(repeated.exitCode).toBe(1)
    expect(repeated.stderr).toContain('never overwritten')

    await writeFile(migrationSourceFile, `${migrationSource}-- tampered\n`, 'utf8')
    const tampered = await runOpenPencilCLI([
      'backend',
      'ledger',
      'inspect',
      transitionedPath,
      '--source-root',
      root,
      '--json'
    ])
    expect(tampered.exitCode).toBe(1)
    expect(tampered.stderr).toContain('digest does not match')

    const unverifiedOutput = join(root, 'unverified-transition.json')
    const blockedTransition = await runOpenPencilCLI([
      'backend',
      'ledger',
      'transition',
      ledgerPath,
      '--event',
      eventPath,
      '--source-root',
      root,
      '--output',
      unverifiedOutput,
      '--json'
    ])
    expect(blockedTransition.exitCode).toBe(1)
    expect(blockedTransition.stderr).toContain('digest does not match')
    await expect(readFile(unverifiedOutput, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    await rm(migrationSourceFile)
    const missing = await runOpenPencilCLI([
      'backend',
      'ledger',
      'inspect',
      transitionedPath,
      '--source-root',
      root,
      '--json'
    ])
    expect(missing.exitCode).toBe(1)
    expect(missing.stderr).toContain('missing or inaccessible')

    const symlinkTarget = join(root, 'migration-source-target.sql')
    await writeFile(symlinkTarget, migrationSource, 'utf8')
    await symlink(symlinkTarget, migrationSourceFile)
    const linked = await runOpenPencilCLI([
      'backend',
      'ledger',
      'inspect',
      transitionedPath,
      '--source-root',
      root,
      '--json'
    ])
    expect(linked.exitCode).toBe(1)
    expect(linked.stderr).toContain('must not contain symbolic links')

    const unsafeLedgerPath = join(root, 'unsafe-migration-ledger.json')
    const unsafeLedger = JSON.parse(await readFile(transitionedPath, 'utf8')) as {
      entries: Array<{ source: { path: string } }>
    }
    unsafeLedger.entries[0].source.path = '../escaped.sql'
    await writeFile(unsafeLedgerPath, JSON.stringify(unsafeLedger), 'utf8')
    const escaped = await runOpenPencilCLI([
      'backend',
      'ledger',
      'inspect',
      unsafeLedgerPath,
      '--source-root',
      root,
      '--json'
    ])
    expect(escaped.exitCode).toBe(1)
    expect(escaped.stderr).toContain('backend-migration-ledger-source-path-invalid')
  })

  test('exposes an append-only grantGeneration authority rebind through the offline CLI', async () => {
    const { root } = await workspace()
    const initialPath = join(root, 'authority-ledger.json')
    const initialized = await runOpenPencilCLI([
      'backend',
      'ledger',
      'init',
      '--ledger-id',
      'supabase:authority-rotation',
      '--created-at',
      '2026-09-04T00:00:00.000Z',
      '--output',
      initialPath,
      '--json'
    ])
    expect(initialized.exitCode).toBe(0)

    const schemaDigest = sourceDigest('schema:baseline')
    const providerAuthorityDigest = sourceDigest('provider:authority')
    const previousAuthority: StagedMigrationExecutionTargetAuthorityV1 = {
      providerId: 'supabase',
      providerAuthorityDigest,
      projectRef: 'project-dev',
      accountId: 'account-dev',
      grantGeneration: 'grant-dev-1',
      environment: 'dev'
    }
    const nextAuthority = { ...previousAuthority, grantGeneration: 'grant-dev-2' }
    const transition = async (
      ledger: string,
      event: unknown,
      name: string
    ): Promise<{ output: string; report: BackendCLIReport }> => {
      const eventPath = join(root, `${name}-event.json`)
      const output = join(root, `${name}-ledger.json`)
      await writeFile(eventPath, JSON.stringify(event), 'utf8')
      const result = await runOpenPencilCLI([
        'backend',
        'ledger',
        'transition',
        ledger,
        '--event',
        eventPath,
        '--source-root',
        root,
        '--output',
        output,
        '--json'
      ])
      expect(result.exitCode).toBe(0)
      return { output, report: jsonReport(result.stdout) }
    }
    const driftEvent = async (
      driftId: string,
      expectedSchemaDigest: string | null,
      checkedAt: string
    ) => {
      const evidenceDigest = sourceDigest(`evidence:${driftId}`)
      const providerReceipt: SourceMigrationDriftReceiptV1 = {
        format: SOURCE_MIGRATION_DRIFT_RECEIPT_FORMAT,
        version: 1,
        receiptId: `receipt:${driftId}`,
        driftId,
        targetAuthority: previousAuthority,
        expectedSchemaDigest,
        observedSchemaDigest: schemaDigest,
        status: 'none',
        outcome: 'succeeded',
        checkedAt,
        evidenceDigest
      }
      return {
        type: 'record-drift',
        record: {
          driftId,
          environment: 'dev',
          targetAuthority: previousAuthority,
          expectedSchemaDigest,
          observedSchemaDigest: schemaDigest,
          status: 'none',
          providerReceipt,
          providerReceiptDigest: await digestSourceMigrationDriftReceipt(providerReceipt),
          evidenceDigest,
          checkedAt
        },
        occurredAt: checkedAt
      }
    }

    const bound = await transition(
      initialPath,
      await driftEvent('drift:dev:baseline', null, '2026-09-04T00:01:00.000Z'),
      'bound'
    )
    const verified = await transition(
      bound.output,
      await driftEvent('drift:dev:verified', schemaDigest, '2026-09-04T00:02:00.000Z'),
      'verified'
    )
    const latestNoDriftReceiptDigest = (
      JSON.parse(await readFile(verified.output, 'utf8')) as {
        driftRecords: Array<{ providerReceiptDigest: string }>
      }
    ).driftRecords.at(-1)?.providerReceiptDigest
    if (!latestNoDriftReceiptDigest) throw new Error('missing CLI no-drift fixture')
    const rebindId = 'authority-rebind:dev:grant-dev-2'
    const authorityReceipt = (
      role: SourceMigrationAuthorityRebindReceiptV1['role'],
      targetAuthority: StagedMigrationExecutionTargetAuthorityV1,
      checkedAt: string
    ): SourceMigrationAuthorityRebindReceiptV1 => ({
      format: SOURCE_MIGRATION_AUTHORITY_REBIND_RECEIPT_FORMAT,
      version: 1,
      receiptId: `authority-receipt:${role}:grant-dev-2`,
      rebindId,
      role,
      targetAuthority,
      schemaDigest,
      latestNoDriftReceiptDigest,
      unresolvedMutation: false,
      outcome: 'succeeded',
      checkedAt,
      evidenceDigest: sourceDigest(`authority-evidence:${role}`)
    })
    const previousAuthorityReceipt = authorityReceipt(
      'previous',
      previousAuthority,
      '2026-09-04T00:03:00.000Z'
    )
    const nextAuthorityReceipt = authorityReceipt('next', nextAuthority, '2026-09-04T00:04:00.000Z')
    const reboundAt = '2026-09-04T00:05:00.000Z'
    const rebound = await transition(
      verified.output,
      {
        type: 'rebind-environment-authority',
        record: {
          rebindId,
          environment: 'dev',
          previousTargetAuthority: previousAuthority,
          nextTargetAuthority: nextAuthority,
          schemaDigest,
          latestNoDriftId: 'drift:dev:verified',
          latestNoDriftReceiptDigest,
          previousAuthorityReceipt,
          previousAuthorityReceiptDigest:
            await digestSourceMigrationAuthorityRebindReceipt(previousAuthorityReceipt),
          nextAuthorityReceipt,
          nextAuthorityReceiptDigest:
            await digestSourceMigrationAuthorityRebindReceipt(nextAuthorityReceipt),
          approval: null,
          reboundAt
        },
        occurredAt: reboundAt
      },
      'rebound'
    )
    expect(rebound.report).toMatchObject({
      operation: 'transition',
      eventType: 'rebind-environment-authority',
      authorityRebindings: 1,
      sourceFilesVerified: true,
      sourceFileCount: 0,
      networkPerformed: false,
      applyPerformed: false
    })
    expect((rebound.report.environments as unknown[])[0]).toMatchObject({
      environment: 'dev',
      providerId: 'supabase',
      projectRef: 'project-dev',
      accountId: 'account-dev',
      grantGeneration: 'grant-dev-2',
      drift: 'none'
    })
  })

  test('validates and deterministically plans with explicit provider names', async () => {
    const { application } = await workspace()
    const validated = await runOpenPencilCLI(['backend', 'validate', application, '--json'])
    expect(validated.exitCode).toBe(0)
    expect(jsonReport(validated.stdout)).toMatchObject({
      operation: 'validate',
      valid: true,
      frontendHostingProvider: null,
      backendProvider: null,
      backendDeploymentRequired: true
    })

    const command = ['backend', 'plan', application, '--json']
    const [first, second] = await Promise.all([
      runOpenPencilCLI(command),
      runOpenPencilCLI(command)
    ])
    expect(first.exitCode).toBe(0)
    expect(second.exitCode).toBe(0)
    const firstReport = jsonReport(first.stdout)
    const secondReport = jsonReport(second.stdout)
    expect(firstReport).toMatchObject({
      operation: 'plan',
      frontendHostingProvider: null,
      backendProviderTrustDomain: 'cli-builtin',
      backendDeploymentRequired: true,
      backendProvider: {
        publisherId: 'open-pencil',
        providerId: 'supabase',
        permissions: []
      }
    })
    const cliPackageDigest = (firstReport.backendProvider as { packageDigest: string })
      .packageDigest
    const descriptorDigest = await digestCanonicalManifest(SUPABASE_BACKEND_PROVIDER_DESCRIPTOR)
    const expectedCLIAuthorityDigest = `sha256:${await digestCanonicalManifest({
      format: 'openpencil.cli-backend-provider-authority.v1',
      publisherId: 'open-pencil',
      descriptorDigest
    })}`
    expect(cliPackageDigest).toBe(expectedCLIAuthorityDigest)
    expect(cliPackageDigest).toMatch(/^sha256:[A-Za-z0-9_-]{43}$/)
    expect(cliPackageDigest.startsWith('app-bundle-sha256:')).toBe(false)
    expect((firstReport.plan as { planDigest: string }).planDigest).toBe(
      (secondReport.plan as { planDigest: string }).planDigest
    )
  })

  test('fails closed on invalid contracts and unsupported production target capability use', async () => {
    const { root, application } = await workspace()
    const invalidPath = join(root, 'invalid.json')
    await writeFile(
      invalidPath,
      JSON.stringify({ ...backendApplicationFixture(), secretValue: 'must-not-be-accepted' }),
      'utf8'
    )
    const invalid = await runOpenPencilCLI(['backend', 'validate', invalidPath, '--json'])
    expect(invalid.exitCode).toBe(1)
    expect(invalid.stderr).toContain('Backend validation failed closed')
    expect(invalid.stderr).not.toContain('must-not-be-accepted')

    const unsupported = await runOpenPencilCLI([
      'backend',
      'plan',
      application,
      '--target',
      'flutter',
      '--mode',
      'production',
      '--json'
    ])
    expect(unsupported.exitCode).toBe(1)
    expect(unsupported.stderr).toContain('backend-capability-source-only-mode-required')

    const flutterSourceOnly = await runOpenPencilCLI([
      'backend',
      'plan',
      application,
      '--target',
      'flutter',
      '--mode',
      'source-only-prototype',
      '--json'
    ])
    expect(flutterSourceOnly.exitCode).toBe(0)

    const vueProduction = await runOpenPencilCLI([
      'backend',
      'plan',
      application,
      '--target',
      'vue',
      '--mode',
      'production',
      '--json'
    ])
    expect(vueProduction.exitCode).toBe(0)
  })

  test('emits to a new directory and never overwrites an existing output', async () => {
    const { root, application } = await workspace()
    const output = join(root, 'backend-output')
    const emitted = await runOpenPencilCLI([
      'backend',
      'emit',
      application,
      '--output',
      output,
      '--json'
    ])
    expect(emitted.exitCode).toBe(0)
    const report = jsonReport(emitted.stdout)
    expect(report).toMatchObject({
      operation: 'emit',
      applyAvailable: false,
      applyPerformed: false
    })
    const manifestPath = join(output, 'openpencil-backend.manifest.json')
    const before = await readFile(manifestPath, 'utf8')
    expect(JSON.parse(before)).toMatchObject({ format: 'openpencil.backend-artifacts.v1' })

    const repeated = await runOpenPencilCLI([
      'backend',
      'emit',
      application,
      '--output',
      output,
      '--json'
    ])
    expect(repeated.exitCode).toBe(1)
    expect(repeated.stderr).toContain('never overwritten')
    expect(await readFile(manifestPath, 'utf8')).toBe(before)
  })

  test('treats missing and failed strict gates as blocking while never accepting a receipt', async () => {
    const { root, application } = await workspace()
    const missing = await runOpenPencilCLI(['backend', 'audit', application, '--json'])
    expect(missing.exitCode).toBe(1)
    const missingReport = jsonReport(missing.stdout)
    expect(missingReport).toMatchObject({
      strictProductionGatesReady: false,
      auditPassed: false,
      releaseReady: false,
      applyAvailable: false,
      applyPerformed: false,
      receipt: { provided: false, accepted: false }
    })
    expect(
      (missingReport.gates as Array<{ gate: string; status: string }>).find(
        (gate) => gate.gate === 'target-capabilities-supported'
      )
    ).toMatchObject({ status: 'unknown' })

    const gatesPath = await passedGates(join(root, 'gates.json'))
    const passedWithoutReceipt = await runOpenPencilCLI([
      'backend',
      'audit',
      application,
      '--gates',
      gatesPath,
      '--json'
    ])
    expect(passedWithoutReceipt.exitCode).toBe(1)
    expect(jsonReport(passedWithoutReceipt.stdout)).toMatchObject({
      strictProductionGatesReady: true,
      gateEvidenceTrusted: false,
      auditPassed: false,
      releaseReady: false,
      receipt: { provided: false, accepted: false }
    })

    const invalidReceiptPath = join(root, 'receipt.json')
    await writeFile(invalidReceiptPath, JSON.stringify({ secretValue: 'forbidden' }), 'utf8')
    const invalidReceipt = await runOpenPencilCLI([
      'backend',
      'audit',
      application,
      '--gates',
      gatesPath,
      '--receipt',
      invalidReceiptPath,
      '--json'
    ])
    expect(invalidReceipt.exitCode).toBe(1)
    expect(jsonReport(invalidReceipt.stdout)).toMatchObject({
      strictProductionGatesReady: true,
      auditPassed: false,
      receipt: { provided: true, schemaValid: false, accepted: false }
    })
    expect(invalidReceipt.stdout).not.toContain('forbidden')
  })

  test('blocks foreign document, plan, and artifact receipts even when all gates pass', async () => {
    const { root, application } = await workspace()
    const gatesPath = await passedGates(join(root, 'gates.json'))
    const planned = await runOpenPencilCLI(['backend', 'plan', application, '--json'])
    expect(planned.exitCode).toBe(0)
    const report = jsonReport(planned.stdout)
    const applicationDigest = report.applicationDigest as string
    const compilerPlan = report.plan as { planDigest: string }
    const artifactDigest = await digestCanonicalManifest({ artifact: 'local-placeholder' })
    const receipt = {
      format: 'openpencil.backend-release-receipt',
      version: 1,
      receiptId: 'receipt-local-shape',
      releaseId: 'release-local-shape',
      planId: 'plan-local-shape',
      planDigest: compilerPlan.planDigest,
      documentDigest: applicationDigest,
      irDigest: applicationDigest,
      compilerVersion: '0.15.0',
      target: 'react',
      environment: 'production',
      backendProvider: report.backendProvider,
      artifacts: {
        staticArtifactDigest: artifactDigest,
        serverArtifactDigest: artifactDigest,
        schemaArtifactDigest: artifactDigest
      },
      migration: {
        planId: 'migration-local-shape',
        planDigest: compilerPlan.planDigest,
        fromModelDigest: null,
        targetModelDigest: applicationDigest,
        operations: []
      },
      requiredEnvironmentNames: ['BACKEND_PUBLIC_KEY'],
      requiredCredentialRefs: [],
      remoteOperationIds: [],
      verifiedAt: '2026-08-30T00:00:00Z',
      gates: await passedGateValues(),
      outcome: 'succeeded',
      backendDeploymentRequired: false,
      failure: null
    }
    const foreignReceipts = [
      {
        ...receipt,
        documentDigest: await digestCanonicalManifest({ document: 'foreign' })
      },
      {
        ...receipt,
        planDigest: await digestCanonicalManifest({ plan: 'foreign' })
      },
      {
        ...receipt,
        artifacts: {
          ...receipt.artifacts,
          schemaArtifactDigest: await digestCanonicalManifest({ artifact: 'foreign' })
        }
      }
    ]
    for (const [index, foreignReceipt] of foreignReceipts.entries()) {
      const receiptPath = join(root, `foreign-receipt-${index}.json`)
      await writeFile(receiptPath, JSON.stringify(foreignReceipt), 'utf8')
      const audited = await runOpenPencilCLI([
        'backend',
        'audit',
        application,
        '--gates',
        gatesPath,
        '--receipt',
        receiptPath,
        '--json'
      ])
      expect(audited.exitCode).toBe(1)
      expect(jsonReport(audited.stdout)).toMatchObject({
        strictProductionGatesReady: true,
        auditPassed: false,
        releaseReady: false,
        receipt: {
          provided: true,
          schemaValid: true,
          authorityMatchesLocalPlan: false,
          accepted: false
        }
      })
    }
  })

  test('release performs only local emit and remains blocked before Apply', async () => {
    const { root, application } = await workspace()
    const gates = await passedGates(join(root, 'gates.json'))
    const output = join(root, 'release-output')
    const released = await runOpenPencilCLI([
      'backend',
      'release',
      application,
      '--gates',
      gates,
      '--frontend-hosting-provider',
      'static-host',
      '--output',
      output,
      '--json'
    ])
    expect(released.exitCode).toBe(1)
    expect(jsonReport(released.stdout)).toMatchObject({
      operation: 'release',
      status: 'blocked-before-apply',
      frontendHostingProvider: 'static-host',
      backendProvider: { providerId: 'supabase' },
      backendDeploymentRequired: true,
      strictProductionGatesReady: true,
      releaseReady: false,
      applyAvailable: false,
      applyPerformed: false,
      automaticRetryAllowed: false,
      receiptIssued: false,
      receipt: { accepted: false }
    })
    expect(await readFile(join(output, 'openpencil-backend.manifest.json'), 'utf8')).toContain(
      'openpencil.backend-artifacts.v1'
    )

    const help = await runOpenPencilCLI(['backend', '--help'])
    expect(help.exitCode).toBe(0)
    expect(help.stdout).not.toMatch(/^\s*apply\s/mu)
  })
})
