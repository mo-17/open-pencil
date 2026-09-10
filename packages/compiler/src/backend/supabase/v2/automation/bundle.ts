import type {
  BackendProviderAdapterV2,
  BackendProviderBundleV2
} from '#compiler/backend/v2/contracts'

import { SUPABASE_BACKEND_PROVIDER_BUNDLE_V2 } from '../bundle'
import { validateSupabaseCommonV2 } from '../common'
import { emitSupabaseAutomationArtifactsV2 } from './artifacts'
import {
  SUPABASE_AUTOMATION_CAPABILITIES_V2,
  SUPABASE_AUTOMATION_PROVIDER_DESCRIPTOR_V2,
  SUPABASE_AUTOMATION_SERVER_CAPABILITIES_V2
} from './descriptor'
import {
  createSupabaseAutomationsPlanV2,
  createSupabaseAutomationServerBridgePlanV2,
  validateSupabaseAutomationsV2
} from './index'

const SUPABASE_AUTOMATIONS_ADAPTER_V2 = Object.freeze({
  capabilities: SUPABASE_AUTOMATION_CAPABILITIES_V2,
  outputs: Object.freeze(['deployment-manifest', 'migration-plan', 'server-runtime'] as const),
  validate: validateSupabaseAutomationsV2,
  plan: createSupabaseAutomationsPlanV2,
  emit: emitSupabaseAutomationArtifactsV2
}) satisfies BackendProviderAdapterV2

const SUPABASE_AUTOMATION_SERVER_ADAPTER_V2 = Object.freeze({
  capabilities: SUPABASE_AUTOMATION_SERVER_CAPABILITIES_V2,
  outputs: Object.freeze([]),
  plan: createSupabaseAutomationServerBridgePlanV2,
  emit: () => Object.freeze([])
}) satisfies BackendProviderAdapterV2

export const SUPABASE_AUTOMATION_PROVIDER_BUNDLE_V2 = Object.freeze({
  ...SUPABASE_BACKEND_PROVIDER_BUNDLE_V2,
  descriptor: SUPABASE_AUTOMATION_PROVIDER_DESCRIPTOR_V2,
  server: SUPABASE_AUTOMATION_SERVER_ADAPTER_V2,
  automations: SUPABASE_AUTOMATIONS_ADAPTER_V2,
  validate: validateSupabaseCommonV2
}) satisfies BackendProviderBundleV2
