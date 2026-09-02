import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SUPABASE_BACKEND_PROVIDER_DESCRIPTOR } from '@open-pencil/compiler/backend'
import { BACKEND_PRODUCTION_GATE_IDS } from '@open-pencil/lowcode/backend'
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

describe('CLI backend local-only workflow', () => {
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

    for (const target of ['flutter', 'vue']) {
      const unsupported = await runOpenPencilCLI([
        'backend',
        'plan',
        application,
        '--target',
        target,
        '--mode',
        'production',
        '--json'
      ])
      expect(unsupported.exitCode).toBe(1)
      expect(unsupported.stderr).toContain('backend-capability-source-only-mode-required')

      const sourceOnly = await runOpenPencilCLI([
        'backend',
        'plan',
        application,
        '--target',
        target,
        '--mode',
        'source-only-prototype',
        '--json'
      ])
      expect(sourceOnly.exitCode).toBe(0)
    }
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
