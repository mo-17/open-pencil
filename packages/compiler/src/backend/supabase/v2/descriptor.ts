import type {
  BackendProviderDescriptorV2,
  BackendProviderOutputKindV2
} from '#compiler/backend/v2/contracts'

import type { BackendCapabilityV2 } from '@open-pencil/lowcode/backend'

import { SUPABASE_BACKEND_PROVIDER_ID, SUPABASE_BACKEND_PROVIDER_PLUGIN_ID } from '../descriptor'

export const SUPABASE_BACKEND_PROVIDER_CONTRIBUTION_ID_V2 = 'supabase.backend.v2' as const
export const SUPABASE_BACKEND_PROVIDER_ADAPTER_ID_V2 = 'open-pencil.backend.supabase.v2' as const
export const SUPABASE_BACKEND_PROVIDER_ADAPTER_VERSION_V2 = '2.3.0' as const

/** Shared schema capability for the isolated Realtime, Atomic, and Backfill review slices. */
export const SUPABASE_AUTH_CAPABILITIES_V2 = Object.freeze([
  'auth.identity'
] as const satisfies readonly BackendCapabilityV2[])

/** This slot plans the RPC's data steps; P1 direct owner CRUD remains separately available. */
export const SUPABASE_ATOMIC_DATA_CAPABILITIES_V2 = Object.freeze([
  'data.read',
  'data.write'
] as const satisfies readonly BackendCapabilityV2[])

export const SUPABASE_MIGRATION_CAPABILITIES_V2 = Object.freeze([
  'migrations.schema'
] as const satisfies readonly BackendCapabilityV2[])

export const SUPABASE_SECURITY_POLICY_CAPABILITIES_V2 = Object.freeze([
  'policy.row-level'
] as const satisfies readonly BackendCapabilityV2[])

export const SUPABASE_PRIVATE_REALTIME_CAPABILITIES_V2 = Object.freeze([
  'events.data-change',
  'realtime.subscribe'
] as const satisfies readonly BackendCapabilityV2[])

export const SUPABASE_ATOMIC_TRANSACTION_CAPABILITIES_V2 = Object.freeze([
  'transactions.atomic'
] as const satisfies readonly BackendCapabilityV2[])

export const SUPABASE_BACKFILL_CAPABILITIES_V2 = Object.freeze([
  'migrations.backfill',
  'migrations.data'
] as const satisfies readonly BackendCapabilityV2[])

export const SUPABASE_BACKEND_PROVIDER_CAPABILITIES_V2 = Object.freeze([
  'auth.identity',
  'data.read',
  'data.write',
  'events.data-change',
  'migrations.backfill',
  'migrations.data',
  'migrations.schema',
  'policy.row-level',
  'realtime.subscribe',
  'transactions.atomic'
] as const satisfies readonly BackendCapabilityV2[])

export const SUPABASE_BACKEND_PROVIDER_OUTPUTS_V2 = Object.freeze([
  'client-config',
  'database-schema',
  'deployment-manifest',
  'migration-plan',
  'security-policy',
  'server-runtime'
] as const satisfies readonly BackendProviderOutputKindV2[])

/** Candidate descriptor only; it is intentionally absent from the built-in provider registry. */
export const SUPABASE_BACKEND_PROVIDER_DESCRIPTOR_V2 = Object.freeze({
  pluginId: SUPABASE_BACKEND_PROVIDER_PLUGIN_ID,
  contributionId: SUPABASE_BACKEND_PROVIDER_CONTRIBUTION_ID_V2,
  providerId: SUPABASE_BACKEND_PROVIDER_ID,
  adapterId: SUPABASE_BACKEND_PROVIDER_ADAPTER_ID_V2,
  adapterVersion: SUPABASE_BACKEND_PROVIDER_ADAPTER_VERSION_V2,
  contractVersion: 2,
  supportedModelVersions: Object.freeze([2] as const),
  capabilities: SUPABASE_BACKEND_PROVIDER_CAPABILITIES_V2,
  outputs: SUPABASE_BACKEND_PROVIDER_OUTPUTS_V2
}) satisfies BackendProviderDescriptorV2
