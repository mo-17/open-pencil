/* oxlint-disable eslint(max-lines) -- Promotion, inspected-ledger, CI, and capability fixtures exercise one fail-closed Host boundary. */
import { describe, expect, test } from 'bun:test'

import {
  canonicalSupabaseInspectedSourceMigrationLedgerJSON,
  verifySupabaseInspectedSourceMigrationLedgerIntegrity,
  type SupabaseInspectedSourceMigrationLedgerV1
} from '@open-pencil/compiler/backend'
import {
  BACKEND_BACKFILL_EXECUTION_V2_COMPLETION_RULE,
  BACKEND_BACKFILL_EXECUTION_V2_SCOPE_FORMAT,
  BACKEND_SOURCE_LEDGER_BINDING_RECEIPT_FORMAT,
  BACKEND_SOURCE_LEDGER_BINDING_SUBJECT_FORMAT,
  BACKEND_SOURCE_LEDGER_BINDING_VERSION,
  BACKEND_SOURCE_LEDGER_CI_ATTESTATION_FORMAT,
  SOURCE_MIGRATION_DRIFT_RECEIPT_FORMAT,
  STAGED_MIGRATION_EXECUTION_FORMAT,
  STAGED_MIGRATION_EXECUTION_RECEIPT_FORMAT,
  canonicalBackendBackfillExecutionReceiptV2Bytes,
  createSourceMigrationLedger,
  digestBackendBackfillExecutionReceiptV2,
  digestBackendSourceLedgerAppliedPrefixV1,
  digestBackendSourceLedgerBindingSubjectV1,
  digestBackendSourceLedgerCIAttestationV1,
  digestSourceMigrationDriftReceipt,
  digestSourceMigrationLedger,
  digestStagedMigrationExecutionPlan,
  digestStagedMigrationExecutionReceipt,
  parseBackendSourceLedgerBindingReceiptV1,
  parseBackendSourceLedgerBindingSubjectV1,
  parseBackendBackfillExecutionReceiptV2,
  transitionSourceMigrationLedger,
  verifyBackendBackfillExecutionReceiptChainV2,
  verifySourceMigrationLedgerIntegrity,
  type BackendBackfillExecutionReceiptV2,
  type BackendSourceLedgerBindingReceiptV1,
  type BackendSourceLedgerCIAttestationV1,
  type SourceMigrationDriftReceiptV1,
  type SourceMigrationLedgerEntryV1,
  type SourceMigrationLedgerV1,
  type SourceMigrationPromotionRecordV1,
  type StagedMigrationExecutionPlanV1,
  type StagedMigrationExecutionReceiptV1,
  type StagedMigrationExecutionTargetAuthorityV1
} from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest, encodeBase64URL } from '@open-pencil/scene-graph'

import {
  SUPABASE_MANAGEMENT_DATABASE_WRITE_CREDENTIAL_INCARNATION_CREDENTIAL,
  SUPABASE_MANAGEMENT_DATABASE_WRITE_PAT_CREDENTIAL,
  SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL
} from '@/app/lowcode/supabase/credentials'
import {
  createSupabaseManagementDatabaseWriteCredentialLeaseIssuerForTestingV1,
  issueSupabaseManagementDatabaseWriteCredentialLeaseV1
} from '@/app/lowcode/supabase/management-database-write-credential-lease'
import { createMemoryBackendHostReleaseDispatchJournal } from '@/app/plugins/host/deployment/backend/release-journal'
import { deriveSupabaseBackfillDatabaseCASLedgerInstallCredentialLeaseBindingV1 } from '@/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/install'
import {
  createSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityForTestingV1,
  type SupabaseBackfillDatabaseCASLedgerInstallAppliedResultV1,
  type SupabaseBackfillDatabaseCASLedgerInstallTransportBindingV1
} from '@/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/install-durable-authority'
import {
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_COLUMNS_V1,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_CONSTRAINTS_V1,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL
} from '@/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/verifier'
import {
  consumeTrustedSupabaseBackfillLockedHighWaterCaptureV1,
  trustedSupabaseBackfillLockedHighWaterCaptureV1
} from '@/app/plugins/host/deployment/supabase/backfill/locked-high-water-capture'
import {
  SUPABASE_BACKFILL_READ_QUERY_INDIRECT_EXECUTION_SAFETY_PROFILE,
  SUPABASE_BACKFILL_READ_QUERY_MANAGED_RELATIONS,
  createSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateV1,
  trustedSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateContextV1
} from '@/app/plugins/host/deployment/supabase/backfill/read-query-indirect-execution-safety'
import {
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_CONTINUATION_PAGE_OBSERVATION_FORMAT,
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_CONTINUATION_REVIEW_FORMAT,
  SupabaseBackfillReceiptV2ChainContinuationReviewError,
  SupabaseBackfillReceiptV2ChainContinuationResponseError,
  createSupabaseBackfillReceiptV2ChainContinuationReviewForTestingV1,
  parseSupabaseBackfillReceiptV2ChainContinuationResponseForTestingV1,
  trustedSupabaseBackfillReceiptV2ChainContinuationPageObservationContextV1,
  trustedSupabaseBackfillReceiptV2ChainContinuationReviewContextV1,
  type SupabaseBackfillReceiptV2ChainContinuationResponseErrorCode,
  type SupabaseBackfillReceiptV2ChainContinuationReviewErrorCode
} from '@/app/plugins/host/deployment/supabase/backfill/receipt/v2/chain/continuation-review'
import {
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_COLLECTION_FORMAT,
  SupabaseBackfillReceiptV2ChainPageCollectionError,
  collectAndVerifySupabaseBackfillReceiptV2ChainForTestingV1,
  type SupabaseBackfillReceiptV2ChainPageCollectionErrorCode
} from '@/app/plugins/host/deployment/supabase/backfill/receipt/v2/chain/page/collector'
import {
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_FIRST_PAGE_OBSERVATION_FORMAT,
  SupabaseBackfillReceiptV2ChainPageResponseError,
  decodeSupabaseBackfillReceiptV2ChainPageResponseForTestingV1,
  decodeSupabaseBackfillReceiptV2ChainPageWireResponseForTestingV1,
  parseSupabaseBackfillReceiptV2ChainFirstPageResponseForTestingV1,
  requireCurrentPageReview,
  trustedSupabaseBackfillReceiptV2ChainFirstPageObservationContextV1,
  type SupabaseBackfillReceiptV2ChainPageResponseErrorCode
} from '@/app/plugins/host/deployment/supabase/backfill/receipt/v2/chain/page/response'
import {
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_FIXED_QUERY,
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_PARAMETER_ORDER,
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_RESPONSE_FIELDS,
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SQL,
  SupabaseBackfillReceiptV2ChainFirstPageReviewError,
  createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1,
  trustedSupabaseBackfillReceiptV2ChainFirstPageReviewContextV1,
  type SupabaseBackfillReceiptV2ChainFirstPageReviewErrorCode
} from '@/app/plugins/host/deployment/supabase/backfill/receipt/v2/chain/page/review'
import { SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_V1 } from '@/app/plugins/host/deployment/supabase/backfill/receipt/v2/chain/page/transport-size-certificate'
import {
  createSupabaseBackfillReceiptV2ReviewV1,
  type SupabaseBackfillReceiptV2ReviewEnvelopeV1
} from '@/app/plugins/host/deployment/supabase/backfill/receipt/v2/review'
import {
  SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_RESPONSE_OBSERVATION_FORMAT,
  SupabaseBackfillReceiptZeroCASResponseError,
  parseSupabaseBackfillReceiptZeroCASResponseForTestingV1,
  type SupabaseBackfillReceiptZeroCASResponseErrorCode
} from '@/app/plugins/host/deployment/supabase/backfill/receipt/zero/cas/response'
import {
  SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER,
  SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_RESULT_STATES,
  SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_SQL,
  SupabaseBackfillReceiptZeroCASReviewError,
  createSupabaseBackfillReceiptZeroCASReviewForTestingV1,
  trustedSupabaseBackfillReceiptZeroCASReviewContextV1,
  type SupabaseBackfillReceiptZeroCASReviewErrorCode
} from '@/app/plugins/host/deployment/supabase/backfill/receipt/zero/cas/review'
import SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_SQL_SOURCE from '@/app/plugins/host/deployment/supabase/backfill/receipt/zero/cas/v1.sql?raw'
import {
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_OBSERVATION_FORMAT,
  SupabaseBackfillReceiptZeroReconciliationResponseError,
  parseSupabaseBackfillReceiptZeroReconciliationResponseForTestingV1,
  type SupabaseBackfillReceiptZeroReconciliationResponseErrorCode
} from '@/app/plugins/host/deployment/supabase/backfill/receipt/zero/reconciliation/response'
import {
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_FIXED_QUERY,
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESPONSE_FIELDS,
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESULT_STATES,
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_SQL,
  SupabaseBackfillReceiptZeroReconciliationReviewError,
  createSupabaseBackfillReceiptZeroReconciliationReviewForTestingV1,
  trustedSupabaseBackfillReceiptZeroReconciliationReviewContextV1,
  type SupabaseBackfillReceiptZeroReconciliationReviewErrorCode
} from '@/app/plugins/host/deployment/supabase/backfill/receipt/zero/reconciliation/review'
import {
  SupabaseBackfillReceiptZeroReviewError,
  createSupabaseBackfillReceiptZeroReviewForTestingV1,
  trustedSupabaseBackfillReceiptZeroReviewContextV1,
  type SupabaseBackfillReceiptZeroReviewErrorCode
} from '@/app/plugins/host/deployment/supabase/backfill/receipt/zero/review'
import {
  SUPABASE_BACKFILL_SOURCE_LEDGER_CI_RESPONSE_FORMAT,
  SupabaseBackfillSourceLedgerBindingError,
  bindSupabaseBackfillSourceLedgerForTestingV1,
  createSupabaseBackfillSourceLedgerCIVerifierForTestingV1,
  createSupabaseBackfillSourceLedgerReviewV1,
  materializeSupabaseBackfillExecutionScopeV2ForTestingV1,
  trustedSupabaseBackfillExecutionScopeV2ForTestingContextV1,
  type SupabaseBackfillSourceLedgerBindingErrorCode,
  type SupabaseBackfillSourceLedgerCIVerificationRequestV1,
  type SupabaseBackfillSourceLedgerCIVerifierForTestingV1
} from '@/app/plugins/host/deployment/supabase/backfill/source-ledger-binding'
import {
  SUPABASE_BACKFILL_TESTING_FIXED_READ_INVOCATION_FORMAT,
  SUPABASE_BACKFILL_TESTING_FIXED_READ_LIMITS,
  SUPABASE_BACKFILL_TESTING_FIXED_READ_RESULT_FORMAT,
  SUPABASE_BACKFILL_TESTING_FIXED_READ_SESSION_FORMAT,
  SupabaseBackfillTestingFixedReadSessionError,
  createSupabaseBackfillFixedReadHarnessForTestingV1,
  createSupabaseBackfillReceiptZeroReconciliationFixedReadSessionForTestingV1,
  disposeSupabaseBackfillFixedReadSessionForTestingV1,
  runSupabaseBackfillFixedReadSessionForTestingV1,
  trustedSupabaseBackfillFixedReadResultContextForTestingV1,
  type SupabaseBackfillFixedReadInvocationForTestingV1,
  type SupabaseBackfillTestingFixedReadSessionErrorCode
} from '@/app/plugins/host/deployment/supabase/backfill/testing-fixed-read-session'
import { MemoryCredentialStore } from '@/app/settings/credentials/memory'
import { createCredentialServices } from '@/app/settings/credentials/services'

import {
  BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT,
  BACKFILL_DATABASE_CAS_LEDGER_INSTALL_WRITE_GRANT,
  createBackfillDatabaseCASLedgerInstallFixtureV1,
  createBackfillDatabaseCASLedgerInstalledVerificationFixtureV1,
  type BackfillDatabaseCASLedgerInstallFixtureV1
} from './database/cas-ledger/helpers'
import { createCapturedBackfillLockedHighWaterFixture } from './locked-high-water/helpers'

const CREATED_AT = '2026-09-06T00:00:00.000Z'
const REGISTERED_AT = '2026-09-06T00:01:00.000Z'
const DEV_BASELINED_AT = '2026-09-06T00:02:00.000Z'
const STAGING_BASELINED_AT = '2026-09-06T00:03:00.000Z'
const DEV_PROMOTED_AT = '2026-09-06T00:04:00.000Z'
const STAGING_PROMOTED_AT = '2026-09-06T00:05:00.000Z'
const STAGING_VERIFIED_AT = '2026-09-06T00:06:00.000Z'
const ATTESTED_AT = '2026-09-07T10:00:00.000Z'
const RECORDED_AT = '2026-09-07T10:00:01.000Z'
const EVALUATED_AT = '2026-09-07T10:00:02.000Z'
const CI_VERIFIED_AT = '2026-09-07T10:00:03.000Z'
const RECEIPT_ZERO_PREPARED_AT = '2026-09-07T10:04:00.000Z'
const RECEIPT_ZERO_NONCE = '723e4567-e89b-42d3-a456-426614174000'
const RECEIPT_ZERO_SECOND_NONCE = '823e4567-e89b-42d3-a456-426614174000'
const RECEIPT_ZERO_WRITE_CREDENTIAL_INCARNATION = '923e4567-e89b-42d3-a456-426614174000'
const P1_MIGRATION_ID = 'p1-source-ledger-prerequisite'
const P1_SOURCE_PATH = 'supabase/migrations/20260906000100_p1_source_prerequisite.sql'
const P1_SOURCE_SQL = [
  'BEGIN;',
  'CREATE TABLE "public"."source_ledger_prerequisite" ("id" text PRIMARY KEY);',
  'COMMIT;',
  ''
].join('\n')

async function digest(label: string): Promise<string> {
  return digestCanonicalManifest({ label })
}

async function textDigest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  return encodeBase64URL(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
}

async function sourceLedgerError(
  operation: Promise<unknown>,
  expected: SupabaseBackfillSourceLedgerBindingErrorCode
): Promise<void> {
  try {
    await operation
  } catch (cause) {
    expect(cause).toBeInstanceOf(SupabaseBackfillSourceLedgerBindingError)
    expect((cause as SupabaseBackfillSourceLedgerBindingError).code).toBe(expected)
    return
  }
  throw new TypeError(`Expected source-ledger binding error ${expected}`)
}

function executionPlan(migrationPlanDigest: string): StagedMigrationExecutionPlanV1 {
  return {
    format: STAGED_MIGRATION_EXECUTION_FORMAT,
    version: 1,
    executionId: 'execution:p1-source-ledger-prerequisite',
    changeId: 'change:p1-source-ledger-prerequisite',
    sourceMigrationPlan: {
      version: 1,
      planId: 'migration-plan:p1-source-ledger-prerequisite',
      planDigest: migrationPlanDigest,
      fromModelDigest: 'F'.repeat(42) + 'A',
      targetModelDigest: 'T'.repeat(42) + 'A'
    },
    phase: 'expand',
    predecessor: null,
    operations: [
      {
        operation: {
          id: 'operation:p1-source-ledger-prerequisite',
          kind: 'add-nullable-field',
          sourceOperationIds: ['source-operation:p1-source-ledger-prerequisite'],
          entityId: 'accounts',
          field: {
            id: 'source_ledger_marker',
            name: 'source_ledger_marker',
            type: 'string',
            nullable: true
          }
        },
        risk: 'low'
      }
    ],
    highestRisk: 'low',
    requiresHumanApproval: false
  }
}

async function migrationEntry(
  receiptReview: SupabaseBackfillReceiptV2ReviewEnvelopeV1
): Promise<SourceMigrationLedgerEntryV1> {
  const plan = executionPlan(receiptReview.review.scopeDraft.migrationPlanDigest)
  return {
    migrationId: P1_MIGRATION_ID,
    sequence: 1,
    name: 'p1-source-ledger-prerequisite',
    source: { path: P1_SOURCE_PATH, digest: await textDigest(P1_SOURCE_SQL) },
    executionPlan: plan,
    executionPlanDigest: await digestStagedMigrationExecutionPlan(plan),
    registeredAt: REGISTERED_AT
  }
}

async function recordNoDrift(
  ledger: SourceMigrationLedgerV1,
  environment: 'dev' | 'staging',
  authority: StagedMigrationExecutionTargetAuthorityV1,
  observedSchemaDigest: string,
  checkedAt: string
): Promise<SourceMigrationLedgerV1> {
  const state = ledger.environments.find((entry) => entry.environment === environment)
  if (!state) throw new TypeError(`Missing ${environment} ledger state`)
  const driftId = `drift:${environment}:${checkedAt}`
  const evidenceDigest = await digest(`evidence:${driftId}`)
  const providerReceipt: SourceMigrationDriftReceiptV1 = {
    format: SOURCE_MIGRATION_DRIFT_RECEIPT_FORMAT,
    version: 1,
    receiptId: `receipt:${driftId}`,
    driftId,
    targetAuthority: authority,
    expectedSchemaDigest: state.schemaDigest,
    observedSchemaDigest,
    status: 'none',
    outcome: 'succeeded',
    checkedAt,
    evidenceDigest
  }
  return transitionSourceMigrationLedger(ledger, {
    type: 'record-drift',
    record: {
      driftId,
      environment,
      targetAuthority: authority,
      expectedSchemaDigest: state.schemaDigest,
      observedSchemaDigest,
      status: 'none',
      providerReceipt,
      providerReceiptDigest: await digestSourceMigrationDriftReceipt(providerReceipt),
      evidenceDigest,
      checkedAt
    },
    occurredAt: checkedAt
  })
}

async function promotion(
  entry: SourceMigrationLedgerEntryV1,
  from: SourceMigrationPromotionRecordV1['from'],
  to: SourceMigrationPromotionRecordV1['to'],
  authority: StagedMigrationExecutionTargetAuthorityV1,
  schemaBeforeDigest: string,
  schemaAfterDigest: string,
  promotedAt: string
): Promise<SourceMigrationPromotionRecordV1> {
  const evidenceDigest = await digest(`promotion-evidence:${to}`)
  const executionReceipt: StagedMigrationExecutionReceiptV1 = {
    format: STAGED_MIGRATION_EXECUTION_RECEIPT_FORMAT,
    version: 1,
    receiptId: `receipt:promotion:${to}:${entry.sequence}`,
    executionId: entry.executionPlan.executionId,
    executionPlanDigest: entry.executionPlanDigest,
    phase: entry.executionPlan.phase,
    promotionFrom: from,
    targetAuthority: authority,
    schemaBeforeDigest,
    schemaAfterDigest,
    outcome: 'succeeded',
    recordedAt: promotedAt,
    evidenceDigest
  }
  return {
    promotionId: `promotion:${to}:${entry.sequence}`,
    migrationId: entry.migrationId,
    from,
    to,
    targetAuthority: authority,
    executionReceipt,
    executionReceiptDigest: await digestStagedMigrationExecutionReceipt(executionReceipt),
    schemaBeforeDigest,
    schemaAfterDigest,
    evidenceDigest,
    approval: null,
    promotedAt
  }
}

async function promotionLedgerFixture(
  receiptReview: SupabaseBackfillReceiptV2ReviewEnvelopeV1
): Promise<{
  ledger: SourceMigrationLedgerV1
  digest: string
  entry: SourceMigrationLedgerEntryV1
}> {
  const providerAuthorityDigest = receiptReview.review.bindings.providerAuthorityDigest
  const devAuthority: StagedMigrationExecutionTargetAuthorityV1 = {
    providerId: 'supabase',
    providerAuthorityDigest,
    projectRef: 'dev-source-ledger-fixture',
    accountId: receiptReview.review.authority.accountId,
    grantGeneration: 'dev-source-ledger-grant-1',
    environment: 'dev'
  }
  const stagingAuthority: StagedMigrationExecutionTargetAuthorityV1 = {
    providerId: 'supabase',
    providerAuthorityDigest,
    projectRef: receiptReview.review.authority.projectRef,
    accountId: receiptReview.review.authority.accountId,
    grantGeneration: 'staging-source-ledger-grant-1',
    environment: 'staging'
  }
  const baselineSchemaDigest = await digest('baseline-schema')
  const p1SchemaDigest = await digest('p1-schema')
  const entry = await migrationEntry(receiptReview)
  let ledger = createSourceMigrationLedger({
    ledgerId: `supabase:${receiptReview.review.authority.projectRef}:promotion`,
    createdAt: CREATED_AT
  })
  ledger = await transitionSourceMigrationLedger(ledger, {
    type: 'register-migration',
    entry,
    occurredAt: REGISTERED_AT
  })
  ledger = await recordNoDrift(ledger, 'dev', devAuthority, baselineSchemaDigest, DEV_BASELINED_AT)
  ledger = await recordNoDrift(
    ledger,
    'staging',
    stagingAuthority,
    baselineSchemaDigest,
    STAGING_BASELINED_AT
  )
  ledger = await transitionSourceMigrationLedger(ledger, {
    type: 'promote-migration',
    record: await promotion(
      entry,
      'source',
      'dev',
      devAuthority,
      baselineSchemaDigest,
      p1SchemaDigest,
      DEV_PROMOTED_AT
    ),
    occurredAt: DEV_PROMOTED_AT
  })
  ledger = await transitionSourceMigrationLedger(ledger, {
    type: 'promote-migration',
    record: await promotion(
      entry,
      'dev',
      'staging',
      stagingAuthority,
      baselineSchemaDigest,
      p1SchemaDigest,
      STAGING_PROMOTED_AT
    ),
    occurredAt: STAGING_PROMOTED_AT
  })
  ledger = await recordNoDrift(
    ledger,
    'staging',
    stagingAuthority,
    p1SchemaDigest,
    STAGING_VERIFIED_AT
  )
  const verified = await verifySourceMigrationLedgerIntegrity(ledger)
  if (!verified.ok) throw new TypeError('Promotion ledger fixture failed integrity verification')
  return Object.freeze({
    ledger: verified.value,
    digest: await digestSourceMigrationLedger(ledger),
    entry
  })
}

async function inspectedLedgerFixture(
  receiptReview: SupabaseBackfillReceiptV2ReviewEnvelopeV1,
  entry: SourceMigrationLedgerEntryV1
): Promise<{
  ledger: SupabaseInspectedSourceMigrationLedgerV1
  json: string
  fileDigest: string
}> {
  const payload = {
    migrationId: entry.migrationId,
    sequence: 1,
    name: entry.name,
    source: entry.source,
    reviewManifestDigest: await digest('p1-review-manifest'),
    applicationDigest: receiptReview.review.scopeDraft.applicationDigest,
    migrationPlanDigest: entry.executionPlan.sourceMigrationPlan.planDigest,
    stagedExecutionPlanDigest: entry.executionPlanDigest,
    emissionManifestDigest: receiptReview.review.bindings.manifestDigest,
    emissionPlanDigest: receiptReview.review.bindings.backendPlanDigest,
    storagePolicyArtifactDigest: null,
    previousEntryDigest: null,
    registeredAt: entry.registeredAt
  }
  const inspectedEntry = Object.freeze({
    ...payload,
    entryDigest: await digestCanonicalManifest(payload)
  })
  const candidate = {
    format: 'openpencil.supabase-inspected-source-migration-ledger.v1' as const,
    version: 1 as const,
    ledgerId: `supabase:${receiptReview.review.authority.projectRef}:inspected`,
    entries: [inspectedEntry],
    headDigest: inspectedEntry.entryDigest,
    createdAt: CREATED_AT,
    updatedAt: entry.registeredAt
  }
  const verified = verifySupabaseInspectedSourceMigrationLedgerIntegrity(candidate)
  if (!verified.ok) throw new TypeError('Inspected ledger fixture failed integrity verification')
  const json = canonicalSupabaseInspectedSourceMigrationLedgerJSON(verified.value)
  return Object.freeze({ ledger: verified.value, json, fileDigest: await textDigest(json) })
}

async function renamedInspectedLedgerJSON(
  ledger: SupabaseInspectedSourceMigrationLedgerV1
): Promise<string> {
  const original = ledger.entries[0]
  if (!original) throw new TypeError('Inspected ledger fixture has no entry')
  const payload = {
    migrationId: original.migrationId,
    sequence: original.sequence,
    name: 'p1-source-ledger-parity-mismatch',
    source: original.source,
    reviewManifestDigest: original.reviewManifestDigest,
    applicationDigest: original.applicationDigest,
    migrationPlanDigest: original.migrationPlanDigest,
    stagedExecutionPlanDigest: original.stagedExecutionPlanDigest,
    emissionManifestDigest: original.emissionManifestDigest,
    emissionPlanDigest: original.emissionPlanDigest,
    storagePolicyArtifactDigest: original.storagePolicyArtifactDigest,
    previousEntryDigest: original.previousEntryDigest,
    registeredAt: original.registeredAt
  }
  const entry = Object.freeze({ ...payload, entryDigest: await digestCanonicalManifest(payload) })
  const candidate = {
    ...ledger,
    entries: [entry],
    headDigest: entry.entryDigest
  }
  const verified = verifySupabaseInspectedSourceMigrationLedgerIntegrity(candidate)
  if (!verified.ok) throw new TypeError('Renamed inspected ledger failed integrity verification')
  return canonicalSupabaseInspectedSourceMigrationLedgerJSON(verified.value)
}

async function sourceEvidenceFixture(
  captureValues: Parameters<typeof createCapturedBackfillLockedHighWaterFixture>[1] = {},
  requiredMatchedRowCount: number | null = 1
) {
  const captured = await createCapturedBackfillLockedHighWaterFixture(
    250,
    captureValues,
    requiredMatchedRowCount
  )
  const receiptReview = await createSupabaseBackfillReceiptV2ReviewV1({
    capture: captured.capture
  })
  const promoted = await promotionLedgerFixture(receiptReview)
  const inspected = await inspectedLedgerFixture(receiptReview, promoted.entry)
  const staging = promoted.ledger.environments.find((entry) => entry.environment === 'staging')
  const latestNoDrift = [...promoted.ledger.driftRecords]
    .reverse()
    .find((entry) => entry.environment === 'staging')
  if (
    !staging?.targetAuthority ||
    !staging.schemaDigest ||
    !staging.lastReceiptDigest ||
    !latestNoDrift
  ) {
    throw new TypeError('Promotion fixture lacks final staging evidence')
  }
  const subject = parseBackendSourceLedgerBindingSubjectV1({
    format: BACKEND_SOURCE_LEDGER_BINDING_SUBJECT_FORMAT,
    version: BACKEND_SOURCE_LEDGER_BINDING_VERSION,
    providerId: 'supabase',
    environment: 'staging',
    projectRef: receiptReview.review.authority.projectRef,
    accountId: receiptReview.review.authority.accountId,
    providerAuthorityDigest: receiptReview.review.bindings.providerAuthorityDigest,
    applicationId: receiptReview.review.scopeDraft.applicationId,
    applicationDigest: receiptReview.review.scopeDraft.applicationDigest,
    migrationId: receiptReview.review.scopeDraft.migrationId,
    migrationDigest: receiptReview.review.scopeDraft.migrationDigest,
    migrationPlanDigest: receiptReview.review.scopeDraft.migrationPlanDigest,
    sourceLedgerDigest: promoted.digest,
    promotionLedgerDigest: promoted.digest,
    sourceArtifact: {
      migrationId: promoted.entry.migrationId,
      phase: 'expand',
      path: promoted.entry.source.path,
      digest: promoted.entry.source.digest,
      executionPlanDigest: promoted.entry.executionPlanDigest,
      migrationPlanDigest: promoted.entry.executionPlan.sourceMigrationPlan.planDigest
    },
    inspectedLedger: {
      path: 'supabase/openpencil-inspected-source-ledger.json',
      fileDigest: inspected.fileDigest,
      headDigest: inspected.ledger.headDigest,
      selectedEntryDigest: inspected.ledger.entries[0]?.entryDigest
    },
    staging: {
      targetAuthority: staging.targetAuthority,
      schemaDigest: staging.schemaDigest,
      appliedMigrationIds: staging.appliedMigrationIds,
      appliedPrefixDigest: await digestBackendSourceLedgerAppliedPrefixV1(
        staging.appliedMigrationIds
      ),
      lastReceiptDigest: staging.lastReceiptDigest,
      lastNoDriftReceiptDigest: latestNoDrift.providerReceiptDigest,
      drift: 'none'
    }
  })
  const subjectDigest = await digestBackendSourceLedgerBindingSubjectV1(subject)
  const attestation: BackendSourceLedgerCIAttestationV1 = {
    format: BACKEND_SOURCE_LEDGER_CI_ATTESTATION_FORMAT,
    version: BACKEND_SOURCE_LEDGER_BINDING_VERSION,
    subjectDigest,
    sourceLedgerDigest: subject.sourceLedgerDigest,
    stagingProjectRef: subject.projectRef,
    ciProvider: 'github-actions',
    repository: 'open-pencil/open-pencil',
    workflow: 'supabase-staging-migrations',
    runId: 'run-source-ledger-1001',
    runAttempt: 1,
    protectedRef: 'refs/heads/main',
    revision: '0123456789abcdef0123456789abcdef01234567',
    protectedRefVerified: true,
    dbPushCommandDigest: await digest('supabase-db-push-command'),
    dbPushReceiptDigest: await digest('supabase-db-push-receipt'),
    databaseHistoryDigest: await digest('supabase-database-history'),
    succeeded: true,
    unresolvedMutation: false,
    attestedAt: ATTESTED_AT
  }
  const bindingReceipt = parseBackendSourceLedgerBindingReceiptV1({
    format: BACKEND_SOURCE_LEDGER_BINDING_RECEIPT_FORMAT,
    version: BACKEND_SOURCE_LEDGER_BINDING_VERSION,
    subject,
    subjectDigest,
    attestation,
    attestationDigest: await digestBackendSourceLedgerCIAttestationV1(attestation),
    recordedAt: RECORDED_AT
  })
  const review = await createSupabaseBackfillSourceLedgerReviewV1({
    receiptReview,
    bindingReceipt,
    promotionLedger: promoted.ledger,
    inspectedSourceLedgerJSON: inspected.json,
    sourceMigrationSQL: P1_SOURCE_SQL,
    evaluatedAt: EVALUATED_AT
  })
  return Object.freeze({
    ...captured,
    receiptReview,
    promoted,
    inspected,
    subject,
    bindingReceipt,
    review
  })
}

async function validCIResponse(request: SupabaseBackfillSourceLedgerCIVerificationRequestV1) {
  return Object.freeze({
    format: SUPABASE_BACKFILL_SOURCE_LEDGER_CI_RESPONSE_FORMAT,
    version: 1 as const,
    verified: true as const,
    testingOnly: true as const,
    requestDigest: await digestCanonicalManifest(request),
    reviewDigest: request.reviewDigest,
    bindingReceiptDigest: request.bindingReceiptDigest,
    subjectDigest: request.subjectDigest,
    attestationDigest: request.attestationDigest,
    sourceLedgerDigest: request.sourceLedgerDigest,
    trustRootId: 'testing-ci-trust-root-1',
    verifiedAt: CI_VERIFIED_AT
  })
}

function validTestingVerifier(): SupabaseBackfillSourceLedgerCIVerifierForTestingV1 {
  return createSupabaseBackfillSourceLedgerCIVerifierForTestingV1(validCIResponse)
}

function deferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
} {
  let settle: ((value: T) => void) | null = null
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return Object.freeze({
    promise,
    resolve(value: T) {
      if (!settle) throw new TypeError('Deferred fixture is not initialized')
      settle(value)
    }
  })
}

async function receiptZeroError(
  operation: Promise<unknown>,
  expected: SupabaseBackfillReceiptZeroReviewErrorCode
): Promise<void> {
  try {
    await operation
  } catch (cause) {
    expect(cause).toBeInstanceOf(SupabaseBackfillReceiptZeroReviewError)
    expect((cause as SupabaseBackfillReceiptZeroReviewError).code).toBe(expected)
    return
  }
  throw new TypeError(`Expected Receipt-zero review error ${expected}`)
}

async function receiptZeroCASError(
  operation: Promise<unknown>,
  expected: SupabaseBackfillReceiptZeroCASReviewErrorCode
): Promise<void> {
  try {
    await operation
  } catch (cause) {
    expect(cause).toBeInstanceOf(SupabaseBackfillReceiptZeroCASReviewError)
    expect((cause as SupabaseBackfillReceiptZeroCASReviewError).code).toBe(expected)
    return
  }
  throw new TypeError(`Expected Receipt-zero CAS review error ${expected}`)
}

async function receiptZeroCASResponseError(
  operation: Promise<unknown>,
  expected: SupabaseBackfillReceiptZeroCASResponseErrorCode
): Promise<void> {
  try {
    await operation
  } catch (cause) {
    expect(cause).toBeInstanceOf(SupabaseBackfillReceiptZeroCASResponseError)
    expect((cause as SupabaseBackfillReceiptZeroCASResponseError).code).toBe(expected)
    return
  }
  throw new TypeError(`Expected Receipt-zero CAS response error ${expected}`)
}

async function receiptZeroReconciliationError(
  operation: Promise<unknown>,
  expected: SupabaseBackfillReceiptZeroReconciliationReviewErrorCode
): Promise<void> {
  try {
    await operation
  } catch (cause) {
    expect(cause).toBeInstanceOf(SupabaseBackfillReceiptZeroReconciliationReviewError)
    expect((cause as SupabaseBackfillReceiptZeroReconciliationReviewError).code).toBe(expected)
    return
  }
  throw new TypeError(`Expected Receipt-zero reconciliation review error ${expected}`)
}

async function receiptZeroReconciliationResponseError(
  operation: Promise<unknown>,
  expected: SupabaseBackfillReceiptZeroReconciliationResponseErrorCode
): Promise<void> {
  try {
    await operation
  } catch (cause) {
    expect(cause).toBeInstanceOf(SupabaseBackfillReceiptZeroReconciliationResponseError)
    expect((cause as SupabaseBackfillReceiptZeroReconciliationResponseError).code).toBe(expected)
    return
  }
  throw new TypeError(`Expected Receipt-zero reconciliation response error ${expected}`)
}

async function fixedReadSessionError(
  operation: Promise<unknown>,
  expected: SupabaseBackfillTestingFixedReadSessionErrorCode
): Promise<void> {
  try {
    await operation
  } catch (cause) {
    expect(cause).toBeInstanceOf(SupabaseBackfillTestingFixedReadSessionError)
    expect((cause as SupabaseBackfillTestingFixedReadSessionError).code).toBe(expected)
    return
  }
  throw new TypeError(`Expected testing fixed-read session error ${expected}`)
}

async function receiptV2ChainFirstPageReviewError(
  operation: Promise<unknown>,
  expected: SupabaseBackfillReceiptV2ChainFirstPageReviewErrorCode
): Promise<void> {
  try {
    await operation
  } catch (cause) {
    expect(cause).toBeInstanceOf(SupabaseBackfillReceiptV2ChainFirstPageReviewError)
    expect((cause as SupabaseBackfillReceiptV2ChainFirstPageReviewError).code).toBe(expected)
    return
  }
  throw new TypeError(`Expected Receipt V2 chain first-page review error ${expected}`)
}

async function receiptV2ChainPageResponseError(
  operation: Promise<unknown>,
  expected: SupabaseBackfillReceiptV2ChainPageResponseErrorCode
): Promise<void> {
  try {
    await operation
  } catch (cause) {
    expect(cause).toBeInstanceOf(SupabaseBackfillReceiptV2ChainPageResponseError)
    expect((cause as SupabaseBackfillReceiptV2ChainPageResponseError).code).toBe(expected)
    return
  }
  throw new TypeError(`Expected Receipt V2 chain page response error ${expected}`)
}

async function receiptV2ChainContinuationReviewError(
  operation: Promise<unknown>,
  expected: SupabaseBackfillReceiptV2ChainContinuationReviewErrorCode
): Promise<void> {
  try {
    await operation
  } catch (cause) {
    expect(cause).toBeInstanceOf(SupabaseBackfillReceiptV2ChainContinuationReviewError)
    expect((cause as SupabaseBackfillReceiptV2ChainContinuationReviewError).code).toBe(expected)
    return
  }
  throw new TypeError(`Expected Receipt V2 chain continuation review error ${expected}`)
}

async function receiptV2ChainContinuationResponseError(
  operation: Promise<unknown>,
  expected: SupabaseBackfillReceiptV2ChainContinuationResponseErrorCode
): Promise<void> {
  try {
    await operation
  } catch (cause) {
    expect(cause).toBeInstanceOf(SupabaseBackfillReceiptV2ChainContinuationResponseError)
    expect((cause as SupabaseBackfillReceiptV2ChainContinuationResponseError).code).toBe(expected)
    return
  }
  throw new TypeError(`Expected Receipt V2 chain continuation response error ${expected}`)
}

async function receiptV2ChainPageCollectionError(
  operation: Promise<unknown>,
  expected: SupabaseBackfillReceiptV2ChainPageCollectionErrorCode
): Promise<void> {
  try {
    await operation
  } catch (cause) {
    expect(cause).toBeInstanceOf(SupabaseBackfillReceiptV2ChainPageCollectionError)
    expect((cause as SupabaseBackfillReceiptV2ChainPageCollectionError).code).toBe(expected)
    return
  }
  throw new TypeError(`Expected Receipt V2 chain page collection error ${expected}`)
}

function decodeBase64Text(value: string): string {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new TextDecoder().decode(bytes)
}

function encodeBase64Text(value: string): string {
  const bytes = new TextEncoder().encode(value)
  return encodeBase64Bytes(bytes)
}

function encodeBase64Bytes(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function digestRawText(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  return encodeBase64URL(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value))
}

async function reconciliationStaticSqlSafetyCertificate(
  casReview: Awaited<ReturnType<typeof createSupabaseBackfillReceiptZeroCASReviewForTestingV1>>
) {
  const casContext = trustedSupabaseBackfillReceiptZeroCASReviewContextV1(casReview)
  if (!casContext) throw new TypeError('Expected a genuine Receipt-zero CAS review context')
  return createSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateV1({
    queryId: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_FIXED_QUERY.queryId,
    queryVersion: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_FIXED_QUERY.queryVersion,
    queryDigest: await digestCanonicalManifest(
      SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_FIXED_QUERY
    ),
    sql: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_SQL,
    sqlDigest: await digestRawText(SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_SQL),
    parameterOrder: SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER,
    responseFields: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESPONSE_FIELDS,
    ledgerShapeDigest: casContext.receiptZeroContext.databaseLedgerContext.result.ledgerShapeDigest,
    expectedColumnInventoryDigest: await digestCanonicalManifest(
      SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_COLUMNS_V1
    ),
    expectedConstraintInventoryDigest: await digestCanonicalManifest(
      SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_CONSTRAINTS_V1
    ),
    managedRelations: SUPABASE_BACKFILL_READ_QUERY_MANAGED_RELATIONS
  })
}

async function pageStaticSqlSafetyCertificate(
  reconciliationReview: Awaited<
    ReturnType<typeof createSupabaseBackfillReceiptZeroReconciliationReviewForTestingV1>
  >
) {
  return createSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateV1({
    queryId: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_FIXED_QUERY.queryId,
    queryVersion: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_FIXED_QUERY.queryVersion,
    queryDigest: await digestCanonicalManifest(SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_FIXED_QUERY),
    sql: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SQL,
    sqlDigest: await digestRawText(SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SQL),
    parameterOrder: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_PARAMETER_ORDER,
    responseFields: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_RESPONSE_FIELDS,
    ledgerShapeDigest: reconciliationReview.review.bindings.ledgerShapeDigest,
    expectedColumnInventoryDigest: await digestCanonicalManifest(
      SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_COLUMNS_V1
    ),
    expectedConstraintInventoryDigest: await digestCanonicalManifest(
      SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_CONSTRAINTS_V1
    ),
    managedRelations: SUPABASE_BACKFILL_READ_QUERY_MANAGED_RELATIONS
  })
}

function databaseLedgerTransportBinding(
  fixture: BackfillDatabaseCASLedgerInstallFixtureV1,
  credentialLease: Awaited<ReturnType<typeof issueSupabaseManagementDatabaseWriteCredentialLeaseV1>>
): SupabaseBackfillDatabaseCASLedgerInstallTransportBindingV1 {
  return Object.freeze({
    providerId: 'supabase' as const,
    projectRef: fixture.context.projectRef,
    accountId: fixture.context.accountId,
    readGrantGeneration: fixture.readAuthority.grantGeneration,
    writeGrantGeneration: fixture.writeAuthority.grantGeneration,
    migrationName: fixture.context.migrationName,
    installReviewDigest: fixture.context.installReviewDigest,
    sourceReviewDigest: fixture.context.sourceReviewDigest,
    verificationDigest: fixture.context.verificationDigest,
    ledgerShapeDigest: fixture.context.ledgerShapeDigest,
    baseSqlDigest: fixture.context.sqlDigest,
    marker: fixture.context.marker,
    markerBindingDigest: fixture.context.markerBindingDigest,
    installSqlDigest: fixture.context.installSqlDigest,
    verificationQueryDigest: fixture.context.verificationQueryDigest,
    credentialLeaseBindingDigest: credentialLease.bindingDigest,
    writeCredentialIncarnation: credentialLease.writeCredentialIncarnation,
    operationLeaseGeneration: credentialLease.operationLeaseGeneration
  })
}

async function appliedDatabaseLedgerFixture(
  evidence: Awaited<ReturnType<typeof sourceEvidenceFixture>>
): Promise<
  Readonly<{
    fixture: BackfillDatabaseCASLedgerInstallFixtureV1
    applied: SupabaseBackfillDatabaseCASLedgerInstallAppliedResultV1
  }>
> {
  const fixture = await createBackfillDatabaseCASLedgerInstallFixtureV1({
    captured: evidence,
    receiptReview: evidence.receiptReview
  })
  const services = createCredentialServices(new MemoryCredentialStore())
  await services.manager.set(
    SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL,
    BACKFILL_DATABASE_CAS_LEDGER_INSTALL_WRITE_GRANT
  )
  await services.manager.set(
    SUPABASE_MANAGEMENT_DATABASE_WRITE_CREDENTIAL_INCARNATION_CREDENTIAL,
    RECEIPT_ZERO_WRITE_CREDENTIAL_INCARNATION
  )
  await services.manager.set(
    SUPABASE_MANAGEMENT_DATABASE_WRITE_PAT_CREDENTIAL,
    BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT
  )
  const credentialIssuer =
    createSupabaseManagementDatabaseWriteCredentialLeaseIssuerForTestingV1(services)
  const credentialBinding = deriveSupabaseBackfillDatabaseCASLedgerInstallCredentialLeaseBindingV1(
    fixture.context
  )
  if (!credentialBinding) throw new TypeError('Expected a genuine database-ledger lease binding')
  const credentialLease = await issueSupabaseManagementDatabaseWriteCredentialLeaseV1({
    issuer: credentialIssuer,
    binding: credentialBinding
  })
  const durable = createSupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityForTestingV1({
    journal: createMemoryBackendHostReleaseDispatchJournal()
  })
  const claimed = await durable.authority.claim({
    context: fixture.context,
    releaseId: 'receipt-zero-database-ledger-install',
    ownerId: 'receipt-zero-test-host',
    claimedAt: '2026-09-07T10:00:00.000Z'
  })
  if (claimed.status !== 'claimed' || !claimed.attempt) {
    throw new TypeError(`Expected a database-ledger claim, received ${claimed.status}`)
  }
  const precommitted = await durable.authority.precommit({
    attempt: claimed.attempt,
    credentialIssuer,
    credentialLease,
    progressRecordedAt: '2026-09-07T10:01:00.000Z',
    outcomeUnknownAt: '2026-09-07T10:02:00.000Z'
  })
  const consumed = await durable.permitConsumer.consume(
    precommitted.permit,
    databaseLedgerTransportBinding(fixture, credentialLease)
  )
  if (!consumed || !durable.permitConsumer.markPOSTStarted(precommitted.permit)) {
    throw new TypeError('Expected the database-ledger test permit to cross the POST boundary')
  }
  const installedVerification =
    await createBackfillDatabaseCASLedgerInstalledVerificationFixtureV1(fixture)
  const applied = await durable.authority.reconcileInstalled({
    attempt: claimed.attempt,
    installedVerification,
    recordedAt: '2026-09-07T10:03:00.000Z'
  })
  if (applied.status !== 'applied') {
    throw new TypeError(`Expected an applied database ledger, received ${applied.status}`)
  }
  return Object.freeze({ fixture, applied })
}

async function receiptZeroFixture(
  captureValues: Parameters<typeof createCapturedBackfillLockedHighWaterFixture>[1] = {},
  requiredMatchedRowCount: number | null = 1
) {
  const evidence = await sourceEvidenceFixture(captureValues, requiredMatchedRowCount)
  const binding = await bindSupabaseBackfillSourceLedgerForTestingV1({
    review: evidence.review,
    verifier: validTestingVerifier()
  })
  const scopeEnvelope = await materializeSupabaseBackfillExecutionScopeV2ForTestingV1({
    receiptReview: evidence.receiptReview,
    binding
  })
  const databaseLedger = await appliedDatabaseLedgerFixture(evidence)
  return Object.freeze({ evidence, binding, scopeEnvelope, databaseLedger })
}

async function receiptZeroCASFixture(
  captureValues: Parameters<typeof createCapturedBackfillLockedHighWaterFixture>[1] = {},
  requiredMatchedRowCount: number | null = 1
) {
  const fixture = await receiptZeroFixture(captureValues, requiredMatchedRowCount)
  const receiptZero = await createSupabaseBackfillReceiptZeroReviewForTestingV1({
    scopeEnvelope: fixture.scopeEnvelope,
    databaseLedgerInstallation: fixture.databaseLedger.applied,
    preparedAt: RECEIPT_ZERO_PREPARED_AT,
    nonce: RECEIPT_ZERO_NONCE
  })
  const casReview = await createSupabaseBackfillReceiptZeroCASReviewForTestingV1({
    receiptZeroReview: receiptZero
  })
  const staticSqlSafetyCertificate = await reconciliationStaticSqlSafetyCertificate(casReview)
  return Object.freeze({ fixture, receiptZero, casReview, staticSqlSafetyCertificate })
}

type ReceiptZeroCASFixtureV1 = Awaited<ReturnType<typeof receiptZeroCASFixture>>
type ReceiptZeroReconciliationReviewFixtureV1 = Awaited<
  ReturnType<typeof createSupabaseBackfillReceiptZeroReconciliationReviewForTestingV1>
>
type ReceiptZeroReconciliationStateV1 =
  (typeof SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESULT_STATES)[number]
type ReceiptZeroReconciliationResponseRowV1 = {
  [Key in (typeof SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESPONSE_FIELDS)[number]]: unknown
}

async function receiptZeroReconciliationFixture(
  captureValues: Parameters<typeof createCapturedBackfillLockedHighWaterFixture>[1] = {},
  requiredMatchedRowCount: number | null = 1
): Promise<
  Readonly<
    ReceiptZeroCASFixtureV1 & {
      reconciliationReview: ReceiptZeroReconciliationReviewFixtureV1
      pageSafetyCertificate: Awaited<ReturnType<typeof pageStaticSqlSafetyCertificate>>
    }
  >
> {
  const source = await receiptZeroCASFixture(captureValues, requiredMatchedRowCount)
  const reconciliationReview =
    await createSupabaseBackfillReceiptZeroReconciliationReviewForTestingV1({
      casReview: source.casReview,
      staticSqlSafetyCertificate: source.staticSqlSafetyCertificate
    })
  const pageSafetyCertificate = await pageStaticSqlSafetyCertificate(reconciliationReview)
  return Object.freeze({ ...source, reconciliationReview, pageSafetyCertificate })
}

async function reconciliationResponseRow(
  source: Awaited<ReturnType<typeof receiptZeroReconciliationFixture>>,
  reportedStatus: ReceiptZeroReconciliationStateV1
): Promise<ReceiptZeroReconciliationResponseRowV1> {
  const emptyFacts = {
    collisionExecutionCount: 0,
    targetExecutionCount: 0,
    exactInitialExecutionCount: 0,
    exactImmutableExecutionCount: 0,
    receiptCount: 0,
    exactReceiptZeroCount: 0,
    headCount: 0,
    headRevision: null,
    exactInitialHeadCount: 0,
    chainCount: 0,
    chainMinimumRevision: null,
    chainMaximumRevision: null,
    headTimestampMatchesLatestReceipt: false,
    executionTimestampMatchesHead: false
  }
  let facts = emptyFacts
  if (reportedStatus === 'exact-replay') {
    facts = {
      ...emptyFacts,
      collisionExecutionCount: 1,
      targetExecutionCount: 1,
      exactInitialExecutionCount: 1,
      exactImmutableExecutionCount: 1,
      receiptCount: 1,
      exactReceiptZeroCount: 1,
      headCount: 1,
      headRevision: 1,
      exactInitialHeadCount: 1,
      executionTimestampMatchesHead: true
    }
  } else if (reportedStatus === 'advanced-head') {
    facts = {
      ...emptyFacts,
      collisionExecutionCount: 1,
      targetExecutionCount: 1,
      exactImmutableExecutionCount: 1,
      receiptCount: 2,
      exactReceiptZeroCount: 1,
      headCount: 1,
      headRevision: 2,
      chainCount: 2,
      chainMinimumRevision: 1,
      chainMaximumRevision: 2,
      headTimestampMatchesLatestReceipt: true,
      executionTimestampMatchesHead: true
    }
  } else if (reportedStatus === 'corruption') {
    facts = { ...emptyFacts, collisionExecutionCount: 1 }
  }
  const inputValid = reportedStatus !== 'precondition-failed'
  return Object.freeze({
    queryVersion: 'openpencil-supabase-backfill-receipt-zero-reconciliation-v1',
    scopeDigest: source.casReview.review.bindings.scopeDigest,
    receiptDigest: source.casReview.review.bindings.receiptDigest,
    candidateOperationEvidenceDigest:
      source.casReview.review.bindings.candidateOperationEvidenceDigest,
    initialExecutionStatus: source.receiptZero.review.rowPlan.execution.status,
    initialReceiptOutcome: source.receiptZero.review.receipt.outcome,
    reportedStatus,
    inputValid,
    runtimeReady: true,
    fullLedgerShapeVerified: true,
    ...facts,
    transactionReadOnly: true,
    installMarkerDigest: source.reconciliationReview.review.bindings.historicalInstallMarkerDigest,
    serverVersionNum: '170006',
    snapshotDigest: await digest('receipt-zero-reconciliation-snapshot'),
    observedAt: '2026-09-08T00:00:00.000Z'
  })
}

type ReceiptV2ChainPageResponseRowV1 = {
  [Key in (typeof SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_RESPONSE_FIELDS)[number]]: unknown
}

function postgresMicrosecondTimestamp(value: string): string {
  const match = /^(.*?)(?:\.(\d{1,9}))?Z$/u.exec(value)
  if (!match?.[1]) throw new TypeError('Expected a UTC timestamp fixture')
  return `${match[1]}.${(match[2] ?? '').padEnd(6, '0').slice(0, 6)}Z`
}

async function receiptV2ChainFirstPageResponseRow(
  source: Awaited<ReturnType<typeof receiptZeroReconciliationFixture>>,
  pageReview: Awaited<
    ReturnType<typeof createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1>
  >
): Promise<ReceiptV2ChainPageResponseRowV1> {
  const context = trustedSupabaseBackfillReceiptV2ChainFirstPageReviewContextV1(pageReview)
  if (!context || context.parameters[26] === null) {
    throw new TypeError('Expected a genuine first-page review context')
  }
  const receipt = source.receiptZero.review.receipt
  const receiptDigest = source.casReview.review.bindings.receiptDigest
  const committedAt = postgresMicrosecondTimestamp(receipt.committedAt)
  const canonicalReceiptBase64 = context.parameters[26]
  const canonicalReceiptByteLength =
    canonicalBackendBackfillExecutionReceiptV2Bytes(receipt).byteLength
  const reconciliationResponse = await reconciliationResponseRow(source, 'exact-replay')
  return Object.freeze({
    queryVersion: 'openpencil-supabase-backfill-receipt-v2-chain-page-v1',
    pageMode: 'first',
    scopeDigest: source.casReview.review.bindings.scopeDigest,
    afterRevision: 0,
    pageSize: 4,
    anchorRevision: 1,
    anchorEventId: receipt.databaseEventId,
    anchorReceiptDigest: receiptDigest,
    anchorUpdatedAt: committedAt,
    reportedStatus: 'chain-complete',
    reconciliationReportedStatus: 'exact-replay',
    reconciliationResponse,
    inputValid: true,
    runtimeReady: true,
    fullLedgerShapeVerified: true,
    exactImmutableExecutionCount: 1,
    currentExecutionCount: 1,
    exactReceiptZeroCount: 1,
    executionStatus: source.receiptZero.review.rowPlan.execution.status,
    receiptCount: 1,
    minimumReceiptRevision: null,
    maximumReceiptRevision: null,
    headCount: 1,
    currentHeadRevision: 1,
    currentHeadEventId: receipt.databaseEventId,
    currentHeadReceiptDigest: receiptDigest,
    currentHeadUpdatedAt: committedAt,
    headMatchesAnchor: true,
    anchorReceiptCount: 1,
    headTimestampMatchesAnchorReceipt: true,
    executionTimestampMatchesHead: true,
    pageCandidateCount: 1,
    pageReceiptCount: 1,
    pageFirstRevision: 1,
    pageLastRevision: 1,
    pageContiguous: true,
    pageLinksValid: true,
    receiptZeroMatchesCandidate: true,
    hasMore: false,
    receipts: Object.freeze([
      Object.freeze({
        revision: 1,
        eventId: receipt.databaseEventId,
        receiptId: receipt.receiptId,
        idempotencyKey: receipt.idempotencyKey,
        requestDigest: receipt.requestDigest,
        receiptDigest,
        previousRevision: null,
        previousEventId: null,
        previousReceiptDigest: null,
        checkpointKind: receipt.checkpointKind,
        canonicalReceiptBase64,
        canonicalReceiptByteLength,
        committedAt
      })
    ]),
    transactionReadOnly: reconciliationResponse.transactionReadOnly,
    installMarkerDigest: reconciliationResponse.installMarkerDigest,
    serverVersionNum: reconciliationResponse.serverVersionNum,
    snapshotDigest: reconciliationResponse.snapshotDigest,
    observedAt: reconciliationResponse.observedAt
  })
}

async function extendReceiptV2Chain(
  capture: BackendBackfillExecutionReceiptV2,
  receiptCount: number
): Promise<readonly BackendBackfillExecutionReceiptV2[]> {
  const receipts: BackendBackfillExecutionReceiptV2[] = [capture]
  let previous = capture
  let previousDigest = await digestBackendBackfillExecutionReceiptV2(previous)
  for (let revision = 2; revision <= receiptCount; revision += 1) {
    const committedAt = new Date(Date.parse(capture.committedAt) + revision * 1_000).toISOString()
    const receipt = parseBackendBackfillExecutionReceiptV2({
      ...capture,
      receiptId: `receipt-${revision - 1}`,
      idempotencyKey: `idempotency-${revision - 1}`,
      requestDigest: await digest(`receipt-request-${revision}`),
      checkpointKind: 'batch',
      batchIndex: revision - 1,
      previousReceiptDigest: previousDigest,
      operationAuthorityDigest: await digest(`receipt-operation-${revision}`),
      databaseEventId: `database-event-${revision - 1}`,
      databaseHeadVersion: revision,
      committedAt,
      evidenceDigest: await digest(`receipt-evidence-${revision}`)
    })
    receipts.push(receipt)
    previous = receipt
    previousDigest = await digestBackendBackfillExecutionReceiptV2(previous)
  }
  return Object.freeze(receipts)
}

async function extendPortableReceiptV2Chain(
  capture: BackendBackfillExecutionReceiptV2,
  receiptCount: number,
  duplicateIdempotencyBatchIndex: number | null = null
): Promise<readonly BackendBackfillExecutionReceiptV2[]> {
  const batchCount = receiptCount - 1
  const scope = capture.scope
  if (
    receiptCount < 2 ||
    receiptCount > 10_000 ||
    scope.requiredBatchCount !== batchCount ||
    scope.capturedHighWater !== batchCount * scope.batchSize ||
    scope.initialRemainingEligibleRowCount !== batchCount * scope.batchSize ||
    scope.initialRemainingTargetRowCount !== batchCount * scope.batchSize
  ) {
    throw new TypeError('Portable Receipt fixture scope does not match its exact batch chain')
  }
  const receipts: BackendBackfillExecutionReceiptV2[] = [capture]
  let previous = capture
  let previousDigest = await digestBackendBackfillExecutionReceiptV2(previous)
  for (let batchIndex = 1; batchIndex <= batchCount; batchIndex += 1) {
    const terminal = batchIndex === batchCount
    const cumulativeRowCount = batchIndex * scope.batchSize
    const committedAt = new Date(Date.parse(capture.committedAt) + batchIndex * 1_000).toISOString()
    const receipt = parseBackendBackfillExecutionReceiptV2({
      ...capture,
      receiptId: `portable-receipt-${batchIndex}`,
      idempotencyKey:
        batchIndex === duplicateIdempotencyBatchIndex
          ? `portable-idempotency-${batchIndex - 1}`
          : `portable-idempotency-${batchIndex}`,
      requestDigest: await digest(`portable-receipt-request-${batchIndex}`),
      checkpointKind: 'batch',
      batchIndex,
      previousCursor: previous.lastProcessedKey,
      lastProcessedKey: cumulativeRowCount,
      batchCounts: {
        scannedRowCount: scope.batchSize,
        matchedRowCount: scope.batchSize,
        updatedRowCount: scope.batchSize
      },
      cumulativeCounts: {
        scannedRowCount: cumulativeRowCount,
        matchedRowCount: cumulativeRowCount,
        updatedRowCount: cumulativeRowCount
      },
      exhaustion: terminal
        ? {
            checked: true,
            remainingEligibleRowCount: 0,
            remainingTargetRowCount: 0
          }
        : {
            checked: false,
            remainingEligibleRowCount: null,
            remainingTargetRowCount: null
          },
      postconditions: {
        fieldNotNull: terminal,
        requiredMatchedRowCount: scope.requiredMatchedRowCount,
        matchedRowCountSatisfied:
          scope.requiredMatchedRowCount === null ||
          cumulativeRowCount >= scope.requiredMatchedRowCount
      },
      outcome: terminal ? 'completed' : 'in-progress',
      terminalReason: terminal ? 'predicate-exhausted' : null,
      stableErrorCode: null,
      previousReceiptDigest: previousDigest,
      catalogEvidenceDigest: await digest(`portable-receipt-catalog-${batchIndex}`),
      operationAuthorityDigest: await digest(`portable-receipt-operation-${batchIndex}`),
      databaseEventId: `portable-database-event-${batchIndex}`,
      databaseHeadVersion: batchIndex + 1,
      committedAt,
      evidenceDigest: await digest(`portable-receipt-evidence-${batchIndex}`)
    })
    receipts.push(receipt)
    previous = receipt
    previousDigest = await digestBackendBackfillExecutionReceiptV2(previous)
  }
  return Object.freeze(receipts)
}

async function databaseReceiptRow(
  receipt: BackendBackfillExecutionReceiptV2,
  previous: BackendBackfillExecutionReceiptV2 | undefined
): Promise<Readonly<Record<string, unknown>>> {
  const canonicalBytes = canonicalBackendBackfillExecutionReceiptV2Bytes(receipt)
  return Object.freeze({
    revision: receipt.databaseHeadVersion,
    eventId: receipt.databaseEventId,
    receiptId: receipt.receiptId,
    idempotencyKey: receipt.idempotencyKey,
    requestDigest: receipt.requestDigest,
    receiptDigest: await digestBackendBackfillExecutionReceiptV2(receipt),
    previousRevision: previous?.databaseHeadVersion ?? null,
    previousEventId: previous?.databaseEventId ?? null,
    previousReceiptDigest: receipt.previousReceiptDigest,
    checkpointKind: receipt.checkpointKind,
    canonicalReceiptBase64: encodeBase64Bytes(canonicalBytes),
    canonicalReceiptByteLength: canonicalBytes.byteLength,
    committedAt: postgresMicrosecondTimestamp(receipt.committedAt)
  })
}

function executionStatusForReceipt(receipt: BackendBackfillExecutionReceiptV2) {
  if (receipt.outcome === 'completed') return 'completed'
  if (receipt.outcome === 'failed') return 'failed'
  return 'running'
}

async function receiptV2ChainFirstPageResponseRowForReceipts(
  source: Awaited<ReturnType<typeof receiptZeroReconciliationFixture>>,
  pageReview: Awaited<
    ReturnType<typeof createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1>
  >,
  receipts: readonly BackendBackfillExecutionReceiptV2[]
): Promise<
  Readonly<{
    row: ReceiptV2ChainPageResponseRowV1
    receipts: readonly BackendBackfillExecutionReceiptV2[]
  }>
> {
  const receiptCount = receipts.length
  if (receiptCount < 2 || receiptCount > 10_000) {
    throw new TypeError('Advanced Receipt fixture count is out of range')
  }
  const base = await receiptV2ChainFirstPageResponseRow(source, pageReview)
  const head = receipts[receipts.length - 1]
  const headDigest = await digestBackendBackfillExecutionReceiptV2(head)
  const returnedReceipts = receipts.slice(0, 4)
  const databaseRows = await Promise.all(
    returnedReceipts.map((receipt, index) => databaseReceiptRow(receipt, receipts[index - 1]))
  )
  const reconciliationResponse = Object.freeze({
    ...(await reconciliationResponseRow(source, 'advanced-head')),
    receiptCount,
    headRevision: receiptCount,
    chainCount: receiptCount,
    chainMaximumRevision: receiptCount
  })
  const pageReceiptCount = returnedReceipts.length
  return Object.freeze({
    receipts,
    row: Object.freeze({
      ...base,
      anchorRevision: receiptCount,
      anchorEventId: head.databaseEventId,
      anchorReceiptDigest: headDigest,
      anchorUpdatedAt: postgresMicrosecondTimestamp(head.committedAt),
      reportedStatus: receiptCount > 4 ? 'page-ready' : 'chain-complete',
      reconciliationReportedStatus: 'advanced-head',
      reconciliationResponse,
      executionStatus: executionStatusForReceipt(head),
      receiptCount,
      minimumReceiptRevision: 1,
      maximumReceiptRevision: receiptCount,
      currentHeadRevision: receiptCount,
      currentHeadEventId: head.databaseEventId,
      currentHeadReceiptDigest: headDigest,
      currentHeadUpdatedAt: postgresMicrosecondTimestamp(head.committedAt),
      pageCandidateCount: Math.min(5, receiptCount),
      pageReceiptCount,
      pageFirstRevision: 1,
      pageLastRevision: pageReceiptCount,
      hasMore: receiptCount > 4,
      receipts: Object.freeze(databaseRows)
    })
  })
}

async function advancedReceiptV2ChainFirstPageResponseRow(
  source: Awaited<ReturnType<typeof receiptZeroReconciliationFixture>>,
  pageReview: Awaited<
    ReturnType<typeof createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1>
  >,
  receiptCount: number
) {
  return receiptV2ChainFirstPageResponseRowForReceipts(
    source,
    pageReview,
    await extendReceiptV2Chain(source.receiptZero.review.receipt, receiptCount)
  )
}

async function continuationReceiptV2ChainPageResponseRow(
  firstPage: Awaited<ReturnType<typeof advancedReceiptV2ChainFirstPageResponseRow>>,
  afterRevision = 4
): Promise<ReceiptV2ChainPageResponseRowV1> {
  const receiptCount = firstPage.receipts.length
  const returnedReceipts = firstPage.receipts.slice(afterRevision, afterRevision + 4)
  const databaseRows = await Promise.all(
    returnedReceipts.map((receipt, index) =>
      databaseReceiptRow(receipt, firstPage.receipts[afterRevision + index - 1])
    )
  )
  const remainingReceiptCount = receiptCount - afterRevision
  const pageReceiptCount = returnedReceipts.length
  return Object.freeze({
    ...firstPage.row,
    pageMode: 'continuation',
    afterRevision,
    reportedStatus: remainingReceiptCount > 4 ? 'page-ready' : 'chain-complete',
    pageCandidateCount: Math.min(5, remainingReceiptCount),
    pageReceiptCount,
    pageFirstRevision: pageReceiptCount === 0 ? null : afterRevision + 1,
    pageLastRevision: pageReceiptCount === 0 ? null : afterRevision + pageReceiptCount,
    pageContiguous: pageReceiptCount > 0,
    pageLinksValid: pageReceiptCount > 0,
    hasMore: remainingReceiptCount > 4,
    receipts: Object.freeze(databaseRows)
  })
}

async function parseReceiptV2ChainPageSequence(
  source: Awaited<ReturnType<typeof receiptZeroReconciliationFixture>>,
  firstPageReview: Awaited<
    ReturnType<typeof createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1>
  >,
  chain: Awaited<ReturnType<typeof advancedReceiptV2ChainFirstPageResponseRow>>
) {
  const receiptCount = chain.receipts.length
  const firstPageObservation =
    await parseSupabaseBackfillReceiptV2ChainFirstPageResponseForTestingV1({
      pageReview: firstPageReview,
      response: [chain.row]
    })
  const continuationPageObservations: Awaited<
    ReturnType<typeof parseSupabaseBackfillReceiptV2ChainContinuationResponseForTestingV1>
  >[] = []
  let previousPageObservation:
    | typeof firstPageObservation
    | Awaited<
        ReturnType<typeof parseSupabaseBackfillReceiptV2ChainContinuationResponseForTestingV1>
      > = firstPageObservation
  for (let afterRevision = 4; afterRevision < receiptCount; afterRevision += 4) {
    const continuationReview =
      await createSupabaseBackfillReceiptV2ChainContinuationReviewForTestingV1({
        previousPageObservation
      })
    const response = await continuationReceiptV2ChainPageResponseRow(chain, afterRevision)
    const observation = await parseSupabaseBackfillReceiptV2ChainContinuationResponseForTestingV1({
      continuationReview,
      response: [response]
    })
    continuationPageObservations.push(observation)
    previousPageObservation = observation
  }
  return Object.freeze({
    source,
    chain,
    firstPageObservation,
    continuationPageObservations: Object.freeze(continuationPageObservations)
  })
}

async function parsedReceiptV2ChainPageSequence(receiptCount: number) {
  const source = await receiptZeroReconciliationFixture()
  const firstPageReview = await createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1({
    reconciliationReview: source.reconciliationReview,
    staticSqlSafetyCertificate: source.pageSafetyCertificate
  })
  const chain = await advancedReceiptV2ChainFirstPageResponseRow(
    source,
    firstPageReview,
    receiptCount
  )
  return parseReceiptV2ChainPageSequence(source, firstPageReview, chain)
}

async function parsedPortableReceiptV2ChainPageSequence(
  receiptCount: number,
  duplicateIdempotencyBatchIndex: number | null = null
) {
  const batchCount = receiptCount - 1
  const rowCount = batchCount * 250
  const source = await receiptZeroReconciliationFixture(
    {
      capturedHighWater: String(rowCount),
      minimumCursor: '1',
      totalRowCount: String(rowCount),
      remainingNullTargetRowCount: String(rowCount),
      requiredBatchReceiptCount: String(batchCount)
    },
    null
  )
  const firstPageReview = await createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1({
    reconciliationReview: source.reconciliationReview,
    staticSqlSafetyCertificate: source.pageSafetyCertificate
  })
  const receipts = await extendPortableReceiptV2Chain(
    source.receiptZero.review.receipt,
    receiptCount,
    duplicateIdempotencyBatchIndex
  )
  const chain = await receiptV2ChainFirstPageResponseRowForReceipts(
    source,
    firstPageReview,
    receipts
  )
  return parseReceiptV2ChainPageSequence(source, firstPageReview, chain)
}

async function parsedCompletedReceiptZeroPageSequence() {
  const source = await receiptZeroReconciliationFixture({ remainingNullTargetRowCount: '0' }, null)
  const firstPageReview = await createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1({
    reconciliationReview: source.reconciliationReview,
    staticSqlSafetyCertificate: source.pageSafetyCertificate
  })
  const row = await receiptV2ChainFirstPageResponseRow(source, firstPageReview)
  const firstPageObservation =
    await parseSupabaseBackfillReceiptV2ChainFirstPageResponseForTestingV1({
      pageReview: firstPageReview,
      response: [row]
    })
  return Object.freeze({ source, firstPageObservation })
}

describe('Supabase backfill source-ledger binding', () => {
  test('recomputes exact source evidence without turning portable CI claims into authority', async () => {
    const evidence = await sourceEvidenceFixture()

    expect(evidence.review.review).toMatchObject({
      format: 'openpencil.supabase-backfill-source-ledger-review.v1',
      providerId: 'supabase',
      environmentIntent: 'staging',
      reviewOnly: true,
      testingOnly: false,
      sourceLedgerBound: false,
      ciAuthenticated: false,
      releaseReady: false,
      databaseAuthorityCreated: false,
      executionAuthorityCreated: false,
      receiptAuthorityCreated: false,
      source: {
        sourceMigrationId: P1_MIGRATION_ID,
        sourceMigrationPath: P1_SOURCE_PATH,
        appliedMigrationIds: [P1_MIGRATION_ID],
        drift: 'none'
      },
      ciEvidence: { structurallyVerifiedOnly: true }
    })
    expect(evidence.review.review.bindings.sourceLedgerDigest).toBe(evidence.promoted.digest)
    expect(evidence.review.review.bindings.sourceLedgerDigest).not.toBe(
      evidence.inspected.ledger.headDigest
    )
    expect(evidence.review.review.blockers).toContain(
      'source-ledger-ci-attestation-not-authenticated'
    )
    expect(evidence.review.review.blockers).toContain(
      'source-ledger-production-trust-root-not-bound'
    )
    expect(JSON.stringify(evidence.review)).not.toContain(P1_SOURCE_SQL)
  })

  test('testing trust root binds the promotion digest and materializes V2 without consuming capture', async () => {
    const evidence = await sourceEvidenceFixture()
    const binding = await bindSupabaseBackfillSourceLedgerForTestingV1({
      review: evidence.review,
      verifier: validTestingVerifier()
    })
    const scope = await materializeSupabaseBackfillExecutionScopeV2ForTestingV1({
      receiptReview: evidence.receiptReview,
      binding
    })

    expect(binding).toMatchObject({
      providerId: 'supabase',
      environment: 'staging',
      testingOnly: true,
      sourceLedgerBound: false,
      testingSourceLedgerBound: true,
      ciAuthenticated: false,
      testingCiVerified: true,
      releaseReady: false,
      databaseAuthorityCreated: false,
      executionAuthorityCreated: false,
      receiptAuthorityCreated: false
    })
    expect(binding.blockers).toContain('source-ledger-production-trust-root-not-bound')
    expect(binding.blockers).toContain('source-ledger-testing-trust-root-only')
    expect(scope).toMatchObject({
      testingOnly: true,
      sourceLedgerBound: false,
      testingSourceLedgerBound: true,
      ciAuthenticated: false,
      testingCiVerified: true,
      releaseReady: false,
      databaseAuthorityCreated: false,
      executionAuthorityCreated: false,
      receiptAuthorityCreated: false,
      sourceLedgerBindingDigest: binding.bindingDigest,
      scope: {
        format: BACKEND_BACKFILL_EXECUTION_V2_SCOPE_FORMAT,
        completionRule: BACKEND_BACKFILL_EXECUTION_V2_COMPLETION_RULE,
        sourceLedgerDigest: evidence.promoted.digest
      }
    })
    expect(trustedSupabaseBackfillExecutionScopeV2ForTestingContextV1(scope)).toMatchObject({
      envelope: scope,
      receiptReview: evidence.receiptReview,
      binding,
      capture: evidence.capture
    })
    expect(
      trustedSupabaseBackfillExecutionScopeV2ForTestingContextV1(structuredClone(scope))
    ).toBeNull()
    expect(trustedSupabaseBackfillLockedHighWaterCaptureV1(evidence.capture)).toBe(true)
    expect(consumeTrustedSupabaseBackfillLockedHighWaterCaptureV1(evidence.capture)?.capture).toBe(
      evidence.capture
    )
  })

  test('rejects untrusted callbacks, serialized proofs, tampering, and equal-data crosswires', async () => {
    const evidence = await sourceEvidenceFixture()
    let untrustedCalls = 0
    await sourceLedgerError(
      bindSupabaseBackfillSourceLedgerForTestingV1({
        review: evidence.review,
        verifier: {
          async verify() {
            untrustedCalls += 1
            return {}
          }
        }
      }),
      'supabase-backfill-source-ledger-ci-verifier-untrusted'
    )
    expect(untrustedCalls).toBe(0)

    const trustedVerifier = validTestingVerifier()
    await sourceLedgerError(
      bindSupabaseBackfillSourceLedgerForTestingV1({
        review: structuredClone(evidence.review),
        verifier: trustedVerifier
      }),
      'supabase-backfill-source-ledger-proof-invalid'
    )

    const tamperedReceipt: BackendSourceLedgerBindingReceiptV1 = {
      ...evidence.bindingReceipt,
      subjectDigest: await digest('tampered-subject')
    }
    await sourceLedgerError(
      createSupabaseBackfillSourceLedgerReviewV1({
        receiptReview: evidence.receiptReview,
        bindingReceipt: tamperedReceipt,
        promotionLedger: evidence.promoted.ledger,
        inspectedSourceLedgerJSON: evidence.inspected.json,
        sourceMigrationSQL: P1_SOURCE_SQL,
        evaluatedAt: EVALUATED_AT
      }),
      'supabase-backfill-source-ledger-evidence-mismatch'
    )
    await sourceLedgerError(
      createSupabaseBackfillSourceLedgerReviewV1({
        receiptReview: evidence.receiptReview,
        bindingReceipt: evidence.bindingReceipt,
        promotionLedger: evidence.promoted.ledger,
        inspectedSourceLedgerJSON: await renamedInspectedLedgerJSON(evidence.inspected.ledger),
        sourceMigrationSQL: P1_SOURCE_SQL,
        evaluatedAt: EVALUATED_AT
      }),
      'supabase-backfill-source-ledger-evidence-mismatch'
    )

    const binding = await bindSupabaseBackfillSourceLedgerForTestingV1({
      review: evidence.review,
      verifier: trustedVerifier
    })
    const equalDataReceiptReview = await createSupabaseBackfillReceiptV2ReviewV1({
      capture: evidence.capture
    })
    expect(equalDataReceiptReview).toEqual(evidence.receiptReview)
    expect(equalDataReceiptReview).not.toBe(evidence.receiptReview)
    await sourceLedgerError(
      materializeSupabaseBackfillExecutionScopeV2ForTestingV1({
        receiptReview: equalDataReceiptReview,
        binding
      }),
      'supabase-backfill-source-ledger-proof-invalid'
    )
    await sourceLedgerError(
      materializeSupabaseBackfillExecutionScopeV2ForTestingV1({
        receiptReview: evidence.receiptReview,
        binding: structuredClone(binding)
      }),
      'supabase-backfill-source-ledger-proof-invalid'
    )
  })

  test('single-flights CI verification, permits failure retry, and consumes only on success', async () => {
    const evidence = await sourceEvidenceFixture()
    const invalidTimestampVerifier = createSupabaseBackfillSourceLedgerCIVerifierForTestingV1(
      async (request) => ({
        ...(await validCIResponse(request)),
        verifiedAt: '2026-99-99T10:00:03.000Z'
      })
    )
    await sourceLedgerError(
      bindSupabaseBackfillSourceLedgerForTestingV1({
        review: evidence.review,
        verifier: invalidTimestampVerifier
      }),
      'supabase-backfill-source-ledger-ci-verification-failed'
    )
    const failedVerifier = createSupabaseBackfillSourceLedgerCIVerifierForTestingV1(
      async (request) => ({
        ...(await validCIResponse(request)),
        requestDigest: await digest('wrong-ci-request')
      })
    )
    await sourceLedgerError(
      bindSupabaseBackfillSourceLedgerForTestingV1({
        review: evidence.review,
        verifier: failedVerifier
      }),
      'supabase-backfill-source-ledger-ci-verification-failed'
    )

    const started = deferred<boolean>()
    const release = deferred<boolean>()
    const slowVerifier = createSupabaseBackfillSourceLedgerCIVerifierForTestingV1(
      async (request) => {
        started.resolve(true)
        await release.promise
        return validCIResponse(request)
      }
    )
    const first = bindSupabaseBackfillSourceLedgerForTestingV1({
      review: evidence.review,
      verifier: slowVerifier
    })
    await started.promise
    await sourceLedgerError(
      bindSupabaseBackfillSourceLedgerForTestingV1({
        review: evidence.review,
        verifier: validTestingVerifier()
      }),
      'supabase-backfill-source-ledger-proof-in-use'
    )
    release.resolve(true)
    const binding = await first
    expect(binding.testingSourceLedgerBound).toBe(true)

    await sourceLedgerError(
      bindSupabaseBackfillSourceLedgerForTestingV1({
        review: evidence.review,
        verifier: validTestingVerifier()
      }),
      'supabase-backfill-source-ledger-proof-consumed'
    )
  })
})

describe('Supabase backfill Receipt-zero review', () => {
  test('binds one deterministic unpersisted capture candidate without creating authority', async () => {
    const fixture = await receiptZeroFixture()
    const input = Object.freeze({
      scopeEnvelope: fixture.scopeEnvelope,
      databaseLedgerInstallation: fixture.databaseLedger.applied,
      preparedAt: RECEIPT_ZERO_PREPARED_AT,
      nonce: RECEIPT_ZERO_NONCE
    })
    const [first, second] = await Promise.all([
      createSupabaseBackfillReceiptZeroReviewForTestingV1(input),
      createSupabaseBackfillReceiptZeroReviewForTestingV1(input)
    ])

    expect(second).toEqual(first)
    expect(second).not.toBe(first)
    expect(first.review).toMatchObject({
      format: 'openpencil.supabase-backfill-receipt-zero-review.v1',
      providerId: 'supabase',
      environmentIntent: 'staging',
      testingOnly: true,
      reviewOnly: true,
      applyAvailable: false,
      releaseReady: false,
      sourceLedgerBound: false,
      testingSourceLedgerBound: true,
      ciAuthenticated: false,
      testingCiVerified: true,
      testingDatabaseLedgerInstalledProofObserved: true,
      databaseLedgerBound: false,
      operationAuthorityAuthenticated: false,
      databaseAuthorityCreated: false,
      mutationAuthorityCreated: false,
      executionAuthorityCreated: false,
      receiptAuthorityCreated: false,
      policy: {
        databaseTransactionRequired: true,
        isolation: 'serializable',
        expectedInitialHead: null,
        insertOrder: ['execution', 'receipt', 'head'],
        exactReplayOnly: true,
        conflictUpdateAllowed: false,
        advancedHeadMayBeRewound: false,
        partialStateIsCorruption: true,
        captureConsumed: false,
        operationCredentialIssued: false,
        installCredentialLeaseUsedAsProvenanceOnly: true,
        databaseLedgerReverificationRequired: true,
        receiptOperationAuthorityDigestIsUnauthenticatedTestingEvidence: true,
        mutationDispatched: false,
        requestDispatched: false,
        receiptPersisted: false,
        databaseCASCommitted: false,
        databaseCommitTimeObserved: false,
        candidateCommittedAtEqualsPreparedAt: true,
        outcomeUnknownRequiresReadOnlyReconciliation: true,
        automaticRetryAllowed: false
      }
    })
    expect(first.review.receipt).toMatchObject({
      checkpointKind: 'capture',
      batchIndex: 0,
      databaseHeadVersion: 1,
      previousReceiptDigest: null,
      previousCursor: null,
      lastProcessedKey: null,
      outcome: 'in-progress',
      terminalReason: null,
      committedAt: RECEIPT_ZERO_PREPARED_AT
    })
    expect(first.review.receipt.operationAuthorityDigest).toBe(
      first.review.bindings.candidateOperationEvidenceDigest
    )
    expect(await digestCanonicalManifest(first.review.operationEvidence)).toBe(
      first.review.bindings.candidateOperationEvidenceDigest
    )
    expect(await digestCanonicalManifest(fixture.databaseLedger.applied)).toBe(
      first.review.bindings.appliedResultDigest
    )
    expect(await digestCanonicalManifest(first.review.rowPlan)).toBe(
      first.review.bindings.rowPlanDigest
    )
    expect(first.review.operationEvidence.databaseLedger).toMatchObject({
      provenance: 'testing',
      appliedResultDigest: first.review.bindings.appliedResultDigest,
      credentialLeaseBindingDigest: fixture.databaseLedger.applied.credentialLeaseBindingDigest,
      writeCredentialIncarnation: fixture.databaseLedger.applied.writeCredentialIncarnation,
      operationLeaseGeneration: fixture.databaseLedger.applied.operationLeaseGeneration
    })
    expect(first.review.blockers).toContain('receipt-zero-not-persisted')
    expect(first.review.blockers).toContain(
      'receipt-zero-production-operation-authority-not-created'
    )
    const verified = await verifyBackendBackfillExecutionReceiptChainV2([first.review.receipt], {
      scope: fixture.scopeEnvelope.scope,
      expectedHeadDigest: first.review.bindings.receiptDigest,
      evaluatedAt: RECEIPT_ZERO_PREPARED_AT
    })
    expect(verified).toMatchObject({
      ok: true,
      releaseReady: false,
      databaseAuthorityGranted: false,
      executionAuthorityGranted: false,
      outcome: 'in-progress'
    })
    const context = trustedSupabaseBackfillReceiptZeroReviewContextV1(first)
    expect(context?.envelope).toBe(first)
    expect(JSON.parse(context?.canonicalScopeJSON ?? 'null')).toEqual(fixture.scopeEnvelope.scope)
    expect(JSON.parse(context?.canonicalReceiptJSON ?? 'null')).toEqual(first.review.receipt)
    expect(new TextEncoder().encode(context?.canonicalScopeJSON).byteLength).toBe(
      first.review.rowPlan.execution.canonicalScopeByteLength
    )
    expect(new TextEncoder().encode(context?.canonicalReceiptJSON).byteLength).toBe(
      first.review.rowPlan.receipt.canonicalReceiptByteLength
    )
    expect(trustedSupabaseBackfillReceiptZeroReviewContextV1(structuredClone(first))).toBeNull()
    expect(trustedSupabaseBackfillLockedHighWaterCaptureV1(fixture.evidence.capture)).toBe(true)
    expect(JSON.stringify(first)).not.toContain(BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT)
    expect(JSON.stringify(first)).not.toContain('CREATE TABLE')

    const changedNonce = await createSupabaseBackfillReceiptZeroReviewForTestingV1({
      ...input,
      nonce: RECEIPT_ZERO_SECOND_NONCE
    })
    expect(changedNonce.review.operationEvidence.identifiers).not.toEqual(
      first.review.operationEvidence.identifiers
    )
    expect(changedNonce.review.bindings.requestDigest).not.toBe(first.review.bindings.requestDigest)
    expect(changedNonce.review.bindings.receiptDigest).not.toBe(first.review.bindings.receiptDigest)
    expect(changedNonce.review.bindings.rowPlanDigest).not.toBe(first.review.bindings.rowPlanDigest)
  })

  test('records already-satisfied without confusing eligible rows with target rows', async () => {
    const fixture = await receiptZeroFixture({ remainingNullTargetRowCount: '0' }, null)
    const review = await createSupabaseBackfillReceiptZeroReviewForTestingV1({
      scopeEnvelope: fixture.scopeEnvelope,
      databaseLedgerInstallation: fixture.databaseLedger.applied,
      preparedAt: RECEIPT_ZERO_PREPARED_AT,
      nonce: RECEIPT_ZERO_NONCE
    })

    expect(review.review.receipt.scope.initialRemainingEligibleRowCount).toBe(42)
    expect(review.review.receipt.scope.initialRemainingTargetRowCount).toBe(0)
    expect(review.review.receipt).toMatchObject({
      outcome: 'completed',
      terminalReason: 'already-satisfied',
      exhaustion: {
        checked: true,
        remainingEligibleRowCount: 42,
        remainingTargetRowCount: 0
      },
      postconditions: {
        fieldNotNull: true,
        matchedRowCountSatisfied: true
      }
    })
    expect(review.review.rowPlan.execution.status).toBe('completed')
  })

  test('rejects clones, equal-data crosswires, hostile options, and pre-evidence time', async () => {
    const [first, second] = await Promise.all([receiptZeroFixture(), receiptZeroFixture()])
    const valid = {
      scopeEnvelope: first.scopeEnvelope,
      databaseLedgerInstallation: first.databaseLedger.applied,
      preparedAt: RECEIPT_ZERO_PREPARED_AT,
      nonce: RECEIPT_ZERO_NONCE
    }

    await receiptZeroError(
      createSupabaseBackfillReceiptZeroReviewForTestingV1({
        ...valid,
        scopeEnvelope: structuredClone(first.scopeEnvelope)
      }),
      'supabase-backfill-receipt-zero-scope-proof-invalid'
    )
    await receiptZeroError(
      createSupabaseBackfillReceiptZeroReviewForTestingV1({
        ...valid,
        databaseLedgerInstallation: structuredClone(first.databaseLedger.applied)
      }),
      'supabase-backfill-receipt-zero-database-ledger-proof-invalid'
    )
    await receiptZeroError(
      createSupabaseBackfillReceiptZeroReviewForTestingV1({
        ...valid,
        databaseLedgerInstallation: second.databaseLedger.applied
      }),
      'supabase-backfill-receipt-zero-evidence-crosswired'
    )
    await receiptZeroError(
      createSupabaseBackfillReceiptZeroReviewForTestingV1({
        ...valid,
        preparedAt: '2026-09-07T10:00:02.000Z'
      }),
      'supabase-backfill-receipt-zero-timestamp-invalid'
    )
    await receiptZeroError(
      createSupabaseBackfillReceiptZeroReviewForTestingV1({
        ...valid,
        nonce: 'not-a-uuid'
      }),
      'supabase-backfill-receipt-zero-input-invalid'
    )

    let getterCalls = 0
    const accessor = Object.defineProperty(
      {
        databaseLedgerInstallation: valid.databaseLedgerInstallation,
        preparedAt: valid.preparedAt,
        nonce: valid.nonce
      },
      'scopeEnvelope',
      {
        enumerable: true,
        get() {
          getterCalls += 1
          return valid.scopeEnvelope
        }
      }
    )
    await receiptZeroError(
      createSupabaseBackfillReceiptZeroReviewForTestingV1(accessor as never),
      'supabase-backfill-receipt-zero-input-invalid'
    )
    expect(getterCalls).toBe(0)
    await receiptZeroError(
      createSupabaseBackfillReceiptZeroReviewForTestingV1({ ...valid, extra: true } as never),
      'supabase-backfill-receipt-zero-input-invalid'
    )
    await receiptZeroError(
      createSupabaseBackfillReceiptZeroReviewForTestingV1(
        Object.assign({ ...valid }, { [Symbol('extra')]: true }) as never
      ),
      'supabase-backfill-receipt-zero-input-invalid'
    )

    const review = await createSupabaseBackfillReceiptZeroReviewForTestingV1(valid)
    expect(consumeTrustedSupabaseBackfillLockedHighWaterCaptureV1(first.evidence.capture)).not.toBe(
      null
    )
    expect(
      consumeTrustedSupabaseBackfillLockedHighWaterCaptureV1(first.evidence.capture)
    ).toBeNull()
    expect(trustedSupabaseBackfillReceiptZeroReviewContextV1(review)).toBeNull()
  })
})

describe('Supabase backfill Receipt-zero CAS transaction review', () => {
  test('binds fixed single-statement SQL and hidden positional values without creating dispatch authority', async () => {
    const fixture = await receiptZeroFixture()
    const receiptZero = await createSupabaseBackfillReceiptZeroReviewForTestingV1({
      scopeEnvelope: fixture.scopeEnvelope,
      databaseLedgerInstallation: fixture.databaseLedger.applied,
      preparedAt: RECEIPT_ZERO_PREPARED_AT,
      nonce: RECEIPT_ZERO_NONCE
    })
    const [first, second] = await Promise.all([
      createSupabaseBackfillReceiptZeroCASReviewForTestingV1({ receiptZeroReview: receiptZero }),
      createSupabaseBackfillReceiptZeroCASReviewForTestingV1({ receiptZeroReview: receiptZero })
    ])

    expect(second).toEqual(first)
    expect(second).not.toBe(first)
    expect(first.review).toMatchObject({
      format: 'openpencil.supabase-backfill-receipt-zero-cas-review.v1',
      providerId: 'supabase',
      environmentIntent: 'staging',
      testingOnly: true,
      reviewOnly: true,
      applyAvailable: false,
      releaseReady: false,
      databaseLedgerBound: false,
      operationAuthorityAuthenticated: false,
      databaseAuthorityCreated: false,
      mutationAuthorityCreated: false,
      executionAuthorityCreated: false,
      receiptAuthorityCreated: false,
      transaction: {
        isolation: 'serializable',
        snapshotScope: 'externally-established-serializable-transaction',
        accessMode: 'read-write',
        statementCount: 1,
        dmlCTECount: 3,
        lockOrder: ['execution', 'head', 'receipt'],
        insertOrder: ['execution', 'receipt', 'head'],
        executionInsertConflictAction: 'do-nothing',
        receiptInsertConflictAction: 'error-rollback',
        headInsertConflictAction: 'error-rollback',
        conflictUpdateAllowed: false,
        exactReplayWrites: false,
        advancedHeadWrites: false,
        corruptionWrites: false,
        preconditionFailedWrites: false,
        advancedHeadMayBeRewound: false,
        advancedHeadIsRelationalClassificationOnly: true,
        advancedHeadRequiresReadOnlyChainReconciliation: true,
        absentIsPreStateOnly: true,
        finalStates: [
          'inserted',
          'exact-replay',
          'advanced-head',
          'corruption',
          'precondition-failed'
        ],
        responseShape: 'one-row-one-status-field',
        requiresExternallyEstablishedSerializableTransaction: true,
        requiresExternallyBoundedStatementTimeout: true,
        requiresExternallyBoundedLockTimeout: true,
        establishesTransaction: false,
        directManagementQueryDispatchCompatible: false
      },
      parameters: {
        order: SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER,
        valueCount: 28,
        valuesExposed: false
      },
      policy: {
        previewContainsPlaceholdersOnly: true,
        canonicalValuesKeptInTrustedContextOnly: true,
        databaseLedgerReverificationIncluded: false,
        captureConsumed: false,
        operationCredentialIssued: false,
        operationAuthorityDigestIsUnauthenticatedTestingEvidence: true,
        candidateCommittedAtIsUntrusted: true,
        databaseCommitTimeObserved: false,
        managementTransportCreated: false,
        currentManagementQueryEndpointCompatible: false,
        requestDispatched: false,
        mutationDispatched: false,
        receiptPersisted: false,
        databaseCASCommitted: false,
        ambiguousOutcomeRequiresReadOnlyReconciliation: true,
        automaticRetryAllowed: false,
        serializationFailureMayBeRetriedAutomatically: false
      },
      artifact: {
        containsCatalogRead: false,
        containsManagedDataRead: true,
        containsDml: true,
        performsSchemaChange: false,
        mutationDispatched: false,
        hostDispatchAvailable: false
      }
    })
    expect(SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_SQL).toBe(
      SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_SQL_SOURCE
    )
    expect(new TextEncoder().encode(SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_SQL_SOURCE)).toHaveLength(
      23_004
    )
    expect(SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_SQL_SOURCE.endsWith('\n')).toBe(true)
    expect(SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_SQL_SOURCE.endsWith('\n\n')).toBe(false)
    expect(await digestRawText(SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_SQL_SOURCE)).toBe(
      'ROtzUuqaSQ8SQa-B49dWe9lP1F2Tcu0wljVFaabAchc'
    )
    expect(
      SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_SQL_SOURCE.match(
        /"pg_catalog"\."current_setting"\('synchronous_commit'\) = 'on'/gu
      )
    ).toHaveLength(1)
    expect(first.previewSql).toBe(SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_SQL)
    expect(first.review.bindings.transactionSqlDigest).toBe(
      await digestRawText(SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_SQL)
    )
    expect(first.review.bindings.parameterSchemaDigest).toBe(
      await digestCanonicalManifest(first.review.parameters.schema)
    )

    const context = trustedSupabaseBackfillReceiptZeroCASReviewContextV1(first)
    expect(context?.envelope).toBe(first)
    expect(context?.receiptZeroContext.envelope).toBe(receiptZero)
    expect(context?.parameters).toHaveLength(28)
    const values = context?.parameters ?? []
    const receipt = receiptZero.review.receipt
    const scope = receipt.scope
    const plan = receiptZero.review.rowPlan
    const receiptZeroContext = trustedSupabaseBackfillReceiptZeroReviewContextV1(receiptZero)
    expect(values).toEqual([
      receipt.executionId,
      scope.applicationId,
      scope.applicationDigest,
      scope.migrationId,
      scope.migrationDigest,
      scope.migrationPlanDigest,
      scope.providerAuthorityDigest,
      scope.sourceLedgerDigest,
      receiptZero.review.bindings.scopeDigest,
      scope.resourceIdentityDigest,
      scope.catalogPreconditionDigest,
      encodeBase64Text(receiptZeroContext?.canonicalScopeJSON ?? ''),
      scope.captureDigest,
      scope.capturedHighWater === null ? null : String(scope.capturedHighWater),
      String(scope.initialRemainingEligibleRowCount),
      String(scope.initialRemainingTargetRowCount),
      scope.requiredMatchedRowCount === null ? null : String(scope.requiredMatchedRowCount),
      String(scope.requiredBatchCount),
      String(scope.batchSize),
      plan.execution.status,
      receipt.committedAt,
      receipt.databaseEventId,
      receipt.receiptId,
      receipt.idempotencyKey,
      receipt.requestDigest,
      receiptZero.review.bindings.receiptDigest,
      encodeBase64Text(receiptZeroContext?.canonicalReceiptJSON ?? ''),
      receiptZero.review.bindings.candidateOperationEvidenceDigest
    ])
    expect(first.review.parameters.schema[20]).toMatchObject({
      name: 'candidateCommittedAt',
      pgType: 'text',
      encoding: 'rfc3339'
    })
    expect(decodeBase64Text(String(values[11]))).toBe(
      trustedSupabaseBackfillReceiptZeroReviewContextV1(receiptZero)?.canonicalScopeJSON
    )
    expect(decodeBase64Text(String(values[26]))).toBe(
      trustedSupabaseBackfillReceiptZeroReviewContextV1(receiptZero)?.canonicalReceiptJSON
    )
    expect(first.review.bindings.parameterValuesDigest).toBe(
      await digestCanonicalManifest({
        format: 'openpencil.supabase-backfill-receipt-zero-cas-parameters.v1',
        version: 1,
        order: SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER,
        values
      })
    )
    expect(JSON.stringify(first)).not.toContain(String(values[11]))
    expect(JSON.stringify(first)).not.toContain(String(values[26]))
    expect(JSON.stringify(first)).not.toContain(BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT)
    expect(Object.keys(first.review.parameters)).toEqual([
      'order',
      'schema',
      'valueCount',
      'valuesExposed',
      'canonicalScopeByteLength',
      'canonicalReceiptByteLength'
    ])
    const intentionallyPublicParameterValues = new Set([
      receiptZero.review.bindings.scopeDigest,
      receiptZero.review.bindings.receiptDigest,
      receiptZero.review.bindings.candidateOperationEvidenceDigest
    ])
    const publicJSON = JSON.stringify(first)
    for (const value of values) {
      if (value === null || value.length < 16 || intentionallyPublicParameterValues.has(value)) {
        continue
      }
      expect(publicJSON).not.toContain(value)
    }
    expect(first.review.blockers).toContain(
      'receipt-zero-cas-parameterized-management-transport-not-certified'
    )
    expect(first.review.blockers).toContain(
      'receipt-zero-cas-production-response-authentication-unavailable'
    )
    expect(first.review.blockers).not.toContain('receipt-zero-cas-response-parser-unavailable')
    expect(trustedSupabaseBackfillLockedHighWaterCaptureV1(fixture.evidence.capture)).toBe(true)
  })

  test('makes every state and atomicity boundary explicit in the fixed statement', () => {
    const sql = SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_SQL
    expect(sql).not.toContain('BEGIN;')
    expect(sql).not.toContain('COMMIT;')
    expect(sql).not.toContain('SET TRANSACTION')
    expect(sql).not.toContain('DO UPDATE')
    expect(sql).toContain('$1::"pg_catalog"."text"')
    expect(sql).toContain('$28::"pg_catalog"."text"')
    expect(sql).toContain(
      '$21::"pg_catalog"."text"::"pg_catalog"."timestamptz" AS "candidate_committed_at"'
    )
    expect(sql).toContain('$21::"pg_catalog"."text" AS "candidate_committed_at_text"')
    expect(sql).toContain("current_setting\"('transaction_isolation')")
    expect(sql).toContain("= 'serializable'")
    expect(sql).toContain('FOR UPDATE OF "execution" NOWAIT')
    expect(sql).toContain('FOR UPDATE OF "head" NOWAIT')
    expect(sql).toContain('FOR UPDATE OF "receipt" NOWAIT')
    expect(sql).toContain('ON CONFLICT DO NOTHING')
    expect(sql.match(/INSERT INTO/gu)).toHaveLength(3)
    expect(sql).toContain("THEN 'absent'")
    expect(sql).toContain("THEN 'exact-replay'")
    expect(sql).toContain("THEN 'advanced-head'")
    expect(sql).toContain("ELSE 'corruption'")
    expect(sql).toContain("THEN 'precondition-failed'")
    const exactReplayBranch = sql.slice(
      sql.indexOf("THEN 'absent'"),
      sql.indexOf("THEN 'exact-replay'")
    )
    expect(exactReplayBranch).not.toContain('"initial_execution_status" = \'running\'')
    expect(exactReplayBranch).not.toContain("\"receipt_document\" ->> 'outcome' = 'in-progress'")
    const advancedHeadBranch = sql.slice(
      sql.indexOf("THEN 'exact-replay'"),
      sql.indexOf("THEN 'advanced-head'")
    )
    expect(advancedHeadBranch).toContain('"initial_execution_status" = \'running\'')
    expect(advancedHeadBranch).toContain("\"receipt_document\" ->> 'outcome' = 'in-progress'")
    expect(sql).toContain('WHERE 1 / CASE')
    expect(sql.trimEnd().endsWith(';')).toBe(true)
  })

  test('keeps completed Receipt zero terminal and rejects clones, accessors, and consumed capture', async () => {
    const fixture = await receiptZeroFixture({ remainingNullTargetRowCount: '0' }, null)
    const receiptZero = await createSupabaseBackfillReceiptZeroReviewForTestingV1({
      scopeEnvelope: fixture.scopeEnvelope,
      databaseLedgerInstallation: fixture.databaseLedger.applied,
      preparedAt: RECEIPT_ZERO_PREPARED_AT,
      nonce: RECEIPT_ZERO_NONCE
    })
    const review = await createSupabaseBackfillReceiptZeroCASReviewForTestingV1({
      receiptZeroReview: receiptZero
    })
    expect(trustedSupabaseBackfillReceiptZeroCASReviewContextV1(review)?.parameters[19]).toBe(
      'completed'
    )
    expect(trustedSupabaseBackfillReceiptZeroCASReviewContextV1(structuredClone(review))).toBeNull()

    await receiptZeroCASError(
      createSupabaseBackfillReceiptZeroCASReviewForTestingV1({
        receiptZeroReview: structuredClone(receiptZero)
      }),
      'supabase-backfill-receipt-zero-cas-proof-invalid'
    )
    let getterCalls = 0
    const accessor = Object.defineProperty({}, 'receiptZeroReview', {
      enumerable: true,
      get() {
        getterCalls += 1
        return receiptZero
      }
    })
    await receiptZeroCASError(
      createSupabaseBackfillReceiptZeroCASReviewForTestingV1(accessor as never),
      'supabase-backfill-receipt-zero-cas-input-invalid'
    )
    expect(getterCalls).toBe(0)
    await receiptZeroCASError(
      createSupabaseBackfillReceiptZeroCASReviewForTestingV1({
        receiptZeroReview: receiptZero,
        extra: true
      } as never),
      'supabase-backfill-receipt-zero-cas-input-invalid'
    )
    await receiptZeroCASError(
      createSupabaseBackfillReceiptZeroCASReviewForTestingV1(
        Object.assign({ receiptZeroReview: receiptZero }, { [Symbol('extra')]: true }) as never
      ),
      'supabase-backfill-receipt-zero-cas-input-invalid'
    )

    expect(
      consumeTrustedSupabaseBackfillLockedHighWaterCaptureV1(fixture.evidence.capture)
    ).not.toBe(null)
    expect(trustedSupabaseBackfillReceiptZeroCASReviewContextV1(review)).toBeNull()
    await receiptZeroCASError(
      createSupabaseBackfillReceiptZeroCASReviewForTestingV1({ receiptZeroReview: receiptZero }),
      'supabase-backfill-receipt-zero-cas-proof-invalid'
    )
  })

  test('strictly parses all five reported states as sanitized non-authority observations', async () => {
    const { fixture, casReview } = await receiptZeroCASFixture()
    const context = trustedSupabaseBackfillReceiptZeroCASReviewContextV1(casReview)
    if (!context) throw new TypeError('Expected a genuine Receipt-zero CAS review context')
    const expectedValuesDigest = await digestCanonicalManifest({
      format: 'openpencil.supabase-backfill-receipt-zero-cas-parameters.v1',
      version: 1,
      order: SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER,
      values: context.parameters
    })

    for (const status of SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_RESULT_STATES) {
      const observation = await parseSupabaseBackfillReceiptZeroCASResponseForTestingV1({
        casReview,
        response: [{ status }]
      })
      expect(observation).toEqual({
        format: SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_RESPONSE_OBSERVATION_FORMAT,
        version: 1,
        providerId: 'supabase',
        environment: 'staging',
        testingOnly: true,
        status,
        bindings: {
          casReviewDigest: casReview.reviewDigest,
          transactionSqlDigest: await digestRawText(SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_SQL),
          parameterSchemaDigest: await digestCanonicalManifest(casReview.review.parameters.schema),
          parameterValuesDigest: expectedValuesDigest,
          responseDigest: await digestCanonicalManifest([{ status }])
        },
        reportedStatusProvesDatabaseState: false,
        requiresReadOnlyReconciliation: true,
        automaticRetryAllowed: false,
        captureConsumed: false,
        hiddenParameterValuesExposed: false,
        credentialAuthorityCreated: false,
        transportAuthorityCreated: false,
        databaseAuthorityCreated: false,
        mutationAuthorityCreated: false,
        executionAuthorityCreated: false,
        receiptAuthorityCreated: false,
        releaseAuthorityCreated: false,
        releaseReady: false
      })
      expect(Object.isFrozen(observation)).toBe(true)
      expect(Object.isFrozen(observation.bindings)).toBe(true)
      const publicJSON = JSON.stringify(observation)
      const publicDigests = new Set(Object.values(observation.bindings))
      for (const value of context.parameters) {
        if (value === null || value.length < 16 || publicDigests.has(value)) continue
        expect(publicJSON).not.toContain(value)
      }
      expect(publicJSON).not.toContain(BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT)
    }

    expect(trustedSupabaseBackfillReceiptZeroCASReviewContextV1(casReview)).not.toBeNull()
    expect(
      consumeTrustedSupabaseBackfillLockedHighWaterCaptureV1(fixture.evidence.capture)
    ).not.toBeNull()
  })

  test('requires an exact plain input and the genuine process-local CAS review identity', async () => {
    const { casReview } = await receiptZeroCASFixture()
    const response = [{ status: 'inserted' }]
    const proofError = 'supabase-backfill-receipt-zero-cas-response-proof-invalid' as const
    const inputError = 'supabase-backfill-receipt-zero-cas-response-input-invalid' as const

    await receiptZeroCASResponseError(
      parseSupabaseBackfillReceiptZeroCASResponseForTestingV1({
        casReview: structuredClone(casReview),
        response
      }),
      proofError
    )
    await receiptZeroCASResponseError(
      parseSupabaseBackfillReceiptZeroCASResponseForTestingV1({
        casReview: { ...casReview },
        response
      }),
      proofError
    )
    await receiptZeroCASResponseError(
      parseSupabaseBackfillReceiptZeroCASResponseForTestingV1({ casReview } as never),
      inputError
    )
    await receiptZeroCASResponseError(
      parseSupabaseBackfillReceiptZeroCASResponseForTestingV1({
        casReview,
        response,
        extra: true
      } as never),
      inputError
    )
    await receiptZeroCASResponseError(
      parseSupabaseBackfillReceiptZeroCASResponseForTestingV1(
        Object.assign({ casReview, response }, { [Symbol('extra')]: true }) as never
      ),
      inputError
    )
    await receiptZeroCASResponseError(
      parseSupabaseBackfillReceiptZeroCASResponseForTestingV1(
        Object.assign(Object.create({ inherited: true }), { casReview, response }) as never
      ),
      inputError
    )

    let casReviewGetterCalls = 0
    const casReviewAccessor = Object.defineProperties(
      {},
      {
        casReview: {
          enumerable: true,
          get() {
            casReviewGetterCalls += 1
            return casReview
          }
        },
        response: { enumerable: true, value: response }
      }
    )
    await receiptZeroCASResponseError(
      parseSupabaseBackfillReceiptZeroCASResponseForTestingV1(casReviewAccessor as never),
      inputError
    )
    expect(casReviewGetterCalls).toBe(0)

    let responseGetterCalls = 0
    const responseAccessor = Object.defineProperties(
      {},
      {
        casReview: { enumerable: true, value: casReview },
        response: {
          enumerable: true,
          get() {
            responseGetterCalls += 1
            return response
          }
        }
      }
    )
    await receiptZeroCASResponseError(
      parseSupabaseBackfillReceiptZeroCASResponseForTestingV1(responseAccessor as never),
      inputError
    )
    expect(responseGetterCalls).toBe(0)
  })

  test('rejects non-dense, extended, accessor, prototype, and unsupported status responses', async () => {
    const { casReview } = await receiptZeroCASFixture()
    const responseError = 'supabase-backfill-receipt-zero-cas-response-invalid' as const
    const sparseResponse: unknown[] = []
    sparseResponse.length = 1
    const invalidResponses: unknown[] = [
      null,
      {},
      [],
      [{ status: 'inserted' }, { status: 'inserted' }],
      sparseResponse,
      [{ status: 'absent' }],
      [{ status: 'INSERTED' }],
      [{ status: 1 }],
      [{}],
      [{ status: 'inserted', extra: true }],
      [Object.assign(Object.create({ inherited: true }), { status: 'inserted' })],
      [Object.assign({ status: 'inserted' }, { [Symbol('extra')]: true })]
    ]
    const extendedArray = Object.assign([{ status: 'inserted' }], { extra: true })
    const symbolArray = Object.assign([{ status: 'inserted' }], { [Symbol('extra')]: true })
    const customArrayPrototype = [{ status: 'inserted' }]
    Object.setPrototypeOf(customArrayPrototype, Object.create(Array.prototype))
    invalidResponses.push(extendedArray, symbolArray, customArrayPrototype)

    for (const response of invalidResponses) {
      await receiptZeroCASResponseError(
        parseSupabaseBackfillReceiptZeroCASResponseForTestingV1({ casReview, response }),
        responseError
      )
    }

    let indexGetterCalls = 0
    const indexAccessor: unknown[] = []
    indexAccessor.length = 1
    Object.defineProperty(indexAccessor, '0', {
      enumerable: true,
      get() {
        indexGetterCalls += 1
        return { status: 'inserted' }
      }
    })
    await receiptZeroCASResponseError(
      parseSupabaseBackfillReceiptZeroCASResponseForTestingV1({
        casReview,
        response: indexAccessor
      }),
      responseError
    )
    expect(indexGetterCalls).toBe(0)

    let statusGetterCalls = 0
    const statusAccessor = Object.defineProperty({}, 'status', {
      enumerable: true,
      get() {
        statusGetterCalls += 1
        return 'inserted'
      }
    })
    await receiptZeroCASResponseError(
      parseSupabaseBackfillReceiptZeroCASResponseForTestingV1({
        casReview,
        response: [statusAccessor]
      }),
      responseError
    )
    expect(statusGetterCalls).toBe(0)

    const nullPrototypeRow = Object.assign(Object.create(null), { status: 'exact-replay' })
    await expect(
      parseSupabaseBackfillReceiptZeroCASResponseForTestingV1({
        casReview,
        response: [nullPrototypeRow]
      })
    ).resolves.toMatchObject({ status: 'exact-replay', requiresReadOnlyReconciliation: true })
  })
})

describe('Supabase backfill Receipt-zero read-only reconciliation review', () => {
  test('reuses all 28 hidden CAS values in one deterministic non-authority review', async () => {
    const { fixture, casReview, staticSqlSafetyCertificate } = await receiptZeroCASFixture()
    const casContext = trustedSupabaseBackfillReceiptZeroCASReviewContextV1(casReview)
    if (!casContext) throw new TypeError('Expected a genuine Receipt-zero CAS review context')
    const staticSqlSafetyContext =
      trustedSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateContextV1(
        staticSqlSafetyCertificate
      )
    if (!staticSqlSafetyContext) {
      throw new TypeError('Expected a genuine reconciliation static SQL safety context')
    }

    const [first, second] = await Promise.all([
      createSupabaseBackfillReceiptZeroReconciliationReviewForTestingV1({
        casReview,
        staticSqlSafetyCertificate
      }),
      createSupabaseBackfillReceiptZeroReconciliationReviewForTestingV1({
        casReview,
        staticSqlSafetyCertificate
      })
    ])

    expect(second).toEqual(first)
    expect(second).not.toBe(first)
    expect(first.review).toMatchObject({
      format: 'openpencil.supabase-backfill-receipt-zero-reconciliation-review.v1',
      version: 1,
      providerId: 'supabase',
      environmentIntent: 'staging',
      testingOnly: true,
      reviewOnly: true,
      applyAvailable: false,
      releaseReady: false,
      databaseLedgerBound: false,
      reconciliationAuthorityCreated: false,
      databaseAuthorityCreated: false,
      mutationAuthorityCreated: false,
      executionAuthorityCreated: false,
      receiptAuthorityCreated: false,
      query: {
        queryId: 'backfill-receipt-zero-reconciliation',
        queryVersion: 'openpencil-supabase-backfill-receipt-zero-reconciliation-v1',
        accessMode: 'read-only',
        snapshotScope: 'single-statement',
        statementCount: 1,
        responseShape: 'one-row-classification-facts',
        responseFields: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESPONSE_FIELDS,
        hostMustRecomputeStatusFromFacts: true,
        dmlAllowed: false,
        staticSqlSafetyCertificateCreated: true,
        staticSqlSafetyProfile: SUPABASE_BACKFILL_READ_QUERY_INDIRECT_EXECUTION_SAFETY_PROFILE,
        staticSqlSafetyConditionalOnly: true,
        liveIndirectExecutionSafetyAuthenticated: false,
        indirectExecutionSafetyProven: false,
        requiresTransportEnforcedReadOnlyBoundary: true,
        requiresFullLiveTypeOperatorIndexGuardBeforeDispatch: true,
        requiresBoundedStatementTimeoutBeforeDispatch: true,
        rowLocksUsed: false,
        schemaMutationAllowed: false,
        managementReadOnlyEndpointSemanticallyCompatible: false,
        hostTransportCreated: false
      },
      parameters: {
        order: SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER,
        valueCount: 28,
        valuesExposed: false,
        reusedWithoutReorderingFromCASReview: true
      },
      catalogGuard: {
        evaluatesInSameStatementSnapshotWhenDispatched: true,
        minimumOnly: false,
        fullCatalogVerificationPerformed: false,
        fullCatalogVerificationIncludedInStatement: true,
        exactColumnInventoryComparisonIncludedInStatement: true,
        exactConstraintIndexOperatorInventoryComparisonIncludedInStatement: true,
        aclAndUnexpectedObjectCounterChecksIncludedInStatement: true,
        schemaName: 'openpencil_release',
        tableCommentsChecked: true,
        commonOwnerRequired: true,
        regularUnpartitionedTablesRequired: true,
        rowLevelSecurityEnabledRequired: true,
        forcedRowLevelSecurityForbidden: true,
        inheritanceForbidden: true,
        policyCountRequired: 0,
        primaryKeyMarkerConstraint: 'backfill_executions_v1_pkey',
        installMarkerPrefix: 'openpencil-install:v1:supabase-backfill-database-cas-ledger:',
        installMarkerPrefixCountRequired: 1,
        specificHistoricalInstallMarkerComparedInSql: false,
        observedInstallMarkerDigestReturned: true,
        historicalInstallMarkerDigestAvailableInTrustedReviewBinding: true,
        specificHistoricalInstallMarkerParserComparisonCreated: true,
        roleRequired: 'supabase_read_only_user',
        nonSuperuserRequired: true,
        bypassRlsRequired: true,
        effectivePgReadAllDataUsageRequired: true,
        queryRoleMustNotOwnLedger: true,
        currentAndSessionRoleMustMatch: true,
        transactionReadOnlyObserved: true,
        transactionReadOnlySettingIsEvidenceOnly: true,
        databasePrimaryRequired: true,
        effectiveSearchPath: ['pg_catalog']
      },
      classification: {
        states: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESULT_STATES,
        insertedReadbackMapsTo: 'exact-replay',
        advancedHeadIsRelationalOnly: true,
        advancedHeadRequiresFullPortableReceiptV2ChainVerification: true,
        missingSchemaRelationOrColumn: 'transport-failure-outcome-unknown'
      },
      policy: {
        previewContainsPlaceholdersOnly: true,
        canonicalValuesKeptInTrustedContextOnly: true,
        requestDispatched: false,
        managedDataReadPerformed: false,
        mutationDispatched: false,
        captureConsumed: false,
        credentialAuthorityCreated: false,
        transportAuthorityCreated: false,
        databaseAuthorityCreated: false,
        reconciliationResultAuthenticated: false,
        reportedReconciliationStatusTrusted: false,
        testingStatusParserCreated: true,
        productionResponseAuthenticated: false,
        automaticRetryAllowed: false,
        transportFailureClassifiesDatabaseState: false,
        transportFailureOutcome: 'outcome-unknown',
        absentProvesPriorMutationStopped: false,
        successfulAdvancedClassificationReleaseReady: false
      },
      artifact: {
        containsCatalogRead: true,
        containsManagedDataRead: true,
        containsDml: false,
        containsDirectDml: false,
        indirectExecutionSafetyProven: false,
        containsRowLock: false,
        performsSchemaChange: false,
        requestDispatched: false,
        hostDispatchAvailable: false
      }
    })
    expect(first.previewSql).toBe(SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_SQL)
    expect(first.review.bindings.reconciliationSqlDigest).toBe(
      await digestRawText(SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_SQL)
    )
    expect(first.review.bindings.reconciliationQueryDigest).toBe(
      await digestCanonicalManifest(SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_FIXED_QUERY)
    )
    expect(first.review.bindings.staticSqlSafetyCertificateDigest).toBe(
      staticSqlSafetyCertificate.certificateDigest
    )
    expect(first.review.bindings.expectedColumnInventoryDigest).toBe(
      await digestCanonicalManifest(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_COLUMNS_V1)
    )
    expect(first.review.bindings.expectedConstraintInventoryDigest).toBe(
      await digestCanonicalManifest(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_CONSTRAINTS_V1)
    )
    expect(first.review.bindings.casReviewDigest).toBe(casReview.reviewDigest)
    expect(first.review.bindings.casTransactionSqlDigest).toBe(
      casReview.review.bindings.transactionSqlDigest
    )
    expect(first.review.bindings.parameterSchemaDigest).toBe(
      casReview.review.bindings.parameterSchemaDigest
    )
    expect(first.review.bindings.parameterValuesDigest).toBe(
      casReview.review.bindings.parameterValuesDigest
    )
    expect(first.review.bindings.historicalInstallMarkerDigest).toBe(
      await digestRawText(fixture.databaseLedger.applied.marker)
    )

    const context = trustedSupabaseBackfillReceiptZeroReconciliationReviewContextV1(first)
    expect(context?.envelope).toBe(first)
    expect(context?.casContext).toBe(casContext)
    expect(context?.staticSqlSafetyContext).toBe(staticSqlSafetyContext)
    expect(context?.parameters).toBe(casContext.parameters)
    expect(context?.parameters).toHaveLength(28)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.review)).toBe(true)
    expect(Object.isFrozen(first.review.bindings)).toBe(true)
    expect(Object.isFrozen(first.review.query)).toBe(true)
    expect(Object.isFrozen(first.review.catalogGuard)).toBe(true)
    expect(Object.isFrozen(first.review.classification)).toBe(true)
    expect(Object.isFrozen(first.review.policy)).toBe(true)
    expect(Object.isFrozen(first.review.artifact)).toBe(true)

    const publicJSON = JSON.stringify(first)
    const publicDigests = new Set(Object.values(first.review.bindings))
    for (const value of casContext.parameters) {
      if (value === null || value.length < 16 || publicDigests.has(value)) continue
      expect(publicJSON).not.toContain(value)
    }
    expect(publicJSON).not.toContain(fixture.databaseLedger.applied.marker)
    expect(publicJSON).not.toContain(BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT)
    expect(first.review.blockers).toContain(
      'receipt-zero-reconciliation-production-response-authentication-unavailable'
    )
    expect(first.review.blockers).not.toContain(
      'receipt-zero-reconciliation-full-catalog-verification-unavailable'
    )
    expect(first.review.blockers).not.toContain(
      'receipt-zero-reconciliation-full-live-type-operator-index-guard-unavailable'
    )
    expect(first.review.blockers).toContain(
      'receipt-zero-reconciliation-indirect-execution-safety-not-proven'
    )
    expect(first.review.blockers).toContain(
      'receipt-zero-reconciliation-bounded-statement-timeout-unavailable'
    )
    expect(first.review.blockers).toContain(
      'receipt-zero-reconciliation-fixed-query-request-size-not-certified'
    )
    expect(first.review.blockers).toContain(
      'receipt-zero-reconciliation-full-v2-chain-verification-not-performed'
    )
    const pageCertificate = await pageStaticSqlSafetyCertificate(first)
    await receiptZeroReconciliationError(
      createSupabaseBackfillReceiptZeroReconciliationReviewForTestingV1({
        casReview,
        staticSqlSafetyCertificate: structuredClone(staticSqlSafetyCertificate)
      }),
      'supabase-backfill-receipt-zero-reconciliation-proof-invalid'
    )
    await receiptZeroReconciliationError(
      createSupabaseBackfillReceiptZeroReconciliationReviewForTestingV1({
        casReview,
        staticSqlSafetyCertificate: { ...staticSqlSafetyCertificate }
      }),
      'supabase-backfill-receipt-zero-reconciliation-proof-invalid'
    )
    await receiptZeroReconciliationError(
      createSupabaseBackfillReceiptZeroReconciliationReviewForTestingV1({
        casReview,
        staticSqlSafetyCertificate: pageCertificate
      }),
      'supabase-backfill-receipt-zero-reconciliation-static-sql-safety-binding-mismatch'
    )
    expect(trustedSupabaseBackfillLockedHighWaterCaptureV1(fixture.evidence.capture)).toBe(true)
  })

  test('keeps managed-row reads and output bounded while preserving a fixed read-only query', async () => {
    const sql = SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_SQL
    expect(new TextEncoder().encode(sql)).toHaveLength(115_192)
    expect(await digestRawText(sql)).toBe('IUs7VRmTI8SSyB0K-AjP8z_86MBmwcSA4W4bqcDTP1o')
    expect(sql).toContain('WITH RECURSIVE')
    expect(sql.trimEnd().endsWith(';')).toBe(true)
    expect([...sql.matchAll(/;/gu)]).toHaveLength(1)
    expect(sql).not.toMatch(/\b(?:BEGIN|COMMIT|INSERT|UPDATE|DELETE|MERGE|COPY|CALL|LOCK)\b/gu)
    expect(sql).not.toContain('SET TRANSACTION')
    expect(sql).not.toContain('FOR UPDATE')
    expect(sql).not.toContain('FOR SHARE')
    expect(sql).not.toContain('ON CONFLICT')
    expect(sql).not.toMatch(/\b(?:COUNT|MIN|MAX|SUM|AVG)\s*\(/gu)
    const positions = new Set([...sql.matchAll(/\$(\d+)/gu)].map((match) => Number(match[1])))
    expect([...positions].sort((left, right) => left - right)).toEqual(
      Array.from({ length: 28 }, (_, index) => index + 1)
    )
    expect(sql).not.toContain('$29')
    const verifierPositions = new Set(
      [...SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL.matchAll(/\$(\d+)/gu)].map(
        (match) => Number(match[1])
      )
    )
    expect([...verifierPositions].sort((left, right) => left - right)).toEqual(
      Array.from({ length: 9 }, (_, index) => index + 1)
    )
    for (let position = 1; position <= 9; position += 1) {
      expect([
        ...SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL.matchAll(
          new RegExp(`\\$${position}(?=::)`, 'gu')
        )
      ]).toHaveLength(1)
    }
    expect(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL).not.toContain(';')
    expect([...sql.matchAll(/WITH RECURSIVE/gu)]).toHaveLength(2)
    expect(sql).toContain('LIMIT 2')
    expect(sql).toContain('LIMIT 10001')
    expect([...sql.matchAll(/FROM ONLY "openpencil_release"\./gu)]).toHaveLength(4)
    expect(sql).not.toMatch(/FROM "openpencil_release"\./gu)
    expect(sql).not.toContain('SELECT "receipt".*')
    expect(sql).toContain('"read_receipt_zero" AS MATERIALIZED')
    expect(sql).toContain('"full_catalog_snapshot" AS MATERIALIZED')
    expect(sql).toContain('"full_catalog_exactness" AS MATERIALIZED')
    expect(sql).toContain("'unexpectedIndexCount'")
    expect(sql).toContain("'unexpectedTriggerCount'")
    expect(sql).toContain("'publicationExposureCount'")
    expect(sql).toContain("'keyOpclasses'")
    expect(sql).toContain("'foreignKeyOperators'")
    expect(sql).toContain(JSON.stringify(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_COLUMNS_V1))
    expect(sql).toContain(
      JSON.stringify(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_CONSTRAINTS_V1)
    )
    expect(sql).toContain("CURRENT_USER = 'supabase_read_only_user'")
    expect(sql).toContain('CURRENT_USER = SESSION_USER')
    expect(sql).toContain('"rolsuper"')
    expect(sql).toContain('"rolbypassrls"')
    expect(sql).toContain("'pg_read_all_data', 'usage'")
    expect(sql).not.toContain("'pg_read_all_data', 'member'")
    expect(sql).toContain('NOT "pg_catalog"."pg_is_in_recovery"()')
    expect([...sql.matchAll(/"pg_catalog"\."current_setting"\('search_path'\)/gu)]).toHaveLength(2)
    expect([...sql.matchAll(/"pg_catalog"\."current_schemas"/gu)]).toHaveLength(0)
    expect(sql).toContain("'openpencil:release-ledger:v1'")
    expect(sql).toContain("'backfill_executions_v1_pkey'")
    expect(sql).toContain(
      "'^openpencil-install:v1:supabase-backfill-database-cas-ledger:[A-Za-z0-9_-]{43}$'"
    )
    expect(sql).toContain("LIKE 'openpencil-install:v1:supabase-backfill-database-cas-ledger:%'")
    expect(sql).toContain('"constraint_entry"."conkey"')
    expect(sql).toContain('"pg_catalog"."pg_inherits"')
    expect(sql).toContain('"pg_catalog"."pg_policy"')
    expect(sql).toContain('"pg_catalog"."sha256"')
    expect(sql).toContain('AS "installMarkerDigest"')
    expect(sql).toContain('AS "transactionReadOnly"')
    expect(sql).toContain('AS "snapshotDigest"')
    expect(sql).toContain('AS "queryVersion"')
    expect(sql).toContain('AS "scopeDigest"')
    expect(sql).toContain('AS "receiptDigest"')
    expect(sql).toContain('AS "candidateOperationEvidenceDigest"')
    expect(sql).toContain('AS "initialExecutionStatus"')
    expect(sql).toContain('AS "initialReceiptOutcome"')
    expect(sql).toContain('AS "reportedStatus"')
    expect(sql).not.toContain('AS "status"')
    expect(sql).toContain("THEN 'precondition-failed'")
    expect(sql).toContain("THEN 'absent'")
    expect(sql).toContain("THEN 'exact-replay'")
    expect(sql).toContain("THEN 'advanced-head'")
    expect(sql).toContain("ELSE 'corruption'")
    const advancedBranch = sql.slice(
      sql.indexOf("THEN 'exact-replay'"),
      sql.indexOf("THEN 'advanced-head'")
    )
    expect(advancedBranch).toContain('"initial_execution_status" = \'running\'')
    expect(advancedBranch).toContain('"initial_receipt_outcome" = \'in-progress\'')
  })

  test('accepts completed exact-readback candidates but rejects forged identity and consumed capture', async () => {
    const fixture = await receiptZeroFixture({ remainingNullTargetRowCount: '0' }, null)
    const receiptZero = await createSupabaseBackfillReceiptZeroReviewForTestingV1({
      scopeEnvelope: fixture.scopeEnvelope,
      databaseLedgerInstallation: fixture.databaseLedger.applied,
      preparedAt: RECEIPT_ZERO_PREPARED_AT,
      nonce: RECEIPT_ZERO_NONCE
    })
    const casReview = await createSupabaseBackfillReceiptZeroCASReviewForTestingV1({
      receiptZeroReview: receiptZero
    })
    const staticSqlSafetyCertificate = await reconciliationStaticSqlSafetyCertificate(casReview)
    const review = await createSupabaseBackfillReceiptZeroReconciliationReviewForTestingV1({
      casReview,
      staticSqlSafetyCertificate
    })
    expect(
      trustedSupabaseBackfillReceiptZeroReconciliationReviewContextV1(review)?.parameters[19]
    ).toBe('completed')
    expect(
      trustedSupabaseBackfillReceiptZeroReconciliationReviewContextV1(structuredClone(review))
    ).toBeNull()

    await receiptZeroReconciliationError(
      createSupabaseBackfillReceiptZeroReconciliationReviewForTestingV1({
        casReview: structuredClone(casReview),
        staticSqlSafetyCertificate
      }),
      'supabase-backfill-receipt-zero-reconciliation-proof-invalid'
    )
    await receiptZeroReconciliationError(
      createSupabaseBackfillReceiptZeroReconciliationReviewForTestingV1({
        casReview: { ...casReview },
        staticSqlSafetyCertificate
      }),
      'supabase-backfill-receipt-zero-reconciliation-proof-invalid'
    )
    await receiptZeroReconciliationError(
      createSupabaseBackfillReceiptZeroReconciliationReviewForTestingV1({
        casReview,
        staticSqlSafetyCertificate,
        extra: true
      } as never),
      'supabase-backfill-receipt-zero-reconciliation-input-invalid'
    )
    await receiptZeroReconciliationError(
      createSupabaseBackfillReceiptZeroReconciliationReviewForTestingV1(
        Object.assign(
          { casReview, staticSqlSafetyCertificate },
          { [Symbol('extra')]: true }
        ) as never
      ),
      'supabase-backfill-receipt-zero-reconciliation-input-invalid'
    )

    let getterCalls = 0
    const accessor = Object.defineProperty({ staticSqlSafetyCertificate }, 'casReview', {
      enumerable: true,
      get() {
        getterCalls += 1
        return casReview
      }
    })
    await receiptZeroReconciliationError(
      createSupabaseBackfillReceiptZeroReconciliationReviewForTestingV1(accessor as never),
      'supabase-backfill-receipt-zero-reconciliation-input-invalid'
    )
    expect(getterCalls).toBe(0)

    expect(
      consumeTrustedSupabaseBackfillLockedHighWaterCaptureV1(fixture.evidence.capture)
    ).not.toBeNull()
    expect(trustedSupabaseBackfillReceiptZeroReconciliationReviewContextV1(review)).toBeNull()
    await receiptZeroReconciliationError(
      createSupabaseBackfillReceiptZeroReconciliationReviewForTestingV1({
        casReview,
        staticSqlSafetyCertificate
      }),
      'supabase-backfill-receipt-zero-reconciliation-proof-invalid'
    )
  })

  test('does not register a review if its inherited capture is consumed during digesting', async () => {
    const { fixture, casReview, staticSqlSafetyCertificate } = await receiptZeroCASFixture()
    const creating = createSupabaseBackfillReceiptZeroReconciliationReviewForTestingV1({
      casReview,
      staticSqlSafetyCertificate
    })
    expect(
      consumeTrustedSupabaseBackfillLockedHighWaterCaptureV1(fixture.evidence.capture)
    ).not.toBeNull()
    await receiptZeroReconciliationError(
      creating,
      'supabase-backfill-receipt-zero-reconciliation-proof-invalid'
    )
  })
})

describe('Supabase backfill Receipt-zero reconciliation response parser', () => {
  test('recomputes all five relational states without creating database or release authority', async () => {
    const source = await receiptZeroReconciliationFixture()
    const trustedContext = trustedSupabaseBackfillReceiptZeroReconciliationReviewContextV1(
      source.reconciliationReview
    )
    if (!trustedContext) throw new TypeError('Expected a genuine reconciliation review context')

    for (const reportedStatus of SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESULT_STATES) {
      const row = await reconciliationResponseRow(source, reportedStatus)
      const first = await parseSupabaseBackfillReceiptZeroReconciliationResponseForTestingV1({
        reconciliationReview: source.reconciliationReview,
        response: [row]
      })
      const second = await parseSupabaseBackfillReceiptZeroReconciliationResponseForTestingV1({
        reconciliationReview: source.reconciliationReview,
        response: [row]
      })

      expect(second).toEqual(first)
      expect(second).not.toBe(first)
      expect(first).toMatchObject({
        format: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_OBSERVATION_FORMAT,
        version: 1,
        providerId: 'supabase',
        environment: 'staging',
        testingOnly: true,
        reportedStatus,
        status: reportedStatus,
        reportedStatusMatchesRecomputedFacts: true,
        statusRecomputedByHost: true,
        reportedInstallMarkerDigestMatchesHistorical: true,
        specificHistoricalInstallationAuthenticated: false,
        reportedStatusProvesDatabaseState: false,
        statusProvesDatabaseState: false,
        productionTransportAuthenticated: false,
        fullPortableReceiptV2ChainVerified: false,
        advancedHeadRequiresFullPortableReceiptV2ChainVerification:
          reportedStatus === 'advanced-head',
        absentProvesPriorMutationStopped: false,
        automaticRetryAllowed: false,
        captureConsumed: false,
        credentialAuthorityCreated: false,
        transportAuthorityCreated: false,
        databaseAuthorityCreated: false,
        mutationAuthorityCreated: false,
        executionAuthorityCreated: false,
        receiptAuthorityCreated: false,
        releaseAuthorityCreated: false,
        releaseReady: false
      })
      expect(first.bindings).toMatchObject({
        reconciliationReviewDigest: source.reconciliationReview.reviewDigest,
        reconciliationQueryDigest:
          source.reconciliationReview.review.bindings.reconciliationQueryDigest,
        reconciliationSqlDigest:
          source.reconciliationReview.review.bindings.reconciliationSqlDigest,
        parameterSchemaDigest: source.reconciliationReview.review.bindings.parameterSchemaDigest,
        parameterValuesDigest: source.reconciliationReview.review.bindings.parameterValuesDigest,
        expectedColumnInventoryDigest:
          source.reconciliationReview.review.bindings.expectedColumnInventoryDigest,
        expectedConstraintInventoryDigest:
          source.reconciliationReview.review.bindings.expectedConstraintInventoryDigest,
        scopeDigest: source.casReview.review.bindings.scopeDigest,
        receiptDigest: source.casReview.review.bindings.receiptDigest,
        candidateOperationEvidenceDigest:
          source.casReview.review.bindings.candidateOperationEvidenceDigest,
        historicalInstallMarkerDigest:
          source.reconciliationReview.review.bindings.historicalInstallMarkerDigest,
        observedInstallMarkerDigest:
          source.reconciliationReview.review.bindings.historicalInstallMarkerDigest
      })
      expect(first.bindings.responseDigest).toBe(await digestCanonicalManifest([row]))
      expect(first.snapshot).toEqual({
        transactionReadOnly: true,
        serverVersionNum: '170006',
        snapshotDigest: await digest('receipt-zero-reconciliation-snapshot'),
        observedAt: '2026-09-08T00:00:00.000Z'
      })
      expect(Object.isFrozen(first)).toBe(true)
      expect(Object.isFrozen(first.bindings)).toBe(true)
      expect(Object.isFrozen(first.facts)).toBe(true)
      expect(Object.isFrozen(first.snapshot)).toBe(true)
      const publicJSON = JSON.stringify(first)
      const publicDigests = new Set(
        Object.values(first.bindings).filter((value): value is string => typeof value === 'string')
      )
      for (const value of trustedContext.parameters) {
        if (value === null || value.length < 16 || publicDigests.has(value)) continue
        expect(publicJSON).not.toContain(value)
      }
      expect(publicJSON).not.toContain(source.fixture.databaseLedger.applied.marker)
      expect(publicJSON).not.toContain(BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT)
    }

    expect(
      trustedSupabaseBackfillReceiptZeroReconciliationReviewContextV1(source.reconciliationReview)
    ).not.toBeNull()
    expect(trustedSupabaseBackfillLockedHighWaterCaptureV1(source.fixture.evidence.capture)).toBe(
      true
    )
  })

  test('accepts completed exact readback while keeping the observation non-authoritative', async () => {
    const source = await receiptZeroReconciliationFixture(
      { remainingNullTargetRowCount: '0' },
      null
    )
    const row = await reconciliationResponseRow(source, 'exact-replay')
    expect(row.initialExecutionStatus).toBe('completed')
    expect(row.initialReceiptOutcome).toBe('completed')

    await expect(
      parseSupabaseBackfillReceiptZeroReconciliationResponseForTestingV1({
        reconciliationReview: source.reconciliationReview,
        response: [row]
      })
    ).resolves.toMatchObject({
      reportedStatus: 'exact-replay',
      status: 'exact-replay',
      statusProvesDatabaseState: false,
      databaseAuthorityCreated: false,
      releaseReady: false
    })
  })

  test('downgrades marker drift while preserving explicit testing-only uncertainty', async () => {
    const source = await receiptZeroReconciliationFixture()
    const advanced = await reconciliationResponseRow(source, 'advanced-head')
    const markerDrift = Object.freeze({
      ...advanced,
      transactionReadOnly: false,
      installMarkerDigest: await digest('different-historical-installation')
    })

    const observation = await parseSupabaseBackfillReceiptZeroReconciliationResponseForTestingV1({
      reconciliationReview: source.reconciliationReview,
      response: [markerDrift]
    })
    expect(observation).toMatchObject({
      reportedStatus: 'advanced-head',
      status: 'precondition-failed',
      reportedStatusMatchesRecomputedFacts: true,
      statusRecomputedByHost: true,
      reportedInstallMarkerDigestMatchesHistorical: false,
      specificHistoricalInstallationAuthenticated: false,
      reportedStatusProvesDatabaseState: false,
      statusProvesDatabaseState: false,
      productionTransportAuthenticated: false,
      fullPortableReceiptV2ChainVerified: false,
      advancedHeadRequiresFullPortableReceiptV2ChainVerification: true,
      automaticRetryAllowed: false,
      databaseAuthorityCreated: false,
      receiptAuthorityCreated: false,
      releaseAuthorityCreated: false,
      releaseReady: false,
      snapshot: { transactionReadOnly: false }
    })

    const corruption = await reconciliationResponseRow(source, 'corruption')
    await expect(
      parseSupabaseBackfillReceiptZeroReconciliationResponseForTestingV1({
        reconciliationReview: source.reconciliationReview,
        response: [{ ...corruption, installMarkerDigest: markerDrift.installMarkerDigest }]
      })
    ).resolves.toMatchObject({
      reportedStatus: 'corruption',
      status: 'precondition-failed',
      reportedInstallMarkerDigestMatchesHistorical: false,
      statusProvesDatabaseState: false
    })

    const precondition = await reconciliationResponseRow(source, 'precondition-failed')
    const unavailableMarker = Object.freeze({
      ...precondition,
      inputValid: true,
      fullLedgerShapeVerified: false,
      installMarkerDigest: null
    })
    await expect(
      parseSupabaseBackfillReceiptZeroReconciliationResponseForTestingV1({
        reconciliationReview: source.reconciliationReview,
        response: [unavailableMarker]
      })
    ).resolves.toMatchObject({
      reportedStatus: 'precondition-failed',
      status: 'precondition-failed',
      reportedInstallMarkerDigestMatchesHistorical: false,
      automaticRetryAllowed: false
    })

    const runtimeUnavailable = Object.freeze({
      ...precondition,
      inputValid: true,
      runtimeReady: false
    })
    await expect(
      parseSupabaseBackfillReceiptZeroReconciliationResponseForTestingV1({
        reconciliationReview: source.reconciliationReview,
        response: [runtimeUnavailable]
      })
    ).resolves.toMatchObject({
      reportedStatus: 'precondition-failed',
      status: 'precondition-failed',
      facts: { inputValid: true, runtimeReady: false },
      releaseReady: false
    })

    const exact = await reconciliationResponseRow(source, 'exact-replay')
    await expect(
      parseSupabaseBackfillReceiptZeroReconciliationResponseForTestingV1({
        reconciliationReview: source.reconciliationReview,
        response: [{ ...exact, transactionReadOnly: false }]
      })
    ).resolves.toMatchObject({
      reportedStatus: 'exact-replay',
      status: 'exact-replay',
      snapshot: { transactionReadOnly: false },
      statusProvesDatabaseState: false,
      productionTransportAuthenticated: false
    })
  })

  test('rejects binding drift, reported-status substitution, and contradictory success facts', async () => {
    const source = await receiptZeroReconciliationFixture()
    const exact = await reconciliationResponseRow(source, 'exact-replay')
    const advanced = await reconciliationResponseRow(source, 'advanced-head')
    const absent = await reconciliationResponseRow(source, 'absent')
    const precondition = await reconciliationResponseRow(source, 'precondition-failed')
    const bindingError =
      'supabase-backfill-receipt-zero-reconciliation-response-binding-mismatch' as const
    const responseError = 'supabase-backfill-receipt-zero-reconciliation-response-invalid' as const
    const differentDigest = await digest('different-reconciliation-binding')

    for (const response of [
      [{ ...exact, scopeDigest: differentDigest }],
      [{ ...exact, receiptDigest: differentDigest }],
      [{ ...exact, candidateOperationEvidenceDigest: differentDigest }],
      [{ ...exact, initialExecutionStatus: 'completed' }],
      [{ ...exact, initialReceiptOutcome: 'completed' }]
    ]) {
      await receiptZeroReconciliationResponseError(
        parseSupabaseBackfillReceiptZeroReconciliationResponseForTestingV1({
          reconciliationReview: source.reconciliationReview,
          response
        }),
        bindingError
      )
    }

    const contradictoryRows = [
      { ...exact, reportedStatus: 'corruption' },
      { ...exact, exactImmutableExecutionCount: 0 },
      { ...exact, chainCount: 1, chainMinimumRevision: 1, chainMaximumRevision: 1 },
      { ...exact, headTimestampMatchesLatestReceipt: true },
      { ...exact, executionTimestampMatchesHead: false },
      { ...advanced, exactInitialHeadCount: 1 },
      { ...absent, headRevision: 1 },
      {
        ...absent,
        chainCount: 1,
        chainMinimumRevision: 1,
        chainMaximumRevision: 1,
        headTimestampMatchesLatestReceipt: true
      },
      { ...precondition, collisionExecutionCount: 1 },
      { ...exact, exactReceiptZeroCount: 2 },
      { ...exact, receiptCount: 10_002 },
      { ...exact, chainCount: -0 },
      { ...exact, headCount: 0.5 },
      { ...exact, inputValid: 1 },
      { ...exact, reportedStatus: 'inserted' },
      { ...exact, queryVersion: 'changed-query-version' },
      { ...exact, installMarkerDigest: null },
      { ...exact, serverVersionNum: '180000' },
      { ...exact, snapshotDigest: '1:2:3,4' },
      { ...exact, observedAt: '2026-09-08T00:00:00Z' },
      { ...exact, observedAt: 'x'.repeat(10_000) }
    ]
    for (const row of contradictoryRows) {
      await receiptZeroReconciliationResponseError(
        parseSupabaseBackfillReceiptZeroReconciliationResponseForTestingV1({
          reconciliationReview: source.reconciliationReview,
          response: [row]
        }),
        responseError
      )
    }
  })

  test('requires genuine review identity and exact inert input and response data', async () => {
    const source = await receiptZeroReconciliationFixture()
    const row = await reconciliationResponseRow(source, 'exact-replay')
    const proofError =
      'supabase-backfill-receipt-zero-reconciliation-response-proof-invalid' as const
    const inputError =
      'supabase-backfill-receipt-zero-reconciliation-response-input-invalid' as const
    const responseError = 'supabase-backfill-receipt-zero-reconciliation-response-invalid' as const

    for (const reconciliationReview of [
      structuredClone(source.reconciliationReview),
      { ...source.reconciliationReview }
    ]) {
      await receiptZeroReconciliationResponseError(
        parseSupabaseBackfillReceiptZeroReconciliationResponseForTestingV1({
          reconciliationReview,
          response: [row]
        }),
        proofError
      )
    }

    await receiptZeroReconciliationResponseError(
      parseSupabaseBackfillReceiptZeroReconciliationResponseForTestingV1({
        reconciliationReview: source.reconciliationReview,
        response: [row],
        extra: true
      } as never),
      inputError
    )
    await receiptZeroReconciliationResponseError(
      parseSupabaseBackfillReceiptZeroReconciliationResponseForTestingV1(
        Object.assign(
          { reconciliationReview: source.reconciliationReview, response: [row] },
          { [Symbol('extra')]: true }
        ) as never
      ),
      inputError
    )
    await receiptZeroReconciliationResponseError(
      parseSupabaseBackfillReceiptZeroReconciliationResponseForTestingV1(
        Object.assign(Object.create({ inherited: true }), {
          reconciliationReview: source.reconciliationReview,
          response: [row]
        }) as never
      ),
      inputError
    )

    let inputGetterCalls = 0
    const inputAccessor = Object.defineProperties(
      {},
      {
        reconciliationReview: {
          enumerable: true,
          value: source.reconciliationReview
        },
        response: {
          enumerable: true,
          get() {
            inputGetterCalls += 1
            return [row]
          }
        }
      }
    )
    await receiptZeroReconciliationResponseError(
      parseSupabaseBackfillReceiptZeroReconciliationResponseForTestingV1(inputAccessor as never),
      inputError
    )
    expect(inputGetterCalls).toBe(0)

    const revokedInput = Proxy.revocable(
      { reconciliationReview: source.reconciliationReview, response: [row] },
      {}
    )
    revokedInput.revoke()
    await receiptZeroReconciliationResponseError(
      parseSupabaseBackfillReceiptZeroReconciliationResponseForTestingV1(
        revokedInput.proxy as never
      ),
      inputError
    )

    const sparseResponse: unknown[] = []
    sparseResponse.length = 1
    const customArrayPrototype = [row]
    Object.setPrototypeOf(customArrayPrototype, Object.create(Array.prototype))
    const missingFieldRow: Partial<ReceiptZeroReconciliationResponseRowV1> = { ...row }
    delete missingFieldRow.observedAt
    const nonEnumerableFieldRow = { ...row }
    Object.defineProperty(nonEnumerableFieldRow, 'reportedStatus', {
      enumerable: false,
      value: 'exact-replay'
    })
    const invalidResponses: unknown[] = [
      null,
      {},
      [],
      [row, row],
      sparseResponse,
      Object.assign([row], { extra: true }),
      Object.assign([row], { [Symbol('extra')]: true }),
      customArrayPrototype,
      [{ ...row, extra: true }],
      [Object.assign({ ...row }, { [Symbol('extra')]: true })],
      [Object.assign(Object.create({ inherited: true }), row)],
      [missingFieldRow],
      [nonEnumerableFieldRow]
    ]
    for (const response of invalidResponses) {
      await receiptZeroReconciliationResponseError(
        parseSupabaseBackfillReceiptZeroReconciliationResponseForTestingV1({
          reconciliationReview: source.reconciliationReview,
          response
        }),
        responseError
      )
    }

    let indexGetterCalls = 0
    const indexAccessor: unknown[] = []
    indexAccessor.length = 1
    Object.defineProperty(indexAccessor, '0', {
      enumerable: true,
      get() {
        indexGetterCalls += 1
        return row
      }
    })
    await receiptZeroReconciliationResponseError(
      parseSupabaseBackfillReceiptZeroReconciliationResponseForTestingV1({
        reconciliationReview: source.reconciliationReview,
        response: indexAccessor
      }),
      responseError
    )
    expect(indexGetterCalls).toBe(0)

    let statusGetterCalls = 0
    const rowAccessor = Object.defineProperty({ ...row }, 'reportedStatus', {
      enumerable: true,
      get() {
        statusGetterCalls += 1
        return 'exact-replay'
      }
    })
    await receiptZeroReconciliationResponseError(
      parseSupabaseBackfillReceiptZeroReconciliationResponseForTestingV1({
        reconciliationReview: source.reconciliationReview,
        response: [rowAccessor]
      }),
      responseError
    )
    expect(statusGetterCalls).toBe(0)

    const revokedResponse = Proxy.revocable([row], {})
    revokedResponse.revoke()
    await receiptZeroReconciliationResponseError(
      parseSupabaseBackfillReceiptZeroReconciliationResponseForTestingV1({
        reconciliationReview: source.reconciliationReview,
        response: revokedResponse.proxy
      }),
      responseError
    )
    const revokedRow = Proxy.revocable(row, {})
    revokedRow.revoke()
    await receiptZeroReconciliationResponseError(
      parseSupabaseBackfillReceiptZeroReconciliationResponseForTestingV1({
        reconciliationReview: source.reconciliationReview,
        response: [revokedRow.proxy]
      }),
      responseError
    )

    const nullPrototypeRow = Object.assign(Object.create(null), row)
    await expect(
      parseSupabaseBackfillReceiptZeroReconciliationResponseForTestingV1({
        reconciliationReview: source.reconciliationReview,
        response: [nullPrototypeRow]
      })
    ).resolves.toMatchObject({ status: 'exact-replay', releaseReady: false })

    const corruptionRow = await reconciliationResponseRow(source, 'corruption')
    const mutableRow = { ...row }
    const mutableInput = {
      reconciliationReview: source.reconciliationReview,
      response: [mutableRow]
    }
    const parsingSnapshot =
      parseSupabaseBackfillReceiptZeroReconciliationResponseForTestingV1(mutableInput)
    mutableRow.reportedStatus = 'corruption'
    mutableInput.response = [corruptionRow]
    const immutableObservation = await parsingSnapshot
    expect(immutableObservation).toMatchObject({
      reportedStatus: 'exact-replay',
      status: 'exact-replay'
    })
    expect(immutableObservation.bindings.responseDigest).toBe(await digestCanonicalManifest([row]))
  })

  test('revokes parsing before return when the inherited capture is consumed', async () => {
    const proofError =
      'supabase-backfill-receipt-zero-reconciliation-response-proof-invalid' as const
    const before = await receiptZeroReconciliationFixture()
    const beforeRow = await reconciliationResponseRow(before, 'exact-replay')
    expect(
      consumeTrustedSupabaseBackfillLockedHighWaterCaptureV1(before.fixture.evidence.capture)
    ).not.toBeNull()
    await receiptZeroReconciliationResponseError(
      parseSupabaseBackfillReceiptZeroReconciliationResponseForTestingV1({
        reconciliationReview: before.reconciliationReview,
        response: [beforeRow]
      }),
      proofError
    )

    const during = await receiptZeroReconciliationFixture()
    const duringRow = await reconciliationResponseRow(during, 'exact-replay')
    const parsing = parseSupabaseBackfillReceiptZeroReconciliationResponseForTestingV1({
      reconciliationReview: during.reconciliationReview,
      response: [duringRow]
    })
    expect(
      consumeTrustedSupabaseBackfillLockedHighWaterCaptureV1(during.fixture.evidence.capture)
    ).not.toBeNull()
    await receiptZeroReconciliationResponseError(parsing, proofError)
  })
})

describe('Supabase backfill testing-only fixed-read session', () => {
  test('runs one fixed process-local response callback without creating production authority', async () => {
    const source = await receiptZeroReconciliationFixture()
    const reviewContext = trustedSupabaseBackfillReceiptZeroReconciliationReviewContextV1(
      source.reconciliationReview
    )
    if (!reviewContext) throw new TypeError('Expected a genuine reconciliation review context')
    const row = await reconciliationResponseRow(source, 'exact-replay')
    const response = jsonBytes([row])
    const invocations: SupabaseBackfillFixedReadInvocationForTestingV1[] = []
    const signals: AbortSignal[] = []
    const harness = createSupabaseBackfillFixedReadHarnessForTestingV1((invocation, signal) => {
      invocations.push(invocation)
      signals.push(signal)
      return response
    })
    const session =
      await createSupabaseBackfillReceiptZeroReconciliationFixedReadSessionForTestingV1({
        harness,
        reconciliationReview: source.reconciliationReview
      })

    expect(session).toMatchObject({
      format: SUPABASE_BACKFILL_TESTING_FIXED_READ_SESSION_FORMAT,
      version: 1,
      providerId: 'supabase',
      environment: 'staging',
      testingOnly: true,
      processLocalOnly: true,
      variant: 'receipt-zero-reconciliation',
      lifetime: 'single-run',
      contract: {
        statementCount: 1,
        accessMode: 'read-only',
        snapshotScope: 'single-statement',
        parameterCount: 28,
        responseFieldCount: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESPONSE_FIELDS.length,
        configuredSearchPathRequired: ['pg_catalog'],
        harnessTimeoutMs: SUPABASE_BACKFILL_TESTING_FIXED_READ_LIMITS.harnessTimeoutMs,
        maximumRequestBytes: SUPABASE_BACKFILL_TESTING_FIXED_READ_LIMITS.requestBytes,
        maximumResponseBytes:
          SUPABASE_BACKFILL_TESTING_FIXED_READ_LIMITS.reconciliationResponseBytes
      },
      parameterValuesRetainedInSession: false,
      productionTransportCreated: false,
      productionTransportAuthenticated: false,
      readOnlyBoundaryAuthenticated: false,
      liveCatalogSemanticsAuthenticated: false,
      serverStatementTimeoutAuthenticated: false,
      credentialAuthorityCreated: false,
      transportAuthorityCreated: false,
      databaseAuthorityCreated: false,
      mutationAuthorityCreated: false,
      executionAuthorityCreated: false,
      receiptAuthorityCreated: false,
      releaseAuthorityCreated: false,
      releaseReady: false
    })
    expect(Object.isFrozen(harness)).toBe(true)
    expect(Object.isFrozen(session)).toBe(true)
    expect(Object.isFrozen(session.bindings)).toBe(true)
    expect(Object.isFrozen(session.contract)).toBe(true)
    expect(Object.hasOwn(session, 'parameters')).toBe(false)
    expect(Object.hasOwn(session, 'invocation')).toBe(false)

    const result = await runSupabaseBackfillFixedReadSessionForTestingV1({ session })
    const invocation = invocations[0]
    if (!invocation) throw new TypeError('Expected one testing fixed-read invocation')
    expect(invocations).toHaveLength(1)
    expect(signals).toHaveLength(1)
    expect(signals[0]?.aborted).toBe(false)
    expect(invocation).toMatchObject({
      format: SUPABASE_BACKFILL_TESTING_FIXED_READ_INVOCATION_FORMAT,
      version: 1,
      providerId: 'supabase',
      environment: 'staging',
      testingOnly: true,
      processLocalOnly: true,
      variant: 'receipt-zero-reconciliation',
      query: {
        statementCount: 1,
        accessMode: 'read-only',
        snapshotScope: 'single-statement',
        rawSqlCrossedHarnessBoundary: false,
        endpointCrossedHarnessBoundary: false
      },
      requirements: {
        configuredSearchPath: ['pg_catalog'],
        transportEnforcedReadOnlyBoundary: true,
        liveCatalogSemanticsAuthentication: true,
        serverStatementTimeoutMs: SUPABASE_BACKFILL_TESTING_FIXED_READ_LIMITS.harnessTimeoutMs,
        maximumResponseBytes:
          SUPABASE_BACKFILL_TESTING_FIXED_READ_LIMITS.reconciliationResponseBytes
      }
    })
    expect(invocation.query.parameterOrder).toBe(SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER)
    expect(invocation.query.responseFields).toBe(
      SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESPONSE_FIELDS
    )
    expect(invocation.parameters).toEqual(reviewContext.parameters)
    expect(invocation.parameters).not.toBe(reviewContext.parameters)
    expect(invocation.parameters).toHaveLength(28)
    expect(session.requestByteLength).toBe(jsonBytes(invocation).byteLength)
    expect(session.requestDigest).toBe(await digestCanonicalManifest(invocation))
    expect(Object.isFrozen(invocation)).toBe(true)
    expect(Object.isFrozen(invocation.bindings)).toBe(true)
    expect(Object.isFrozen(invocation.query)).toBe(true)
    expect(Object.isFrozen(invocation.requirements)).toBe(true)
    expect(Object.isFrozen(invocation.parameters)).toBe(true)
    for (const forbiddenKey of ['sql', 'url', 'endpoint', 'headers', 'pat', 'credential']) {
      expect(Object.hasOwn(invocation, forbiddenKey)).toBe(false)
      expect(Object.hasOwn(invocation.query, forbiddenKey)).toBe(false)
    }
    expect(JSON.stringify(invocation)).not.toContain(
      SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_SQL
    )

    expect(result).toMatchObject({
      format: SUPABASE_BACKFILL_TESTING_FIXED_READ_RESULT_FORMAT,
      version: 1,
      providerId: 'supabase',
      environment: 'staging',
      testingOnly: true,
      processLocalOnly: true,
      variant: 'receipt-zero-reconciliation',
      sessionDigest: session.sessionDigest,
      requestDigest: session.requestDigest,
      responseByteLength: response.byteLength,
      observation: { reportedStatus: 'exact-replay', status: 'exact-replay' },
      injectedResponseProviderInvoked: true,
      callbackSideEffectsAuthenticated: false,
      productionRequestDispatchAuthenticated: false,
      productionTransportCreationAuthenticated: false,
      productionTransportAuthenticated: false,
      readOnlyBoundaryAuthenticated: false,
      liveCatalogSemanticsAuthenticated: false,
      serverStatementTimeoutAuthenticated: false,
      responseSnapshotAuthenticated: false,
      automaticRetryAllowed: false,
      credentialAuthorityCreated: false,
      transportAuthorityCreated: false,
      databaseAuthorityCreated: false,
      mutationAuthorityCreated: false,
      executionAuthorityCreated: false,
      receiptAuthorityCreated: false,
      releaseAuthorityCreated: false,
      releaseReady: false
    })
    expect(result.resultDigest).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.observation)).toBe(true)
    expect(trustedSupabaseBackfillFixedReadResultContextForTestingV1(result)).toMatchObject({
      result,
      session,
      observation: result.observation
    })
    expect(trustedSupabaseBackfillFixedReadResultContextForTestingV1({ ...result })).toBeNull()

    const publicSessionJSON = JSON.stringify(session)
    const allowedPublicDigests = new Set([
      session.sessionDigest,
      session.requestDigest,
      ...Object.values(session.bindings)
    ])
    for (const value of reviewContext.parameters) {
      if (value === null || value.length < 16 || allowedPublicDigests.has(value)) continue
      expect(publicSessionJSON).not.toContain(value)
    }
    expect(publicSessionJSON).not.toContain(source.fixture.databaseLedger.applied.marker)
    expect(publicSessionJSON).not.toContain(BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT)
  })

  test('consumes sessions before concurrent and reentrant callback attempts', async () => {
    const source = await receiptZeroReconciliationFixture()
    const row = await reconciliationResponseRow(source, 'exact-replay')
    const response = jsonBytes([row])
    const responseGate = deferred<Uint8Array>()
    let concurrentCallbackCount = 0
    const concurrentHarness = createSupabaseBackfillFixedReadHarnessForTestingV1(() => {
      concurrentCallbackCount += 1
      return responseGate.promise
    })
    const concurrentSession =
      await createSupabaseBackfillReceiptZeroReconciliationFixedReadSessionForTestingV1({
        harness: concurrentHarness,
        reconciliationReview: source.reconciliationReview
      })
    const firstRun = runSupabaseBackfillFixedReadSessionForTestingV1({
      session: concurrentSession
    })
    const secondRun = runSupabaseBackfillFixedReadSessionForTestingV1({
      session: concurrentSession
    })
    await fixedReadSessionError(secondRun, 'supabase-backfill-testing-fixed-read-session-consumed')
    responseGate.resolve(response)
    await expect(firstRun).resolves.toMatchObject({ observation: { status: 'exact-replay' } })
    expect(concurrentCallbackCount).toBe(1)
    await fixedReadSessionError(
      runSupabaseBackfillFixedReadSessionForTestingV1({ session: concurrentSession }),
      'supabase-backfill-testing-fixed-read-session-consumed'
    )

    const reentrantState: {
      session: Awaited<
        ReturnType<
          typeof createSupabaseBackfillReceiptZeroReconciliationFixedReadSessionForTestingV1
        >
      > | null
      run: Promise<unknown> | null
    } = { session: null, run: null }
    let reentrantCallbackCount = 0
    const reentrantHarness = createSupabaseBackfillFixedReadHarnessForTestingV1(() => {
      reentrantCallbackCount += 1
      if (!reentrantState.session) throw new TypeError('Expected a bound reentrant session')
      reentrantState.run = runSupabaseBackfillFixedReadSessionForTestingV1({
        session: reentrantState.session
      })
      void reentrantState.run.catch(() => undefined)
      return response
    })
    const reentrantSession =
      await createSupabaseBackfillReceiptZeroReconciliationFixedReadSessionForTestingV1({
        harness: reentrantHarness,
        reconciliationReview: source.reconciliationReview
      })
    reentrantState.session = reentrantSession
    await expect(
      runSupabaseBackfillFixedReadSessionForTestingV1({ session: reentrantSession })
    ).resolves.toMatchObject({ observation: { status: 'exact-replay' } })
    if (!reentrantState.run) throw new TypeError('Expected a reentrant session attempt')
    await fixedReadSessionError(
      reentrantState.run,
      'supabase-backfill-testing-fixed-read-session-consumed'
    )
    expect(reentrantCallbackCount).toBe(1)
  })

  test('burns a session after callback, byte, parser, and abort failures', async () => {
    const providerFailureSource = await receiptZeroReconciliationFixture()
    const providerFailureHarness = createSupabaseBackfillFixedReadHarnessForTestingV1(() => {
      throw new SupabaseBackfillTestingFixedReadSessionError(
        'supabase-backfill-testing-fixed-read-aborted'
      )
    })
    const providerFailureSession =
      await createSupabaseBackfillReceiptZeroReconciliationFixedReadSessionForTestingV1({
        harness: providerFailureHarness,
        reconciliationReview: providerFailureSource.reconciliationReview
      })
    await fixedReadSessionError(
      runSupabaseBackfillFixedReadSessionForTestingV1({ session: providerFailureSession }),
      'supabase-backfill-testing-fixed-read-response-provider-failed'
    )
    await fixedReadSessionError(
      runSupabaseBackfillFixedReadSessionForTestingV1({ session: providerFailureSession }),
      'supabase-backfill-testing-fixed-read-session-consumed'
    )

    const oversizedSource = await receiptZeroReconciliationFixture()
    const oversizedHarness = createSupabaseBackfillFixedReadHarnessForTestingV1(
      () =>
        new Uint8Array(SUPABASE_BACKFILL_TESTING_FIXED_READ_LIMITS.reconciliationResponseBytes + 1)
    )
    const oversizedSession =
      await createSupabaseBackfillReceiptZeroReconciliationFixedReadSessionForTestingV1({
        harness: oversizedHarness,
        reconciliationReview: oversizedSource.reconciliationReview
      })
    await fixedReadSessionError(
      runSupabaseBackfillFixedReadSessionForTestingV1({ session: oversizedSession }),
      'supabase-backfill-testing-fixed-read-response-too-large'
    )
    await fixedReadSessionError(
      runSupabaseBackfillFixedReadSessionForTestingV1({ session: oversizedSession }),
      'supabase-backfill-testing-fixed-read-session-consumed'
    )

    const proxiedBytes = new Proxy(new Uint8Array([0x5b, 0x5d]), {})
    const invalidByteHarness = createSupabaseBackfillFixedReadHarnessForTestingV1(
      () => proxiedBytes
    )
    const invalidByteSession =
      await createSupabaseBackfillReceiptZeroReconciliationFixedReadSessionForTestingV1({
        harness: invalidByteHarness,
        reconciliationReview: oversizedSource.reconciliationReview
      })
    await fixedReadSessionError(
      runSupabaseBackfillFixedReadSessionForTestingV1({ session: invalidByteSession }),
      'supabase-backfill-testing-fixed-read-response-invalid'
    )

    const parserFailureSource = await receiptZeroReconciliationFixture()
    const parserFailureHarness = createSupabaseBackfillFixedReadHarnessForTestingV1(() =>
      jsonBytes([{}])
    )
    const parserFailureSession =
      await createSupabaseBackfillReceiptZeroReconciliationFixedReadSessionForTestingV1({
        harness: parserFailureHarness,
        reconciliationReview: parserFailureSource.reconciliationReview
      })
    await receiptZeroReconciliationResponseError(
      runSupabaseBackfillFixedReadSessionForTestingV1({ session: parserFailureSession }),
      'supabase-backfill-receipt-zero-reconciliation-response-invalid'
    )
    await fixedReadSessionError(
      runSupabaseBackfillFixedReadSessionForTestingV1({ session: parserFailureSession }),
      'supabase-backfill-testing-fixed-read-session-consumed'
    )

    const abortedSource = await receiptZeroReconciliationFixture()
    const abortController = new AbortController()
    let abortedCallbackCount = 0
    const abortedHarness = createSupabaseBackfillFixedReadHarnessForTestingV1(() => {
      abortedCallbackCount += 1
      return jsonBytes([])
    })
    const abortedSession =
      await createSupabaseBackfillReceiptZeroReconciliationFixedReadSessionForTestingV1({
        harness: abortedHarness,
        reconciliationReview: abortedSource.reconciliationReview,
        signal: abortController.signal
      })
    abortController.abort()
    await fixedReadSessionError(
      runSupabaseBackfillFixedReadSessionForTestingV1({ session: abortedSession }),
      'supabase-backfill-testing-fixed-read-aborted'
    )
    expect(abortedCallbackCount).toBe(0)
    await fixedReadSessionError(
      runSupabaseBackfillFixedReadSessionForTestingV1({ session: abortedSession }),
      'supabase-backfill-testing-fixed-read-session-consumed'
    )
  })

  test('rejects forged inputs, preserves a valid session after input rejection, and supports disposal', async () => {
    const source = await receiptZeroReconciliationFixture()
    const row = await reconciliationResponseRow(source, 'exact-replay')
    const response = jsonBytes([row])
    let callbackCount = 0
    const harness = createSupabaseBackfillFixedReadHarnessForTestingV1(() => {
      callbackCount += 1
      return response
    })
    await fixedReadSessionError(
      createSupabaseBackfillReceiptZeroReconciliationFixedReadSessionForTestingV1({
        harness: { ...harness },
        reconciliationReview: source.reconciliationReview
      }),
      'supabase-backfill-testing-fixed-read-harness-untrusted'
    )
    await fixedReadSessionError(
      createSupabaseBackfillReceiptZeroReconciliationFixedReadSessionForTestingV1({
        harness,
        reconciliationReview: { ...source.reconciliationReview }
      }),
      'supabase-backfill-testing-fixed-read-session-proof-invalid'
    )
    await fixedReadSessionError(
      createSupabaseBackfillReceiptZeroReconciliationFixedReadSessionForTestingV1({
        harness,
        reconciliationReview: source.reconciliationReview,
        extra: true
      } as never),
      'supabase-backfill-testing-fixed-read-input-invalid'
    )

    let getterCalls = 0
    const accessor = Object.defineProperties(
      {},
      {
        harness: { enumerable: true, value: harness },
        reconciliationReview: {
          enumerable: true,
          get() {
            getterCalls += 1
            return source.reconciliationReview
          }
        }
      }
    )
    await fixedReadSessionError(
      createSupabaseBackfillReceiptZeroReconciliationFixedReadSessionForTestingV1(
        accessor as never
      ),
      'supabase-backfill-testing-fixed-read-input-invalid'
    )
    expect(getterCalls).toBe(0)

    const signalController = new AbortController()
    const proxiedSignal = new Proxy(signalController.signal, {})
    await fixedReadSessionError(
      createSupabaseBackfillReceiptZeroReconciliationFixedReadSessionForTestingV1({
        harness,
        reconciliationReview: source.reconciliationReview,
        signal: proxiedSignal
      }),
      'supabase-backfill-testing-fixed-read-input-invalid'
    )
    const revokedSignal = Proxy.revocable(signalController.signal, {})
    revokedSignal.revoke()
    await fixedReadSessionError(
      createSupabaseBackfillReceiptZeroReconciliationFixedReadSessionForTestingV1({
        harness,
        reconciliationReview: source.reconciliationReview,
        signal: revokedSignal.proxy
      }),
      'supabase-backfill-testing-fixed-read-input-invalid'
    )
    expect(callbackCount).toBe(0)

    let signalGetterCalls = 0
    const signalWithOwnAccessors = new AbortController().signal
    Object.defineProperties(signalWithOwnAccessors, {
      aborted: {
        configurable: true,
        get() {
          signalGetterCalls += 1
          throw new TypeError('Own aborted getter must not run')
        }
      },
      addEventListener: {
        configurable: true,
        get() {
          signalGetterCalls += 1
          throw new TypeError('Own addEventListener getter must not run')
        }
      },
      removeEventListener: {
        configurable: true,
        get() {
          signalGetterCalls += 1
          throw new TypeError('Own removeEventListener getter must not run')
        }
      }
    })
    let signalCallbackCount = 0
    const signalHarness = createSupabaseBackfillFixedReadHarnessForTestingV1(() => {
      signalCallbackCount += 1
      return response
    })
    const signalSession =
      await createSupabaseBackfillReceiptZeroReconciliationFixedReadSessionForTestingV1({
        harness: signalHarness,
        reconciliationReview: source.reconciliationReview,
        signal: signalWithOwnAccessors
      })
    await expect(
      runSupabaseBackfillFixedReadSessionForTestingV1({ session: signalSession })
    ).resolves.toMatchObject({ observation: { status: 'exact-replay' } })
    expect(signalCallbackCount).toBe(1)
    expect(signalGetterCalls).toBe(0)

    const session =
      await createSupabaseBackfillReceiptZeroReconciliationFixedReadSessionForTestingV1({
        harness,
        reconciliationReview: source.reconciliationReview
      })
    await fixedReadSessionError(
      runSupabaseBackfillFixedReadSessionForTestingV1({
        session,
        extra: true
      } as never),
      'supabase-backfill-testing-fixed-read-input-invalid'
    )
    await fixedReadSessionError(
      runSupabaseBackfillFixedReadSessionForTestingV1({ session: { ...session } }),
      'supabase-backfill-testing-fixed-read-session-proof-invalid'
    )
    await expect(
      runSupabaseBackfillFixedReadSessionForTestingV1({ session })
    ).resolves.toMatchObject({ observation: { status: 'exact-replay' } })
    expect(callbackCount).toBe(1)

    const disposable =
      await createSupabaseBackfillReceiptZeroReconciliationFixedReadSessionForTestingV1({
        harness,
        reconciliationReview: source.reconciliationReview
      })
    expect(disposeSupabaseBackfillFixedReadSessionForTestingV1({ session: disposable })).toBe(true)
    expect(disposeSupabaseBackfillFixedReadSessionForTestingV1({ session: disposable })).toBe(false)
    await fixedReadSessionError(
      runSupabaseBackfillFixedReadSessionForTestingV1({ session: disposable }),
      'supabase-backfill-testing-fixed-read-session-consumed'
    )
    expect(callbackCount).toBe(1)
  })

  test('rechecks capture provenance before and after the response callback', async () => {
    const beforeCallbackSource = await receiptZeroReconciliationFixture()
    const beforeCallbackRow = await reconciliationResponseRow(beforeCallbackSource, 'exact-replay')
    let beforeCallbackCount = 0
    const beforeCallbackHarness = createSupabaseBackfillFixedReadHarnessForTestingV1(() => {
      beforeCallbackCount += 1
      return jsonBytes([beforeCallbackRow])
    })
    const beforeCallbackSession =
      await createSupabaseBackfillReceiptZeroReconciliationFixedReadSessionForTestingV1({
        harness: beforeCallbackHarness,
        reconciliationReview: beforeCallbackSource.reconciliationReview
      })
    const beforeCallbackRun = runSupabaseBackfillFixedReadSessionForTestingV1({
      session: beforeCallbackSession
    })
    expect(
      consumeTrustedSupabaseBackfillLockedHighWaterCaptureV1(
        beforeCallbackSource.fixture.evidence.capture
      )
    ).not.toBeNull()
    await fixedReadSessionError(
      beforeCallbackRun,
      'supabase-backfill-testing-fixed-read-review-changed'
    )
    expect(beforeCallbackCount).toBe(0)

    const source = await receiptZeroReconciliationFixture()
    const row = await reconciliationResponseRow(source, 'exact-replay')
    let callbackCount = 0
    const harness = createSupabaseBackfillFixedReadHarnessForTestingV1(() => {
      callbackCount += 1
      expect(
        consumeTrustedSupabaseBackfillLockedHighWaterCaptureV1(source.fixture.evidence.capture)
      ).not.toBeNull()
      return jsonBytes([row])
    })
    const session =
      await createSupabaseBackfillReceiptZeroReconciliationFixedReadSessionForTestingV1({
        harness,
        reconciliationReview: source.reconciliationReview
      })
    await fixedReadSessionError(
      runSupabaseBackfillFixedReadSessionForTestingV1({ session }),
      'supabase-backfill-testing-fixed-read-review-changed'
    )
    expect(callbackCount).toBe(1)
    await fixedReadSessionError(
      runSupabaseBackfillFixedReadSessionForTestingV1({ session }),
      'supabase-backfill-testing-fixed-read-session-consumed'
    )
  })
})

describe('Supabase backfill Receipt V2 chain first-page review', () => {
  test('extends the exact 28-value CAS prefix with a hidden first-page suffix', async () => {
    const source = await receiptZeroReconciliationFixture()
    const reconciliationContext = trustedSupabaseBackfillReceiptZeroReconciliationReviewContextV1(
      source.reconciliationReview
    )
    if (!reconciliationContext) {
      throw new TypeError('Expected a genuine Receipt-zero reconciliation context')
    }
    const staticSqlSafetyContext =
      trustedSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateContextV1(
        source.pageSafetyCertificate
      )
    if (!staticSqlSafetyContext) {
      throw new TypeError('Expected a genuine page static SQL safety context')
    }

    const [first, second] = await Promise.all([
      createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1({
        reconciliationReview: source.reconciliationReview,
        staticSqlSafetyCertificate: source.pageSafetyCertificate
      }),
      createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1({
        reconciliationReview: source.reconciliationReview,
        staticSqlSafetyCertificate: source.pageSafetyCertificate
      })
    ])

    expect(second).toEqual(first)
    expect(second).not.toBe(first)
    expect(first.previewSql).toBe(SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SQL)
    expect(first.review).toMatchObject({
      format: 'openpencil.supabase-backfill-receipt-v2-chain-first-page-review.v1',
      version: 1,
      providerId: 'supabase',
      environmentIntent: 'staging',
      testingOnly: true,
      reviewOnly: true,
      applyAvailable: false,
      releaseReady: false,
      databaseLedgerBound: false,
      chainVerificationAuthorityCreated: false,
      databaseAuthorityCreated: false,
      mutationAuthorityCreated: false,
      executionAuthorityCreated: false,
      receiptAuthorityCreated: false,
      query: {
        queryId: 'backfill-receipt-v2-chain-page',
        queryVersion: 'openpencil-supabase-backfill-receipt-v2-chain-page-v1',
        accessMode: 'read-only',
        snapshotScope: 'single-statement',
        statementCount: 1,
        responseShape: 'one-row-anchor-bound-bounded-receipt-page',
        responseFields: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_RESPONSE_FIELDS,
        hostMustRecomputeStatusFromFacts: true,
        dmlAllowed: false,
        rowLocksUsed: false,
        schemaMutationAllowed: false,
        staticSqlSafetyCertificateCreated: true,
        staticSqlSafetyProfile: SUPABASE_BACKFILL_READ_QUERY_INDIRECT_EXECUTION_SAFETY_PROFILE,
        staticSqlSafetyConditionalOnly: true,
        liveIndirectExecutionSafetyAuthenticated: false,
        indirectExecutionSafetyProven: false,
        requiresTransportEnforcedReadOnlyBoundary: true,
        requiresFullLiveTypeOperatorIndexGuardBeforeDispatch: true,
        requiresBoundedStatementTimeoutBeforeDispatch: true,
        managementReadOnlyEndpointSemanticallyCompatible: false,
        boundedIntegerResponseWireType: 'int4',
        internalRevisionArithmeticType: 'int8',
        bigintJSONNumberDependency: false,
        transportSizeCertificateCreated: true,
        fixedQueryRequestSizeCertified: true,
        responseSizeUpperBoundCertified: true,
        decodedAggregateUpperBoundCertified: true,
        hostTransportCreated: false
      },
      parameters: {
        order: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_PARAMETER_ORDER,
        valueCount: 33,
        valuesExposed: false,
        reusedReceiptZeroCASPrefixCount: 28,
        modeDerivedFromParameterSuffix: true,
        firstPageAfterRevision: 0,
        firstPageAnchorValuesAreNull: true
      },
      page: {
        kind: 'first',
        afterRevision: 0,
        maximumReceiptCount: 4,
        lookaheadReceiptCount: 5,
        keysetOrder: 'revision-ascending',
        currentHeadCapturedInSameStatement: true,
        fixedQueryAlsoSupportsAnchorBoundContinuation: true,
        continuationMustBindExactAnchor: true,
        staleAnchorReanchoredAutomatically: false,
        crossPageSingleSnapshotClaimed: false,
        canonicalReceiptEncoding: 'standard-base64-without-whitespace',
        maximumCanonicalReceiptBytesEach: 65_536,
        maximumBase64CharactersEach: 87_384,
        maximumBase64CharactersPerPage: 349_536
      },
      transportSize: {
        limits: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_V1,
        request: {
          parameterCount: 33,
          parameterValuesExposed: false,
          requestSizeCertified: true,
          requestFramingCertified: true,
          requestDispatched: false,
          productionTransportAuthenticated: false,
          transportAuthorityCreated: false,
          databaseAuthorityCreated: false,
          releaseAuthorityCreated: false
        },
        localRequestAndResponseBoundsCertified: true,
        decodedAggregateBoundCertified: true,
        productionResponseProvenanceAuthenticated: false,
        productionTransportAuthenticated: false,
        transportAuthorityCreated: false,
        databaseAuthorityCreated: false,
        releaseAuthorityCreated: false
      },
      policy: {
        requestDispatched: false,
        managedDataReadPerformed: false,
        productionResponseAuthenticated: false,
        responseParserCreated: true,
        boundedResponseWireDecoderCreated: true,
        localRequestAndResponseBoundsCertified: true,
        continuationCreated: false,
        fullPortableReceiptV2ChainVerified: false,
        headFreshnessAuthenticatedAcrossPages: false,
        mutationDispatched: false,
        captureConsumed: false,
        credentialAuthorityCreated: false,
        transportAuthorityCreated: false,
        databaseAuthorityCreated: false,
        releaseAuthorityCreated: false,
        automaticRetryAllowed: false
      },
      artifact: {
        path: 'backend/supabase-v2/backfill/receipt-v2-chain-page-review.sql',
        kind: 'receipt-v2-chain-page-read-only-review',
        containsCatalogRead: true,
        containsManagedDataRead: true,
        containsDml: false,
        containsDirectDml: false,
        indirectExecutionSafetyProven: false,
        containsRowLock: false,
        performsSchemaChange: false,
        requestDispatched: false,
        hostDispatchAvailable: false
      }
    })

    const context = trustedSupabaseBackfillReceiptV2ChainFirstPageReviewContextV1(first)
    expect(context?.envelope).toBe(first)
    expect(context?.reconciliationContext).toBe(reconciliationContext)
    expect(context?.staticSqlSafetyContext).toBe(staticSqlSafetyContext)
    expect(context?.sourceParameters).toBe(reconciliationContext.parameters)
    expect(context?.parameters).not.toBe(reconciliationContext.parameters)
    expect(context?.parameters.slice(0, 28)).toEqual(reconciliationContext.parameters)
    expect(context?.parameters.slice(28)).toEqual(['0', null, null, null, null])
    expect(context?.parameters).toHaveLength(33)
    expect(Object.isFrozen(context?.parameters)).toBe(true)
    expect(first.review.parameters.schema.slice(0, 28)).toEqual(
      source.casReview.review.parameters.schema
    )
    for (let index = 0; index < 28; index += 1) {
      expect(first.review.parameters.schema[index]).toBe(
        source.casReview.review.parameters.schema[index]
      )
    }
    expect(first.review.parameters.schema.slice(28)).toEqual([
      {
        position: 29,
        name: 'afterRevision',
        pgType: 'bigint',
        nullable: false,
        encoding: 'decimal-text'
      },
      {
        position: 30,
        name: 'anchorRevision',
        pgType: 'bigint',
        nullable: true,
        encoding: 'decimal-text'
      },
      {
        position: 31,
        name: 'anchorEventId',
        pgType: 'text',
        nullable: true,
        encoding: 'plain-text'
      },
      {
        position: 32,
        name: 'anchorReceiptDigest',
        pgType: 'text',
        nullable: true,
        encoding: 'plain-text'
      },
      {
        position: 33,
        name: 'anchorUpdatedAt',
        pgType: 'text',
        nullable: true,
        encoding: 'rfc3339'
      }
    ])
    expect(first.review.bindings.reconciliationReviewDigest).toBe(
      source.reconciliationReview.reviewDigest
    )
    expect(first.review.bindings.sourceParameterSchemaDigest).toBe(
      source.casReview.review.bindings.parameterSchemaDigest
    )
    expect(first.review.bindings.sourceParameterValuesDigest).toBe(
      source.casReview.review.bindings.parameterValuesDigest
    )
    expect(first.review.bindings.scopeDigest).toBe(source.casReview.review.bindings.scopeDigest)
    expect(first.review.bindings.expectedReceiptZeroDigest).toBe(
      source.casReview.review.bindings.receiptDigest
    )
    expect(first.review.bindings.pageSqlDigest).toBe(
      await digestRawText(SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SQL)
    )
    expect(first.review.bindings.pageQueryDigest).toBe(
      await digestCanonicalManifest(SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_FIXED_QUERY)
    )
    expect(first.review.bindings.pageStaticSqlSafetyCertificateDigest).toBe(
      source.pageSafetyCertificate.certificateDigest
    )
    expect(first.review.bindings.pageTransportSizeCertificateDigest).toBe(
      await digestCanonicalManifest(
        SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_V1
      )
    )
    expect(first.review.bindings.pageRequestSizeCertificateDigest).toBe(
      await digestCanonicalManifest(first.review.transportSize.request)
    )
    expect(first.review.blockers).toEqual([
      ...new Set([
        ...source.reconciliationReview.review.blockers,
        'receipt-v2-chain-first-page-review-only',
        'receipt-v2-chain-page-host-transport-unavailable',
        'receipt-v2-chain-page-indirect-execution-safety-not-proven',
        'receipt-v2-chain-cross-page-head-freshness-unavailable',
        'receipt-v2-chain-production-response-authentication-unavailable'
      ])
    ])
    expect(first.review.blockers).not.toContain('receipt-v2-chain-response-size-not-certified')
    expect(first.review.blockers).not.toContain(
      'receipt-v2-chain-fixed-query-request-size-not-certified'
    )
    expect(first.review.blockers).toContain(
      'receipt-zero-reconciliation-fixed-query-request-size-not-certified'
    )

    const publicJSON = JSON.stringify(first)
    const publicDigests = new Set(Object.values(first.review.bindings))
    for (const value of context?.parameters ?? []) {
      if (value === null || value.length < 16 || publicDigests.has(value)) continue
      expect(publicJSON).not.toContain(value)
    }
    expect(publicJSON).not.toContain(source.fixture.databaseLedger.applied.marker)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.review)).toBe(true)
    expect(Object.isFrozen(first.review.parameters.schema)).toBe(true)
    expect(trustedSupabaseBackfillReceiptV2ChainFirstPageReviewContextV1({ ...first })).toBeNull()
    expect(trustedSupabaseBackfillReceiptV2ChainFirstPageReviewContextV1(first.review)).toBeNull()
  })

  test('keeps one fixed read-only statement with exact keyset and anchor-stale semantics', () => {
    const sql = SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SQL
    const embedded = SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_SQL.trimEnd()
      .slice(0, -1)
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n')
    const placeholders = [
      ...new Set([...sql.matchAll(/\$(\d+)/gu)].map((match) => Number(match[1])))
    ].sort((left, right) => left - right)
    const managedRelationReferences = [
      ...sql.matchAll(
        /(?:FROM(?:\s+ONLY)?|JOIN(?:\s+ONLY)?)\s+"openpencil_release"\."(?:backfill_executions_v1|backfill_receipts_v2|backfill_heads_v1)"/gu
      )
    ].map((match) => match[0])

    expect(sql).toContain(embedded)
    expect(sql.match(/;/gu)).toHaveLength(1)
    expect(placeholders).toEqual(Array.from({ length: 33 }, (_, index) => index + 1))
    expect(sql).not.toContain('$34')
    expect(managedRelationReferences.length).toBeGreaterThanOrEqual(9)
    expect(managedRelationReferences.every((reference) => reference.startsWith('FROM ONLY'))).toBe(
      true
    )
    expect(sql).toContain('"receipt"."revision" > "page_input"."after_revision"')
    expect(sql).toContain('"receipt"."revision" <= "effective_anchor"."revision"')
    expect(sql).toContain('LIMIT 5')
    expect(sql).toContain('LIMIT 4')
    expect(sql).not.toMatch(/\bOFFSET\b/iu)
    expect(sql).toContain('\'revision\', "revision"::"pg_catalog"."int4"')
    expect(sql).toContain('\'previousRevision\', "previous_revision"::"pg_catalog"."int4"')
    expect(sql).toContain('"page_input"."after_revision"::"pg_catalog"."int4" AS "afterRevision"')
    expect(sql).toContain('"effective_anchor"."revision"::"pg_catalog"."int4" AS "anchorRevision"')
    expect(sql).toContain('"current_head"."revision"::"pg_catalog"."int4" AS "currentHeadRevision"')
    expect(sql).toContain(
      '"page_summary"."first_revision"::"pg_catalog"."int4" AS "pageFirstRevision"'
    )
    expect(sql).toContain(
      '"page_summary"."last_revision"::"pg_catalog"."int4" AS "pageLastRevision"'
    )
    expect(sql).toContain("THEN 'anchor-stale'")
    expect(sql).toContain('"current_head"."revision" > "page_input"."anchor_revision"')
    expect(sql).toMatch(
      /WHEN "page_input"\."page_mode" = 'continuation'\s+AND NOT "effective_anchor"\."head_matches_anchor"\s+THEN 'corruption'/u
    )
    expect(sql).toContain("'base64'")
    expect(sql).toContain('"pg_catalog"."chr"(10)')
    expect(sql).toMatch(/\bCOALESCE\s*\(/u)
    expect(sql).toMatch(/\bLEAST\s*\(/u)
    expect(sql).not.toMatch(/\b(?:COUNT|MIN|MAX|SUM|AVG)\s*\(/gu)
    expect(sql).not.toMatch(/"[^"]+"\."(?:coalesce|greatest|least|nullif)"\s*\(/iu)
    expect(sql).not.toMatch(
      /\b(?:INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|MERGE\s+INTO|TRUNCATE\s+|ALTER\s+TABLE|DROP\s+|CREATE\s+|GRANT\s+|REVOKE\s+)\b/iu
    )
    expect(sql).not.toMatch(/\bFOR\s+(?:UPDATE|NO\s+KEY\s+UPDATE|SHARE|KEY\s+SHARE)\b/iu)
    expect(sql).not.toMatch(/\b(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT|SET\s+TRANSACTION)\b/iu)
    expect(SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_FIXED_QUERY).toMatchObject({
      parameterOrder: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_PARAMETER_ORDER,
      responseFields: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_RESPONSE_FIELDS,
      pageSize: 4,
      lookaheadSize: 5,
      statementCount: 1,
      accessMode: 'read-only',
      snapshotScope: 'single-statement'
    })
    expect(new Set(SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_RESPONSE_FIELDS).size).toBe(
      SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_RESPONSE_FIELDS.length
    )
  })

  test('rejects forged, consumed, and accessor-bearing review inputs', async () => {
    const source = await receiptZeroReconciliationFixture()
    const inputError = 'supabase-backfill-receipt-v2-chain-first-page-input-invalid' as const
    const proofError = 'supabase-backfill-receipt-v2-chain-first-page-proof-invalid' as const
    const staticBindingError =
      'supabase-backfill-receipt-v2-chain-first-page-static-sql-safety-binding-mismatch' as const

    await receiptV2ChainFirstPageReviewError(
      createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1({} as never),
      inputError
    )
    await receiptV2ChainFirstPageReviewError(
      createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1({
        reconciliationReview: source.reconciliationReview,
        staticSqlSafetyCertificate: source.pageSafetyCertificate,
        extra: true
      } as never),
      inputError
    )
    await receiptV2ChainFirstPageReviewError(
      createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1(
        Object.assign(
          {
            reconciliationReview: source.reconciliationReview,
            staticSqlSafetyCertificate: source.pageSafetyCertificate
          },
          { [Symbol('extra')]: true }
        )
      ),
      inputError
    )
    await receiptV2ChainFirstPageReviewError(
      createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1({
        reconciliationReview: { ...source.reconciliationReview },
        staticSqlSafetyCertificate: source.pageSafetyCertificate
      }),
      proofError
    )
    await receiptV2ChainFirstPageReviewError(
      createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1({
        reconciliationReview: source.reconciliationReview,
        staticSqlSafetyCertificate: structuredClone(source.pageSafetyCertificate)
      }),
      proofError
    )
    await receiptV2ChainFirstPageReviewError(
      createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1({
        reconciliationReview: source.reconciliationReview,
        staticSqlSafetyCertificate: { ...source.pageSafetyCertificate }
      }),
      proofError
    )
    await receiptV2ChainFirstPageReviewError(
      createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1({
        reconciliationReview: source.reconciliationReview,
        staticSqlSafetyCertificate: source.staticSqlSafetyCertificate
      }),
      staticBindingError
    )

    let getterCalls = 0
    const accessor = Object.defineProperty(
      { staticSqlSafetyCertificate: source.pageSafetyCertificate },
      'reconciliationReview',
      {
        enumerable: true,
        get() {
          getterCalls += 1
          return source.reconciliationReview
        }
      }
    )
    await receiptV2ChainFirstPageReviewError(
      createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1(accessor as never),
      inputError
    )
    expect(getterCalls).toBe(0)

    const revoked = Proxy.revocable(
      {
        reconciliationReview: source.reconciliationReview,
        staticSqlSafetyCertificate: source.pageSafetyCertificate
      },
      {}
    )
    revoked.revoke()
    await receiptV2ChainFirstPageReviewError(
      createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1(revoked.proxy),
      inputError
    )

    expect(
      consumeTrustedSupabaseBackfillLockedHighWaterCaptureV1(source.fixture.evidence.capture)
    ).not.toBeNull()
    await receiptV2ChainFirstPageReviewError(
      createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1({
        reconciliationReview: source.reconciliationReview,
        staticSqlSafetyCertificate: source.pageSafetyCertificate
      }),
      proofError
    )
  })
})

describe('Supabase backfill Receipt V2 chain first-page response parser', () => {
  test('recomputes the complete nested reconciliation and binds canonical Receipt-zero bytes', async () => {
    const source = await receiptZeroReconciliationFixture()
    const pageReview = await createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1({
      reconciliationReview: source.reconciliationReview,
      staticSqlSafetyCertificate: source.pageSafetyCertificate
    })
    const row = await receiptV2ChainFirstPageResponseRow(source, pageReview)
    const reviewContext = trustedSupabaseBackfillReceiptV2ChainFirstPageReviewContextV1(pageReview)
    if (!reviewContext) throw new TypeError('Expected a genuine Receipt V2 page review context')
    const wireBytes = new TextEncoder().encode(JSON.stringify([row]))
    const [wireDecoded, objectDecoded] = await Promise.all([
      decodeSupabaseBackfillReceiptV2ChainPageWireResponseForTestingV1(
        wireBytes,
        requireCurrentPageReview(pageReview, reviewContext)
      ),
      decodeSupabaseBackfillReceiptV2ChainPageResponseForTestingV1(
        [row],
        requireCurrentPageReview(pageReview, reviewContext)
      )
    ])
    const [first, second] = await Promise.all([
      parseSupabaseBackfillReceiptV2ChainFirstPageResponseForTestingV1({
        pageReview,
        response: [row]
      }),
      parseSupabaseBackfillReceiptV2ChainFirstPageResponseForTestingV1({
        pageReview,
        response: [row]
      })
    ])

    expect(wireDecoded).toMatchObject({
      decodedPage: { status: 'chain-complete' },
      size: {
        responseByteLength: wireBytes.byteLength,
        responseSizeCertified: true,
        responseFramingCertified: true
      },
      productionTransportAuthenticated: false,
      transportAuthorityCreated: false,
      databaseAuthorityCreated: false,
      releaseAuthorityCreated: false
    })
    expect(wireDecoded.size.base64PayloadCharacterCount).toBe(
      String(reviewContext.parameters[26]).length
    )
    expect(objectDecoded.status).toBe('chain-complete')
    expect(objectDecoded).not.toHaveProperty('size')
    expect(objectDecoded).not.toHaveProperty('productionTransportAuthenticated')

    expect(second).toEqual(first)
    expect(second).not.toBe(first)
    expect(first).toMatchObject({
      format: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_FIRST_PAGE_OBSERVATION_FORMAT,
      version: 1,
      providerId: 'supabase',
      environment: 'staging',
      testingOnly: true,
      pageMode: 'first',
      reportedStatus: 'chain-complete',
      status: 'chain-complete',
      reconciliation: {
        reportedStatus: 'exact-replay',
        status: 'exact-replay',
        reportedStatusMatchesRecomputedFacts: true
      },
      afterRevision: 0,
      anchor: {
        revision: 1,
        eventId: source.receiptZero.review.receipt.databaseEventId,
        receiptDigest: source.casReview.review.bindings.receiptDigest
      },
      currentHead: {
        revision: 1,
        eventId: source.receiptZero.review.receipt.databaseEventId,
        receiptDigest: source.casReview.review.bindings.receiptDigest
      },
      facts: {
        currentExecutionCount: 1,
        executionStatus: source.receiptZero.review.rowPlan.execution.status,
        pageCandidateCount: 1,
        pageReceiptCount: 1,
        pageContiguous: true,
        pageLinksValid: true,
        hasMore: false
      },
      receipts: [
        {
          revision: 1,
          eventId: source.receiptZero.review.receipt.databaseEventId,
          receiptId: source.receiptZero.review.receipt.receiptId,
          receiptDigest: source.casReview.review.bindings.receiptDigest,
          checkpointKind: 'capture'
        }
      ],
      reportedStatusMatchesRecomputedFacts: true,
      statusRecomputedByHost: true,
      completeEmbeddedReconciliationRecomputedByHost: true,
      canonicalReceiptPayloadsVerified: true,
      pageRowsBoundToCanonicalReceipts: true,
      reportedInstallMarkerDigestMatchesHistorical: true,
      specificHistoricalInstallationAuthenticated: false,
      reportedStatusProvesDatabaseState: false,
      statusProvesDatabaseState: false,
      productionTransportAuthenticated: false,
      fullPortableReceiptV2ChainVerified: false,
      continuationReviewCreated: false,
      crossPageHeadFreshnessAuthenticated: false,
      automaticRetryAllowed: false,
      captureConsumed: false,
      credentialAuthorityCreated: false,
      transportAuthorityCreated: false,
      databaseAuthorityCreated: false,
      mutationAuthorityCreated: false,
      executionAuthorityCreated: false,
      receiptAuthorityCreated: false,
      releaseAuthorityCreated: false,
      releaseReady: false
    })
    expect(first.bindings).toMatchObject({
      pageReviewDigest: pageReview.reviewDigest,
      pageQueryDigest: pageReview.review.bindings.pageQueryDigest,
      pageSqlDigest: pageReview.review.bindings.pageSqlDigest,
      pageParameterSchemaDigest: pageReview.review.bindings.pageParameterSchemaDigest,
      pageParameterValuesDigest: pageReview.review.bindings.pageParameterValuesDigest,
      reconciliationReviewDigest: source.reconciliationReview.reviewDigest,
      scopeDigest: source.casReview.review.bindings.scopeDigest,
      expectedReceiptZeroDigest: source.casReview.review.bindings.receiptDigest,
      historicalInstallMarkerDigest:
        source.reconciliationReview.review.bindings.historicalInstallMarkerDigest,
      observedInstallMarkerDigest:
        source.reconciliationReview.review.bindings.historicalInstallMarkerDigest
    })
    expect(first.bindings.responseDigest).toBe(await digestCanonicalManifest([row]))
    expect(first.bindings.reconciliationResponseDigest).toBe(
      await digestCanonicalManifest([row.reconciliationResponse])
    )
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.bindings)).toBe(true)
    expect(Object.isFrozen(first.anchor)).toBe(true)
    expect(Object.isFrozen(first.currentHead)).toBe(true)
    expect(Object.isFrozen(first.facts)).toBe(true)
    expect(Object.isFrozen(first.receipts)).toBe(true)
    expect(Object.isFrozen(first.receipts[0])).toBe(true)

    const trusted = trustedSupabaseBackfillReceiptV2ChainFirstPageObservationContextV1(first)
    expect(trusted?.observation).toBe(first)
    expect(trusted?.receipts).toEqual([source.receiptZero.review.receipt])
    expect(
      trustedSupabaseBackfillReceiptV2ChainFirstPageObservationContextV1({ ...first })
    ).toBeNull()
    expect(
      trustedSupabaseBackfillReceiptV2ChainFirstPageObservationContextV1(first.anchor)
    ).toBeNull()
    const publicJSON = JSON.stringify(first)
    expect(publicJSON).not.toContain(String(reviewContext.parameters[26]))
    expect(publicJSON).not.toContain(source.fixture.databaseLedger.applied.marker)
    expect(publicJSON).not.toContain(BACKFILL_DATABASE_CAS_LEDGER_INSTALL_PAT)
    expect(trustedSupabaseBackfillLockedHighWaterCaptureV1(source.fixture.evidence.capture)).toBe(
      true
    )
  })

  test('derives advanced chain-complete and bounded page-ready states from page algebra', async () => {
    for (const receiptCount of [2, 5] as const) {
      const source = await receiptZeroReconciliationFixture()
      const pageReview = await createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1({
        reconciliationReview: source.reconciliationReview,
        staticSqlSafetyCertificate: source.pageSafetyCertificate
      })
      const fixture = await advancedReceiptV2ChainFirstPageResponseRow(
        source,
        pageReview,
        receiptCount
      )
      const observation = await parseSupabaseBackfillReceiptV2ChainFirstPageResponseForTestingV1({
        pageReview,
        response: [fixture.row]
      })
      const expectedStatus = receiptCount === 2 ? 'chain-complete' : 'page-ready'
      expect(observation).toMatchObject({
        reportedStatus: expectedStatus,
        status: expectedStatus,
        reconciliation: { reportedStatus: 'advanced-head', status: 'advanced-head' },
        anchor: { revision: receiptCount },
        facts: {
          receiptCount,
          minimumReceiptRevision: 1,
          maximumReceiptRevision: receiptCount,
          pageCandidateCount: Math.min(5, receiptCount),
          pageReceiptCount: Math.min(4, receiptCount),
          pageFirstRevision: 1,
          pageLastRevision: Math.min(4, receiptCount),
          hasMore: receiptCount > 4
        },
        receipts: fixture.receipts.slice(0, 4).map((receipt) => ({
          revision: receipt.databaseHeadVersion,
          receiptId: receipt.receiptId
        })),
        fullPortableReceiptV2ChainVerified: false,
        releaseReady: false
      })
      expect(
        trustedSupabaseBackfillReceiptV2ChainFirstPageObservationContextV1(observation)?.receipts
      ).toEqual(fixture.receipts.slice(0, 4))
    }
  })

  test('snapshots exact wire values and rejects non-canonical Receipt or metadata substitutions', async () => {
    const source = await receiptZeroReconciliationFixture()
    const pageReview = await createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1({
      reconciliationReview: source.reconciliationReview,
      staticSqlSafetyCertificate: source.pageSafetyCertificate
    })
    const row = await receiptV2ChainFirstPageResponseRow(source, pageReview)
    const inputError = 'supabase-backfill-receipt-v2-chain-page-response-input-invalid' as const
    const proofError = 'supabase-backfill-receipt-v2-chain-page-response-proof-invalid' as const
    const invalidError = 'supabase-backfill-receipt-v2-chain-page-response-invalid' as const
    const receiptError = 'supabase-backfill-receipt-v2-chain-page-response-receipt-invalid' as const
    const bindingError =
      'supabase-backfill-receipt-v2-chain-page-response-binding-mismatch' as const

    await receiptV2ChainPageResponseError(
      parseSupabaseBackfillReceiptV2ChainFirstPageResponseForTestingV1({} as never),
      inputError
    )
    await receiptV2ChainPageResponseError(
      parseSupabaseBackfillReceiptV2ChainFirstPageResponseForTestingV1({
        pageReview,
        response: [row],
        extra: true
      } as never),
      inputError
    )
    await receiptV2ChainPageResponseError(
      parseSupabaseBackfillReceiptV2ChainFirstPageResponseForTestingV1({
        pageReview: { ...pageReview },
        response: [row]
      }),
      proofError
    )
    await receiptV2ChainPageResponseError(
      parseSupabaseBackfillReceiptV2ChainFirstPageResponseForTestingV1({
        pageReview,
        response: [{ ...row, extra: true }]
      }),
      invalidError
    )
    await receiptV2ChainPageResponseError(
      parseSupabaseBackfillReceiptV2ChainFirstPageResponseForTestingV1({
        pageReview,
        response: [{ ...row, pageReceiptCount: -0 }]
      }),
      invalidError
    )
    await receiptV2ChainPageResponseError(
      parseSupabaseBackfillReceiptV2ChainFirstPageResponseForTestingV1({
        pageReview,
        response: [{ ...row, queryVersion: 'substituted-page-query-v1' }]
      }),
      invalidError
    )

    let getterCalls = 0
    const accessorRow = Object.defineProperty({ ...row }, 'reportedStatus', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'chain-complete'
      }
    })
    await receiptV2ChainPageResponseError(
      parseSupabaseBackfillReceiptV2ChainFirstPageResponseForTestingV1({
        pageReview,
        response: [accessorRow]
      }),
      invalidError
    )
    expect(getterCalls).toBe(0)

    const receiptRow = (row.receipts as readonly Record<string, unknown>[])[0]
    const sparseReceipts: unknown[] = []
    sparseReceipts.length = 1
    await receiptV2ChainPageResponseError(
      parseSupabaseBackfillReceiptV2ChainFirstPageResponseForTestingV1({
        pageReview,
        response: [{ ...row, receipts: sparseReceipts }]
      }),
      invalidError
    )
    await receiptV2ChainPageResponseError(
      parseSupabaseBackfillReceiptV2ChainFirstPageResponseForTestingV1({
        pageReview,
        response: [
          {
            ...row,
            receipts: [
              { ...receiptRow, canonicalReceiptBase64: ` ${receiptRow.canonicalReceiptBase64}` }
            ]
          }
        ]
      }),
      receiptError
    )

    const canonicalText = decodeBase64Text(String(receiptRow.canonicalReceiptBase64))
    const nonCanonicalText = canonicalText.replace('{', '{ ')
    await receiptV2ChainPageResponseError(
      parseSupabaseBackfillReceiptV2ChainFirstPageResponseForTestingV1({
        pageReview,
        response: [
          {
            ...row,
            receipts: [
              {
                ...receiptRow,
                canonicalReceiptBase64: encodeBase64Text(nonCanonicalText),
                canonicalReceiptByteLength: new TextEncoder().encode(nonCanonicalText).byteLength
              }
            ]
          }
        ]
      }),
      receiptError
    )
    await receiptV2ChainPageResponseError(
      parseSupabaseBackfillReceiptV2ChainFirstPageResponseForTestingV1({
        pageReview,
        response: [
          {
            ...row,
            receipts: [{ ...receiptRow, receiptId: 'substituted-receipt-id' }]
          }
        ]
      }),
      bindingError
    )
    await receiptV2ChainPageResponseError(
      parseSupabaseBackfillReceiptV2ChainFirstPageResponseForTestingV1({
        pageReview,
        response: [{ ...row, reportedStatus: 'corruption' }]
      }),
      invalidError
    )

    const substitutedHeadDigest = await digest('substituted-terminal-head')
    const substitutedHeadEventId = 'substituted-terminal-event'
    const substitutedHeadUpdatedAt = '2026-09-08T00:00:01.000000Z'
    await receiptV2ChainPageResponseError(
      parseSupabaseBackfillReceiptV2ChainFirstPageResponseForTestingV1({
        pageReview,
        response: [
          {
            ...row,
            anchorEventId: substitutedHeadEventId,
            anchorReceiptDigest: substitutedHeadDigest,
            anchorUpdatedAt: substitutedHeadUpdatedAt,
            currentHeadEventId: substitutedHeadEventId,
            currentHeadReceiptDigest: substitutedHeadDigest,
            currentHeadUpdatedAt: substitutedHeadUpdatedAt
          }
        ]
      }),
      invalidError
    )

    const nullPrototypeRow = Object.assign(Object.create(null), row)
    await expect(
      parseSupabaseBackfillReceiptV2ChainFirstPageResponseForTestingV1({
        pageReview,
        response: [nullPrototypeRow]
      })
    ).resolves.toMatchObject({ status: 'chain-complete', releaseReady: false })

    const mutableRow = { ...row }
    const mutableInput = { pageReview, response: [mutableRow] }
    const parsingSnapshot =
      parseSupabaseBackfillReceiptV2ChainFirstPageResponseForTestingV1(mutableInput)
    mutableRow.reportedStatus = 'corruption'
    mutableInput.response = [{ ...row, reportedStatus: 'corruption' }]
    await expect(parsingSnapshot).resolves.toMatchObject({
      reportedStatus: 'chain-complete',
      status: 'chain-complete'
    })
  })

  test('downgrades marker drift and revokes observations with the inherited capture', async () => {
    const source = await receiptZeroReconciliationFixture()
    const pageReview = await createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1({
      reconciliationReview: source.reconciliationReview,
      staticSqlSafetyCertificate: source.pageSafetyCertificate
    })
    const row = await receiptV2ChainFirstPageResponseRow(source, pageReview)
    const observedMarkerDigest = await digest('different-live-install-marker')
    const reconciliationResponse = {
      ...(row.reconciliationResponse as ReceiptZeroReconciliationResponseRowV1),
      installMarkerDigest: observedMarkerDigest
    }
    const drifted = await parseSupabaseBackfillReceiptV2ChainFirstPageResponseForTestingV1({
      pageReview,
      response: [
        {
          ...row,
          reconciliationResponse,
          installMarkerDigest: observedMarkerDigest
        }
      ]
    })
    expect(drifted).toMatchObject({
      reportedStatus: 'chain-complete',
      status: 'precondition-failed',
      reconciliation: {
        reportedStatus: 'exact-replay',
        status: 'precondition-failed'
      },
      reportedInstallMarkerDigestMatchesHistorical: false,
      releaseReady: false
    })

    expect(
      consumeTrustedSupabaseBackfillLockedHighWaterCaptureV1(source.fixture.evidence.capture)
    ).not.toBeNull()
    expect(trustedSupabaseBackfillReceiptV2ChainFirstPageObservationContextV1(drifted)).toBeNull()
    await receiptV2ChainPageResponseError(
      parseSupabaseBackfillReceiptV2ChainFirstPageResponseForTestingV1({
        pageReview,
        response: [row]
      }),
      'supabase-backfill-receipt-v2-chain-page-response-proof-invalid'
    )

    const during = await receiptZeroReconciliationFixture()
    const duringReview = await createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1({
      reconciliationReview: during.reconciliationReview,
      staticSqlSafetyCertificate: during.pageSafetyCertificate
    })
    const duringRow = await receiptV2ChainFirstPageResponseRow(during, duringReview)
    const parsing = parseSupabaseBackfillReceiptV2ChainFirstPageResponseForTestingV1({
      pageReview: duringReview,
      response: [duringRow]
    })
    expect(
      consumeTrustedSupabaseBackfillLockedHighWaterCaptureV1(during.fixture.evidence.capture)
    ).not.toBeNull()
    await receiptV2ChainPageResponseError(
      parsing,
      'supabase-backfill-receipt-v2-chain-page-response-proof-invalid'
    )
  })
})

describe('Supabase backfill Receipt V2 chain continuation review', () => {
  test('binds the next keyset suffix to one genuine page-ready observation and fixed anchor', async () => {
    const source = await receiptZeroReconciliationFixture()
    const firstPageReview = await createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1({
      reconciliationReview: source.reconciliationReview,
      staticSqlSafetyCertificate: source.pageSafetyCertificate
    })
    const page = await advancedReceiptV2ChainFirstPageResponseRow(source, firstPageReview, 5)
    const observation = await parseSupabaseBackfillReceiptV2ChainFirstPageResponseForTestingV1({
      pageReview: firstPageReview,
      response: [page.row]
    })
    const [first, second] = await Promise.all([
      createSupabaseBackfillReceiptV2ChainContinuationReviewForTestingV1({
        previousPageObservation: observation
      }),
      createSupabaseBackfillReceiptV2ChainContinuationReviewForTestingV1({
        previousPageObservation: observation
      })
    ])

    expect(second).toEqual(first)
    expect(second).not.toBe(first)
    expect(first.previewSql).toBe(SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SQL)
    expect(first.review).toMatchObject({
      format: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_CONTINUATION_REVIEW_FORMAT,
      version: 1,
      providerId: 'supabase',
      environmentIntent: 'staging',
      testingOnly: true,
      reviewOnly: true,
      applyAvailable: false,
      releaseReady: false,
      databaseLedgerBound: false,
      chainVerificationAuthorityCreated: false,
      continuationAuthorityCreated: false,
      databaseAuthorityCreated: false,
      mutationAuthorityCreated: false,
      executionAuthorityCreated: false,
      receiptAuthorityCreated: false,
      page: {
        kind: 'continuation',
        afterRevision: 4,
        maximumReceiptCount: 4,
        lookaheadReceiptCount: 5,
        keysetOrder: 'revision-ascending',
        sourcePageStatus: 'page-ready',
        anchor: observation.anchor,
        continuationBindsExactAnchor: true,
        staleAnchorReanchoredAutomatically: false,
        crossPageSingleSnapshotClaimed: false
      },
      transportSize: {
        limits: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_V1,
        request: {
          parameterCount: 33,
          parameterValuesExposed: false,
          requestSizeCertified: true,
          requestFramingCertified: true,
          requestDispatched: false,
          productionTransportAuthenticated: false
        },
        localRequestAndResponseBoundsCertified: true,
        decodedAggregateBoundCertified: true,
        productionResponseProvenanceAuthenticated: false,
        productionTransportAuthenticated: false
      },
      policy: {
        previousPageIdentityRequired: true,
        previousPageCanonicalReceiptsRetainedOnlyInTrustedContext: true,
        previewContainsPlaceholdersOnly: true,
        canonicalValuesKeptInTrustedContextOnly: true,
        requestDispatched: false,
        managedDataReadPerformed: false,
        productionResponseAuthenticated: false,
        responseParserCreated: true,
        boundedResponseWireDecoderCreated: true,
        localRequestAndResponseBoundsCertified: true,
        pageCollectionPerformed: false,
        fullPortableReceiptV2ChainVerified: false,
        headFreshnessAuthenticatedAcrossPages: false,
        mutationDispatched: false,
        captureConsumed: false,
        credentialAuthorityCreated: false,
        transportAuthorityCreated: false,
        databaseAuthorityCreated: false,
        releaseAuthorityCreated: false,
        automaticRetryAllowed: false
      }
    })
    expect(first.review.query).toBe(firstPageReview.review.query)
    expect(first.review.catalogGuard).toBe(firstPageReview.review.catalogGuard)
    expect(first.review.parameters.schema).toBe(firstPageReview.review.parameters.schema)
    expect(first.review.bindings).toMatchObject({
      sourcePageObservationDigest: await digestCanonicalManifest(observation),
      sourcePageResponseDigest: observation.bindings.responseDigest,
      sourcePageReviewDigest: firstPageReview.reviewDigest,
      reconciliationReviewDigest: source.reconciliationReview.reviewDigest,
      pageSqlDigest: firstPageReview.review.bindings.pageSqlDigest,
      pageQueryDigest: firstPageReview.review.bindings.pageQueryDigest,
      scopeDigest: source.casReview.review.bindings.scopeDigest,
      expectedReceiptZeroDigest: source.casReview.review.bindings.receiptDigest,
      historicalInstallMarkerDigest:
        source.reconciliationReview.review.bindings.historicalInstallMarkerDigest,
      pageTransportSizeCertificateDigest:
        firstPageReview.review.bindings.pageTransportSizeCertificateDigest,
      pageRequestSizeCertificateDigest: await digestCanonicalManifest(
        first.review.transportSize.request
      )
    })
    expect(first.review.blockers).toContain('receipt-v2-chain-continuation-review-only')
    expect(first.review.blockers).not.toContain(
      'receipt-v2-chain-continuation-response-parser-unavailable'
    )
    expect(first.review.blockers).not.toContain('receipt-v2-chain-first-page-review-only')
    expect(first.review.blockers).not.toContain('receipt-v2-chain-response-size-not-certified')
    expect(first.review.blockers).not.toContain(
      'receipt-v2-chain-fixed-query-request-size-not-certified'
    )
    expect(first.review.blockers).toContain(
      'receipt-zero-reconciliation-fixed-query-request-size-not-certified'
    )

    const firstPageContext =
      trustedSupabaseBackfillReceiptV2ChainFirstPageReviewContextV1(firstPageReview)
    const context = trustedSupabaseBackfillReceiptV2ChainContinuationReviewContextV1(first)
    expect(context?.envelope).toBe(first)
    expect(context?.sourceObservationContext.observation).toBe(observation)
    expect(context?.firstPageReviewContext).toBe(firstPageContext)
    expect(context?.sourceParameters).toBe(firstPageContext?.sourceParameters)
    expect(context?.parameters.slice(0, 28)).toEqual(firstPageContext?.sourceParameters)
    expect(context?.parameters.slice(28)).toEqual([
      '4',
      '5',
      observation.anchor.eventId,
      observation.anchor.receiptDigest,
      observation.anchor.updatedAt
    ])
    expect(Object.isFrozen(context?.parameters)).toBe(true)
    expect(
      trustedSupabaseBackfillReceiptV2ChainContinuationReviewContextV1({ ...first })
    ).toBeNull()
    expect(
      trustedSupabaseBackfillReceiptV2ChainContinuationReviewContextV1(first.review)
    ).toBeNull()

    const publicJSON = JSON.stringify(first)
    const publicDigests = new Set(Object.values(first.review.bindings))
    for (const value of context?.parameters.slice(0, 28) ?? []) {
      if (value === null || value.length < 16 || publicDigests.has(value)) continue
      expect(publicJSON).not.toContain(value)
    }
    expect(publicJSON).not.toContain(source.fixture.databaseLedger.applied.marker)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.review)).toBe(true)
    expect(Object.isFrozen(first.review.page.anchor)).toBe(true)
  })

  test('rejects non-ready, forged, accessor-bearing, and revoked observation provenance', async () => {
    const source = await receiptZeroReconciliationFixture()
    const firstPageReview = await createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1({
      reconciliationReview: source.reconciliationReview,
      staticSqlSafetyCertificate: source.pageSafetyCertificate
    })
    const exactRow = await receiptV2ChainFirstPageResponseRow(source, firstPageReview)
    const complete = await parseSupabaseBackfillReceiptV2ChainFirstPageResponseForTestingV1({
      pageReview: firstPageReview,
      response: [exactRow]
    })
    const inputError = 'supabase-backfill-receipt-v2-chain-continuation-input-invalid' as const
    const proofError = 'supabase-backfill-receipt-v2-chain-continuation-proof-invalid' as const
    const notReadyError =
      'supabase-backfill-receipt-v2-chain-continuation-source-not-page-ready' as const

    await receiptV2ChainContinuationReviewError(
      createSupabaseBackfillReceiptV2ChainContinuationReviewForTestingV1({} as never),
      inputError
    )
    await receiptV2ChainContinuationReviewError(
      createSupabaseBackfillReceiptV2ChainContinuationReviewForTestingV1({
        previousPageObservation: complete,
        extra: true
      } as never),
      inputError
    )
    await receiptV2ChainContinuationReviewError(
      createSupabaseBackfillReceiptV2ChainContinuationReviewForTestingV1({
        previousPageObservation: complete
      }),
      notReadyError
    )
    await receiptV2ChainContinuationReviewError(
      createSupabaseBackfillReceiptV2ChainContinuationReviewForTestingV1({
        previousPageObservation: { ...complete }
      }),
      proofError
    )

    let getterCalls = 0
    const accessor = Object.defineProperty({}, 'previousPageObservation', {
      enumerable: true,
      get() {
        getterCalls += 1
        return complete
      }
    })
    await receiptV2ChainContinuationReviewError(
      createSupabaseBackfillReceiptV2ChainContinuationReviewForTestingV1(accessor as never),
      inputError
    )
    expect(getterCalls).toBe(0)

    const revoked = Proxy.revocable({ previousPageObservation: complete }, {})
    revoked.revoke()
    await receiptV2ChainContinuationReviewError(
      createSupabaseBackfillReceiptV2ChainContinuationReviewForTestingV1(revoked.proxy),
      inputError
    )
  })

  test('does not mint a continuation after inherited capture consumption', async () => {
    const source = await receiptZeroReconciliationFixture()
    const firstPageReview = await createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1({
      reconciliationReview: source.reconciliationReview,
      staticSqlSafetyCertificate: source.pageSafetyCertificate
    })
    const page = await advancedReceiptV2ChainFirstPageResponseRow(source, firstPageReview, 5)
    const observation = await parseSupabaseBackfillReceiptV2ChainFirstPageResponseForTestingV1({
      pageReview: firstPageReview,
      response: [page.row]
    })
    expect(
      consumeTrustedSupabaseBackfillLockedHighWaterCaptureV1(source.fixture.evidence.capture)
    ).not.toBeNull()
    await receiptV2ChainContinuationReviewError(
      createSupabaseBackfillReceiptV2ChainContinuationReviewForTestingV1({
        previousPageObservation: observation
      }),
      'supabase-backfill-receipt-v2-chain-continuation-proof-invalid'
    )

    const during = await receiptZeroReconciliationFixture()
    const duringFirstReview = await createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1(
      {
        reconciliationReview: during.reconciliationReview,
        staticSqlSafetyCertificate: during.pageSafetyCertificate
      }
    )
    const duringPage = await advancedReceiptV2ChainFirstPageResponseRow(
      during,
      duringFirstReview,
      5
    )
    const duringObservation =
      await parseSupabaseBackfillReceiptV2ChainFirstPageResponseForTestingV1({
        pageReview: duringFirstReview,
        response: [duringPage.row]
      })
    const creating = createSupabaseBackfillReceiptV2ChainContinuationReviewForTestingV1({
      previousPageObservation: duringObservation
    })
    expect(
      consumeTrustedSupabaseBackfillLockedHighWaterCaptureV1(during.fixture.evidence.capture)
    ).not.toBeNull()
    await receiptV2ChainContinuationReviewError(
      creating,
      'supabase-backfill-receipt-v2-chain-continuation-proof-invalid'
    )
  })
})

describe('Supabase backfill Receipt V2 chain continuation response parser', () => {
  test('binds a canonical second page to its genuine review and prior Receipt boundary', async () => {
    const source = await receiptZeroReconciliationFixture()
    const firstPageReview = await createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1({
      reconciliationReview: source.reconciliationReview,
      staticSqlSafetyCertificate: source.pageSafetyCertificate
    })
    const page = await advancedReceiptV2ChainFirstPageResponseRow(source, firstPageReview, 5)
    const firstPageObservation =
      await parseSupabaseBackfillReceiptV2ChainFirstPageResponseForTestingV1({
        pageReview: firstPageReview,
        response: [page.row]
      })
    const continuationReview =
      await createSupabaseBackfillReceiptV2ChainContinuationReviewForTestingV1({
        previousPageObservation: firstPageObservation
      })
    const row = await continuationReceiptV2ChainPageResponseRow(page)
    const [first, second] = await Promise.all([
      parseSupabaseBackfillReceiptV2ChainContinuationResponseForTestingV1({
        continuationReview,
        response: [row]
      }),
      parseSupabaseBackfillReceiptV2ChainContinuationResponseForTestingV1({
        continuationReview,
        response: [row]
      })
    ])

    expect(second).toEqual(first)
    expect(second).not.toBe(first)
    expect(first).toMatchObject({
      format: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_CONTINUATION_PAGE_OBSERVATION_FORMAT,
      version: 1,
      providerId: 'supabase',
      environment: 'staging',
      testingOnly: true,
      pageMode: 'continuation',
      reportedStatus: 'chain-complete',
      status: 'chain-complete',
      afterRevision: 4,
      anchor: firstPageObservation.anchor,
      currentHead: firstPageObservation.anchor,
      facts: {
        pageCandidateCount: 1,
        pageReceiptCount: 1,
        pageFirstRevision: 5,
        pageLastRevision: 5,
        pageContiguous: true,
        pageLinksValid: true,
        hasMore: false
      },
      receipts: [
        {
          revision: 5,
          eventId: page.receipts[4]?.databaseEventId,
          receiptId: page.receipts[4]?.receiptId
        }
      ],
      previousPageIdentityVerified: true,
      priorReceiptExpectationEnforced: true,
      staleAnchorReanchoredAutomatically: false,
      productionTransportAuthenticated: false,
      fullPortableReceiptV2ChainVerified: false,
      continuationReviewCreated: false,
      crossPageHeadFreshnessAuthenticated: false,
      credentialAuthorityCreated: false,
      transportAuthorityCreated: false,
      databaseAuthorityCreated: false,
      mutationAuthorityCreated: false,
      executionAuthorityCreated: false,
      receiptAuthorityCreated: false,
      releaseAuthorityCreated: false,
      releaseReady: false
    })
    expect(first.bindings).toMatchObject({
      continuationReviewDigest: continuationReview.reviewDigest,
      sourcePageObservationDigest: continuationReview.review.bindings.sourcePageObservationDigest,
      sourcePageResponseDigest: firstPageObservation.bindings.responseDigest,
      sourcePageReviewDigest: firstPageReview.reviewDigest,
      responseDigest: await digestCanonicalManifest([row])
    })
    const context = trustedSupabaseBackfillReceiptV2ChainContinuationPageObservationContextV1(first)
    expect(context?.observation).toBe(first)
    expect(context?.reviewContext.envelope).toBe(continuationReview)
    expect(context?.canonicalReceipts).toEqual([page.receipts[4]])
    expect(
      trustedSupabaseBackfillReceiptV2ChainContinuationPageObservationContextV1({ ...first })
    ).toBeNull()
    const reviewContext =
      trustedSupabaseBackfillReceiptV2ChainContinuationReviewContextV1(continuationReview)
    const publicJSON = JSON.stringify(first)
    for (const index of [0, 11, 26, 27] as const) {
      const value = reviewContext?.parameters[index]
      if (value !== null && value !== undefined) expect(publicJSON).not.toContain(value)
    }
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.bindings)).toBe(true)
    expect(Object.isFrozen(first.receipts)).toBe(true)
  })

  test('chains a page-ready second page into an anchor-bound terminal third page', async () => {
    const source = await receiptZeroReconciliationFixture()
    const firstPageReview = await createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1({
      reconciliationReview: source.reconciliationReview,
      staticSqlSafetyCertificate: source.pageSafetyCertificate
    })
    const chain = await advancedReceiptV2ChainFirstPageResponseRow(source, firstPageReview, 9)
    const firstPage = await parseSupabaseBackfillReceiptV2ChainFirstPageResponseForTestingV1({
      pageReview: firstPageReview,
      response: [chain.row]
    })
    const secondPageReview =
      await createSupabaseBackfillReceiptV2ChainContinuationReviewForTestingV1({
        previousPageObservation: firstPage
      })
    const secondPageRow = await continuationReceiptV2ChainPageResponseRow(chain, 4)
    const secondPage = await parseSupabaseBackfillReceiptV2ChainContinuationResponseForTestingV1({
      continuationReview: secondPageReview,
      response: [secondPageRow]
    })

    expect(secondPage).toMatchObject({
      reportedStatus: 'page-ready',
      status: 'page-ready',
      afterRevision: 4,
      anchor: firstPage.anchor,
      currentHead: firstPage.anchor,
      facts: {
        pageCandidateCount: 5,
        pageReceiptCount: 4,
        pageFirstRevision: 5,
        pageLastRevision: 8,
        pageContiguous: true,
        pageLinksValid: true,
        hasMore: true
      }
    })
    expect(secondPage.receipts.map((receipt) => receipt.revision)).toEqual([5, 6, 7, 8])

    const thirdPageReview =
      await createSupabaseBackfillReceiptV2ChainContinuationReviewForTestingV1({
        previousPageObservation: secondPage
      })
    const thirdPageRow = await continuationReceiptV2ChainPageResponseRow(chain, 8)
    const thirdPage = await parseSupabaseBackfillReceiptV2ChainContinuationResponseForTestingV1({
      continuationReview: thirdPageReview,
      response: [thirdPageRow]
    })

    expect(thirdPageReview.review.page).toMatchObject({
      afterRevision: 8,
      anchor: firstPage.anchor
    })
    expect(thirdPageReview.review.bindings).toMatchObject({
      sourcePageObservationDigest: await digestCanonicalManifest(secondPage),
      sourcePageResponseDigest: secondPage.bindings.responseDigest,
      sourcePageReviewDigest: secondPageReview.reviewDigest
    })
    expect(thirdPage).toMatchObject({
      reportedStatus: 'chain-complete',
      status: 'chain-complete',
      afterRevision: 8,
      anchor: firstPage.anchor,
      currentHead: firstPage.anchor,
      facts: {
        pageCandidateCount: 1,
        pageReceiptCount: 1,
        pageFirstRevision: 9,
        pageLastRevision: 9,
        pageContiguous: true,
        pageLinksValid: true,
        hasMore: false
      },
      previousPageIdentityVerified: true,
      priorReceiptExpectationEnforced: true,
      staleAnchorReanchoredAutomatically: false,
      fullPortableReceiptV2ChainVerified: false,
      releaseReady: false
    })
    expect(thirdPage.receipts).toHaveLength(1)
    expect(thirdPage.receipts[0]).toMatchObject({
      revision: 9,
      eventId: firstPage.anchor.eventId,
      receiptDigest: firstPage.anchor.receiptDigest,
      committedAt: firstPage.anchor.updatedAt
    })
    expect(thirdPage.bindings).toMatchObject({
      continuationReviewDigest: thirdPageReview.reviewDigest,
      sourcePageObservationDigest: thirdPageReview.review.bindings.sourcePageObservationDigest,
      sourcePageResponseDigest: secondPage.bindings.responseDigest,
      sourcePageReviewDigest: secondPageReview.reviewDigest,
      responseDigest: await digestCanonicalManifest([thirdPageRow])
    })
    const context =
      trustedSupabaseBackfillReceiptV2ChainContinuationPageObservationContextV1(thirdPage)
    expect(context?.observation).toBe(thirdPage)
    expect(context?.reviewContext.envelope).toBe(thirdPageReview)
    expect(context?.canonicalReceipts).toEqual([chain.receipts[8]])
  })

  test('rejects predecessor, live-head, execution-status, and exact-wire substitution', async () => {
    const source = await receiptZeroReconciliationFixture()
    const firstPageReview = await createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1({
      reconciliationReview: source.reconciliationReview,
      staticSqlSafetyCertificate: source.pageSafetyCertificate
    })
    const page = await advancedReceiptV2ChainFirstPageResponseRow(source, firstPageReview, 5)
    const firstPageObservation =
      await parseSupabaseBackfillReceiptV2ChainFirstPageResponseForTestingV1({
        pageReview: firstPageReview,
        response: [page.row]
      })
    const continuationReview =
      await createSupabaseBackfillReceiptV2ChainContinuationReviewForTestingV1({
        previousPageObservation: firstPageObservation
      })
    const row = await continuationReceiptV2ChainPageResponseRow(page)
    const receipt = (row.receipts as readonly Record<string, unknown>[])[0]
    const inputError =
      'supabase-backfill-receipt-v2-chain-continuation-response-input-invalid' as const
    const proofError =
      'supabase-backfill-receipt-v2-chain-continuation-response-proof-invalid' as const
    const invalidError = 'supabase-backfill-receipt-v2-chain-continuation-response-invalid' as const
    const bindingError =
      'supabase-backfill-receipt-v2-chain-continuation-response-binding-mismatch' as const

    await receiptV2ChainContinuationResponseError(
      parseSupabaseBackfillReceiptV2ChainContinuationResponseForTestingV1({} as never),
      inputError
    )
    await receiptV2ChainContinuationResponseError(
      parseSupabaseBackfillReceiptV2ChainContinuationResponseForTestingV1({
        continuationReview: { ...continuationReview },
        response: [row]
      }),
      proofError
    )
    await receiptV2ChainContinuationResponseError(
      parseSupabaseBackfillReceiptV2ChainContinuationResponseForTestingV1({
        continuationReview,
        response: [{ ...row, queryVersion: 'substituted-continuation-query-v1' }]
      }),
      invalidError
    )
    for (const substitutedReceipt of [
      { ...receipt, previousRevision: 3 },
      { ...receipt, previousEventId: 'substituted-previous-event' },
      { ...receipt, previousReceiptDigest: await digest('substituted-previous-receipt') }
    ]) {
      await receiptV2ChainContinuationResponseError(
        parseSupabaseBackfillReceiptV2ChainContinuationResponseForTestingV1({
          continuationReview,
          response: [{ ...row, receipts: [substitutedReceipt] }]
        }),
        bindingError
      )
    }
    await receiptV2ChainContinuationResponseError(
      parseSupabaseBackfillReceiptV2ChainContinuationResponseForTestingV1({
        continuationReview,
        response: [{ ...row, executionStatus: null }]
      }),
      bindingError
    )
    await receiptV2ChainContinuationResponseError(
      parseSupabaseBackfillReceiptV2ChainContinuationResponseForTestingV1({
        continuationReview,
        response: [{ ...row, currentHeadRevision: 6 }]
      }),
      bindingError
    )

    let getterCalls = 0
    const accessor = Object.defineProperty({}, 'continuationReview', {
      enumerable: true,
      get() {
        getterCalls += 1
        return continuationReview
      }
    })
    await receiptV2ChainContinuationResponseError(
      parseSupabaseBackfillReceiptV2ChainContinuationResponseForTestingV1(accessor as never),
      inputError
    )
    expect(getterCalls).toBe(0)
  })

  test('accepts only a forward stale empty page and never reanchors it', async () => {
    const source = await receiptZeroReconciliationFixture()
    const firstPageReview = await createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1({
      reconciliationReview: source.reconciliationReview,
      staticSqlSafetyCertificate: source.pageSafetyCertificate
    })
    const original = await advancedReceiptV2ChainFirstPageResponseRow(source, firstPageReview, 5)
    const firstPageObservation =
      await parseSupabaseBackfillReceiptV2ChainFirstPageResponseForTestingV1({
        pageReview: firstPageReview,
        response: [original.row]
      })
    const continuationReview =
      await createSupabaseBackfillReceiptV2ChainContinuationReviewForTestingV1({
        previousPageObservation: firstPageObservation
      })
    const advanced = await advancedReceiptV2ChainFirstPageResponseRow(source, firstPageReview, 6)
    const staleRow = Object.freeze({
      ...advanced.row,
      pageMode: 'continuation',
      afterRevision: 4,
      anchorRevision: firstPageObservation.anchor.revision,
      anchorEventId: firstPageObservation.anchor.eventId,
      anchorReceiptDigest: firstPageObservation.anchor.receiptDigest,
      anchorUpdatedAt: firstPageObservation.anchor.updatedAt,
      reportedStatus: 'anchor-stale',
      headMatchesAnchor: false,
      anchorReceiptCount: 0,
      headTimestampMatchesAnchorReceipt: false,
      pageCandidateCount: 0,
      pageReceiptCount: 0,
      pageFirstRevision: null,
      pageLastRevision: null,
      pageContiguous: false,
      pageLinksValid: false,
      hasMore: false,
      receipts: Object.freeze([])
    }) satisfies ReceiptV2ChainPageResponseRowV1
    const stale = await parseSupabaseBackfillReceiptV2ChainContinuationResponseForTestingV1({
      continuationReview,
      response: [staleRow]
    })
    expect(stale).toMatchObject({
      reportedStatus: 'anchor-stale',
      status: 'anchor-stale',
      anchor: firstPageObservation.anchor,
      currentHead: { revision: 6 },
      receipts: [],
      staleAnchorReanchoredAutomatically: false,
      automaticRetryAllowed: false,
      releaseReady: false
    })

    await receiptV2ChainContinuationResponseError(
      parseSupabaseBackfillReceiptV2ChainContinuationResponseForTestingV1({
        continuationReview,
        response: [
          {
            ...staleRow,
            receipts: (await continuationReceiptV2ChainPageResponseRow(original)).receipts
          }
        ]
      }),
      'supabase-backfill-receipt-v2-chain-continuation-response-invalid'
    )

    const rewrittenDigest = await digest('same-revision-rewritten-head')
    const rewrittenRow = Object.freeze({
      ...staleRow,
      reconciliationResponse: original.row.reconciliationResponse,
      reconciliationReportedStatus: original.row.reconciliationReportedStatus,
      receiptCount: original.row.receiptCount,
      minimumReceiptRevision: original.row.minimumReceiptRevision,
      maximumReceiptRevision: original.row.maximumReceiptRevision,
      currentHeadRevision: 5,
      currentHeadEventId: 'same-revision-rewritten-event',
      currentHeadReceiptDigest: rewrittenDigest,
      currentHeadUpdatedAt: original.row.currentHeadUpdatedAt,
      executionStatus: original.row.executionStatus,
      executionTimestampMatchesHead: original.row.executionTimestampMatchesHead,
      reportedStatus: 'corruption'
    }) satisfies ReceiptV2ChainPageResponseRowV1
    await expect(
      parseSupabaseBackfillReceiptV2ChainContinuationResponseForTestingV1({
        continuationReview,
        response: [rewrittenRow]
      })
    ).resolves.toMatchObject({ reportedStatus: 'corruption', status: 'corruption' })
  })

  test('downgrades marker drift and revokes parsing with the inherited capture', async () => {
    const source = await receiptZeroReconciliationFixture()
    const firstPageReview = await createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1({
      reconciliationReview: source.reconciliationReview,
      staticSqlSafetyCertificate: source.pageSafetyCertificate
    })
    const page = await advancedReceiptV2ChainFirstPageResponseRow(source, firstPageReview, 5)
    const firstPageObservation =
      await parseSupabaseBackfillReceiptV2ChainFirstPageResponseForTestingV1({
        pageReview: firstPageReview,
        response: [page.row]
      })
    const continuationReview =
      await createSupabaseBackfillReceiptV2ChainContinuationReviewForTestingV1({
        previousPageObservation: firstPageObservation
      })
    const row = await continuationReceiptV2ChainPageResponseRow(page)
    const observedMarkerDigest = await digest('different-continuation-install-marker')
    const reconciliationResponse = {
      ...(row.reconciliationResponse as ReceiptZeroReconciliationResponseRowV1),
      installMarkerDigest: observedMarkerDigest
    }
    const drifted = await parseSupabaseBackfillReceiptV2ChainContinuationResponseForTestingV1({
      continuationReview,
      response: [
        {
          ...row,
          reconciliationResponse,
          installMarkerDigest: observedMarkerDigest
        }
      ]
    })
    expect(drifted).toMatchObject({
      reportedStatus: 'chain-complete',
      status: 'precondition-failed',
      reportedInstallMarkerDigestMatchesHistorical: false,
      releaseReady: false
    })

    expect(
      consumeTrustedSupabaseBackfillLockedHighWaterCaptureV1(source.fixture.evidence.capture)
    ).not.toBeNull()
    expect(
      trustedSupabaseBackfillReceiptV2ChainContinuationPageObservationContextV1(drifted)
    ).toBeNull()
    await receiptV2ChainContinuationResponseError(
      parseSupabaseBackfillReceiptV2ChainContinuationResponseForTestingV1({
        continuationReview,
        response: [row]
      }),
      'supabase-backfill-receipt-v2-chain-continuation-response-proof-invalid'
    )

    const during = await receiptZeroReconciliationFixture()
    const duringFirstReview = await createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1(
      {
        reconciliationReview: during.reconciliationReview,
        staticSqlSafetyCertificate: during.pageSafetyCertificate
      }
    )
    const duringPage = await advancedReceiptV2ChainFirstPageResponseRow(
      during,
      duringFirstReview,
      5
    )
    const duringFirstObservation =
      await parseSupabaseBackfillReceiptV2ChainFirstPageResponseForTestingV1({
        pageReview: duringFirstReview,
        response: [duringPage.row]
      })
    const duringReview = await createSupabaseBackfillReceiptV2ChainContinuationReviewForTestingV1({
      previousPageObservation: duringFirstObservation
    })
    const duringRow = await continuationReceiptV2ChainPageResponseRow(duringPage)
    const parsing = parseSupabaseBackfillReceiptV2ChainContinuationResponseForTestingV1({
      continuationReview: duringReview,
      response: [duringRow]
    })
    expect(
      consumeTrustedSupabaseBackfillLockedHighWaterCaptureV1(during.fixture.evidence.capture)
    ).not.toBeNull()
    await receiptV2ChainContinuationResponseError(
      parsing,
      'supabase-backfill-receipt-v2-chain-continuation-response-proof-invalid'
    )
  })
})

describe('Supabase backfill Receipt V2 chain page collector', () => {
  test('verifies a complete trusted multi-page sequence with one bounded portable verifier', async () => {
    const fixture = await parsedPortableReceiptV2ChainPageSequence(9)
    const collection = await collectAndVerifySupabaseBackfillReceiptV2ChainForTestingV1({
      firstPageObservation: fixture.firstPageObservation,
      continuationPageObservations: fixture.continuationPageObservations
    })
    const terminalPage = fixture.continuationPageObservations.at(-1)
    const decodedReceiptByteLength = [
      fixture.firstPageObservation,
      ...fixture.continuationPageObservations
    ].reduce(
      (total, page) =>
        total +
        page.receipts.reduce(
          (pageTotal, receipt) => pageTotal + receipt.canonicalReceiptByteLength,
          0
        ),
      0
    )

    expect(collection).toMatchObject({
      format: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_COLLECTION_FORMAT,
      version: 1,
      providerId: 'supabase',
      environment: 'staging',
      testingOnly: true,
      pageCount: 3,
      receiptCount: 9,
      decodedReceiptByteLength,
      maximumDecodedReceiptBytes:
        SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_V1.maximumDecodedReceiptBytesPerCollection,
      decodedAggregateBoundCertified: true,
      anchor: fixture.firstPageObservation.anchor,
      outcome: 'completed',
      bindings: {
        firstPageObservationDigest: await digestCanonicalManifest(fixture.firstPageObservation),
        terminalPageObservationDigest: await digestCanonicalManifest(terminalPage),
        expectedHeadDigest: fixture.firstPageObservation.anchor.receiptDigest,
        computedHeadDigest: fixture.firstPageObservation.anchor.receiptDigest
      },
      allPageProvenanceVerified: true,
      allReceiptTransitionsVerified: true,
      expectedHeadDigestMatched: true,
      fullPortableReceiptV2ChainVerified: true,
      specificHistoricalInstallationAuthenticated: false,
      productionTransportAuthenticated: false,
      crossPageHeadFreshnessAuthenticated: false,
      automaticRetryAllowed: false,
      captureConsumed: false,
      credentialAuthorityCreated: false,
      transportAuthorityCreated: false,
      databaseAuthorityCreated: false,
      mutationAuthorityCreated: false,
      executionAuthorityCreated: false,
      receiptAuthorityCreated: false,
      releaseAuthorityCreated: false,
      releaseReady: false
    })
    expect(collection.bindings.pageSequenceDigest).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(Object.isFrozen(collection)).toBe(true)
    expect(Object.isFrozen(collection.bindings)).toBe(true)
    expect(Object.hasOwn(collection, 'receipts')).toBe(false)
    const publicJSON = JSON.stringify(collection)
    for (const receipt of fixture.chain.receipts) {
      expect(publicJSON).not.toContain(
        encodeBase64Bytes(canonicalBackendBackfillExecutionReceiptV2Bytes(receipt))
      )
    }

    const exactFourTerminal = await parsedPortableReceiptV2ChainPageSequence(8)
    await expect(
      collectAndVerifySupabaseBackfillReceiptV2ChainForTestingV1({
        firstPageObservation: exactFourTerminal.firstPageObservation,
        continuationPageObservations: exactFourTerminal.continuationPageObservations
      })
    ).resolves.toMatchObject({
      pageCount: 2,
      receiptCount: 8,
      outcome: 'completed',
      fullPortableReceiptV2ChainVerified: true
    })

    const singleReceipt = await parsedCompletedReceiptZeroPageSequence()
    await expect(
      collectAndVerifySupabaseBackfillReceiptV2ChainForTestingV1({
        firstPageObservation: singleReceipt.firstPageObservation,
        continuationPageObservations: []
      })
    ).resolves.toMatchObject({
      pageCount: 1,
      receiptCount: 1,
      outcome: 'completed',
      fullPortableReceiptV2ChainVerified: true
    })
  })

  test('rejects forged, incomplete, reordered, hostile, and revoked page sequences', async () => {
    const structurallyValidOnly = await parsedReceiptV2ChainPageSequence(9)
    await expect(
      collectAndVerifySupabaseBackfillReceiptV2ChainForTestingV1({
        firstPageObservation: structurallyValidOnly.firstPageObservation,
        continuationPageObservations: structurallyValidOnly.continuationPageObservations
      })
    ).rejects.toMatchObject({
      code: 'supabase-backfill-receipt-v2-chain-page-collection-page-verification-failed',
      verifierCode: 'backfill-execution-v2-batch-limit-exceeded'
    })

    const fixture = await parsedPortableReceiptV2ChainPageSequence(9)
    const equalDataChain = await parsedPortableReceiptV2ChainPageSequence(9)
    const [secondPage, thirdPage] = fixture.continuationPageObservations
    const inputError = 'supabase-backfill-receipt-v2-chain-page-collection-input-invalid' as const
    const proofError = 'supabase-backfill-receipt-v2-chain-page-collection-proof-invalid' as const
    const sequenceError =
      'supabase-backfill-receipt-v2-chain-page-collection-sequence-invalid' as const

    await receiptV2ChainPageCollectionError(
      collectAndVerifySupabaseBackfillReceiptV2ChainForTestingV1({} as never),
      inputError
    )
    await receiptV2ChainPageCollectionError(
      collectAndVerifySupabaseBackfillReceiptV2ChainForTestingV1({
        firstPageObservation: { ...fixture.firstPageObservation },
        continuationPageObservations: fixture.continuationPageObservations
      }),
      proofError
    )
    await receiptV2ChainPageCollectionError(
      collectAndVerifySupabaseBackfillReceiptV2ChainForTestingV1({
        firstPageObservation: fixture.firstPageObservation,
        continuationPageObservations: [{ ...secondPage }, thirdPage]
      }),
      proofError
    )
    await receiptV2ChainPageCollectionError(
      collectAndVerifySupabaseBackfillReceiptV2ChainForTestingV1({
        firstPageObservation: fixture.firstPageObservation,
        continuationPageObservations: equalDataChain.continuationPageObservations
      }),
      proofError
    )
    await receiptV2ChainPageCollectionError(
      collectAndVerifySupabaseBackfillReceiptV2ChainForTestingV1({
        firstPageObservation: fixture.firstPageObservation,
        continuationPageObservations: [secondPage, equalDataChain.continuationPageObservations[1]]
      }),
      proofError
    )
    await receiptV2ChainPageCollectionError(
      collectAndVerifySupabaseBackfillReceiptV2ChainForTestingV1({
        firstPageObservation: fixture.firstPageObservation,
        continuationPageObservations: [secondPage]
      }),
      sequenceError
    )
    await receiptV2ChainPageCollectionError(
      collectAndVerifySupabaseBackfillReceiptV2ChainForTestingV1({
        firstPageObservation: fixture.firstPageObservation,
        continuationPageObservations: [thirdPage, secondPage]
      }),
      proofError
    )

    const sparse: unknown[] = []
    sparse.length = 2
    sparse[1] = thirdPage
    await receiptV2ChainPageCollectionError(
      collectAndVerifySupabaseBackfillReceiptV2ChainForTestingV1({
        firstPageObservation: fixture.firstPageObservation,
        continuationPageObservations: sparse
      }),
      inputError
    )
    const revokedPages = Proxy.revocable([], {})
    revokedPages.revoke()
    await receiptV2ChainPageCollectionError(
      collectAndVerifySupabaseBackfillReceiptV2ChainForTestingV1({
        firstPageObservation: fixture.firstPageObservation,
        continuationPageObservations: revokedPages.proxy
      }),
      inputError
    )
    let getterCalls = 0
    const accessor = Object.defineProperties(
      {},
      {
        firstPageObservation: {
          enumerable: true,
          get() {
            getterCalls += 1
            return fixture.firstPageObservation
          }
        },
        continuationPageObservations: {
          enumerable: true,
          value: fixture.continuationPageObservations
        }
      }
    )
    await receiptV2ChainPageCollectionError(
      collectAndVerifySupabaseBackfillReceiptV2ChainForTestingV1(accessor as never),
      inputError
    )
    expect(getterCalls).toBe(0)

    const duplicateAcrossPageBoundary = await parsedPortableReceiptV2ChainPageSequence(9, 4)
    await expect(
      collectAndVerifySupabaseBackfillReceiptV2ChainForTestingV1({
        firstPageObservation: duplicateAcrossPageBoundary.firstPageObservation,
        continuationPageObservations: duplicateAcrossPageBoundary.continuationPageObservations
      })
    ).rejects.toMatchObject({
      code: 'supabase-backfill-receipt-v2-chain-page-collection-page-verification-failed',
      verifierCode: 'backfill-execution-v2-idempotency-key-reused'
    })

    expect(
      consumeTrustedSupabaseBackfillLockedHighWaterCaptureV1(
        fixture.source.fixture.evidence.capture
      )
    ).not.toBeNull()
    await receiptV2ChainPageCollectionError(
      collectAndVerifySupabaseBackfillReceiptV2ChainForTestingV1({
        firstPageObservation: fixture.firstPageObservation,
        continuationPageObservations: fixture.continuationPageObservations
      }),
      proofError
    )

    const during = await parsedPortableReceiptV2ChainPageSequence(9)
    const collecting = collectAndVerifySupabaseBackfillReceiptV2ChainForTestingV1({
      firstPageObservation: during.firstPageObservation,
      continuationPageObservations: during.continuationPageObservations
    })
    expect(
      consumeTrustedSupabaseBackfillLockedHighWaterCaptureV1(during.source.fixture.evidence.capture)
    ).not.toBeNull()
    await receiptV2ChainPageCollectionError(collecting, proofError)
  })
})
