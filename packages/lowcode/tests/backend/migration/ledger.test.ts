/* eslint-disable max-lines -- ledger transition, tamper, replay, recovery, and canonical Receipt scenarios share strict fixtures */
import { describe, expect, test } from 'bun:test'

import {
  SOURCE_MIGRATION_AUTHORITY_REBIND_RECEIPT_FORMAT,
  SOURCE_MIGRATION_LEDGER_FORMAT,
  SOURCE_MIGRATION_DRIFT_RECEIPT_FORMAT,
  SOURCE_MIGRATION_RECOVERY_POINT_FORMAT,
  SOURCE_MIGRATION_RECOVERY_RECEIPT_FORMAT,
  STAGED_MIGRATION_EXECUTION_FORMAT,
  STAGED_MIGRATION_EXECUTION_RECEIPT_FORMAT,
  SourceMigrationLedgerTransitionError,
  createSourceMigrationLedger,
  digestSourceMigrationAuthorityRebindReceipt,
  digestSourceMigrationDriftReceipt,
  digestSourceMigrationRecoveryPoint,
  digestSourceMigrationRecoveryReceipt,
  digestSourceMigrationLedger,
  digestStagedMigrationExecutionPlan,
  digestStagedMigrationExecutionReceipt,
  normalizeSourceMigrationLedger,
  transitionSourceMigrationLedger,
  validateSourceMigrationLedger,
  verifySourceMigrationLedgerIntegrity,
  type SourceMigrationHumanApprovalV1,
  type SourceMigrationAuthorityRebindReceiptV1,
  type SourceMigrationAuthorityRebindRecordV1,
  type SourceMigrationDriftReceiptV1,
  type SourceMigrationDriftRecordV1,
  type SourceMigrationLedgerEntryV1,
  type SourceMigrationLedgerV1,
  type SourceMigrationPromotionRecordV1,
  type SourceMigrationRecoveryPointV1,
  type SourceMigrationRecoveryReceiptV1,
  type SourceMigrationRecoveryRecordV1,
  type StagedMigrationExecutionPlanV1,
  type StagedMigrationExecutionReceiptV1,
  type StagedMigrationExecutionTargetAuthorityV1
} from '@open-pencil/lowcode/backend'

const digestValue = (character: string): string => `${character.repeat(42)}A`
const BASELINE = digestValue('A')
const SCHEMA_EXPAND = digestValue('B')
const SCHEMA_BACKFILL = digestValue('C')
const SCHEMA_CONTRACT = digestValue('D')
const SCHEMA_DRIFTED = digestValue('X')
const EVIDENCE = digestValue('E')
const PROVIDER_AUTHORITY = digestValue('P')

function targetAuthority(
  environment: StagedMigrationExecutionTargetAuthorityV1['environment'],
  projectRef = `project-${environment}`
): StagedMigrationExecutionTargetAuthorityV1 {
  return {
    providerId: 'supabase',
    providerAuthorityDigest: PROVIDER_AUTHORITY,
    projectRef,
    accountId: `account-${environment}`,
    grantGeneration: `grant-${environment}-1`,
    environment
  }
}

function planFor(
  phase: StagedMigrationExecutionPlanV1['phase'],
  predecessorDigest?: string
): StagedMigrationExecutionPlanV1 {
  const base = {
    format: STAGED_MIGRATION_EXECUTION_FORMAT,
    version: 1 as const,
    executionId: `execution:${phase}`,
    changeId: 'change:owner-field',
    sourceMigrationPlan: {
      version: 1 as const,
      planId: 'migration:v1',
      planDigest: digestValue('F'),
      fromModelDigest: digestValue('G'),
      targetModelDigest: digestValue('H')
    }
  }
  if (phase === 'expand') {
    return {
      ...base,
      phase,
      predecessor: null,
      operations: [
        {
          operation: {
            id: 'op:expand',
            kind: 'add-nullable-field',
            sourceOperationIds: ['source:add-field'],
            entityId: 'notes',
            field: { id: 'owner_id', name: 'owner_id', type: 'uuid', nullable: true }
          },
          risk: 'low'
        }
      ],
      highestRisk: 'low',
      requiresHumanApproval: false
    }
  }
  if (phase === 'backfill') {
    if (!predecessorDigest) throw new Error('backfill fixture requires predecessor')
    return {
      ...base,
      phase,
      predecessor: {
        phase: 'expand',
        executionPlanDigest: predecessorDigest,
        receiptRequired: true
      },
      operations: [
        {
          operation: {
            id: 'op:backfill',
            kind: 'backfill-field',
            sourceOperationIds: ['source:add-field'],
            entityId: 'notes',
            fieldId: 'owner_id',
            predicate: 'is-null',
            value: {
              kind: 'literal',
              fieldType: 'uuid',
              value: '123e4567-e89b-12d3-a456-426614174000'
            }
          },
          risk: 'high'
        }
      ],
      highestRisk: 'high',
      requiresHumanApproval: false
    }
  }
  if (!predecessorDigest) throw new Error('contract fixture requires predecessor')
  return {
    ...base,
    phase,
    predecessor: {
      phase: 'backfill',
      executionPlanDigest: predecessorDigest,
      receiptRequired: true
    },
    operations: [
      {
        operation: {
          id: 'op:contract',
          kind: 'retire-field',
          sourceOperationIds: ['source:drop-field'],
          entityId: 'notes',
          fieldId: 'legacy_owner_id',
          compatibilityEvidenceDigest: EVIDENCE
        },
        risk: 'destructive'
      }
    ],
    highestRisk: 'destructive',
    requiresHumanApproval: true
  }
}

async function entryFor(
  sequence: number,
  phase: StagedMigrationExecutionPlanV1['phase'],
  predecessorDigest?: string
): Promise<SourceMigrationLedgerEntryV1> {
  const executionPlan = planFor(phase, predecessorDigest)
  return {
    migrationId: `migration:${String(sequence).padStart(4, '0')}:${phase}`,
    sequence,
    name: `${phase} owner field`,
    source: {
      path: `supabase/migrations/20260903000${sequence}_${phase}_owner.sql`,
      digest: digestValue(String(sequence))
    },
    executionPlan,
    executionPlanDigest: await digestStagedMigrationExecutionPlan(executionPlan),
    registeredAt: `2026-09-03T08:0${sequence}:00.000Z`
  }
}

async function register(
  ledger: SourceMigrationLedgerV1,
  entry: SourceMigrationLedgerEntryV1
): Promise<SourceMigrationLedgerV1> {
  return transitionSourceMigrationLedger(ledger, {
    type: 'register-migration',
    entry,
    occurredAt: entry.registeredAt
  })
}

type DriftReceiptBinding = Pick<
  SourceMigrationDriftRecordV1,
  | 'driftId'
  | 'targetAuthority'
  | 'expectedSchemaDigest'
  | 'observedSchemaDigest'
  | 'status'
  | 'checkedAt'
>

async function driftProof(
  binding: DriftReceiptBinding,
  options: {
    outcome?: SourceMigrationDriftReceiptV1['outcome']
    receiptId?: string
  } = {}
): Promise<Pick<SourceMigrationDriftRecordV1, 'providerReceipt' | 'providerReceiptDigest'>> {
  const outcome = options.outcome ?? 'succeeded'
  const providerReceipt: SourceMigrationDriftReceiptV1 = {
    format: SOURCE_MIGRATION_DRIFT_RECEIPT_FORMAT,
    version: 1,
    receiptId: options.receiptId ?? `provider-receipt:${binding.driftId}`,
    driftId: binding.driftId,
    targetAuthority: binding.targetAuthority,
    expectedSchemaDigest: binding.expectedSchemaDigest,
    observedSchemaDigest: binding.observedSchemaDigest,
    status: binding.status,
    outcome,
    checkedAt: binding.checkedAt,
    evidenceDigest: outcome === 'succeeded' ? EVIDENCE : null
  }
  return {
    providerReceipt,
    providerReceiptDigest: await digestSourceMigrationDriftReceipt(providerReceipt)
  }
}

async function baseline(
  ledger: SourceMigrationLedgerV1,
  environment: 'dev' | 'staging' | 'production',
  checkedAt: string,
  observedSchemaDigest = BASELINE,
  authority = targetAuthority(environment)
): Promise<SourceMigrationLedgerV1> {
  const current = ledger.environments.find((entry) => entry.environment === environment)
  if (!current) throw new Error('missing environment fixture')
  const status: SourceMigrationDriftRecordV1['status'] =
    current.schemaDigest === null || current.schemaDigest === observedSchemaDigest
      ? 'none'
      : 'detected'
  const driftId = `drift:${environment}:${checkedAt.slice(11, 19).replaceAll(':', '-')}`
  const binding = {
    driftId,
    targetAuthority: authority,
    expectedSchemaDigest: current.schemaDigest,
    observedSchemaDigest,
    status,
    checkedAt
  }
  return transitionSourceMigrationLedger(ledger, {
    type: 'record-drift',
    record: {
      ...binding,
      environment,
      ...(await driftProof(binding)),
      evidenceDigest: EVIDENCE
    },
    occurredAt: checkedAt
  })
}

async function authorityRebindRecord(
  ledger: SourceMigrationLedgerV1,
  environment: 'dev' | 'staging' | 'production',
  nextGrantGeneration: string,
  times: { previousCheckedAt: string; nextCheckedAt: string; reboundAt: string },
  humanApproval: SourceMigrationHumanApprovalV1 | null = null
): Promise<SourceMigrationAuthorityRebindRecordV1> {
  const current = ledger.environments.find((entry) => entry.environment === environment)
  const latestDrift = [...ledger.driftRecords]
    .reverse()
    .find((entry) => entry.environment === environment)
  if (!current?.targetAuthority || !current.schemaDigest || !latestDrift)
    throw new Error('authority rebind fixture requires a bound, inspected environment')
  const rebindId = `authority-rebind:${environment}:${nextGrantGeneration}`
  const nextTargetAuthority = {
    ...current.targetAuthority,
    grantGeneration: nextGrantGeneration
  }
  const proof = (
    role: SourceMigrationAuthorityRebindReceiptV1['role'],
    authority: StagedMigrationExecutionTargetAuthorityV1,
    checkedAt: string,
    evidenceDigest: string
  ): SourceMigrationAuthorityRebindReceiptV1 => ({
    format: SOURCE_MIGRATION_AUTHORITY_REBIND_RECEIPT_FORMAT,
    version: 1,
    receiptId: `authority-proof:${role}:${nextGrantGeneration}`,
    rebindId,
    role,
    targetAuthority: authority,
    schemaDigest: current.schemaDigest as string,
    latestNoDriftReceiptDigest: latestDrift.providerReceiptDigest,
    unresolvedMutation: false,
    outcome: 'succeeded',
    checkedAt,
    evidenceDigest
  })
  const previousAuthorityReceipt = proof(
    'previous',
    current.targetAuthority,
    times.previousCheckedAt,
    digestValue(nextGrantGeneration.endsWith('-3') ? 'T' : 'R')
  )
  const nextAuthorityReceipt = proof(
    'next',
    nextTargetAuthority,
    times.nextCheckedAt,
    digestValue(nextGrantGeneration.endsWith('-3') ? 'U' : 'S')
  )
  return {
    rebindId,
    environment,
    previousTargetAuthority: current.targetAuthority,
    nextTargetAuthority,
    schemaDigest: current.schemaDigest,
    latestNoDriftId: latestDrift.driftId,
    latestNoDriftReceiptDigest: latestDrift.providerReceiptDigest,
    previousAuthorityReceipt,
    previousAuthorityReceiptDigest:
      await digestSourceMigrationAuthorityRebindReceipt(previousAuthorityReceipt),
    nextAuthorityReceipt,
    nextAuthorityReceiptDigest:
      await digestSourceMigrationAuthorityRebindReceipt(nextAuthorityReceipt),
    approval: humanApproval,
    reboundAt: times.reboundAt
  }
}

function approval(
  scopes: SourceMigrationHumanApprovalV1['scopes'],
  approvedAt: string
): SourceMigrationHumanApprovalV1 {
  return {
    approved: true,
    approvedBy: 'reviewer:alice',
    scopes,
    evidenceDigest: EVIDENCE,
    approvedAt
  }
}

type RecoveryReceiptBinding = Pick<
  SourceMigrationRecoveryRecordV1,
  | 'recoveryId'
  | 'kind'
  | 'targetAuthority'
  | 'removedMigrationIds'
  | 'resultingAppliedMigrationIds'
  | 'fromSchemaDigest'
  | 'toSchemaDigest'
  | 'recordedAt'
>

async function recoveryProof(
  binding: RecoveryReceiptBinding,
  options: {
    outcome?: SourceMigrationRecoveryReceiptV1['outcome']
    receiptId?: string
  } = {}
): Promise<Pick<SourceMigrationRecoveryRecordV1, 'providerReceipt' | 'providerReceiptDigest'>> {
  const outcome = options.outcome ?? 'succeeded'
  const recoveryPoint: SourceMigrationRecoveryPointV1 | null =
    binding.kind === 'restore'
      ? {
          format: SOURCE_MIGRATION_RECOVERY_POINT_FORMAT,
          version: 1,
          recoveryPointId: `recovery-point:${binding.recoveryId}`,
          targetAuthority: binding.targetAuthority,
          appliedMigrationIds: [...binding.resultingAppliedMigrationIds],
          schemaDigest: binding.toSchemaDigest,
          capturedAt: new Date(Date.parse(binding.recordedAt) - 1).toISOString(),
          evidenceDigest: digestValue('Q')
        }
      : null
  const providerReceipt: SourceMigrationRecoveryReceiptV1 = {
    format: SOURCE_MIGRATION_RECOVERY_RECEIPT_FORMAT,
    version: 1,
    receiptId: options.receiptId ?? `provider-receipt:${binding.recoveryId}`,
    recoveryId: binding.recoveryId,
    kind: binding.kind,
    targetAuthority: binding.targetAuthority,
    removedMigrationIds: [...binding.removedMigrationIds],
    resultingAppliedMigrationIds: [...binding.resultingAppliedMigrationIds],
    fromSchemaDigest: binding.fromSchemaDigest,
    toSchemaDigest: binding.toSchemaDigest,
    recoveryPoint,
    outcome,
    recordedAt: binding.recordedAt,
    evidenceDigest: outcome === 'succeeded' ? EVIDENCE : null
  }
  return {
    providerReceipt,
    providerReceiptDigest: await digestSourceMigrationRecoveryReceipt(providerReceipt)
  }
}

async function promotionFor(
  entry: SourceMigrationLedgerEntryV1,
  from: SourceMigrationPromotionRecordV1['from'],
  to: SourceMigrationPromotionRecordV1['to'],
  schemaBeforeDigest: string,
  schemaAfterDigest: string,
  promotedAt: string,
  humanApproval: SourceMigrationHumanApprovalV1 | null = null
): Promise<SourceMigrationPromotionRecordV1> {
  const executionReceipt: StagedMigrationExecutionReceiptV1 = {
    format: STAGED_MIGRATION_EXECUTION_RECEIPT_FORMAT,
    version: 1,
    receiptId: `receipt:${to}:${entry.sequence}`,
    executionId: entry.executionPlan.executionId,
    executionPlanDigest: entry.executionPlanDigest,
    phase: entry.executionPlan.phase,
    promotionFrom: from,
    targetAuthority: targetAuthority(to),
    schemaBeforeDigest,
    schemaAfterDigest,
    outcome: 'succeeded',
    recordedAt: promotedAt,
    evidenceDigest: EVIDENCE
  }
  return {
    promotionId: `promotion:${to}:${entry.sequence}`,
    migrationId: entry.migrationId,
    from,
    to,
    targetAuthority: targetAuthority(to),
    executionReceipt,
    executionReceiptDigest: await digestStagedMigrationExecutionReceipt(executionReceipt),
    schemaBeforeDigest,
    schemaAfterDigest,
    evidenceDigest: EVIDENCE,
    approval: humanApproval,
    promotedAt
  }
}

async function promote(
  ledger: SourceMigrationLedgerV1,
  record: SourceMigrationPromotionRecordV1
): Promise<SourceMigrationLedgerV1> {
  return transitionSourceMigrationLedger(ledger, {
    type: 'promote-migration',
    record,
    occurredAt: record.promotedAt
  })
}

describe('source migration ledger', () => {
  test('imports legacy v1 ledgers without authority history and normalizes the append-only field', () => {
    const current = createSourceMigrationLedger({
      ledgerId: 'ledger:legacy-v1',
      createdAt: '2026-09-03T08:00:00.000Z'
    })
    const legacy = structuredClone(current) as Partial<SourceMigrationLedgerV1>
    delete legacy.authorityRebindings

    expect(validateSourceMigrationLedger(legacy).ok).toBe(true)
    expect(normalizeSourceMigrationLedger(legacy).authorityRebindings).toEqual([])
    expect(legacy.authorityRebindings).toBeUndefined()
  })

  test('binds reviewed source SQL and migration plan digests into ledger registration', async () => {
    const ledger = createSourceMigrationLedger({
      ledgerId: 'ledger:reviewed-source-binding',
      createdAt: '2026-09-03T08:00:00.000Z'
    })
    const reviewed = await entryFor(1, 'expand')
    reviewed.executionPlan.operations = [
      {
        operation: {
          id: 'op:reviewed-source',
          kind: 'apply-reviewed-migration',
          sourceOperationIds: ['source:reviewed'],
          reviewManifestDigest: digestValue('V'),
          migrationPlanDigest: reviewed.executionPlan.sourceMigrationPlan.planDigest,
          sqlDigest: reviewed.source.digest,
          appliesTo: 'reviewed-source-sql'
        },
        risk: 'low'
      }
    ]
    reviewed.executionPlanDigest = await digestStagedMigrationExecutionPlan(reviewed.executionPlan)
    expect((await register(ledger, reviewed)).entries).toHaveLength(1)

    const sqlMismatch = structuredClone(reviewed)
    const sqlOperation = sqlMismatch.executionPlan.operations[0].operation
    if (sqlOperation.kind !== 'apply-reviewed-migration')
      throw new Error('missing reviewed SQL fixture')
    sqlOperation.sqlDigest = digestValue('W')
    sqlMismatch.executionPlanDigest = await digestStagedMigrationExecutionPlan(
      sqlMismatch.executionPlan
    )
    await expect(register(ledger, sqlMismatch)).rejects.toMatchObject({
      code: 'backend-migration-ledger-entry-invalid'
    })

    const planMismatch = structuredClone(reviewed)
    const planOperation = planMismatch.executionPlan.operations[0].operation
    if (planOperation.kind !== 'apply-reviewed-migration')
      throw new Error('missing reviewed plan fixture')
    planOperation.migrationPlanDigest = digestValue('Y')
    planMismatch.executionPlanDigest = await digestStagedMigrationExecutionPlan(
      planMismatch.executionPlan
    )
    await expect(register(ledger, planMismatch)).rejects.toMatchObject({
      code: 'backend-migration-ledger-entry-invalid'
    })
  })

  test('rebinds only grantGeneration after fresh no-drift and dual Provider proofs', async () => {
    let ledger = createSourceMigrationLedger({
      ledgerId: 'ledger:authority-rebind',
      createdAt: '2026-09-03T08:00:00.000Z'
    })
    ledger = await baseline(ledger, 'dev', '2026-09-03T08:01:00.000Z')
    ledger = await baseline(ledger, 'dev', '2026-09-03T08:02:00.000Z')
    const first = await authorityRebindRecord(ledger, 'dev', 'grant-dev-2', {
      previousCheckedAt: '2026-09-03T08:03:00.000Z',
      nextCheckedAt: '2026-09-03T08:04:00.000Z',
      reboundAt: '2026-09-03T08:05:00.000Z'
    })
    ledger = await transitionSourceMigrationLedger(ledger, {
      type: 'rebind-environment-authority',
      record: first,
      occurredAt: first.reboundAt
    })
    expect(ledger.authorityRebindings).toHaveLength(1)
    expect(ledger.environments[0]?.targetAuthority?.grantGeneration).toBe('grant-dev-2')
    expect(ledger.driftRecords[0]?.targetAuthority.grantGeneration).toBe('grant-dev-1')
    expect((await verifySourceMigrationLedgerIntegrity(ledger)).ok).toBe(true)

    const withoutFreshDrift = await authorityRebindRecord(ledger, 'dev', 'grant-dev-3', {
      previousCheckedAt: '2026-09-03T08:06:00.000Z',
      nextCheckedAt: '2026-09-03T08:07:00.000Z',
      reboundAt: '2026-09-03T08:08:00.000Z'
    })
    await expect(
      transitionSourceMigrationLedger(ledger, {
        type: 'rebind-environment-authority',
        record: withoutFreshDrift,
        occurredAt: withoutFreshDrift.reboundAt
      })
    ).rejects.toMatchObject({
      code: 'backend-migration-ledger-authority-rebind-no-drift-stale'
    })

    ledger = await baseline(
      ledger,
      'dev',
      '2026-09-03T08:06:00.000Z',
      BASELINE,
      first.nextTargetAuthority
    )
    const second = await authorityRebindRecord(ledger, 'dev', 'grant-dev-3', {
      previousCheckedAt: '2026-09-03T08:07:00.000Z',
      nextCheckedAt: '2026-09-03T08:08:00.000Z',
      reboundAt: '2026-09-03T08:09:00.000Z'
    })
    ledger = await transitionSourceMigrationLedger(ledger, {
      type: 'rebind-environment-authority',
      record: second,
      occurredAt: second.reboundAt
    })
    expect(ledger.authorityRebindings).toHaveLength(2)
    expect(ledger.environments[0]?.targetAuthority?.grantGeneration).toBe('grant-dev-3')

    const silentlyMutated = structuredClone(ledger)
    const dev = silentlyMutated.environments.find((entry) => entry.environment === 'dev')
    if (!dev?.targetAuthority) throw new Error('missing rebound environment fixture')
    dev.targetAuthority.grantGeneration = 'grant-dev-silent'
    const result = validateSourceMigrationLedger(silentlyMutated)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.diagnostics.map((entry) => entry.code)).toContain(
        'backend-migration-ledger-environment-state-mismatch'
      )
    }
  })

  test('rejects foreign scope, unchanged generation, unresolved mutation, and proof tampering', async () => {
    let ledger = createSourceMigrationLedger({
      ledgerId: 'ledger:authority-rebind-blocked',
      createdAt: '2026-09-03T08:00:00.000Z'
    })
    ledger = await baseline(ledger, 'staging', '2026-09-03T08:01:00.000Z')
    ledger = await baseline(ledger, 'staging', '2026-09-03T08:02:00.000Z')
    const valid = await authorityRebindRecord(ledger, 'staging', 'grant-staging-2', {
      previousCheckedAt: '2026-09-03T08:03:00.000Z',
      nextCheckedAt: '2026-09-03T08:04:00.000Z',
      reboundAt: '2026-09-03T08:05:00.000Z'
    })

    const foreignProject = structuredClone(valid)
    foreignProject.nextTargetAuthority.projectRef = 'project-attacker'
    foreignProject.nextAuthorityReceipt.targetAuthority = foreignProject.nextTargetAuthority
    foreignProject.nextAuthorityReceiptDigest = await digestSourceMigrationAuthorityRebindReceipt(
      foreignProject.nextAuthorityReceipt
    )
    await expect(
      transitionSourceMigrationLedger(ledger, {
        type: 'rebind-environment-authority',
        record: foreignProject,
        occurredAt: foreignProject.reboundAt
      })
    ).rejects.toMatchObject({
      code: 'backend-migration-ledger-authority-rebind-record-invalid'
    })

    const unchangedGeneration = structuredClone(valid)
    unchangedGeneration.nextTargetAuthority.grantGeneration =
      unchangedGeneration.previousTargetAuthority.grantGeneration
    unchangedGeneration.nextAuthorityReceipt.targetAuthority =
      unchangedGeneration.nextTargetAuthority
    unchangedGeneration.nextAuthorityReceiptDigest =
      await digestSourceMigrationAuthorityRebindReceipt(unchangedGeneration.nextAuthorityReceipt)
    await expect(
      transitionSourceMigrationLedger(ledger, {
        type: 'rebind-environment-authority',
        record: unchangedGeneration,
        occurredAt: unchangedGeneration.reboundAt
      })
    ).rejects.toMatchObject({
      code: 'backend-migration-ledger-authority-rebind-record-invalid'
    })

    const unresolvedMutation = structuredClone(valid)
    Reflect.set(unresolvedMutation.nextAuthorityReceipt, 'unresolvedMutation', true)
    await expect(
      transitionSourceMigrationLedger(ledger, {
        type: 'rebind-environment-authority',
        record: unresolvedMutation,
        occurredAt: unresolvedMutation.reboundAt
      })
    ).rejects.toMatchObject({
      code: 'backend-migration-ledger-authority-rebind-record-invalid'
    })

    await expect(
      transitionSourceMigrationLedger(ledger, {
        type: 'rebind-environment-authority',
        record: { ...valid, nextAuthorityReceiptDigest: digestValue('Z') },
        occurredAt: valid.reboundAt
      })
    ).rejects.toMatchObject({
      code: 'backend-migration-ledger-authority-rebind-receipt-digest-mismatch'
    })
  })

  test('requires exact production approval for an authority rebind', async () => {
    let ledger = createSourceMigrationLedger({
      ledgerId: 'ledger:production-authority-rebind',
      createdAt: '2026-09-03T08:00:00.000Z'
    })
    ledger = await baseline(ledger, 'production', '2026-09-03T08:01:00.000Z')
    ledger = await baseline(ledger, 'production', '2026-09-03T08:02:00.000Z')
    const unapproved = await authorityRebindRecord(ledger, 'production', 'grant-production-2', {
      previousCheckedAt: '2026-09-03T08:03:00.000Z',
      nextCheckedAt: '2026-09-03T08:04:00.000Z',
      reboundAt: '2026-09-03T08:05:00.000Z'
    })
    await expect(
      transitionSourceMigrationLedger(ledger, {
        type: 'rebind-environment-authority',
        record: unapproved,
        occurredAt: unapproved.reboundAt
      })
    ).rejects.toMatchObject({ code: 'backend-migration-ledger-approval-required' })

    const approved = {
      ...unapproved,
      approval: approval(['production'], '2026-09-03T08:04:30.000Z')
    }
    ledger = await transitionSourceMigrationLedger(ledger, {
      type: 'rebind-environment-authority',
      record: approved,
      occurredAt: approved.reboundAt
    })
    expect(ledger.environments[2]?.targetAuthority?.grantGeneration).toBe('grant-production-2')
  })

  test('is canonical across history order and verifies embedded plan digests', async () => {
    let ledger = createSourceMigrationLedger({
      ledgerId: 'ledger:main',
      createdAt: '2026-09-03T08:00:00.000Z'
    })
    const entry = await entryFor(1, 'expand')
    ledger = await register(ledger, entry)
    ledger = await baseline(ledger, 'staging', '2026-09-03T08:09:00.000Z')
    ledger = await baseline(ledger, 'dev', '2026-09-03T08:10:00.000Z')
    expect(ledger.driftRecords.map((record) => record.environment)).toEqual(['staging', 'dev'])

    const shuffled = structuredClone(ledger)
    shuffled.driftRecords.reverse()
    const normalized = normalizeSourceMigrationLedger(shuffled)
    expect(normalized.driftRecords.map((record) => record.environment)).toEqual(['staging', 'dev'])
    expect(await digestSourceMigrationLedger(shuffled)).toBe(
      await digestSourceMigrationLedger(ledger)
    )
    expect((await verifySourceMigrationLedgerIntegrity(ledger)).ok).toBe(true)

    const tampered = structuredClone(ledger)
    tampered.entries[0].executionPlanDigest = digestValue('Z')
    expect((await verifySourceMigrationLedgerIntegrity(tampered)).ok).toBe(false)
  })

  test('accepts only exact successful canonical drift Receipts and rejects replay or tampering', async () => {
    let ledger = createSourceMigrationLedger({
      ledgerId: 'ledger:drift-receipt',
      createdAt: '2026-09-03T08:00:00.000Z'
    })
    const authority = targetAuthority('dev')
    const blockedOutcomes = ['failed', 'outcome-unknown'] as const
    for (const [index, outcome] of blockedOutcomes.entries()) {
      const checkedAt = `2026-09-03T08:0${index + 1}:00.000Z`
      const binding = {
        driftId: `drift:blocked:${outcome}`,
        targetAuthority: authority,
        expectedSchemaDigest: null,
        observedSchemaDigest: BASELINE,
        status: 'none' as const,
        checkedAt
      }
      await expect(
        transitionSourceMigrationLedger(ledger, {
          type: 'record-drift',
          record: {
            ...binding,
            environment: 'dev',
            ...(await driftProof(binding, { outcome })),
            evidenceDigest: EVIDENCE
          },
          occurredAt: checkedAt
        })
      ).rejects.toMatchObject({ code: 'backend-migration-ledger-drift-record-invalid' })
    }
    expect(ledger.driftRecords).toHaveLength(0)
    expect(ledger.environments[0]).toMatchObject({
      targetAuthority: null,
      schemaDigest: null,
      drift: 'unknown'
    })

    const checkedAt = '2026-09-03T08:03:00.000Z'
    const binding = {
      driftId: 'drift:successful:dev',
      targetAuthority: authority,
      expectedSchemaDigest: null,
      observedSchemaDigest: BASELINE,
      status: 'none' as const,
      checkedAt
    }
    const successfulRecord: SourceMigrationDriftRecordV1 = {
      ...binding,
      environment: 'dev',
      ...(await driftProof(binding)),
      evidenceDigest: EVIDENCE
    }
    const receiptBindingTamperCases: Array<(receipt: SourceMigrationDriftReceiptV1) => void> = [
      (receipt) => {
        receipt.driftId = 'drift:provider-rebound:dev'
      },
      (receipt) => {
        receipt.targetAuthority = {
          ...receipt.targetAuthority,
          projectRef: 'project-attacker'
        }
      },
      (receipt) => {
        receipt.expectedSchemaDigest = BASELINE
        receipt.observedSchemaDigest = SCHEMA_DRIFTED
        receipt.status = 'detected'
      },
      (receipt) => {
        receipt.checkedAt = '2026-09-03T08:02:59.999Z'
      },
      (receipt) => {
        receipt.evidenceDigest = digestValue('Z')
      }
    ]
    for (const mutateReceipt of receiptBindingTamperCases) {
      const tamperedRecord = structuredClone(successfulRecord)
      mutateReceipt(tamperedRecord.providerReceipt)
      tamperedRecord.providerReceiptDigest = await digestSourceMigrationDriftReceipt(
        tamperedRecord.providerReceipt
      )
      await expect(
        transitionSourceMigrationLedger(ledger, {
          type: 'record-drift',
          record: tamperedRecord,
          occurredAt: checkedAt
        })
      ).rejects.toMatchObject({ code: 'backend-migration-ledger-drift-record-invalid' })
    }
    await expect(
      transitionSourceMigrationLedger(ledger, {
        type: 'record-drift',
        record: { ...successfulRecord, providerReceiptDigest: digestValue('Z') },
        occurredAt: checkedAt
      })
    ).rejects.toMatchObject({ code: 'backend-migration-ledger-drift-receipt-digest-mismatch' })

    ledger = await transitionSourceMigrationLedger(ledger, {
      type: 'record-drift',
      record: successfulRecord,
      occurredAt: checkedAt
    })
    expect(ledger.driftRecords).toHaveLength(1)
    expect(ledger.environments[0]).toMatchObject({
      targetAuthority: authority,
      schemaDigest: BASELINE,
      drift: 'none'
    })

    const replayBinding = {
      ...binding,
      driftId: 'drift:replayed:dev',
      expectedSchemaDigest: BASELINE,
      checkedAt: '2026-09-03T08:04:00.000Z'
    }
    await expect(
      transitionSourceMigrationLedger(ledger, {
        type: 'record-drift',
        record: {
          ...replayBinding,
          environment: 'dev',
          ...(await driftProof(replayBinding, {
            receiptId: successfulRecord.providerReceipt.receiptId
          })),
          evidenceDigest: EVIDENCE
        },
        occurredAt: replayBinding.checkedAt
      })
    ).rejects.toMatchObject({ code: 'backend-migration-ledger-drift-receipt-reused' })

    const outerEvidenceTamper = structuredClone(ledger)
    outerEvidenceTamper.driftRecords[0].evidenceDigest = digestValue('Z')
    const outerEvidenceResult = validateSourceMigrationLedger(outerEvidenceTamper)
    expect(outerEvidenceResult.ok).toBe(false)
    if (!outerEvidenceResult.ok) {
      expect(outerEvidenceResult.diagnostics.map((entry) => entry.code)).toContain(
        'backend-migration-ledger-drift-receipt-mismatch'
      )
    }

    const receiptTamper = structuredClone(ledger)
    receiptTamper.driftRecords[0].providerReceipt.evidenceDigest = digestValue('Z')
    receiptTamper.driftRecords[0].evidenceDigest = digestValue('Z')
    const receiptTamperResult = await verifySourceMigrationLedgerIntegrity(receiptTamper)
    expect(receiptTamperResult.ok).toBe(false)
    if (!receiptTamperResult.ok) {
      expect(receiptTamperResult.diagnostics.map((entry) => entry.code)).toContain(
        'backend-migration-ledger-drift-receipt-digest-mismatch'
      )
    }
  })

  test('promotes only dev to staging to production and requires production approval evidence', async () => {
    let ledger = createSourceMigrationLedger({
      ledgerId: 'ledger:promotion',
      createdAt: '2026-09-03T08:00:00.000Z'
    })
    const entry = await entryFor(1, 'expand')
    ledger = await register(ledger, entry)
    ledger = await baseline(ledger, 'dev', '2026-09-03T08:10:00.000Z')
    ledger = await baseline(ledger, 'staging', '2026-09-03T08:11:00.000Z')
    ledger = await baseline(ledger, 'production', '2026-09-03T08:12:00.000Z')

    ledger = await promote(
      ledger,
      await promotionFor(
        entry,
        'source',
        'dev',
        BASELINE,
        SCHEMA_EXPAND,
        '2026-09-03T08:20:00.000Z'
      )
    )
    ledger = await promote(
      ledger,
      await promotionFor(
        entry,
        'dev',
        'staging',
        BASELINE,
        SCHEMA_EXPAND,
        '2026-09-03T08:21:00.000Z'
      )
    )
    const unapprovedProduction = await promotionFor(
      entry,
      'staging',
      'production',
      BASELINE,
      SCHEMA_EXPAND,
      '2026-09-03T08:22:00.000Z'
    )
    await expect(promote(ledger, unapprovedProduction)).rejects.toMatchObject({
      code: 'backend-migration-ledger-approval-required'
    })

    ledger = await promote(ledger, {
      ...unapprovedProduction,
      approval: approval(['production'], '2026-09-03T08:22:00.000Z')
    })
    expect(
      ledger.environments.find((environment) => environment.environment === 'production')
        ?.appliedMigrationIds
    ).toEqual([entry.migrationId])
    expect(validateSourceMigrationLedger(ledger).ok).toBe(true)

    const divergentHistory = structuredClone(ledger)
    const divergentStagingPromotion = divergentHistory.promotions.find(
      (promotion) => promotion.to === 'staging'
    )
    const divergentStagingEnvironment = divergentHistory.environments.find(
      (environment) => environment.environment === 'staging'
    )
    if (!divergentStagingPromotion || !divergentStagingEnvironment)
      throw new Error('missing cross-environment schema fixture')
    divergentStagingPromotion.schemaAfterDigest = SCHEMA_BACKFILL
    divergentStagingPromotion.executionReceipt.schemaAfterDigest = SCHEMA_BACKFILL
    divergentStagingPromotion.executionReceiptDigest = await digestStagedMigrationExecutionReceipt(
      divergentStagingPromotion.executionReceipt
    )
    divergentStagingEnvironment.schemaDigest = SCHEMA_BACKFILL
    divergentStagingEnvironment.lastReceiptDigest = divergentStagingPromotion.executionReceiptDigest
    const divergentHistoryResult = await verifySourceMigrationLedgerIntegrity(divergentHistory)
    expect(divergentHistoryResult.ok).toBe(false)
    if (!divergentHistoryResult.ok) {
      expect(divergentHistoryResult.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        'backend-migration-ledger-source-schema-mismatch'
      )
    }

    const unknownHistory = structuredClone(ledger)
    const unknownPromotion = unknownHistory.promotions[0]
    const unknownEnvironment = unknownHistory.environments.find(
      (environment) => environment.environment === unknownPromotion?.to
    )
    if (!unknownPromotion || !unknownEnvironment)
      throw new Error('missing promotion outcome fixture')
    unknownPromotion.executionReceipt.outcome = 'outcome-unknown'
    unknownPromotion.executionReceipt.evidenceDigest = null
    unknownPromotion.executionReceiptDigest = await digestStagedMigrationExecutionReceipt(
      unknownPromotion.executionReceipt
    )
    unknownEnvironment.lastReceiptDigest = unknownPromotion.executionReceiptDigest
    const unknownHistoryResult = validateSourceMigrationLedger(unknownHistory)
    expect(unknownHistoryResult.ok).toBe(false)
    if (!unknownHistoryResult.ok) {
      expect(unknownHistoryResult.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        'backend-migration-ledger-execution-receipt-not-succeeded'
      )
    }
  })

  test('rejects cross-environment, cross-project, schema, time, and duplicate receipt replay', async () => {
    let ledger = createSourceMigrationLedger({
      ledgerId: 'ledger:receipt-authority',
      createdAt: '2026-09-03T08:00:00.000Z'
    })
    const entry = await entryFor(1, 'expand')
    ledger = await register(ledger, entry)
    ledger = await baseline(ledger, 'dev', '2026-09-03T08:10:00.000Z')
    ledger = await baseline(ledger, 'staging', '2026-09-03T08:11:00.000Z')
    const devPromotion = await promotionFor(
      entry,
      'source',
      'dev',
      BASELINE,
      SCHEMA_EXPAND,
      '2026-09-03T08:20:00.000Z'
    )
    ledger = await promote(ledger, devPromotion)

    const stagingPromotion = await promotionFor(
      entry,
      'dev',
      'staging',
      BASELINE,
      SCHEMA_EXPAND,
      '2026-09-03T08:21:00.000Z'
    )
    const divergentPromotion = await promotionFor(
      entry,
      'dev',
      'staging',
      BASELINE,
      SCHEMA_BACKFILL,
      '2026-09-03T08:21:00.000Z'
    )
    await expect(promote(ledger, divergentPromotion)).rejects.toMatchObject({
      code: 'backend-migration-ledger-source-schema-mismatch'
    })
    const unknownReceipt: StagedMigrationExecutionReceiptV1 = {
      ...stagingPromotion.executionReceipt,
      outcome: 'outcome-unknown',
      evidenceDigest: null
    }
    await expect(
      promote(ledger, {
        ...stagingPromotion,
        executionReceipt: unknownReceipt,
        executionReceiptDigest: await digestStagedMigrationExecutionReceipt(unknownReceipt)
      })
    ).rejects.toMatchObject({ code: 'backend-migration-ledger-execution-receipt-mismatch' })
    await expect(
      promote(ledger, {
        ...stagingPromotion,
        evidenceDigest: digestValue('Z')
      })
    ).rejects.toMatchObject({
      code: 'backend-migration-ledger-execution-receipt-evidence-mismatch'
    })

    const expectedStagingAuthority = targetAuthority('staging')
    const foreignAuthorities: StagedMigrationExecutionTargetAuthorityV1[] = [
      { ...expectedStagingAuthority, projectRef: 'project-attacker' },
      { ...expectedStagingAuthority, accountId: 'account-attacker' },
      { ...expectedStagingAuthority, grantGeneration: 'grant-staging-stale' },
      { ...expectedStagingAuthority, providerAuthorityDigest: digestValue('Q') }
    ]
    for (const foreignAuthority of foreignAuthorities) {
      const foreignReceipt = {
        ...stagingPromotion.executionReceipt,
        targetAuthority: foreignAuthority
      }
      await expect(
        promote(ledger, {
          ...stagingPromotion,
          executionReceipt: foreignReceipt,
          executionReceiptDigest: await digestStagedMigrationExecutionReceipt(foreignReceipt)
        })
      ).rejects.toMatchObject({
        code: 'backend-migration-ledger-execution-receipt-target-mismatch'
      })
    }

    await expect(
      promote(ledger, {
        ...stagingPromotion,
        schemaAfterDigest: SCHEMA_BACKFILL
      })
    ).rejects.toMatchObject({
      code: 'backend-migration-ledger-execution-receipt-target-mismatch'
    })

    await expect(
      promote(ledger, {
        ...stagingPromotion,
        promotedAt: '2026-09-03T08:21:01.000Z'
      })
    ).rejects.toMatchObject({
      code: 'backend-migration-ledger-execution-receipt-time-mismatch'
    })

    await expect(
      promote(ledger, {
        ...stagingPromotion,
        executionReceipt: devPromotion.executionReceipt,
        executionReceiptDigest: devPromotion.executionReceiptDigest
      })
    ).rejects.toMatchObject({
      code: 'backend-migration-ledger-execution-receipt-reused'
    })
  })

  test('blocks promotion on drift and records in-place recovery evidence', async () => {
    let ledger = createSourceMigrationLedger({
      ledgerId: 'ledger:drift',
      createdAt: '2026-09-03T08:00:00.000Z'
    })
    const entry = await entryFor(1, 'expand')
    ledger = await register(ledger, entry)
    ledger = await baseline(ledger, 'dev', '2026-09-03T08:10:00.000Z')
    ledger = await baseline(ledger, 'dev', '2026-09-03T08:11:00.000Z', SCHEMA_DRIFTED)
    const promotion = await promotionFor(
      entry,
      'source',
      'dev',
      BASELINE,
      SCHEMA_EXPAND,
      '2026-09-03T08:20:00.000Z'
    )
    await expect(promote(ledger, promotion)).rejects.toMatchObject({
      code: 'backend-migration-ledger-drift-blocked'
    })

    const recoveryBinding = {
      recoveryId: 'recovery:drift:dev',
      targetAuthority: targetAuthority('dev'),
      kind: 'restore' as const,
      removedMigrationIds: [],
      resultingAppliedMigrationIds: [],
      fromSchemaDigest: SCHEMA_DRIFTED,
      toSchemaDigest: BASELINE,
      recordedAt: '2026-09-03T08:30:00.000Z'
    }
    const recoveryRecord: SourceMigrationRecoveryRecordV1 = {
      ...recoveryBinding,
      environment: 'dev',
      ...(await recoveryProof(recoveryBinding)),
      evidenceDigest: EVIDENCE,
      approval: approval(['destructive'], recoveryBinding.recordedAt)
    }
    const recoveryPoint = recoveryRecord.providerReceipt.recoveryPoint
    if (!recoveryPoint) throw new Error('missing restore recovery point fixture')
    const recoveryPointDigest = await digestSourceMigrationRecoveryPoint(recoveryPoint)
    expect(recoveryPointDigest).toHaveLength(43)
    const changedRecoveryPoint = structuredClone(recoveryPoint)
    changedRecoveryPoint.schemaDigest = SCHEMA_BACKFILL
    expect(await digestSourceMigrationRecoveryPoint(changedRecoveryPoint)).not.toBe(
      recoveryPointDigest
    )

    const missingRecoveryPoint = structuredClone(recoveryRecord)
    missingRecoveryPoint.providerReceipt.recoveryPoint = null
    await expect(
      transitionSourceMigrationLedger(ledger, {
        type: 'record-recovery',
        record: missingRecoveryPoint,
        occurredAt: missingRecoveryPoint.recordedAt
      })
    ).rejects.toMatchObject({ code: 'backend-migration-ledger-recovery-record-invalid' })

    const mismatchedRecoveryPoint = structuredClone(recoveryRecord)
    if (!mismatchedRecoveryPoint.providerReceipt.recoveryPoint)
      throw new Error('missing restore recovery point mismatch fixture')
    mismatchedRecoveryPoint.providerReceipt.recoveryPoint.schemaDigest = SCHEMA_BACKFILL
    await expect(
      transitionSourceMigrationLedger(ledger, {
        type: 'record-recovery',
        record: mismatchedRecoveryPoint,
        occurredAt: mismatchedRecoveryPoint.recordedAt
      })
    ).rejects.toMatchObject({ code: 'backend-migration-ledger-recovery-record-invalid' })

    const staleBinding = {
      ...recoveryBinding,
      recoveryId: 'recovery:drift:stale',
      fromSchemaDigest: BASELINE,
      recordedAt: '2026-09-03T08:27:00.000Z'
    }
    await expect(
      transitionSourceMigrationLedger(ledger, {
        type: 'record-recovery',
        record: {
          ...staleBinding,
          environment: 'dev',
          ...(await recoveryProof(staleBinding)),
          evidenceDigest: EVIDENCE,
          approval: approval(['destructive'], staleBinding.recordedAt)
        },
        occurredAt: staleBinding.recordedAt
      })
    ).rejects.toMatchObject({ code: 'backend-migration-ledger-recovery-schema-stale' })
    const blockedOutcomes = [
      {
        outcome: 'failed' as const,
        recoveryId: 'recovery:drift:failed',
        recordedAt: '2026-09-03T08:28:00.000Z'
      },
      {
        outcome: 'outcome-unknown' as const,
        recoveryId: 'recovery:drift:unknown',
        recordedAt: '2026-09-03T08:29:00.000Z'
      }
    ]
    for (const blocked of blockedOutcomes) {
      const blockedBinding = {
        ...recoveryBinding,
        recoveryId: blocked.recoveryId,
        recordedAt: blocked.recordedAt
      }
      const blockedRecord: SourceMigrationRecoveryRecordV1 = {
        ...blockedBinding,
        environment: 'dev',
        ...(await recoveryProof(blockedBinding, { outcome: blocked.outcome })),
        evidenceDigest: EVIDENCE,
        approval: approval(['destructive'], blockedBinding.recordedAt)
      }
      await expect(
        transitionSourceMigrationLedger(ledger, {
          type: 'record-recovery',
          record: blockedRecord,
          occurredAt: blockedRecord.recordedAt
        })
      ).rejects.toMatchObject({ code: 'backend-migration-ledger-recovery-record-invalid' })
      expect(ledger.environments[0].drift).toBe('detected')
      expect(ledger.recoveryRecords).toHaveLength(0)
    }

    await expect(
      transitionSourceMigrationLedger(ledger, {
        type: 'record-recovery',
        record: { ...recoveryRecord, providerReceiptDigest: digestValue('Z') },
        occurredAt: recoveryRecord.recordedAt
      })
    ).rejects.toMatchObject({
      code: 'backend-migration-ledger-recovery-receipt-digest-mismatch'
    })

    ledger = await transitionSourceMigrationLedger(ledger, {
      type: 'record-recovery',
      record: recoveryRecord,
      occurredAt: recoveryRecord.recordedAt
    })
    expect(ledger.environments[0].drift).toBe('none')
    expect(ledger.recoveryRecords).toHaveLength(1)

    const staleHistory = structuredClone(ledger)
    staleHistory.recoveryRecords[0].fromSchemaDigest = BASELINE
    staleHistory.recoveryRecords[0].providerReceipt.fromSchemaDigest = BASELINE
    staleHistory.recoveryRecords[0].providerReceiptDigest =
      await digestSourceMigrationRecoveryReceipt(staleHistory.recoveryRecords[0].providerReceipt)
    const staleHistoryResult = await verifySourceMigrationLedgerIntegrity(staleHistory)
    expect(staleHistoryResult.ok).toBe(false)
    if (!staleHistoryResult.ok) {
      expect(staleHistoryResult.diagnostics.map((entry) => entry.code)).toContain(
        'backend-migration-ledger-recovery-schema-stale'
      )
    }

    const outerEvidenceTamper = structuredClone(ledger)
    outerEvidenceTamper.recoveryRecords[0].evidenceDigest = digestValue('Z')
    const outerEvidenceResult = validateSourceMigrationLedger(outerEvidenceTamper)
    expect(outerEvidenceResult.ok).toBe(false)
    if (!outerEvidenceResult.ok) {
      expect(outerEvidenceResult.diagnostics.map((entry) => entry.code)).toContain(
        'backend-migration-ledger-recovery-receipt-mismatch'
      )
    }

    const tampered = structuredClone(ledger)
    tampered.recoveryRecords[0].providerReceipt.evidenceDigest = digestValue('Z')
    tampered.recoveryRecords[0].evidenceDigest = digestValue('Z')
    const tamperedResult = await verifySourceMigrationLedgerIntegrity(tampered)
    expect(tamperedResult.ok).toBe(false)
    if (!tamperedResult.ok) {
      expect(tamperedResult.diagnostics.map((entry) => entry.code)).toContain(
        'backend-migration-ledger-recovery-receipt-digest-mismatch'
      )
    }
  })

  test('derives environment summaries from immutable history and rejects tampered rewinds', async () => {
    let ledger = createSourceMigrationLedger({
      ledgerId: 'ledger:derived-state',
      createdAt: '2026-09-03T08:00:00.000Z'
    })
    const entry = await entryFor(1, 'expand')
    ledger = await register(ledger, entry)
    ledger = await baseline(ledger, 'dev', '2026-09-03T08:10:00.000Z')
    ledger = await promote(
      ledger,
      await promotionFor(
        entry,
        'source',
        'dev',
        BASELINE,
        SCHEMA_EXPAND,
        '2026-09-03T08:20:00.000Z'
      )
    )

    const schemaTamper = structuredClone(ledger)
    schemaTamper.environments[0].schemaDigest = digestValue('Z')
    const schemaResult = await verifySourceMigrationLedgerIntegrity(schemaTamper)
    expect(schemaResult.ok).toBe(false)
    if (!schemaResult.ok) {
      expect(schemaResult.diagnostics.map((entry) => entry.code)).toContain(
        'backend-migration-ledger-environment-state-mismatch'
      )
    }

    const rewindTamper = structuredClone(ledger)
    rewindTamper.environments[0] = {
      ...rewindTamper.environments[0],
      appliedMigrationIds: [],
      schemaDigest: BASELINE,
      lastReceiptDigest: null
    }
    const rewindResult = await verifySourceMigrationLedgerIntegrity(rewindTamper)
    expect(rewindResult.ok).toBe(false)
    if (!rewindResult.ok) {
      expect(rewindResult.diagnostics.map((entry) => entry.code)).toContain(
        'backend-migration-ledger-environment-state-mismatch'
      )
    }

    ledger = await baseline(ledger, 'dev', '2026-09-03T08:21:00.000Z', digestValue('X'))
    const driftTamper = structuredClone(ledger)
    driftTamper.environments[0].drift = 'none'
    const driftResult = await verifySourceMigrationLedgerIntegrity(driftTamper)
    expect(driftResult.ok).toBe(false)
    if (!driftResult.ok) {
      expect(driftResult.diagnostics.map((entry) => entry.code)).toContain(
        'backend-migration-ledger-environment-state-mismatch'
      )
    }
  })

  test('blocks staging to production when the source environment has detected drift', async () => {
    let ledger = createSourceMigrationLedger({
      ledgerId: 'ledger:source-drift',
      createdAt: '2026-09-03T08:00:00.000Z'
    })
    const entry = await entryFor(1, 'expand')
    ledger = await register(ledger, entry)
    ledger = await baseline(ledger, 'dev', '2026-09-03T08:10:00.000Z')
    ledger = await baseline(ledger, 'staging', '2026-09-03T08:11:00.000Z')
    ledger = await baseline(ledger, 'production', '2026-09-03T08:12:00.000Z')
    ledger = await promote(
      ledger,
      await promotionFor(
        entry,
        'source',
        'dev',
        BASELINE,
        SCHEMA_EXPAND,
        '2026-09-03T08:20:00.000Z'
      )
    )
    ledger = await promote(
      ledger,
      await promotionFor(
        entry,
        'dev',
        'staging',
        BASELINE,
        SCHEMA_EXPAND,
        '2026-09-03T08:21:00.000Z'
      )
    )
    ledger = await baseline(ledger, 'staging', '2026-09-03T08:22:00.000Z', digestValue('X'))

    await expect(
      promote(
        ledger,
        await promotionFor(
          entry,
          'staging',
          'production',
          BASELINE,
          SCHEMA_EXPAND,
          '2026-09-03T08:23:00.000Z',
          approval(['production'], '2026-09-03T08:23:00.000Z')
        )
      )
    ).rejects.toMatchObject({ code: 'backend-migration-ledger-source-drift-blocked' })
  })

  test('requires predecessor receipts across release phases and destructive approval', async () => {
    let ledger = createSourceMigrationLedger({
      ledgerId: 'ledger:phases',
      createdAt: '2026-09-03T08:00:00.000Z'
    })
    const expand = await entryFor(1, 'expand')
    const backfill = await entryFor(2, 'backfill', expand.executionPlanDigest)
    const contract = await entryFor(3, 'contract', backfill.executionPlanDigest)
    ledger = await register(ledger, expand)
    ledger = await register(ledger, backfill)
    ledger = await register(ledger, contract)
    ledger = await baseline(ledger, 'dev', '2026-09-03T08:10:00.000Z')
    ledger = await promote(
      ledger,
      await promotionFor(
        expand,
        'source',
        'dev',
        BASELINE,
        SCHEMA_EXPAND,
        '2026-09-03T08:20:00.000Z'
      )
    )
    ledger = await promote(
      ledger,
      await promotionFor(
        backfill,
        'source',
        'dev',
        SCHEMA_EXPAND,
        SCHEMA_BACKFILL,
        '2026-09-03T08:21:00.000Z'
      )
    )
    const destructive = await promotionFor(
      contract,
      'source',
      'dev',
      SCHEMA_BACKFILL,
      SCHEMA_CONTRACT,
      '2026-09-03T08:22:00.000Z'
    )
    await expect(promote(ledger, destructive)).rejects.toBeInstanceOf(
      SourceMigrationLedgerTransitionError
    )
    ledger = await promote(ledger, {
      ...destructive,
      approval: approval(['destructive'], '2026-09-03T08:22:00.000Z')
    })
    expect(ledger.environments[0].appliedMigrationIds).toEqual([
      expand.migrationId,
      backfill.migrationId,
      contract.migrationId
    ])

    const tampered = structuredClone(ledger)
    const latestPromotion = tampered.promotions.at(-1)
    if (!latestPromotion) throw new Error('missing destructive promotion fixture')
    latestPromotion.approval = null
    expect(validateSourceMigrationLedger(tampered).ok).toBe(false)
  })

  test('requires downstream environments to rewind before an upstream recovery', async () => {
    let ledger = createSourceMigrationLedger({
      ledgerId: 'ledger:recovery-order',
      createdAt: '2026-09-03T08:00:00.000Z'
    })
    const entry = await entryFor(1, 'expand')
    ledger = await register(ledger, entry)
    ledger = await baseline(ledger, 'dev', '2026-09-03T08:10:00.000Z')
    ledger = await baseline(ledger, 'staging', '2026-09-03T08:11:00.000Z')
    ledger = await promote(
      ledger,
      await promotionFor(
        entry,
        'source',
        'dev',
        BASELINE,
        SCHEMA_EXPAND,
        '2026-09-03T08:20:00.000Z'
      )
    )
    ledger = await promote(
      ledger,
      await promotionFor(
        entry,
        'dev',
        'staging',
        BASELINE,
        SCHEMA_EXPAND,
        '2026-09-03T08:21:00.000Z'
      )
    )
    const recoveryBinding = {
      recoveryId: 'recovery:ordered:dev',
      targetAuthority: targetAuthority('dev'),
      kind: 'rollback' as const,
      removedMigrationIds: [entry.migrationId],
      resultingAppliedMigrationIds: [],
      fromSchemaDigest: SCHEMA_EXPAND,
      toSchemaDigest: BASELINE,
      recordedAt: '2026-09-03T08:30:00.000Z'
    }
    const recoveryRecord: SourceMigrationRecoveryRecordV1 = {
      ...recoveryBinding,
      environment: 'dev',
      ...(await recoveryProof(recoveryBinding)),
      evidenceDigest: EVIDENCE,
      approval: approval(['destructive'], recoveryBinding.recordedAt)
    }
    await expect(
      transitionSourceMigrationLedger(ledger, {
        type: 'record-recovery',
        record: recoveryRecord,
        occurredAt: recoveryRecord.recordedAt
      })
    ).rejects.toMatchObject({ code: 'backend-migration-ledger-recovery-downstream-ahead' })

    const tamperedHistory = structuredClone(ledger)
    tamperedHistory.recoveryRecords.push(recoveryRecord)
    const dev = tamperedHistory.environments.find(
      (environment) => environment.environment === 'dev'
    )
    if (!dev) throw new Error('missing dev recovery-order fixture')
    dev.appliedMigrationIds = []
    dev.schemaDigest = BASELINE
    dev.lastReceiptDigest = null
    dev.drift = 'none'
    tamperedHistory.updatedAt = recoveryRecord.recordedAt
    const tamperedHistoryResult = await verifySourceMigrationLedgerIntegrity(tamperedHistory)
    expect(tamperedHistoryResult.ok).toBe(false)
    if (!tamperedHistoryResult.ok) {
      expect(tamperedHistoryResult.diagnostics.map((entry) => entry.code)).toContain(
        'backend-migration-ledger-recovery-downstream-ahead'
      )
    }
  })

  test('records rollback and rewinds only the latest applied source migration', async () => {
    let ledger = createSourceMigrationLedger({
      ledgerId: 'ledger:rollback',
      createdAt: '2026-09-03T08:00:00.000Z'
    })
    const entry = await entryFor(1, 'expand')
    ledger = await register(ledger, entry)
    ledger = await baseline(ledger, 'dev', '2026-09-03T08:10:00.000Z')
    ledger = await promote(
      ledger,
      await promotionFor(
        entry,
        'source',
        'dev',
        BASELINE,
        SCHEMA_EXPAND,
        '2026-09-03T08:20:00.000Z'
      )
    )
    const recoveryBinding = {
      recoveryId: 'recovery:rollback:dev',
      targetAuthority: targetAuthority('dev'),
      kind: 'rollback' as const,
      removedMigrationIds: [entry.migrationId],
      resultingAppliedMigrationIds: [],
      fromSchemaDigest: SCHEMA_EXPAND,
      toSchemaDigest: BASELINE,
      recordedAt: '2026-09-03T08:30:00.000Z'
    }
    const recoveryRecord: SourceMigrationRecoveryRecordV1 = {
      ...recoveryBinding,
      environment: 'dev',
      ...(await recoveryProof(recoveryBinding)),
      evidenceDigest: EVIDENCE,
      approval: approval(['destructive'], recoveryBinding.recordedAt)
    }
    const foreignBinding = {
      ...recoveryBinding,
      targetAuthority: targetAuthority('dev', 'project-attacker')
    }
    await expect(
      transitionSourceMigrationLedger(ledger, {
        type: 'record-recovery',
        record: {
          ...recoveryRecord,
          ...foreignBinding,
          ...(await recoveryProof(foreignBinding))
        },
        occurredAt: recoveryRecord.recordedAt
      })
    ).rejects.toMatchObject({ code: 'backend-migration-ledger-recovery-authority-mismatch' })

    const healthyRewindRestoreBinding = {
      ...recoveryBinding,
      recoveryId: 'recovery:healthy-restore-with-rewind:dev',
      kind: 'restore' as const,
      recordedAt: '2026-09-03T08:27:00.000Z'
    }
    await expect(
      transitionSourceMigrationLedger(ledger, {
        type: 'record-recovery',
        record: {
          ...healthyRewindRestoreBinding,
          environment: 'dev',
          ...(await recoveryProof(healthyRewindRestoreBinding)),
          evidenceDigest: EVIDENCE,
          approval: approval(['destructive'], healthyRewindRestoreBinding.recordedAt)
        },
        occurredAt: healthyRewindRestoreBinding.recordedAt
      })
    ).rejects.toMatchObject({ code: 'backend-migration-ledger-restore-unnecessary' })

    const wrongTargetBinding = {
      ...recoveryBinding,
      recoveryId: 'recovery:wrong-target:dev',
      toSchemaDigest: SCHEMA_BACKFILL,
      recordedAt: '2026-09-03T08:28:00.000Z'
    }
    await expect(
      transitionSourceMigrationLedger(ledger, {
        type: 'record-recovery',
        record: {
          ...wrongTargetBinding,
          environment: 'dev',
          ...(await recoveryProof(wrongTargetBinding)),
          evidenceDigest: EVIDENCE,
          approval: approval(['destructive'], wrongTargetBinding.recordedAt)
        },
        occurredAt: wrongTargetBinding.recordedAt
      })
    ).rejects.toMatchObject({
      code: 'backend-migration-ledger-recovery-target-schema-mismatch'
    })

    const unapprovedBinding = {
      ...recoveryBinding,
      recoveryId: 'recovery:unapproved:dev',
      recordedAt: '2026-09-03T08:29:00.000Z'
    }
    await expect(
      transitionSourceMigrationLedger(ledger, {
        type: 'record-recovery',
        record: {
          ...recoveryRecord,
          ...unapprovedBinding,
          ...(await recoveryProof(unapprovedBinding)),
          approval: null
        },
        occurredAt: unapprovedBinding.recordedAt
      })
    ).rejects.toMatchObject({ code: 'backend-migration-ledger-approval-required' })

    ledger = await transitionSourceMigrationLedger(ledger, {
      type: 'record-recovery',
      record: recoveryRecord,
      occurredAt: recoveryRecord.recordedAt
    })
    expect(ledger.environments[0]).toMatchObject({
      appliedMigrationIds: [],
      schemaDigest: BASELINE,
      lastReceiptDigest: null,
      drift: 'none'
    })
    expect(ledger.recoveryRecords[0].kind).toBe('rollback')

    const healthyRestoreBinding = {
      recoveryId: 'recovery:healthy-restore:dev',
      targetAuthority: targetAuthority('dev'),
      kind: 'restore' as const,
      removedMigrationIds: [],
      resultingAppliedMigrationIds: [],
      fromSchemaDigest: BASELINE,
      toSchemaDigest: BASELINE,
      recordedAt: '2026-09-03T08:31:30.000Z'
    }
    await expect(
      transitionSourceMigrationLedger(ledger, {
        type: 'record-recovery',
        record: {
          ...healthyRestoreBinding,
          environment: 'dev',
          ...(await recoveryProof(healthyRestoreBinding)),
          evidenceDigest: EVIDENCE,
          approval: approval(['destructive'], healthyRestoreBinding.recordedAt)
        },
        occurredAt: healthyRestoreBinding.recordedAt
      })
    ).rejects.toMatchObject({ code: 'backend-migration-ledger-restore-unnecessary' })

    const targetHistoryTamper = structuredClone(ledger)
    targetHistoryTamper.recoveryRecords[0].toSchemaDigest = SCHEMA_BACKFILL
    targetHistoryTamper.recoveryRecords[0].providerReceipt.toSchemaDigest = SCHEMA_BACKFILL
    targetHistoryTamper.recoveryRecords[0].providerReceiptDigest =
      await digestSourceMigrationRecoveryReceipt(
        targetHistoryTamper.recoveryRecords[0].providerReceipt
      )
    const targetHistoryResult = await verifySourceMigrationLedgerIntegrity(targetHistoryTamper)
    expect(targetHistoryResult.ok).toBe(false)
    if (!targetHistoryResult.ok) {
      expect(targetHistoryResult.diagnostics.map((entry) => entry.code)).toContain(
        'backend-migration-ledger-recovery-target-schema-mismatch'
      )
    }

    await expect(
      transitionSourceMigrationLedger(ledger, {
        type: 'record-recovery',
        record: {
          ...recoveryRecord,
          recoveryId: 'recovery:binding-tampered:dev',
          recordedAt: '2026-09-03T08:31:00.000Z'
        },
        occurredAt: '2026-09-03T08:31:00.000Z'
      })
    ).rejects.toMatchObject({ code: 'backend-migration-ledger-recovery-record-invalid' })

    const replayBinding = {
      ...recoveryBinding,
      recoveryId: 'recovery:replayed:dev',
      kind: 'restore' as const,
      removedMigrationIds: [],
      fromSchemaDigest: BASELINE,
      recordedAt: '2026-09-03T08:32:00.000Z'
    }
    await expect(
      transitionSourceMigrationLedger(ledger, {
        type: 'record-recovery',
        record: {
          ...replayBinding,
          environment: 'dev',
          ...(await recoveryProof(replayBinding, {
            receiptId: recoveryRecord.providerReceipt.receiptId
          })),
          evidenceDigest: EVIDENCE,
          approval: approval(['destructive'], replayBinding.recordedAt)
        },
        occurredAt: replayBinding.recordedAt
      })
    ).rejects.toMatchObject({ code: 'backend-migration-ledger-recovery-receipt-reused' })
  })

  test('rejects duplicate source migration paths before a ledger entry can overwrite history', async () => {
    let ledger = createSourceMigrationLedger({
      ledgerId: 'ledger:source-path-replay',
      createdAt: '2026-09-03T08:00:00.000Z'
    })
    const entry = await entryFor(1, 'expand')
    ledger = await register(ledger, entry)
    await expect(
      register(ledger, {
        ...entry,
        migrationId: 'migration:0002:duplicate-path',
        sequence: 2,
        name: 'duplicate source path',
        registeredAt: '2026-09-03T08:02:00.000Z'
      })
    ).rejects.toMatchObject({ code: 'backend-migration-ledger-source-path-duplicate' })
  })

  test('rejects non-canonical SHA-256 base64url aliases', async () => {
    const ledger = createSourceMigrationLedger({
      ledgerId: 'ledger:digest-alias',
      createdAt: '2026-09-03T08:00:00.000Z'
    })
    const entry = await entryFor(1, 'expand')
    entry.source.digest = `${'A'.repeat(42)}B`
    await expect(register(ledger, entry)).rejects.toMatchObject({
      code: 'backend-migration-ledger-entry-invalid'
    })
  })

  test('rejects unknown fields and unsafe source paths without interpreting them', async () => {
    const ledger = createSourceMigrationLedger({
      ledgerId: 'ledger:fail-closed',
      createdAt: '2026-09-03T08:00:00.000Z'
    })
    const entry = await entryFor(1, 'expand')
    entry.source.path = '../production.sql'
    const invalid = {
      ...ledger,
      format: SOURCE_MIGRATION_LEDGER_FORMAT,
      entries: [{ ...entry, rawSql: 'drop table users' }]
    }
    const result = validateSourceMigrationLedger(invalid)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        'backend-unknown-field'
      )
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        'backend-migration-ledger-source-path-invalid'
      )
    }

    const validEntry = await entryFor(1, 'expand')
    await expect(
      transitionSourceMigrationLedger(ledger, {
        type: 'register-migration',
        entry: validEntry,
        occurredAt: validEntry.registeredAt,
        rawSql: 'drop table users'
      })
    ).rejects.toMatchObject({ code: 'backend-migration-ledger-event-invalid' })
  })

  test('requires canonical, strictly ordered ledger timestamps', async () => {
    expect(() =>
      createSourceMigrationLedger({
        ledgerId: 'ledger:invalid-calendar',
        createdAt: '2026-02-30T08:00:00.000Z'
      })
    ).toThrow('backend-migration-ledger-timestamp-invalid')

    const ledger = createSourceMigrationLedger({
      ledgerId: 'ledger:strict-time',
      createdAt: '2026-09-03T08:00:00.000Z'
    })
    const entry = await entryFor(1, 'expand')
    entry.registeredAt = ledger.updatedAt
    await expect(register(ledger, entry)).rejects.toMatchObject({
      code: 'backend-migration-ledger-event-stale'
    })
  })
})
