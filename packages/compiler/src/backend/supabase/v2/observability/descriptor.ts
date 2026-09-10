import {
  SUPABASE_BACKEND_PROVIDER_ID,
  SUPABASE_BACKEND_PROVIDER_PLUGIN_ID
} from '#compiler/backend/supabase/descriptor'
import type {
  BackendProviderDescriptorV2,
  BackendProviderOutputKindV2
} from '#compiler/backend/v2/contracts'

import type { BackendCapabilityV2 } from '@open-pencil/lowcode/backend'

import {
  SUPABASE_AUTOMATION_PROVIDER_CAPABILITIES_V2,
  SUPABASE_AUTOMATION_PROVIDER_OUTPUTS_V2
} from '../automation/descriptor'

export const SUPABASE_OBSERVABILITY_PROVIDER_CONTRIBUTION_ID_V2 =
  'supabase.backend.observability.v2' as const
export const SUPABASE_OBSERVABILITY_PROVIDER_ADAPTER_ID_V2 =
  'open-pencil.backend.supabase.observability.v2' as const
export const SUPABASE_OBSERVABILITY_PROVIDER_ADAPTER_VERSION_V2 = '2.5.0' as const

export const SUPABASE_OBSERVABILITY_CAPABILITIES_V2 = Object.freeze([
  'audit.events',
  'drift.detect',
  'observability.logs',
  'observability.metrics',
  'observability.traces'
] as const satisfies readonly BackendCapabilityV2[])

/** The drift schedule is modeled, but this candidate emits no scheduler or worker. */
export const SUPABASE_OBSERVABILITY_PROVIDER_CAPABILITIES_V2 = Object.freeze([
  ...SUPABASE_AUTOMATION_PROVIDER_CAPABILITIES_V2,
  ...SUPABASE_OBSERVABILITY_CAPABILITIES_V2
] as const satisfies readonly BackendCapabilityV2[])

export const SUPABASE_OBSERVABILITY_PROVIDER_OUTPUTS_V2 = Object.freeze([
  ...SUPABASE_AUTOMATION_PROVIDER_OUTPUTS_V2
] as const satisfies readonly BackendProviderOutputKindV2[])

/** Isolated read-only candidate; intentionally absent from every production registry. */
export const SUPABASE_OBSERVABILITY_PROVIDER_DESCRIPTOR_V2 = Object.freeze({
  pluginId: SUPABASE_BACKEND_PROVIDER_PLUGIN_ID,
  contributionId: SUPABASE_OBSERVABILITY_PROVIDER_CONTRIBUTION_ID_V2,
  providerId: SUPABASE_BACKEND_PROVIDER_ID,
  adapterId: SUPABASE_OBSERVABILITY_PROVIDER_ADAPTER_ID_V2,
  adapterVersion: SUPABASE_OBSERVABILITY_PROVIDER_ADAPTER_VERSION_V2,
  contractVersion: 2,
  supportedModelVersions: Object.freeze([2] as const),
  capabilities: SUPABASE_OBSERVABILITY_PROVIDER_CAPABILITIES_V2,
  outputs: SUPABASE_OBSERVABILITY_PROVIDER_OUTPUTS_V2
}) satisfies BackendProviderDescriptorV2
