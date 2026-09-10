import { canonicalBackendValue, digestCanonicalBackendValue } from '#compiler/backend/canonical'
import type {
  BackendArtifactSourceV2,
  BackendProviderAdapterContextV2
} from '#compiler/backend/v2/contracts'

import type { JSONValue } from '@open-pencil/scene-graph/primitives'

import { supabaseAutomationIdempotencyLedgerSchemaNameV2 } from './idempotency-ledger-sql'
import {
  createSupabaseAutomationsPlanV2,
  resolvedSupabaseAutomationsV2,
  SUPABASE_AUTOMATION_ARTIFACT_PATHS_V2,
  SUPABASE_AUTOMATION_LIMITS_V2
} from './index'
import { emitSupabaseAutomationsReviewSQLV2 } from './sql'
import { supabaseAutomationTransactionalOutboxSchemaNameV2 } from './transactional-outbox-sql'

function stableJSON(value: unknown, path: string): string {
  return `${JSON.stringify(canonicalBackendValue(value, path), null, 2)}\n`
}

function assertExpectedPlan(context: BackendProviderAdapterContextV2, plan: JSONValue): void {
  if (
    digestCanonicalBackendValue(plan, '$.supabaseAutomations.receivedPlan') !==
    digestCanonicalBackendValue(
      createSupabaseAutomationsPlanV2(context),
      '$.supabaseAutomations.expectedPlan'
    )
  ) {
    throw new TypeError('Supabase automation plan does not match normalized application IR.')
  }
}

export function emitSupabaseAutomationArtifactsV2(
  context: BackendProviderAdapterContextV2,
  plan: JSONValue
): readonly BackendArtifactSourceV2[] {
  assertExpectedPlan(context, plan)
  const resolved = resolvedSupabaseAutomationsV2(context.application)
  const idempotencyLedgerRequired = resolved.automations.length > 0
  const idempotencyLedgerSchemaName = idempotencyLedgerRequired
    ? supabaseAutomationIdempotencyLedgerSchemaNameV2(resolved.applicationObjectKey)
    : null
  const transactionalOutboxSchemaName = idempotencyLedgerRequired
    ? supabaseAutomationTransactionalOutboxSchemaNameV2(resolved.applicationObjectKey)
    : null
  const reviewManifest = {
    format: 'openpencil.supabase-automations-review.v1',
    version: 1,
    providerId: 'supabase',
    applicationId: context.application.applicationId,
    reviewOnly: true,
    applyAllowed: false,
    deployAllowed: false,
    releaseReady: false,
    source: 'normalized-backend-v2-ir',
    expectedPostApplyState: {
      evidenceStatus: 'unverified-until-trusted-post-apply-receipt',
      acceptedReceipt: false,
      queueExposure: {
        dataApi: 'not-exposed',
        pgmqPublicSchema: 'not-required',
        publicRoleTableAccess: 'none',
        anonRoleTableAccess: 'none',
        authenticatedRoleTableAccess: 'none',
        serviceRoleTableAccess: 'none',
        workerAccess: 'dedicated-database-role-only'
      },
      queueShape: {
        durability: 'logged',
        partitioning: 'none',
        ownershipAndConfigurationMarker: 'exact',
        declaredRuntimeConfiguration: 'marker-only-not-database-enforced',
        completeAclInventory: 'unverified'
      },
      cron: {
        timezone: 'effective-zero-offset-UTC',
        username: 'current-user',
        database: 'current-database',
        connectionTarget: 'local-current-database-server',
        scheduleCommandAndActiveState: 'exact'
      },
      idempotencyLedger: {
        required: idempotencyLedgerRequired,
        schemaCandidateEmitted: idempotencyLedgerRequired,
        schemaName: idempotencyLedgerSchemaName,
        databaseApplied: false,
        evidenceStatus: idempotencyLedgerRequired
          ? 'expected-unverified-until-trusted-post-apply-receipt'
          : 'not-required',
        existingObjectPolicy: 'reject',
        ownership: 'expected-dedicated-current-user-unverified',
        tableShape: 'expected-logged-nonpartitioned-heap-unverified',
        commentsConstraintsAndIndexes: 'exact-catalog-postcondition',
        businessKey: ['automation_id', 'idempotency_key_digest'],
        initialRevision: 0,
        exactHeadCasFields: ['current_revision', 'current_head_digest'],
        revisionChain: 'expected-append-only-self-linked-unverified',
        stableRevisionBindings: [
          'event_id',
          'operation_id',
          'causation_id',
          'causation_hop',
          'retention_expires_at'
        ],
        recordedAtMonotonic: 'expected-unverified',
        revisionMutationGuard: 'expected-unverified',
        outcomeUnknownRetry: 'forbidden-until-reconciliation',
        retryEligibility: 'known-not-dispatched-then-bounded-policy-review',
        retentionTimestamp: 'retention_expires_at',
        retentionSemantics: 'earliest-review-boundary-not-discard-authority',
        declaredRetentionAndCausationPolicy: 'host-cas-writer-and-receipt-required',
        directOrEffectiveApiRoleAccess: 'expected-none-unverified',
        hostCasWriterEmitted: false,
        cleanupRunnerEmitted: false,
        transactionalOutboxIncluded: idempotencyLedgerRequired,
        acceptedReceipt: false
      },
      transactionalOutbox: {
        required: idempotencyLedgerRequired,
        schemaCandidateEmitted: idempotencyLedgerRequired,
        schemaName: transactionalOutboxSchemaName,
        databaseApplied: false,
        evidenceStatus: idempotencyLedgerRequired
          ? 'expected-unverified-until-trusted-post-apply-receipt'
          : 'not-required',
        existingObjectPolicy: 'reject',
        exposure: 'private-schema-api-role-access-revoked-postgrest-inventory-unverified',
        ownership: 'expected-dedicated-current-user-unverified',
        tableShape: 'expected-logged-nonpartitioned-heap-unverified',
        commentsConstraintsAndIndexes: 'exact-catalog-postcondition',
        businessKey: ['outbox_id'],
        immutableBindings: [
          'business_transaction_id',
          'business_transaction_digest',
          'entity_id',
          'row_id_digest',
          'row_version',
          'event_id',
          'event_digest',
          'queue_id',
          'message_envelope_digest',
          'idempotency_key_digest',
          'message_enqueued_at',
          'message_retention_deadline'
        ],
        initialRevision: 0,
        initialState: 'pending',
        exactHeadCasFields: ['current_revision', 'current_head_digest'],
        exactHeadSnapshotFields: [
          'current_business_transaction_digest',
          'current_message_enqueued_at',
          'current_message_retention_deadline',
          'current_publish_attempt_ids',
          'current_publish_attempt_id',
          'current_publish_attempt_ordinal',
          'current_state',
          'current_recorded_at',
          'current_transition_evidence_digest',
          'current_publish_confirmation_evidence_digest',
          'current_known_not_published_evidence_digest',
          'current_delivery_evidence_digest',
          'current_reconciliation_evidence_digest'
        ],
        revisionChain: 'expected-append-only-self-linked-unverified',
        stateMachine: [
          'pending',
          'pre-publish-outcome-unknown',
          'outcome-unknown',
          'known-not-published',
          'published',
          'delivered'
        ],
        publishAttempts: 'ordered-unique-bounded-20',
        publishAttemptHistoryBinding: 'exact-array-self-fk-and-head-revision-fk',
        recordedAtPrecision: 'supabase-fixed-nine-utc-text-projection-not-source-byte-preservation',
        messageRetentionDeadline:
          'immutable-supabase-fixed-nine-utc-text-projection-not-source-byte-preservation',
        timestampProjectionBinding: 'host-cas-writer-and-receipt-required',
        prePublishRetentionBoundary: 'recorded-at-strictly-before-message-retention-deadline',
        outcomeUnknownRetry: 'forbidden-until-reconciliation',
        businessTransactionAtomicity: 'host-cas-writer-and-receipt-required',
        recordDigestBinding: 'host-cas-writer-and-receipt-required',
        directOrEffectiveApiRoleAccess: 'expected-none-unverified',
        hostCasWriterEmitted: false,
        enqueueDmlEmitted: false,
        publishDmlEmitted: false,
        ackDmlEmitted: false,
        cleanupRunnerEmitted: false,
        workerEmitted: false,
        acceptedReceipt: false
      }
    },
    retirement: {
      automatic: false,
      explicitApprovalRequired: true,
      inspectedInventoryRequired: true,
      inspectedInventoryVerified: false
    },
    extensions: {
      bootstrapAllowedByArtifact: false,
      inventoryVerification: 'trusted-post-apply-receipt-required',
      pgmq: 'separate-reviewed-bootstrap-prerequisite',
      pgCron: resolved.automations.some((entry) => entry.trigger.kind === 'schedule')
        ? 'separate-reviewed-bootstrap-prerequisite'
        : 'not-required'
    },
    limits: SUPABASE_AUTOMATION_LIMITS_V2,
    artifacts: SUPABASE_AUTOMATION_ARTIFACT_PATHS_V2,
    blockers: [
      'trusted-source-migration-admission-required',
      'provider-version-and-extension-drift-inspection-required',
      'dedicated-database-role-and-credential-lease-required',
      'bounded-queue-worker-not-implemented',
      ...(idempotencyLedgerRequired
        ? [
            'idempotency-cas-ledger-not-applied',
            'idempotency-host-cas-writer-not-implemented',
            'idempotency-ledger-post-apply-receipt-not-implemented',
            'idempotency-ledger-retention-cleanup-not-implemented',
            'idempotency-declared-retention-and-causation-policy-binding-required',
            'transactional-outbox-schema-not-applied',
            'transactional-outbox-host-cas-writer-not-implemented',
            'transactional-outbox-business-transaction-binding-required',
            'transactional-outbox-timestamp-projection-binding-required',
            'transactional-outbox-post-apply-receipt-not-implemented',
            'transactional-outbox-postgrest-exposure-inventory-required'
          ]
        : []),
      'retry-and-dead-letter-runner-not-implemented',
      'webhook-hmac-credential-purpose-proof-required',
      'endpoint-authority-and-credential-generation-binding-required',
      'webhook-dns-and-redirect-policy-runner-not-implemented',
      'runtime-health-check-and-deployment-receipt-required',
      'queue-retention-and-archive-reconciliation-not-implemented',
      'extension-version-namespace-membership-inspection-receipt-required',
      'cron-connection-target-inspection-receipt-required',
      'queue-complete-acl-and-pgmq-data-api-exposure-receipt-required',
      'queue-cron-post-apply-receipt-not-implemented',
      'generated-automation-object-retirement-requires-explicit-approval'
    ],
    requiredManualChecks: [
      'review-and-source-control-sql',
      'confirm-pgmq-and-pg-cron-supported-versions',
      'confirm-no-pgmq-public-data-api-exposure',
      'bootstrap-extensions-in-a-separate-privileged-review',
      'bind-extension-version-namespace-and-object-membership-in-receipt',
      'inspect-existing-and-retired-queue-and-cron-inventory',
      'verify-queue-shape-markers-and-effective-known-role-acls',
      'verify-complete-queue-acl-and-postgrest-exposed-schema-inventory',
      'verify-cron-timezone-owner-database-schedule-command-and-active-state',
      'verify-cron-local-node-and-port-target',
      'verify-at-least-once-retry-and-idempotency-under-worker-crash',
      ...(idempotencyLedgerRequired
        ? [
            'verify-idempotency-ledger-owner-columns-constraints-indexes-comments-and-acls',
            'verify-idempotency-head-cas-revision-chain-and-outcome-unknown-fence',
            'verify-idempotency-declared-retention-and-causation-policy-binding',
            'verify-idempotency-ledger-retention-cleanup-before-enabling-worker',
            'verify-transactional-outbox-owner-columns-constraints-indexes-comments-and-acls',
            'verify-transactional-outbox-transaction-row-event-message-and-attempt-bindings',
            'verify-transactional-outbox-head-cas-state-machine-and-evidence-fences',
            'verify-transactional-outbox-message-retention-and-pre-publish-nanosecond-boundary',
            'verify-transactional-outbox-timestamp-projection-preserves-instant-and-ordering',
            'verify-transactional-outbox-postgrest-exposed-schema-inventory'
          ]
        : []),
      'verify-dead-letter-archive-and-retention',
      'verify-webhook-private-network-and-redirect-rejection',
      'verify-endpoint-authority-digest-and-credential-generation-binding',
      'verify-inbound-and-outbound-hmac-replay-protection'
    ]
  }
  const workerContract = {
    format: 'openpencil.supabase-automation-worker-contract.v1',
    version: 1,
    providerId: 'supabase',
    applicationId: context.application.applicationId,
    reviewOnly: true,
    executableRuntimeEmitted: false,
    operationCredentialIssued: false,
    networkAuthorityCreated: false,
    databaseAuthorityCreated: false,
    queueRead: 'pgmq.read-with-visibility-timeout',
    successDisposition: 'pgmq.archive-after-idempotency-commit',
    failureDisposition: 'visibility-timeout-then-bounded-retry',
    poisonDisposition: 'archive-to-declared-dead-letter-queue',
    idempotencyCommit: 'contract-only-host-cas-writer-not-emitted',
    idempotencyLedger: {
      required: idempotencyLedgerRequired,
      schemaCandidateEmitted: idempotencyLedgerRequired,
      schemaName: idempotencyLedgerSchemaName,
      databaseApplied: false,
      hostCasWriterEmitted: false,
      trustedReceiptAccepted: false,
      persistenceAuthorityCreated: false,
      retryFenceAuthorityCreated: false,
      cleanupRunnerEmitted: false,
      transactionalOutboxIncluded: idempotencyLedgerRequired
    },
    transactionalOutbox: {
      required: idempotencyLedgerRequired,
      schemaCandidateEmitted: idempotencyLedgerRequired,
      schemaName: transactionalOutboxSchemaName,
      databaseApplied: false,
      hostCasWriterEmitted: false,
      trustedReceiptAccepted: false,
      persistenceAuthorityCreated: false,
      dispatchAuthorityCreated: false,
      ackAuthorityCreated: false,
      cleanupRunnerEmitted: false,
      workerEmitted: false
    },
    outboundWebhookPolicy: {
      compilerSuppliedEndpointAccepted: false,
      endpointAuthority: {
        requiredHostEnvelope: 'canonical-https-endpoint-generation-and-purpose',
        replacement: 'new-generation-and-release-review-required',
        authorityCreated: false
      },
      redirects: 'forbidden',
      addressResolution: 'revalidate-every-hop',
      privateRanges: 'forbidden',
      body: 'canonical-json-utf8',
      signature: 'hmac-sha256-raw-body-v1'
    },
    ...resolved
  }
  return Object.freeze([
    Object.freeze({
      path: SUPABASE_AUTOMATION_ARTIFACT_PATHS_V2.reviewManifest,
      kind: 'deployment-manifest' as const,
      mediaType: 'application/json',
      content: stableJSON(reviewManifest, '$.supabaseAutomations.reviewManifest')
    }),
    Object.freeze({
      path: SUPABASE_AUTOMATION_ARTIFACT_PATHS_V2.sql,
      kind: 'migration-plan' as const,
      mediaType: 'application/sql; charset=utf-8',
      content: emitSupabaseAutomationsReviewSQLV2(context.application)
    }),
    Object.freeze({
      path: SUPABASE_AUTOMATION_ARTIFACT_PATHS_V2.workerContract,
      kind: 'server-runtime' as const,
      mediaType: 'application/json',
      content: stableJSON(workerContract, '$.supabaseAutomations.workerContract')
    })
  ])
}
