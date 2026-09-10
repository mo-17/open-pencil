import type {
  BackendProviderAdapterV2,
  BackendProviderAdapterContextV2,
  BackendProviderBundleV2
} from '#compiler/backend/v2/contracts'

import { SUPABASE_AUTOMATION_PROVIDER_BUNDLE_V2 } from '../automation/bundle'
import { SUPABASE_AUTOMATION_CAPABILITIES_V2 } from '../automation/descriptor'
import { validateSupabaseCommonV2 } from '../common'
import {
  emitSupabaseObservabilityArtifactsV2,
  emitSupabaseObservabilityAutomationArtifactsV2
} from './artifacts'
import {
  SUPABASE_OBSERVABILITY_CAPABILITIES_V2,
  SUPABASE_OBSERVABILITY_PROVIDER_DESCRIPTOR_V2
} from './descriptor'
import {
  createSupabaseObservabilityAutomationBridgePlanV2,
  createSupabaseObservabilityPlanV2,
  validateSupabaseObservabilityAutomationCompositeV2,
  validateSupabaseObservabilityV2
} from './index'

const SUPABASE_OBSERVABILITY_ADAPTER_V2 = Object.freeze({
  capabilities: SUPABASE_OBSERVABILITY_CAPABILITIES_V2,
  outputs: Object.freeze(['deployment-manifest', 'migration-plan'] as const),
  plan: createSupabaseObservabilityPlanV2,
  emit: emitSupabaseObservabilityArtifactsV2
}) satisfies BackendProviderAdapterV2

const SUPABASE_OBSERVABILITY_AUTOMATION_ADAPTER_V2 = Object.freeze({
  capabilities: SUPABASE_AUTOMATION_CAPABILITIES_V2,
  outputs: Object.freeze(['deployment-manifest', 'migration-plan', 'server-runtime'] as const),
  plan: createSupabaseObservabilityAutomationBridgePlanV2,
  emit: emitSupabaseObservabilityAutomationArtifactsV2
}) satisfies BackendProviderAdapterV2

export const SUPABASE_OBSERVABILITY_PROVIDER_BUNDLE_V2 = Object.freeze({
  ...SUPABASE_AUTOMATION_PROVIDER_BUNDLE_V2,
  descriptor: SUPABASE_OBSERVABILITY_PROVIDER_DESCRIPTOR_V2,
  automations: SUPABASE_OBSERVABILITY_AUTOMATION_ADAPTER_V2,
  observability: SUPABASE_OBSERVABILITY_ADAPTER_V2,
  validate: (context: BackendProviderAdapterContextV2) =>
    Object.freeze([
      ...validateSupabaseCommonV2(context),
      ...validateSupabaseObservabilityAutomationCompositeV2(context),
      ...validateSupabaseObservabilityV2(context)
    ])
}) satisfies BackendProviderBundleV2
