import {
  backendSha256,
  digestCanonicalBackendValue,
  freezeBackendValue
} from '#compiler/backend/canonical'

import {
  digestBackendApplication,
  digestStagedMigrationExecutionPlan,
  digestStagedMigrationExecutionReceipt,
  normalizedBackendApplication,
  planBackendMigration,
  validateStagedMigrationExecutionPlan,
  validateStagedMigrationExecutionReceipt,
  type StagedMigrationExecutionPlanV1,
  type StagedMigrationExecutionReceiptV1
} from '@open-pencil/lowcode/backend'

import {
  digestSupabasePhysicalSchema,
  parseSupabaseInspectedMigrationSnapshot,
  type SupabaseInspectedMigrationSnapshotV1
} from '../inspection'
import { addBlocker, blockedSQL, reviewSQL, sortedBlockers } from './common'
import type {
  CreateSupabaseInspectedMigrationReviewInputV1,
  SupabaseInspectedMigrationReviewManifestV1,
  SupabaseInspectedMigrationReviewV1,
  SupabaseMigrationReviewBlockerV1
} from './contract'
import { foreignKeyIndexBlockers, inventoryBlockers } from './inventory'
import { renderPoliciesAndPrivileges } from './policy'
import {
  renderInspectedBaselinePreconditions,
  renderPostPolicyGrantPreconditions
} from './precondition'
import { renderAdditiveMigrations } from './sql'
import { renderStagedMigrations } from './staged-sql'

export type {
  CreateSupabaseInspectedMigrationReviewInputV1,
  SupabaseInspectedMigrationReviewManifestV1,
  SupabaseInspectedMigrationReviewV1,
  SupabaseMigrationReviewEnvironmentV1,
  SupabaseMigrationReviewBlockerV1,
  SupabasePrivilegeReviewOperationV1,
  SupabaseSchemaPrivilegeReviewOperationV1,
  SupabaseStagedMigrationReviewInputV1,
  SupabaseTablePrivilegeReviewOperationV1
} from './contract'

interface NormalizedStagedAuthority {
  readonly executionPlan: StagedMigrationExecutionPlanV1
  readonly executionPlanDigest: string
  readonly predecessorReceipt: StagedMigrationExecutionReceiptV1 | null
  readonly predecessorReceiptDigest: string | null
}

function addPredecessorReceiptAuthorityBlockers(
  receipt: StagedMigrationExecutionReceiptV1,
  snapshot: SupabaseInspectedMigrationSnapshotV1,
  environment: SupabaseInspectedMigrationReviewManifestV1['environment'],
  blockers: SupabaseMigrationReviewBlockerV1[]
): void {
  const expectedPromotionFrom = environment === 'staging' ? 'dev' : 'staging'
  if (receipt.targetAuthority.providerId !== 'supabase') {
    addBlocker(
      blockers,
      'supabase-staged-predecessor-receipt-provider-mismatch',
      '$.stagedExecution.predecessorReceipt.targetAuthority.providerId',
      'The predecessor receipt targets a different Backend Provider.'
    )
  }
  if (receipt.targetAuthority.environment !== environment) {
    addBlocker(
      blockers,
      'supabase-staged-predecessor-receipt-environment-mismatch',
      '$.stagedExecution.predecessorReceipt.targetAuthority.environment',
      'The predecessor receipt targets a different review environment.'
    )
  }
  if (receipt.promotionFrom !== expectedPromotionFrom) {
    addBlocker(
      blockers,
      'supabase-staged-predecessor-receipt-promotion-mismatch',
      '$.stagedExecution.predecessorReceipt.promotionFrom',
      `The predecessor receipt must prove ${expectedPromotionFrom} to ${environment} promotion.`
    )
  }
  if (receipt.targetAuthority.projectRef !== snapshot.provenance.projectRef) {
    addBlocker(
      blockers,
      'supabase-staged-predecessor-receipt-project-mismatch',
      '$.stagedExecution.predecessorReceipt.targetAuthority.projectRef',
      'The predecessor receipt belongs to a different inspected Supabase project.'
    )
  }
  if (receipt.targetAuthority.accountId !== snapshot.provenance.accountId) {
    addBlocker(
      blockers,
      'supabase-staged-predecessor-receipt-account-mismatch',
      '$.stagedExecution.predecessorReceipt.targetAuthority.accountId',
      'The predecessor receipt belongs to a different inspected Supabase account.'
    )
  }
  if (receipt.schemaAfterDigest !== snapshot.currentModelDigest) {
    addBlocker(
      blockers,
      'supabase-staged-predecessor-receipt-schema-mismatch',
      '$.stagedExecution.predecessorReceipt.schemaAfterDigest',
      'The predecessor receipt schema does not match the inspected logical current DataModelIR.'
    )
  }
  if (Date.parse(receipt.recordedAt) > Date.parse(snapshot.provenance.observedAt)) {
    addBlocker(
      blockers,
      'supabase-staged-predecessor-receipt-future',
      '$.stagedExecution.predecessorReceipt.recordedAt',
      'The predecessor receipt was recorded after the inspected snapshot.'
    )
  }
  // The inspection has no independent provider-authority or credential-grant generation source.
  // Keep both receipt fields intact without pretending a self-reported value was verified here.
}

async function normalizeStagedAuthority(
  input: CreateSupabaseInspectedMigrationReviewInputV1['stagedExecution'],
  migrationPlan: SupabaseInspectedMigrationReviewManifestV1['migrationPlan'],
  migrationPlanDigest: string,
  snapshot: SupabaseInspectedMigrationSnapshotV1,
  environment: SupabaseInspectedMigrationReviewManifestV1['environment'],
  blockers: SupabaseMigrationReviewBlockerV1[]
): Promise<NormalizedStagedAuthority | null> {
  if (!input) return null
  const parsedPlan = validateStagedMigrationExecutionPlan(input.executionPlan)
  if (!parsedPlan.ok) {
    throw new TypeError(
      `Supabase staged migration execution validation failed: ${parsedPlan.diagnostics
        .map((entry) => entry.code)
        .join(', ')}`
    )
  }
  const executionPlan = parsedPlan.value
  const executionPlanDigest = await digestStagedMigrationExecutionPlan(executionPlan)
  if (executionPlan.sourceMigrationPlan.targetModelDigest !== migrationPlan.targetModelDigest) {
    throw new TypeError('Supabase staged migration target differs from the reviewed DataModelIR.')
  }
  if (
    executionPlan.phase === 'expand' &&
    (executionPlan.sourceMigrationPlan.planId !== migrationPlan.planId ||
      executionPlan.sourceMigrationPlan.planDigest !== migrationPlanDigest ||
      executionPlan.sourceMigrationPlan.fromModelDigest !== snapshot.currentModelDigest)
  ) {
    throw new TypeError(
      'Supabase expand execution is not bound to the inspected source MigrationPlan authority.'
    )
  }

  const predecessor = executionPlan.predecessor
  let predecessorReceipt: StagedMigrationExecutionReceiptV1 | null = null
  let predecessorReceiptDigest: string | null = null
  if (!predecessor) {
    if (input.predecessorReceipt !== undefined) {
      throw new TypeError('Supabase expand execution cannot consume a predecessor receipt.')
    }
  } else if (input.predecessorReceipt === undefined) {
    addBlocker(
      blockers,
      'supabase-staged-predecessor-receipt-required',
      '$.stagedExecution.predecessorReceipt',
      'Backfill and contract SQL require a successful predecessor execution receipt.'
    )
  } else {
    const parsedReceipt = validateStagedMigrationExecutionReceipt(input.predecessorReceipt)
    if (!parsedReceipt.ok) {
      throw new TypeError(
        `Supabase predecessor receipt validation failed: ${parsedReceipt.diagnostics
          .map((entry) => entry.code)
          .join(', ')}`
      )
    }
    predecessorReceipt = parsedReceipt.value
    predecessorReceiptDigest = await digestStagedMigrationExecutionReceipt(predecessorReceipt)
    if (
      predecessorReceipt.executionPlanDigest !== predecessor.executionPlanDigest ||
      predecessorReceipt.phase !== predecessor.phase ||
      predecessorReceipt.outcome !== 'succeeded' ||
      predecessorReceipt.evidenceDigest === null
    ) {
      addBlocker(
        blockers,
        'supabase-staged-predecessor-receipt-mismatch',
        '$.stagedExecution.predecessorReceipt',
        'The predecessor receipt does not prove the declared execution plan and phase succeeded.'
      )
    }
    addPredecessorReceiptAuthorityBlockers(predecessorReceipt, snapshot, environment, blockers)
  }
  if (executionPlan.requiresHumanApproval || executionPlan.highestRisk === 'destructive') {
    addBlocker(
      blockers,
      'supabase-staged-destructive-approval-required',
      '$.stagedExecution.executionPlan',
      'Destructive migration SQL requires independent human approval and recovery evidence.'
    )
  }
  return {
    executionPlan,
    executionPlanDigest,
    predecessorReceipt,
    predecessorReceiptDigest
  }
}

/**
 * Approval identity intentionally excludes the observation timestamp. The complete manifest still
 * retains that timestamp as evidence, while two unchanged catalog captures produce one semantic
 * reviewed migration identity suitable for pre-Apply freshness and durable single-flight checks.
 */
export function digestSupabaseInspectedMigrationReviewManifest(
  manifest: SupabaseInspectedMigrationReviewManifestV1
): string {
  const provenance = manifest.inspectionProvenance
  const { inspectionCaptureDigest, ...approvalManifest } = manifest
  if (typeof inspectionCaptureDigest !== 'string' || inspectionCaptureDigest.length === 0) {
    throw new TypeError('Supabase inspection capture digest is required.')
  }
  return digestCanonicalBackendValue(
    {
      ...approvalManifest,
      inspectionProvenance: {
        projectRef: provenance.projectRef,
        accountId: provenance.accountId,
        querySchemaVersion: provenance.querySchemaVersion,
        databaseRole: provenance.databaseRole,
        completeness: provenance.completeness,
        truncated: provenance.truncated
      }
    },
    '$.supabaseMigrationReview.manifest'
  )
}

// eslint-disable-next-line complexity -- One fail-closed authority funnel binds inspection, staged receipts, SQL, and manifest evidence.
export async function createSupabaseInspectedMigrationReview(
  input: CreateSupabaseInspectedMigrationReviewInputV1
): Promise<SupabaseInspectedMigrationReviewV1> {
  const application = normalizedBackendApplication(input.application)
  const snapshot = await parseSupabaseInspectedMigrationSnapshot(input.snapshot)
  if (
    input.expectedProjectRef !== undefined &&
    input.expectedProjectRef !== snapshot.provenance.projectRef
  ) {
    throw new TypeError('Supabase inspected schema belongs to a different project authority.')
  }
  if (
    input.expectedAccountId !== undefined &&
    input.expectedAccountId !== snapshot.provenance.accountId
  ) {
    throw new TypeError('Supabase inspected schema belongs to a different account authority.')
  }
  if (
    input.expectedInspectedSchemaDigest !== undefined &&
    input.expectedInspectedSchemaDigest !== snapshot.inspectedSchemaDigest
  ) {
    throw new TypeError('Supabase inspected schema drifted from the expected release authority.')
  }
  const migrationPlan = await planBackendMigration(snapshot.currentModel, application.dataModel)
  const authoredTargetModelDigest = migrationPlan.targetModelDigest
  const physicalTargetModelDigest = digestSupabasePhysicalSchema(application.dataModel)
  if (
    input.expectedTargetModelDigest !== undefined &&
    input.expectedTargetModelDigest !== authoredTargetModelDigest &&
    input.expectedTargetModelDigest !== physicalTargetModelDigest
  ) {
    throw new TypeError(
      'Supabase target DataModelIR drifted from the expected migration authority.'
    )
  }
  if (migrationPlan.fromModelDigest !== snapshot.currentModelDigest) {
    throw new TypeError('Shared migration plan is not bound to the inspected current DataModelIR.')
  }

  const blockers: SupabaseMigrationReviewBlockerV1[] = []
  const environment = input.environment ?? 'staging'
  if (environment === 'production') {
    addBlocker(
      blockers,
      'supabase-production-migration-approval-required',
      '$.environment',
      'Production migration SQL requires a separately recorded human approval and recovery authority.'
    )
  }
  const migrationPlanDigest = digestCanonicalBackendValue(
    migrationPlan,
    '$.supabaseMigrationReview.migrationPlan'
  )
  const staged = await normalizeStagedAuthority(
    input.stagedExecution,
    migrationPlan,
    migrationPlanDigest,
    snapshot,
    environment,
    blockers
  )
  inventoryBlockers(snapshot, blockers)
  foreignKeyIndexBlockers(application, blockers)
  const migration = staged
    ? renderStagedMigrations(application, snapshot, staged.executionPlan, blockers)
    : renderAdditiveMigrations(application, snapshot, migrationPlan, blockers)
  const privilege = renderPoliciesAndPrivileges(application, snapshot, migrationPlan, blockers)
  const baselinePrecondition = renderInspectedBaselinePreconditions(
    snapshot,
    new Set([...migration.existingTableNames, ...privilege.existingTableNames])
  )
  const preGrantPrecondition = renderPostPolicyGrantPreconditions(
    snapshot,
    privilege.plannedPolicies
  )
  const finalBlockers = sortedBlockers(blockers)
  const executable = finalBlockers.length === 0
  const privilegeOperations = executable ? privilege.operations : []
  // The app live-Apply bridge recognizes only legacy low-risk MigrationPlan ids. Staged SQL uses a
  // separate id list so adding review support cannot widen that executor allowlist by accident.
  const renderedMigrationOperationIds = executable && !staged ? migration.operationIds : []
  const renderedStagedMigrationOperationIds = executable && staged ? migration.operationIds : []
  const sql = executable
    ? reviewSQL([
        ...baselinePrecondition.statements,
        ...migration.statements,
        ...privilege.policyStatements,
        ...preGrantPrecondition.statements,
        ...privilege.grantStatements
      ])
    : blockedSQL(finalBlockers)
  const applicationDigest = await digestBackendApplication(application)
  const privilegePlanDigest = digestCanonicalBackendValue(
    {
      desiredTablePrivileges: privilege.desired,
      privilegeOperations
    },
    '$.supabaseMigrationReview.privilegePlan'
  )
  const sqlDigest = backendSha256(sql)
  const manifest = freezeBackendValue({
    format: 'openpencil.supabase-inspected-migration-review.v1',
    version: 1,
    providerId: 'supabase',
    schema: 'public',
    environment,
    applicationId: application.applicationId,
    applicationDigest,
    inspectionProvenance: snapshot.provenance,
    inspectionCaptureDigest: snapshot.captureDigest,
    inspectedSchemaDigest: snapshot.inspectedSchemaDigest,
    authoredCurrentModelDigest: snapshot.currentModelDigest,
    authoredTargetModelDigest,
    currentModelDigest: snapshot.physicalSchemaDigest,
    targetModelDigest: physicalTargetModelDigest,
    migrationPlan,
    migrationPlanDigest,
    renderedMigrationOperationIds,
    stagedExecutionPlan: staged?.executionPlan ?? null,
    stagedExecutionPlanDigest: staged?.executionPlanDigest ?? null,
    predecessorReceipt: staged?.predecessorReceipt ?? null,
    predecessorReceiptDigest: staged?.predecessorReceiptDigest ?? null,
    renderedStagedMigrationOperationIds,
    renderedMigrationPhases: staged && executable ? [staged.executionPlan.phase] : [],
    baselinePreconditionVersion: 1,
    baselinePreconditionTableNames: executable ? baselinePrecondition.tableNames : [],
    preGrantPreconditionTableNames: executable ? preGrantPrecondition.tableNames : [],
    desiredTablePrivileges: privilege.desired,
    privilegeOperations,
    privilegePlanDigest,
    sqlDigest,
    blockers: finalBlockers,
    reviewReady: executable,
    applyAllowed: false,
    releaseReady: false
  }) as SupabaseInspectedMigrationReviewManifestV1
  const manifestDigest = digestSupabaseInspectedMigrationReviewManifest(manifest)
  return freezeBackendValue({
    snapshot,
    sql,
    manifest,
    manifestDigest
  }) as SupabaseInspectedMigrationReviewV1
}
