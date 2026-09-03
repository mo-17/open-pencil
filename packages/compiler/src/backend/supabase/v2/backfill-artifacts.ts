import { canonicalBackendValue, digestCanonicalBackendValue } from '#compiler/backend/canonical'
import type {
  BackendArtifactSourceV2,
  BackendProviderAdapterContextV2
} from '#compiler/backend/v2/contracts'

import type { JSONValue } from '@open-pencil/scene-graph/primitives'

import {
  createSupabaseBackfillPlanV2,
  resolvedSupabaseBackfillV2,
  SUPABASE_BACKFILL_ARTIFACT_PATHS_V2,
  SUPABASE_BACKFILL_RELEASE_BLOCKERS_V2
} from './backfill'
import { emitSupabaseBackfillReviewSQLV2 } from './backfill-sql'

function stableJSON(value: unknown, path: string): string {
  return `${JSON.stringify(canonicalBackendValue(value, path), null, 2)}\n`
}

function assertExpectedPlan(context: BackendProviderAdapterContextV2, plan: JSONValue): void {
  const expected = createSupabaseBackfillPlanV2(context)
  if (
    digestCanonicalBackendValue(plan, '$.supabaseBackfill.receivedPlan') !==
    digestCanonicalBackendValue(expected, '$.supabaseBackfill.expectedPlan')
  ) {
    throw new TypeError('Supabase backfill plan does not match normalized application IR.')
  }
}

/** Emits deterministic review material only; no artifact contains a mutation runner or Apply hook. */
export function emitSupabaseBackfillArtifactsV2(
  context: BackendProviderAdapterContextV2,
  plan: JSONValue
): readonly BackendArtifactSourceV2[] {
  assertExpectedPlan(context, plan)
  const migration = resolvedSupabaseBackfillV2(context.application)
  const adapterPlanDigest = digestCanonicalBackendValue(plan, '$.supabaseBackfill.adapterPlan')
  const migrationPlan = {
    format: 'openpencil.supabase-backfill-migration-plan.v1',
    version: 1,
    providerId: 'supabase',
    applicationId: context.application.applicationId,
    adapterPlanDigest,
    reviewOnly: true,
    applyAvailable: false,
    releaseReady: false,
    trustedHostRequired: true,
    mutationSqlEmitted: false,
    migration,
    executionContract: {
      strategy: 'capture-high-water-then-scan-monotonic-cursor',
      highWaterSource: 'trusted-live-read',
      resumeSource: 'host-accepted-receipt-head',
      batchOrdering: 'cursor-ascending',
      maximumReceiptCount: migration.maximumReceiptCount,
      maximumBatchReceiptCount: migration.maximumBatchReceiptCount,
      highWaterReceiptCount: 1,
      runnerEmitted: false
    },
    releaseBlockers: SUPABASE_BACKFILL_RELEASE_BLOCKERS_V2
  }
  const reviewManifest = {
    format: 'openpencil.supabase-backfill-review.v1',
    version: 1,
    providerId: 'supabase',
    applicationId: context.application.applicationId,
    adapterPlanDigest,
    actualCapabilities: context.actualCapabilities,
    reviewOnly: true,
    applyAvailable: false,
    deployAvailable: false,
    releaseReady: false,
    trustedHostRequired: true,
    outputs: {
      clientConfig: false,
      mutationSql: false,
      migrationPlan: true,
      deploymentManifest: true,
      reviewSqlTemplate: true
    },
    capabilityCoverage: {
      'migrations.backfill': 'select-only-template-requires-host-read-only-transaction',
      'migrations.data': 'receipt-driven-plan-without-runner-or-ledger',
      'migrations.schema': 'p1-source-ledger-prerequisite-not-bound'
    },
    catalogChecks: {
      executionStatus: 'required-live-check',
      compilerObservedLiveCatalog: false,
      entityMarker: 'required',
      cursorFieldMarker: 'required',
      targetFieldMarker: 'required',
      primaryKeyMarkerAndExactShape: 'required',
      rlsEnabledAndForced: 'required',
      identityGeneration: 'always-required',
      sequenceOwnership: 'identity-internal-dependency-required',
      sequenceIncrement: 1,
      sequenceCache: 1,
      sequenceCycle: false,
      sequenceMinimumAtLeast: migration.cursor.minimum,
      sequenceMaximumAtMost: migration.cursor.maximum,
      sequenceCurrentValueSafeAndNotBehindCursor: 'required',
      sequenceStateReadable: 'required',
      databasePrimary: 'required',
      targetCurrentlyNullable: true,
      targetDesiredNotNull: true,
      targetType: migration.transform.expectedPostgresType,
      targetLiteralDefault: migration.transform.value,
      cursorImmutabilityAndAppendMonotonicity: 'required-independent-host-proof',
      tableAndColumnAclInventory: 'required-independent-host-proof',
      rowPolicyInventory: 'required-independent-host-proof',
      triggerRuleAndFunctionInventory: 'required-independent-host-proof'
    },
    reviewSqlTemplate: {
      statementClasses: ['select', 'with-select'],
      positionalParameters: {
        $1: 'captured-high-water-from-trusted-live-read',
        $2: 'last-processed-key-from-host-accepted-receipt-or-null'
      },
      containsDirectMutationStatement: false,
      performsSchemaChange: false,
      provesLiveStateByGeneration: false,
      databaseEnforcedReadOnly: false,
      requiresTrustedHostReadOnlyTransaction: true,
      selectMayInvokePolicyFunctions: true
    },
    receiptAuthority: {
      resumePolicy: migration.resumePolicy,
      providerV2BindingAvailable: false,
      databaseBatchLedgerAvailable: false,
      sourceLedgerBound: false,
      artifactDigestBound: false,
      providerAuthorityBound: false,
      maximumReceiptCount: migration.maximumReceiptCount,
      maximumBatchReceiptCount: migration.maximumBatchReceiptCount,
      highWaterReceiptCount: 1
    },
    legacyAuthority: {
      legacyPathRetired: false,
      legacyPath: 'p1-unbounded-staged-backfill'
    },
    postconditions: migration.postconditions,
    releaseBlockers: SUPABASE_BACKFILL_RELEASE_BLOCKERS_V2,
    requiredManualChecks: [
      'run-catalog-query-through-trusted-read-only-host',
      'enforce-database-read-only-transaction-for-every-review-query',
      'prove-managed-entity-field-and-primary-key-markers',
      'prove-rls-enabled-and-forced',
      'inspect-table-and-column-acl-for-unbounded-cursor-writes',
      'inspect-row-policies-for-complete-system-wide-runner-visibility',
      'inspect-user-trigger-rule-and-function-overload-drift',
      'prove-identity-always-and-exact-sequence-properties',
      'prove-cursor-immutable-and-append-monotonic',
      'verify-target-live-nullability-type-and-literal-default',
      'capture-high-water-and-prove-safe-integer-range',
      `prove-estimated-cursor-range-batches-do-not-exceed-${migration.maximumBatchReceiptCount}`,
      'bind-source-ledger-artifacts-provider-authority-and-host-receipts',
      'provide-atomic-database-batch-ledger-with-cas-head',
      'retire-p1-unbounded-staged-backfill-path',
      'verify-dry-run-and-exact-postconditions-before-any-reviewed-runner'
    ],
    artifacts: SUPABASE_BACKFILL_ARTIFACT_PATHS_V2
  }
  return Object.freeze([
    Object.freeze({
      path: SUPABASE_BACKFILL_ARTIFACT_PATHS_V2.migrationPlan,
      kind: 'migration-plan' as const,
      mediaType: 'application/json',
      content: stableJSON(migrationPlan, '$.supabaseBackfill.migrationPlan')
    }),
    Object.freeze({
      path: SUPABASE_BACKFILL_ARTIFACT_PATHS_V2.reviewManifest,
      kind: 'deployment-manifest' as const,
      mediaType: 'application/json',
      content: stableJSON(reviewManifest, '$.supabaseBackfill.reviewManifest')
    }),
    Object.freeze({
      path: SUPABASE_BACKFILL_ARTIFACT_PATHS_V2.sql,
      kind: 'server-runtime' as const,
      mediaType: 'application/sql; charset=utf-8',
      content: emitSupabaseBackfillReviewSQLV2(context.application)
    })
  ])
}
