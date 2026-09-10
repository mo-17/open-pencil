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
  SUPABASE_BACKEND_PROVIDER_CAPABILITIES_V2,
  SUPABASE_BACKEND_PROVIDER_OUTPUTS_V2
} from '../descriptor'

export const SUPABASE_AUTOMATION_PROVIDER_CONTRIBUTION_ID_V2 =
  'supabase.backend.automations.v2' as const
export const SUPABASE_AUTOMATION_PROVIDER_ADAPTER_ID_V2 =
  'open-pencil.backend.supabase.automations.v2' as const
export const SUPABASE_AUTOMATION_PROVIDER_ADAPTER_VERSION_V2 = '2.4.0' as const

export const SUPABASE_AUTOMATION_CAPABILITIES_V2 = Object.freeze([
  'jobs.schedule',
  'queues.consume',
  'queues.publish',
  'webhooks.deliver',
  'webhooks.receive',
  'workflows.durable-execution',
  'workflows.idempotency',
  'workflows.retry'
] as const satisfies readonly BackendCapabilityV2[])

/** Required semantic bridge for system-owned handlers; it issues no runtime authority. */
export const SUPABASE_AUTOMATION_SERVER_CAPABILITIES_V2 = Object.freeze([
  'server.functions'
] as const satisfies readonly BackendCapabilityV2[])

export const SUPABASE_AUTOMATION_PROVIDER_CAPABILITIES_V2 = Object.freeze([
  ...SUPABASE_BACKEND_PROVIDER_CAPABILITIES_V2,
  'jobs.schedule',
  'queues.consume',
  'queues.publish',
  'server.functions',
  'webhooks.deliver',
  'webhooks.receive',
  'workflows.durable-execution',
  'workflows.idempotency',
  'workflows.retry'
] as const satisfies readonly BackendCapabilityV2[])

export const SUPABASE_AUTOMATION_PROVIDER_OUTPUTS_V2 = Object.freeze([
  ...SUPABASE_BACKEND_PROVIDER_OUTPUTS_V2
] as const satisfies readonly BackendProviderOutputKindV2[])

/** Isolated review-only candidate; intentionally absent from every production registry. */
export const SUPABASE_AUTOMATION_PROVIDER_DESCRIPTOR_V2 = Object.freeze({
  pluginId: SUPABASE_BACKEND_PROVIDER_PLUGIN_ID,
  contributionId: SUPABASE_AUTOMATION_PROVIDER_CONTRIBUTION_ID_V2,
  providerId: SUPABASE_BACKEND_PROVIDER_ID,
  adapterId: SUPABASE_AUTOMATION_PROVIDER_ADAPTER_ID_V2,
  adapterVersion: SUPABASE_AUTOMATION_PROVIDER_ADAPTER_VERSION_V2,
  contractVersion: 2,
  supportedModelVersions: Object.freeze([2] as const),
  capabilities: SUPABASE_AUTOMATION_PROVIDER_CAPABILITIES_V2,
  outputs: SUPABASE_AUTOMATION_PROVIDER_OUTPUTS_V2
}) satisfies BackendProviderDescriptorV2
