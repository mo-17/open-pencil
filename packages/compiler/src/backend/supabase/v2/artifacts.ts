import { canonicalBackendValue, digestCanonicalBackendValue } from '#compiler/backend/canonical'
import type {
  BackendArtifactSourceV2,
  BackendProviderAdapterContextV2
} from '#compiler/backend/v2/contracts'

import type { JSONValue } from '@open-pencil/scene-graph/primitives'

import { emitSupabasePrivateRealtimeClientV2 } from './client'
import { SUPABASE_COMMON_ARTIFACT_PATHS_V2 } from './common'
import {
  createSupabasePrivateRealtimePlanV2,
  resolvedSupabasePrivateRealtimeSubscriptionsV2,
  SUPABASE_PRIVATE_REALTIME_ARTIFACT_PATHS_V2
} from './realtime'
import { emitSupabasePrivateRealtimeSQLV2 } from './sql'

function stableJSON(value: unknown, path: string): string {
  return `${JSON.stringify(canonicalBackendValue(value, path), null, 2)}\n`
}

function assertExpectedPlan(context: BackendProviderAdapterContextV2, plan: JSONValue): void {
  const expected = createSupabasePrivateRealtimePlanV2(context)
  if (
    digestCanonicalBackendValue(plan, '$.supabasePrivateRealtime.receivedPlan') !==
    digestCanonicalBackendValue(expected, '$.supabasePrivateRealtime.expectedPlan')
  ) {
    throw new TypeError('Supabase private Realtime plan does not match normalized application IR.')
  }
}

export function emitSupabasePrivateRealtimeArtifactsV2(
  context: BackendProviderAdapterContextV2,
  plan: JSONValue
): readonly BackendArtifactSourceV2[] {
  assertExpectedPlan(context, plan)
  const subscriptions = resolvedSupabasePrivateRealtimeSubscriptionsV2(context.application)
  const reviewManifest = {
    format: 'openpencil.supabase-private-realtime-review.v1',
    version: 1,
    providerId: 'supabase',
    applicationId: context.application.applicationId,
    reviewOnly: true,
    applyAllowed: false,
    deployAllowed: false,
    releaseReady: false,
    capabilityCoverage: {
      'auth.identity': 'host-auth-session-contract-planned',
      'events.data-change': 'minimal-invalidation-trigger-review-artifacts-emitted',
      'migrations.schema': 'target-model-and-inspection-gated-review-artifacts-emitted',
      'policy.row-level': 'owner-rls-review-artifacts-emitted',
      'realtime.subscribe': 'review-artifacts-emitted'
    },
    realtimeSchemaMutation: 'forbidden',
    managedObjectLifecycle: {
      repeatApplyAllowed: false,
      priorManagedObjectDrift: 'hard-blocked',
      declarationChange: 'reviewed-cleanup-or-delta-migration-required'
    },
    privateSchemaAuthority: {
      requiredOwner: 'current-trusted-migration-role',
      mismatchedOwner: 'hard-blocked'
    },
    dashboard: { allowPublicAccess: false },
    artifacts: SUPABASE_PRIVATE_REALTIME_ARTIFACT_PATHS_V2,
    commonArtifacts: SUPABASE_COMMON_ARTIFACT_PATHS_V2,
    subscriptions,
    requiredManualChecks: [
      'review-and-source-control-sql',
      'disable-realtime-allow-public-access',
      'inspect-existing-realtime-messages-policies-for-broad-access',
      'apply-through-trusted-release-authority',
      'prove-p1-managed-schema-applied-from-source-ledger',
      'review-managed-object-cleanup-on-declaration-change',
      'retire-prior-application-id-managed-objects',
      'verify-user-a-user-b-topic-isolation',
      'verify-jwt-refresh-and-reconnect',
      'verify-host-owned-auth-refresh-and-logout',
      'verify-trigger-delivery-and-disposal'
    ]
  }
  const databasePrerequisites = {
    format: 'openpencil.supabase-private-realtime-prerequisites.v1',
    version: 1,
    providerId: 'supabase',
    targetModelArtifactEmitted: true,
    migrationReviewArtifactEmitted: true,
    ownerRlsReviewArtifactsEmitted: true,
    schemaApplyAllowed: false,
    privateSupportSchemaSqlEmitted: true,
    source: 'normalized-backend-v2-ir',
    prerequisite: 'p1-managed-schema-and-owner-select-policy',
    requiredEvidence: 'trusted-p1-source-ledger-applied-schema-receipt',
    reviewArtifacts: SUPABASE_COMMON_ARTIFACT_PATHS_V2,
    entities: subscriptions.map((entry) => ({
      entityId: entry.entityId,
      table: entry.table,
      ownerFieldId: entry.ownerFieldId,
      ownerField: entry.ownerField,
      primaryKey: entry.primaryKey,
      policyId: entry.policyId
    }))
  }
  return Object.freeze([
    Object.freeze({
      path: SUPABASE_PRIVATE_REALTIME_ARTIFACT_PATHS_V2.client,
      kind: 'client-config' as const,
      mediaType: 'text/typescript; charset=utf-8',
      content: emitSupabasePrivateRealtimeClientV2(context.application)
    }),
    Object.freeze({
      path: SUPABASE_PRIVATE_REALTIME_ARTIFACT_PATHS_V2.databasePrerequisites,
      kind: 'deployment-manifest' as const,
      mediaType: 'application/json',
      content: stableJSON(databasePrerequisites, '$.supabasePrivateRealtime.prerequisites')
    }),
    Object.freeze({
      path: SUPABASE_PRIVATE_REALTIME_ARTIFACT_PATHS_V2.reviewManifest,
      kind: 'deployment-manifest' as const,
      mediaType: 'application/json',
      content: stableJSON(reviewManifest, '$.supabasePrivateRealtime.reviewManifest')
    }),
    Object.freeze({
      path: SUPABASE_PRIVATE_REALTIME_ARTIFACT_PATHS_V2.sql,
      kind: 'security-policy' as const,
      mediaType: 'application/sql; charset=utf-8',
      content: emitSupabasePrivateRealtimeSQLV2(context.application)
    })
  ])
}
