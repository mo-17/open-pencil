import { canonicalBackendValue, digestCanonicalBackendValue } from '#compiler/backend/canonical'
import type {
  BackendArtifactSourceV2,
  BackendProviderAdapterContextV2
} from '#compiler/backend/v2/contracts'

import {
  BACKEND_OPERATIONAL_APPEND_AUTHORITY_FORMAT,
  BACKEND_OPERATIONAL_EVENT_ANCHOR_FORMAT,
  BACKEND_OPERATIONAL_EVENT_CANONICAL_ENCODING,
  BACKEND_OPERATIONAL_EVENT_FIELDS,
  BACKEND_OPERATIONAL_EVENT_FORMAT,
  BACKEND_OPERATIONAL_EVENT_MAX_SEGMENT_EVENTS,
  BACKEND_OPERATIONAL_EVENT_SINK_BATCH_FORMAT,
  BACKEND_OPERATIONAL_EVENT_SINK_CAS_PROPOSAL_FORMAT,
  BACKEND_OPERATIONAL_EVENT_SINK_MAX_REVISION,
  BACKEND_OPERATIONAL_EVENT_SINK_VERSION,
  BACKEND_OPERATIONAL_EVENT_VERSION
} from '@open-pencil/lowcode/backend'
import type { JSONValue } from '@open-pencil/scene-graph/primitives'

import { emitSupabaseAutomationArtifactsV2 } from '../automation/artifacts'
import { createSupabaseAutomationsPlanV2 } from '../automation/index'
import {
  createSupabaseObservabilityAutomationBridgePlanV2,
  createSupabaseObservabilityPlanV2,
  hasSupabaseObservabilityAutomationIntentV2,
  supabaseObservabilityAutomationContextV2,
  supabaseObservabilityDeclaredDataModelDigestV2,
  supabaseObservabilityDeclaredSubjectDigestV2,
  SUPABASE_OBSERVABILITY_ARTIFACT_PATHS_V2,
  SUPABASE_OBSERVABILITY_LIMITS_V2
} from './index'
import {
  emitSupabaseOperationalEventSinkReviewSQLV2,
  resolveSupabaseOperationalEventSinkScopeV2
} from './operational-event-sink-sql'

function stableJSON(value: unknown, path: string): string {
  return `${JSON.stringify(canonicalBackendValue(value, path), null, 2)}\n`
}

function assertExpectedPlan(context: BackendProviderAdapterContextV2, plan: JSONValue): void {
  if (
    digestCanonicalBackendValue(plan, '$.supabaseObservability.receivedPlan') !==
    digestCanonicalBackendValue(
      createSupabaseObservabilityPlanV2(context),
      '$.supabaseObservability.expectedPlan'
    )
  ) {
    throw new TypeError('Supabase observability plan does not match normalized application IR.')
  }
}

export function emitSupabaseObservabilityArtifactsV2(
  context: BackendProviderAdapterContextV2,
  plan: JSONValue
): readonly BackendArtifactSourceV2[] {
  assertExpectedPlan(context, plan)
  const normalizedPlan = createSupabaseObservabilityPlanV2(context)
  const declaredDataModelDigest = supabaseObservabilityDeclaredDataModelDigestV2(
    context.application
  )
  const declaredSubjectDigest = supabaseObservabilityDeclaredSubjectDigestV2(context.application)
  const sinkScope = resolveSupabaseOperationalEventSinkScopeV2(context.application.applicationId)
  const reviewManifest = {
    format: 'openpencil.supabase-observability-review.v1',
    version: 1,
    providerId: 'supabase',
    applicationId: context.application.applicationId,
    declaredDataModelDigest,
    declaredSubjectDigest,
    expectedSourceLedgerSchemaDigest: null,
    reviewOnly: true,
    readOnly: true,
    applyAllowed: false,
    deployAllowed: false,
    releaseReady: false,
    executableRuntimeEmitted: false,
    databaseMutationPerformed: false,
    expectedPostApplyState: {
      evidenceStatus: 'unverified-until-trusted-post-apply-receipt',
      acceptedReceipt: false,
      operationalEventSink: {
        required: true,
        schemaCandidateEmitted: true,
        schemaName: sinkScope.schemaName,
        applicationScopeDigest: sinkScope.applicationScopeDigest,
        applicationObjectKey: sinkScope.applicationObjectKey,
        databaseApplied: false,
        evidenceStatus: 'expected-unverified-until-trusted-post-apply-receipt',
        existingObjectPolicy: 'reject-including-truncated-name-collision',
        scope: 'application',
        ownership: 'expected-dedicated-current-user-only-unverified',
        tableShape: 'expected-logged-nonpartitioned-heap-unverified',
        commentsConstraintsIndexesAndAcl: 'exact-catalog-postcondition',
        revisionTable: 'operational_event_sink_revisions',
        headTable: 'operational_event_sink_heads',
        initialRevision: 0,
        maximumRevision: BACKEND_OPERATIONAL_EVENT_SINK_MAX_REVISION,
        revisionChain: 'expected-append-only-self-linked-unverified',
        exactHeadCasFields: [
          'current_revision',
          'current_head_digest',
          'current_batch_digest',
          'provider_id',
          'environment',
          'authority_digest',
          'current_segment_last_occurred_at',
          'observed_at'
        ],
        anchorBinding: 'exact-prior-head-prior-time-domain-authority-and-evaluated-at',
        orderedEventDigests: 'exact-order-count-and-final-head-bound',
        segmentLastOccurredAtBinding: 'host-derived-final-event-and-exact-successor-anchor-bound',
        canonicalDigestPattern: '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$',
        nullability: 'explicit-initial-versus-successor-fail-closed',
        observedAtBinding: 'exact-anchor-evaluated-at',
        eventPayloadStored: false,
        directOrEffectiveApiRoleAccess: 'expected-none-unverified',
        postgrestExposedSchemaInventory:
          'expected-not-exposed-unverified-until-trusted-post-apply-receipt',
        timestampProjection: 'trusted-host-zero-pad-to-nine-fractional-digits-without-rounding',
        hostCasWriterEmitted: false,
        telemetryDrainEmitted: false,
        acceptedReceipt: false
      }
    },
    limits: SUPABASE_OBSERVABILITY_LIMITS_V2,
    artifacts: SUPABASE_OBSERVABILITY_ARTIFACT_PATHS_V2,
    blockers: [
      'trusted-host-observation-runner-not-implemented',
      'schedule-and-restart-recovery-not-implemented',
      'current-source-ledger-baseline-required',
      'provider-authority-and-project-binding-required',
      'single-snapshot-inspection-receipt-required',
      'operational-event-sink-schema-not-applied',
      'operational-event-sink-postgrest-exposed-schema-inventory-required',
      'operational-event-sink-host-cas-writer-not-implemented',
      'operational-event-sink-post-apply-receipt-not-implemented',
      'telemetry-redaction-and-cardinality-gates-not-implemented',
      'retention-export-and-deletion-policy-not-configured',
      'alert-delivery-and-acknowledgement-not-implemented',
      'live-drift-and-observability-tests-required'
    ],
    requiredManualChecks: [
      'bind-current-source-ledger-schema-digest',
      'review-provider-project-and-organization-authority',
      'verify-no-application-row-or-secret-observation',
      'verify-failure-outcome-and-missed-schedule-recovery',
      'verify-audit-retention-export-and-access-control',
      'verify-operational-event-sink-owner-columns-constraints-indexes-comments-and-acls',
      'verify-operational-event-sink-schema-absent-from-postgrest-exposed-schemas',
      'verify-operational-event-sink-anchor-revision-head-batch-and-observed-at-bindings',
      'verify-cardinality-budget-and-sensitive-field-redaction',
      'verify-alert-routing-and-operator-acknowledgement'
    ]
  }
  const inspectionContract = {
    format: 'openpencil.supabase-observability-inspection-contract.v1',
    version: 1,
    providerId: 'supabase',
    applicationId: context.application.applicationId,
    reviewOnly: true,
    declaredDataModelDigest,
    declaredSubjectDigest,
    expectedSourceLedgerSchemaDigest: null,
    expectedSourceLedgerSchemaDigestAuthority: 'trusted-host-current-environment-only',
    inputAuthority: {
      transport: 'trusted-desktop-host-single-snapshot',
      compilerSuppliedSqlAccepted: false,
      callerSuppliedSqlAccepted: false,
      callerSuppliedUrlAccepted: false,
      callerSuppliedHeadersAccepted: false,
      callerSuppliedCredentialAccepted: false
    },
    observationBoundary: {
      applicationRows: 'forbidden',
      credentialMaterial: 'forbidden',
      queryParameters: 'forbidden',
      rawErrors: 'forbidden',
      catalogInventory: 'allowlisted-normalized-fields-only',
      eventBatchLimit: SUPABASE_OBSERVABILITY_LIMITS_V2.maximumObservationBatchEvents,
      eventByteLimit: SUPABASE_OBSERVABILITY_LIMITS_V2.maximumObservationEventBytes
    },
    outcome: {
      receiptFormat: 'openpencil.source-migration-drift-receipt',
      receiptVersion: 1,
      expectedSchemaDigestSource: 'trusted-host-current-source-ledger-environment',
      maximumReceiptBytes: SUPABASE_OBSERVABILITY_LIMITS_V2.maximumReceiptBytes,
      statuses: ['none', 'detected'],
      failures: ['failed', 'outcome-unknown'],
      sourceLedgerMutationAuthority: false,
      releaseAuthority: false
    },
    plan: normalizedPlan
  }
  const auditContract = {
    format: 'openpencil.supabase-observability-audit-contract.v1',
    version: 1,
    providerId: 'supabase',
    applicationId: context.application.applicationId,
    reviewOnly: true,
    appendOnlySinkProvisioned: false,
    telemetrySinkProvisioned: false,
    schemaCandidate: {
      emitted: true,
      path: SUPABASE_OBSERVABILITY_ARTIFACT_PATHS_V2.operationalEventSinkSchema,
      schemaName: sinkScope.schemaName,
      applicationScopeDigest: sinkScope.applicationScopeDigest,
      applicationObjectKey: sinkScope.applicationObjectKey,
      reviewOnly: true,
      databaseApplied: false,
      evidenceStatus: 'expected-unverified-until-trusted-post-apply-receipt',
      eventPayloadStored: false,
      hostCasWriterEmitted: false,
      networkTransportEmitted: false,
      credentialAuthorityCreated: false,
      telemetryDrainEmitted: false,
      expectedPostgrestExposure: 'not-exposed',
      postgrestExposureVerified: false,
      applyAuthorityCreated: false,
      verifyAuthorityCreated: false,
      releaseAuthorityCreated: false
    },
    eventEnvelope: {
      format: BACKEND_OPERATIONAL_EVENT_FORMAT,
      version: BACKEND_OPERATIONAL_EVENT_VERSION,
      exactFields: BACKEND_OPERATIONAL_EVENT_FIELDS,
      maximumSegmentEvents: BACKEND_OPERATIONAL_EVENT_MAX_SEGMENT_EVENTS,
      trustedAnchorFormat: BACKEND_OPERATIONAL_EVENT_ANCHOR_FORMAT,
      appendAuthorityFormat: BACKEND_OPERATIONAL_APPEND_AUTHORITY_FORMAT,
      hostAuthenticatedAnchorRequired: true,
      atomicHeadCasRequired: true
    },
    sinkEnvelope: {
      batchFormat: BACKEND_OPERATIONAL_EVENT_SINK_BATCH_FORMAT,
      proposalFormat: BACKEND_OPERATIONAL_EVENT_SINK_CAS_PROPOSAL_FORMAT,
      version: BACKEND_OPERATIONAL_EVENT_SINK_VERSION,
      maximumRevision: BACKEND_OPERATIONAL_EVENT_SINK_MAX_REVISION,
      exactBindings: [
        'trusted-anchor',
        'expected-revision-and-head',
        'next-revision-and-head',
        'segment-prior-and-head',
        'segment-last-occurred-at-and-successor-prior-time',
        'ordered-event-digests-and-count',
        'batch-digest',
        'observed-at',
        'provider-environment-authority'
      ],
      canonicalDigestPattern: '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$',
      timestampPattern:
        '^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9][.][0-9]{9}Z$',
      timestampProjection: 'trusted-host-zero-pad-to-nine-fractional-digits-without-rounding',
      explicitNullSemantics: 'initial-null-successor-non-null',
      proposalAndBatchAuthorityClaims: 'fixed-false',
      eventPayloadStored: false
    },
    forbiddenEventFields: [
      'accessToken',
      'authorization',
      'credential',
      'databasePassword',
      'rawError',
      'rawSql',
      'refreshToken',
      'rowData',
      'secret'
    ],
    integrity: {
      canonicalEncoding: BACKEND_OPERATIONAL_EVENT_CANONICAL_ENCODING,
      digest: 'sha256',
      previousEventDigestRequired: true,
      duplicateEventId: 'reject',
      clockRegression: 'reject',
      globalEventAndAttemptReservationRequired: true
    },
    retention: 'operator-policy-required',
    export: 'operator-controlled-required'
  }
  return Object.freeze([
    Object.freeze({
      path: SUPABASE_OBSERVABILITY_ARTIFACT_PATHS_V2.reviewManifest,
      kind: 'deployment-manifest' as const,
      mediaType: 'application/json',
      content: stableJSON(reviewManifest, '$.supabaseObservability.reviewManifest')
    }),
    Object.freeze({
      path: SUPABASE_OBSERVABILITY_ARTIFACT_PATHS_V2.inspectionContract,
      kind: 'deployment-manifest' as const,
      mediaType: 'application/json',
      content: stableJSON(inspectionContract, '$.supabaseObservability.inspectionContract')
    }),
    Object.freeze({
      path: SUPABASE_OBSERVABILITY_ARTIFACT_PATHS_V2.auditContract,
      kind: 'deployment-manifest' as const,
      mediaType: 'application/json',
      content: stableJSON(auditContract, '$.supabaseObservability.auditContract')
    }),
    Object.freeze({
      path: SUPABASE_OBSERVABILITY_ARTIFACT_PATHS_V2.operationalEventSinkSchema,
      kind: 'migration-plan' as const,
      mediaType: 'application/sql; charset=utf-8',
      content: emitSupabaseOperationalEventSinkReviewSQLV2(context.application.applicationId)
    })
  ])
}

export function emitSupabaseObservabilityAutomationArtifactsV2(
  context: BackendProviderAdapterContextV2,
  plan: JSONValue
): readonly BackendArtifactSourceV2[] {
  if (
    digestCanonicalBackendValue(plan, '$.supabaseObservability.receivedAutomationPlan') !==
    digestCanonicalBackendValue(
      createSupabaseObservabilityAutomationBridgePlanV2(context),
      '$.supabaseObservability.expectedAutomationPlan'
    )
  ) {
    throw new TypeError(
      'Supabase observability automation plan does not match normalized application IR.'
    )
  }
  if (!hasSupabaseObservabilityAutomationIntentV2(context)) return Object.freeze([])
  const automationContext = supabaseObservabilityAutomationContextV2(context)
  return emitSupabaseAutomationArtifactsV2(
    automationContext,
    createSupabaseAutomationsPlanV2(automationContext)
  )
}
