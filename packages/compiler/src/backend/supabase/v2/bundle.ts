import type {
  BackendProviderAdapterV2,
  BackendProviderBundleV2
} from '#compiler/backend/v2/contracts'

import { emitSupabasePrivateRealtimeArtifactsV2 } from './artifacts'
import { createSupabaseBackfillPlanV2, validateSupabaseBackfillV2 } from './backfill'
import { emitSupabaseBackfillArtifactsV2 } from './backfill/artifacts'
import {
  createSupabaseAuthPlanV2,
  createSupabaseMigrationPlanV2,
  createSupabaseSecurityPlanV2,
  emitSupabaseMigrationArtifactsV2,
  emitSupabaseSecurityArtifactsV2,
  validateSupabaseCommonV2
} from './common'
import {
  SUPABASE_AUTH_CAPABILITIES_V2,
  SUPABASE_ATOMIC_DATA_CAPABILITIES_V2,
  SUPABASE_ATOMIC_TRANSACTION_CAPABILITIES_V2,
  SUPABASE_BACKFILL_CAPABILITIES_V2,
  SUPABASE_BACKEND_PROVIDER_DESCRIPTOR_V2,
  SUPABASE_MIGRATION_CAPABILITIES_V2,
  SUPABASE_PRIVATE_REALTIME_CAPABILITIES_V2,
  SUPABASE_SECURITY_POLICY_CAPABILITIES_V2
} from './descriptor'
import { createSupabasePrivateRealtimePlanV2, validateSupabasePrivateRealtimeV2 } from './realtime'
import {
  createSupabaseAtomicDataPlanV2,
  createSupabaseAtomicTransactionPlanV2,
  validateSupabaseAtomicDataBridgeV2,
  validateSupabaseAtomicTransactionV2
} from './transaction'
import { emitSupabaseAtomicTransactionArtifactsV2 } from './transaction/artifacts'

const SUPABASE_ATOMIC_DATA_ADAPTER_V2 = Object.freeze({
  capabilities: SUPABASE_ATOMIC_DATA_CAPABILITIES_V2,
  outputs: Object.freeze([]),
  validate: validateSupabaseAtomicDataBridgeV2,
  plan: createSupabaseAtomicDataPlanV2,
  emit: () => Object.freeze([])
}) satisfies BackendProviderAdapterV2

const SUPABASE_AUTH_ADAPTER_V2 = Object.freeze({
  capabilities: SUPABASE_AUTH_CAPABILITIES_V2,
  outputs: Object.freeze([]),
  plan: createSupabaseAuthPlanV2,
  emit: () => Object.freeze([])
}) satisfies BackendProviderAdapterV2

const SUPABASE_MIGRATIONS_ADAPTER_V2 = Object.freeze({
  capabilities: SUPABASE_MIGRATION_CAPABILITIES_V2,
  outputs: Object.freeze(['database-schema', 'migration-plan'] as const),
  plan: createSupabaseMigrationPlanV2,
  emit: emitSupabaseMigrationArtifactsV2
}) satisfies BackendProviderAdapterV2

const SUPABASE_SECURITY_POLICY_ADAPTER_V2 = Object.freeze({
  capabilities: SUPABASE_SECURITY_POLICY_CAPABILITIES_V2,
  outputs: Object.freeze(['security-policy'] as const),
  plan: createSupabaseSecurityPlanV2,
  emit: emitSupabaseSecurityArtifactsV2
}) satisfies BackendProviderAdapterV2

const SUPABASE_PRIVATE_REALTIME_ADAPTER_V2 = Object.freeze({
  capabilities: SUPABASE_PRIVATE_REALTIME_CAPABILITIES_V2,
  outputs: Object.freeze(['client-config', 'deployment-manifest', 'security-policy'] as const),
  validate: validateSupabasePrivateRealtimeV2,
  plan: createSupabasePrivateRealtimePlanV2,
  emit: emitSupabasePrivateRealtimeArtifactsV2
}) satisfies BackendProviderAdapterV2

const SUPABASE_ATOMIC_TRANSACTIONS_ADAPTER_V2 = Object.freeze({
  capabilities: SUPABASE_ATOMIC_TRANSACTION_CAPABILITIES_V2,
  outputs: Object.freeze(['client-config', 'deployment-manifest', 'server-runtime'] as const),
  validate: validateSupabaseAtomicTransactionV2,
  plan: createSupabaseAtomicTransactionPlanV2,
  emit: emitSupabaseAtomicTransactionArtifactsV2
}) satisfies BackendProviderAdapterV2

const SUPABASE_BACKFILL_ADAPTER_V2 = Object.freeze({
  capabilities: SUPABASE_BACKFILL_CAPABILITIES_V2,
  outputs: Object.freeze(['deployment-manifest', 'migration-plan', 'server-runtime'] as const),
  validate: validateSupabaseBackfillV2,
  plan: createSupabaseBackfillPlanV2,
  emit: emitSupabaseBackfillArtifactsV2
}) satisfies BackendProviderAdapterV2

/** Pure review-only candidate bundle; deliberately not included in the built-in V1 registry. */
export const SUPABASE_BACKEND_PROVIDER_BUNDLE_V2 = Object.freeze({
  descriptor: SUPABASE_BACKEND_PROVIDER_DESCRIPTOR_V2,
  data: SUPABASE_ATOMIC_DATA_ADAPTER_V2,
  auth: SUPABASE_AUTH_ADAPTER_V2,
  securityPolicy: SUPABASE_SECURITY_POLICY_ADAPTER_V2,
  migrations: SUPABASE_MIGRATIONS_ADAPTER_V2,
  realtime: SUPABASE_PRIVATE_REALTIME_ADAPTER_V2,
  transactions: SUPABASE_ATOMIC_TRANSACTIONS_ADAPTER_V2,
  dataMigrations: SUPABASE_BACKFILL_ADAPTER_V2,
  validate: validateSupabaseCommonV2
}) satisfies BackendProviderBundleV2
