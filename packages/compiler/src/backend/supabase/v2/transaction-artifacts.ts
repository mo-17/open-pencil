import { canonicalBackendValue, digestCanonicalBackendValue } from '#compiler/backend/canonical'
import type {
  BackendArtifactSourceV2,
  BackendProviderAdapterContextV2
} from '#compiler/backend/v2/contracts'

import type { JSONValue } from '@open-pencil/scene-graph/primitives'

import {
  createSupabaseAtomicTransactionPlanV2,
  resolvedSupabaseAtomicTransactionV2,
  SUPABASE_ATOMIC_TRANSACTION_ARTIFACT_PATHS_V2
} from './transaction'
import { emitSupabaseAtomicTransactionClientV2 } from './transaction-client'
import { emitSupabaseAtomicTransactionSQLV2 } from './transaction-sql'

function stableJSON(value: unknown, path: string): string {
  return `${JSON.stringify(canonicalBackendValue(value, path), null, 2)}\n`
}

function assertExpectedPlan(context: BackendProviderAdapterContextV2, plan: JSONValue): void {
  const expected = createSupabaseAtomicTransactionPlanV2(context)
  if (
    digestCanonicalBackendValue(plan, '$.supabaseAtomicTransaction.receivedPlan') !==
    digestCanonicalBackendValue(expected, '$.supabaseAtomicTransaction.expectedPlan')
  ) {
    throw new TypeError(
      'Supabase atomic transaction plan does not match normalized application IR.'
    )
  }
}

/** Emits deterministic source-review artifacts only; no callback has Apply or remote authority. */
export function emitSupabaseAtomicTransactionArtifactsV2(
  context: BackendProviderAdapterContextV2,
  plan: JSONValue
): readonly BackendArtifactSourceV2[] {
  assertExpectedPlan(context, plan)
  const transaction = resolvedSupabaseAtomicTransactionV2(context.application)
  const adapterPlanDigest = digestCanonicalBackendValue(
    plan,
    '$.supabaseAtomicTransaction.adapterPlan'
  )
  const prerequisites = {
    format: 'openpencil.supabase-atomic-transaction-prerequisites.v1',
    version: 1,
    providerId: 'supabase',
    applicationId: context.application.applicationId,
    transactionId: transaction.id,
    source: 'normalized-backend-v2-ir',
    schemaApplyAllowed: false,
    atomicArtifactTablePrivilegeGrantEmitted: false,
    p1ReceiptBound: false,
    p1ArtifactDigestBound: false,
    releaseReady: false,
    requiredSourceLedgerEvidence: {
      managedEntity: transaction.entityId,
      table: transaction.table,
      ownershipId: transaction.ownershipId,
      ownerField: transaction.ownerField,
      policyId: transaction.policyId,
      operations: ['select', 'update']
    },
    postgrest: {
      exposedSchema: 'public',
      requestTransaction: 'single-database-transaction',
      schemaCacheReloadNotificationEmitted: true
    },
    directOwnerCrud: true,
    exclusiveWriteAuthority: false,
    atomicGuarantee: 'rpc-call-only'
  }
  const reviewManifest = {
    format: 'openpencil.supabase-atomic-transaction-review.v1',
    version: 1,
    providerId: 'supabase',
    applicationId: context.application.applicationId,
    adapterPlanDigest,
    actualCapabilities: context.actualCapabilities,
    reviewOnly: true,
    applyAllowed: false,
    deployAllowed: false,
    releaseReady: false,
    capabilityCoverage: {
      'auth.identity': 'host-authenticated-session-required',
      'data.read': 'atomic-rpc-step-plus-existing-p1-direct-owner-rest-read',
      'data.write': 'atomic-rpc-step-plus-existing-p1-direct-owner-rest-write',
      'migrations.schema': 'p1-source-ledger-prerequisite',
      'policy.row-level': 'p1-owner-select-update-policy-prerequisite',
      'transactions.atomic': 'serializable-postgrest-rpc-review-artifacts-emitted'
    },
    transaction,
    rpc: {
      schema: 'public',
      function: transaction.functionName,
      volatility: 'volatile',
      security: 'invoker',
      searchPath: '',
      isolation: 'serializable',
      authenticatedExecuteOnly: true,
      publicExecute: false,
      anonExecute: false,
      serviceRoleDirectExecute: false,
      serviceRoleAndBypassBoundary:
        'direct-function-acl-is-not-a-complete-boundary-against-bypassrls-or-superuser-authority',
      automaticRetry: false,
      idempotencyClaim: false,
      atomicArtifactTablePrivilegeGrantEmitted: false,
      existingOverloads: 'hard-blocked'
    },
    directOwnerCrud: true,
    exclusiveWriteAuthority: false,
    atomicGuarantee: 'rpc-call-only',
    releaseBlockers: [
      'p1-source-ledger-receipt-not-bound-to-v2-plan',
      'p1-schema-and-policy-artifact-digests-not-bound-to-v2-plan',
      'p1-owner-policy-expression-evidence-not-bound-to-v2-plan',
      'direct-owner-rest-write-remains-available-outside-atomic-rpc',
      'live-postgrest-and-concurrency-evidence-missing'
    ],
    artifacts: SUPABASE_ATOMIC_TRANSACTION_ARTIFACT_PATHS_V2,
    requiredManualChecks: [
      'review-and-source-control-rpc-sql',
      'prove-p1-managed-schema-and-owner-select-update-rls-from-source-ledger',
      'apply-through-trusted-release-authority',
      'verify-public-rpc-function-owner-acl-search-path-and-isolation',
      'verify-postgrest-single-request-transaction-and-schema-cache-reload',
      'verify-authenticated-postgrest-rpc-invoke',
      'verify-user-a-user-b-owner-isolation',
      'verify-two-client-same-version-one-winner-one-serialization-conflict',
      'verify-failed-transaction-rolls-back',
      'review-service-role-bypassrls-and-superuser-boundary',
      'retire-prior-application-id-managed-functions'
    ]
  }
  return Object.freeze([
    Object.freeze({
      path: SUPABASE_ATOMIC_TRANSACTION_ARTIFACT_PATHS_V2.client,
      kind: 'client-config' as const,
      mediaType: 'text/typescript; charset=utf-8',
      content: emitSupabaseAtomicTransactionClientV2(context.application)
    }),
    Object.freeze({
      path: SUPABASE_ATOMIC_TRANSACTION_ARTIFACT_PATHS_V2.prerequisites,
      kind: 'deployment-manifest' as const,
      mediaType: 'application/json',
      content: stableJSON(prerequisites, '$.supabaseAtomicTransaction.prerequisites')
    }),
    Object.freeze({
      path: SUPABASE_ATOMIC_TRANSACTION_ARTIFACT_PATHS_V2.reviewManifest,
      kind: 'deployment-manifest' as const,
      mediaType: 'application/json',
      content: stableJSON(reviewManifest, '$.supabaseAtomicTransaction.reviewManifest')
    }),
    Object.freeze({
      path: SUPABASE_ATOMIC_TRANSACTION_ARTIFACT_PATHS_V2.sql,
      kind: 'server-runtime' as const,
      mediaType: 'application/sql; charset=utf-8',
      content: emitSupabaseAtomicTransactionSQLV2(context.application)
    })
  ])
}
