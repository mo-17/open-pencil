import { describe, expect, test } from 'bun:test'

import {
  STAGED_MIGRATION_EXECUTION_FORMAT,
  STAGED_MIGRATION_EXECUTION_RECEIPT_FORMAT,
  canonicalStagedMigrationExecutionPlanBytes,
  digestStagedMigrationExecutionPlan,
  digestStagedMigrationExecutionReceipt,
  normalizeStagedMigrationExecutionPlan,
  validateStagedMigrationExecutionPlan,
  validateStagedMigrationExecutionReceipt,
  type StagedMigrationExecutionPlanV1,
  type StagedMigrationExecutionReceiptV1,
  type StagedMigrationOperationV1
} from '@open-pencil/lowcode/backend'

const DIGEST_A = `${'A'.repeat(42)}A`
const DIGEST_B = `${'B'.repeat(42)}A`
const DIGEST_C = `${'C'.repeat(42)}A`
const DIGEST_D = `${'D'.repeat(42)}A`

function executionPlan(
  phase: StagedMigrationExecutionPlanV1['phase'],
  operations: StagedMigrationOperationV1[],
  predecessor: StagedMigrationExecutionPlanV1['predecessor'] = null
): StagedMigrationExecutionPlanV1 {
  const riskOrder = ['low', 'medium', 'high', 'destructive'] as const
  const wrapped = operations.map((operation) => {
    let risk: (typeof riskOrder)[number]
    switch (operation.kind) {
      case 'apply-reviewed-migration':
      case 'add-nullable-field':
        risk = 'low'
        break
      case 'set-generated-default':
        risk = operation.generator === 'uuid' ? 'medium' : 'high'
        break
      case 'rename-entity':
      case 'rename-field':
        risk = operation.compatibility.mode === 'expand-contract' ? 'medium' : 'high'
        break
      case 'retire-field':
      case 'retire-entity':
        risk = 'destructive'
        break
      default:
        risk = 'high'
    }
    return { operation, risk }
  })
  const highestRisk = wrapped.reduce<(typeof riskOrder)[number]>(
    (highest, entry) =>
      riskOrder.indexOf(entry.risk) > riskOrder.indexOf(highest) ? entry.risk : highest,
    'low'
  )
  return {
    format: STAGED_MIGRATION_EXECUTION_FORMAT,
    version: 1,
    executionId: `execution:${phase}`,
    changeId: 'change:notes-owner',
    sourceMigrationPlan: {
      version: 1,
      planId: 'migration:v1',
      planDigest: DIGEST_A,
      fromModelDigest: DIGEST_B,
      targetModelDigest: DIGEST_C
    },
    phase,
    predecessor,
    operations: wrapped,
    highestRisk,
    requiresHumanApproval: highestRisk === 'destructive'
  }
}

describe('staged migration execution contract', () => {
  test('normalizes exact reviewed source SQL authority as a low-risk expand operation', async () => {
    const plan = executionPlan('expand', [
      {
        id: 'op:reviewed-source',
        kind: 'apply-reviewed-migration',
        sourceOperationIds: ['source:z', 'source:a'],
        reviewManifestDigest: DIGEST_A,
        migrationPlanDigest: DIGEST_B,
        sqlDigest: DIGEST_C,
        appliesTo: 'reviewed-source-sql'
      }
    ])
    const normalized = normalizeStagedMigrationExecutionPlan(plan)
    expect(normalized.operations[0]?.risk).toBe('low')
    expect(normalized.operations[0]?.operation.sourceOperationIds).toEqual(['source:a', 'source:z'])
    expect(await digestStagedMigrationExecutionPlan(normalized)).toBe(
      await digestStagedMigrationExecutionPlan(plan)
    )

    const storageOnly = executionPlan('expand', [
      {
        id: 'op:reviewed-storage',
        kind: 'apply-reviewed-migration',
        sourceOperationIds: [],
        reviewManifestDigest: DIGEST_A,
        migrationPlanDigest: DIGEST_B,
        sqlDigest: DIGEST_C,
        appliesTo: 'reviewed-source-sql'
      }
    ])
    expect(validateStagedMigrationExecutionPlan(storageOnly).ok).toBe(true)

    const reviewedOperation = plan.operations[0].operation
    if (reviewedOperation.kind !== 'apply-reviewed-migration') {
      throw new Error('expected reviewed source SQL operation')
    }
    const changedSQL = executionPlan('expand', [{ ...reviewedOperation, sqlDigest: DIGEST_D }])
    expect(await digestStagedMigrationExecutionPlan(changedSQL)).not.toBe(
      await digestStagedMigrationExecutionPlan(plan)
    )
    for (const operation of [
      { ...reviewedOperation, sqlDigest: 'not-a-digest' },
      { ...reviewedOperation, appliesTo: 'database' }
    ]) {
      expect(
        validateStagedMigrationExecutionPlan({
          ...plan,
          operations: [{ operation, risk: 'low' }]
        }).ok
      ).toBe(false)
    }
  })

  test('normalizes canonical operation and source-operation order', async () => {
    const plan = executionPlan('expand', [
      {
        id: 'op:z',
        kind: 'add-nullable-field',
        sourceOperationIds: ['source:z', 'source:a'],
        entityId: 'notes',
        field: { id: 'owner_id', name: 'owner_id', type: 'uuid', nullable: true }
      },
      {
        id: 'op:a',
        kind: 'set-generated-default',
        sourceOperationIds: ['source:b'],
        entityId: 'notes',
        fieldId: 'owner_id',
        fieldType: 'uuid',
        generator: 'uuid',
        appliesTo: 'future-writes'
      }
    ])
    const normalized = normalizeStagedMigrationExecutionPlan(plan)
    expect(normalized.operations.map((entry) => entry.operation.id)).toEqual(['op:a', 'op:z'])
    expect(normalized.operations[1].operation.sourceOperationIds).toEqual(['source:a', 'source:z'])

    const reordered = structuredClone(plan)
    reordered.operations.reverse()
    expect(await digestStagedMigrationExecutionPlan(reordered)).toBe(
      await digestStagedMigrationExecutionPlan(plan)
    )
    expect(canonicalStagedMigrationExecutionPlanBytes(plan)).toEqual(
      canonicalStagedMigrationExecutionPlanBytes(reordered)
    )
  })

  test('supports typed backfill and deferred FK/unique validation phases', () => {
    const expand = executionPlan('expand', [
      {
        id: 'op:fk',
        kind: 'add-foreign-key',
        sourceOperationIds: ['source:fk'],
        entityId: 'notes',
        foreignKey: {
          id: 'notes_owner_fk',
          fields: ['owner_id'],
          targetEntityId: 'users',
          targetFields: ['id'],
          onDelete: 'cascade'
        },
        validation: 'deferred'
      },
      {
        id: 'op:unique',
        kind: 'add-unique',
        sourceOperationIds: ['source:unique'],
        entityId: 'notes',
        unique: { id: 'notes_owner_title_unique', fields: ['owner_id', 'title'] },
        validation: 'deferred'
      }
    ])
    expect(validateStagedMigrationExecutionPlan(expand).ok).toBe(true)

    const backfill = executionPlan(
      'backfill',
      [
        {
          id: 'op:backfill',
          kind: 'backfill-field',
          sourceOperationIds: ['source:field'],
          entityId: 'notes',
          fieldId: 'retry_count',
          predicate: 'is-null',
          value: { kind: 'literal', fieldType: 'integer', value: 0 }
        },
        {
          id: 'op:validate-fk',
          kind: 'validate-foreign-key',
          sourceOperationIds: ['source:fk'],
          entityId: 'notes',
          foreignKeyId: 'notes_owner_fk',
          validation: 'existing-and-concurrent-data'
        },
        {
          id: 'op:validate-unique',
          kind: 'validate-unique',
          sourceOperationIds: ['source:unique'],
          entityId: 'notes',
          uniqueId: 'notes_owner_title_unique',
          validation: 'existing-and-concurrent-data'
        }
      ],
      { phase: 'expand', executionPlanDigest: DIGEST_A, receiptRequired: true }
    )
    expect(validateStagedMigrationExecutionPlan(backfill).ok).toBe(true)
  })

  test('fails closed on type, generator, phase, predecessor, and derived-risk claims', () => {
    const invalidLiteral = executionPlan(
      'backfill',
      [
        {
          id: 'op:backfill',
          kind: 'backfill-field',
          sourceOperationIds: ['source:field'],
          entityId: 'notes',
          fieldId: 'retry_count',
          predicate: 'is-null',
          value: { kind: 'literal', fieldType: 'integer', value: 'zero' }
        }
      ],
      { phase: 'expand', executionPlanDigest: DIGEST_A, receiptRequired: true }
    )
    expect(validateStagedMigrationExecutionPlan(invalidLiteral).ok).toBe(false)

    const invalidGenerator = executionPlan('expand', [
      {
        id: 'op:default',
        kind: 'set-generated-default',
        sourceOperationIds: ['source:field'],
        entityId: 'notes',
        fieldId: 'owner_id',
        fieldType: 'uuid',
        generator: 'identity',
        appliesTo: 'future-writes'
      }
    ])
    expect(validateStagedMigrationExecutionPlan(invalidGenerator).ok).toBe(false)

    const wrongPhase = executionPlan('expand', [
      {
        id: 'op:not-null',
        kind: 'set-not-null',
        sourceOperationIds: ['source:field'],
        entityId: 'notes',
        fieldId: 'owner_id'
      }
    ])
    expect(validateStagedMigrationExecutionPlan(wrongPhase).ok).toBe(false)

    const missingPredecessor = executionPlan('contract', [
      {
        id: 'op:rename',
        kind: 'rename-field',
        sourceOperationIds: ['source:rename'],
        entityId: 'notes',
        fieldId: 'title',
        fromName: 'title',
        toName: 'subject',
        compatibility: { mode: 'expand-contract', applicationEvidenceDigest: DIGEST_B }
      }
    ])
    expect(validateStagedMigrationExecutionPlan(missingPredecessor).ok).toBe(false)

    const tampered = executionPlan(
      'contract',
      [
        {
          id: 'op:retire',
          kind: 'retire-field',
          sourceOperationIds: ['source:retire'],
          entityId: 'notes',
          fieldId: 'legacy_title',
          compatibilityEvidenceDigest: DIGEST_C
        }
      ],
      { phase: 'backfill', executionPlanDigest: DIGEST_A, receiptRequired: true }
    )
    tampered.operations[0].risk = 'low'
    tampered.highestRisk = 'low'
    tampered.requiresHumanApproval = false
    const result = validateStagedMigrationExecutionPlan(tampered)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.diagnostics.map((entry) => entry.code)).toContain(
        'backend-staged-migration-risk-mismatch'
      )
    }
  })

  test('binds receipt digests to target authority and requires successful evidence', async () => {
    const receipt: StagedMigrationExecutionReceiptV1 = {
      format: STAGED_MIGRATION_EXECUTION_RECEIPT_FORMAT,
      version: 1,
      receiptId: 'receipt:expand',
      executionId: 'execution:expand',
      executionPlanDigest: DIGEST_A,
      phase: 'expand',
      promotionFrom: 'source',
      targetAuthority: {
        providerId: 'supabase',
        providerAuthorityDigest: DIGEST_D,
        projectRef: 'project-dev',
        accountId: 'account-alice',
        grantGeneration: 'grant-dev-1',
        environment: 'dev'
      },
      schemaBeforeDigest: DIGEST_B,
      schemaAfterDigest: DIGEST_C,
      outcome: 'succeeded',
      recordedAt: '2026-09-03T08:00:00.000Z',
      evidenceDigest: DIGEST_B
    }
    expect(validateStagedMigrationExecutionReceipt(receipt).ok).toBe(true)
    expect(validateStagedMigrationExecutionReceipt({ ...receipt, evidenceDigest: null }).ok).toBe(
      false
    )
    expect(
      validateStagedMigrationExecutionReceipt({
        ...receipt,
        outcome: 'outcome-unknown',
        evidenceDigest: DIGEST_B
      }).ok
    ).toBe(false)

    expect(
      validateStagedMigrationExecutionReceipt({
        ...receipt,
        targetAuthority: { ...receipt.targetAuthority, environment: 'staging' }
      }).ok
    ).toBe(false)
    expect(
      validateStagedMigrationExecutionReceipt({
        ...receipt,
        schemaAfterDigest: 'not-a-digest'
      }).ok
    ).toBe(false)
    expect(
      validateStagedMigrationExecutionReceipt({
        ...receipt,
        schemaAfterDigest: `${'A'.repeat(42)}B`
      }).ok
    ).toBe(false)
    expect(
      validateStagedMigrationExecutionReceipt({
        ...receipt,
        recordedAt: '2026-09-03T08:00:00Z'
      }).ok
    ).toBe(false)
    expect(
      validateStagedMigrationExecutionReceipt({
        ...receipt,
        recordedAt: '2026-02-30T08:00:00.000Z'
      }).ok
    ).toBe(false)
    expect(
      validateStagedMigrationExecutionReceipt({
        ...receipt,
        targetAuthority: { ...receipt.targetAuthority, accessToken: 'secret' }
      }).ok
    ).toBe(false)

    const stagingReceipt: StagedMigrationExecutionReceiptV1 = {
      ...receipt,
      receiptId: 'receipt:staging',
      promotionFrom: 'dev',
      targetAuthority: {
        ...receipt.targetAuthority,
        projectRef: 'project-staging',
        grantGeneration: 'grant-staging-1',
        environment: 'staging'
      }
    }
    expect(await digestStagedMigrationExecutionReceipt(stagingReceipt)).not.toBe(
      await digestStagedMigrationExecutionReceipt(receipt)
    )
    expect(
      await digestStagedMigrationExecutionReceipt({
        ...receipt,
        schemaAfterDigest: DIGEST_D
      })
    ).not.toBe(await digestStagedMigrationExecutionReceipt(receipt))
  })
})
