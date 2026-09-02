import type { BackendProviderBundle } from './contracts'
import { BackendProviderRegistry } from './registry'
import { SUPABASE_BACKEND_PROVIDER_BUNDLE } from './supabase'

export const BUILTIN_BACKEND_PROVIDER_BUNDLES = Object.freeze([
  SUPABASE_BACKEND_PROVIDER_BUNDLE
] as const satisfies readonly BackendProviderBundle[])

export function createBuiltinBackendProviderRegistry(): BackendProviderRegistry {
  return new BackendProviderRegistry(BUILTIN_BACKEND_PROVIDER_BUNDLES)
}
