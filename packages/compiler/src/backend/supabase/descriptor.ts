import { digestCanonicalBackendValue } from '../canonical'
import type { BackendProviderDescriptor } from '../contracts'

export const SUPABASE_BACKEND_PROVIDER_PLUGIN_ID = 'open-pencil.supabase-backend' as const
export const SUPABASE_BACKEND_PROVIDER_CONTRIBUTION_ID = 'supabase.backend' as const
export const SUPABASE_BACKEND_PROVIDER_ID = 'supabase' as const
export const SUPABASE_BACKEND_PROVIDER_ADAPTER_ID = 'open-pencil.backend.supabase' as const
export const SUPABASE_BACKEND_PROVIDER_ADAPTER_VERSION = '1.0.0' as const

/**
 * Exact compiler-side counterpart of the inert app-plugin contribution. The
 * app host still owns package/publisher/lifecycle authority; this descriptor
 * only selects the reviewed, side-effect-free compiler adapter.
 */
export const SUPABASE_BACKEND_PROVIDER_DESCRIPTOR = Object.freeze({
  pluginId: SUPABASE_BACKEND_PROVIDER_PLUGIN_ID,
  contributionId: SUPABASE_BACKEND_PROVIDER_CONTRIBUTION_ID,
  providerId: SUPABASE_BACKEND_PROVIDER_ID,
  adapterId: SUPABASE_BACKEND_PROVIDER_ADAPTER_ID,
  adapterVersion: SUPABASE_BACKEND_PROVIDER_ADAPTER_VERSION,
  contractVersion: 1,
  supportedModelVersions: Object.freeze([1] as const),
  capabilities: Object.freeze([
    'auth.identity',
    'auth.roles',
    'data.read',
    'data.write',
    'migrations.schema',
    'policy.row-level',
    'server.functions',
    'server.http',
    'storage.objects'
  ] as const),
  outputs: Object.freeze([
    'client-config',
    'database-schema',
    'deployment-manifest',
    'migration-plan',
    'security-policy',
    'server-runtime'
  ] as const)
}) satisfies BackendProviderDescriptor

/**
 * Compiler-local authority for automatic legacy lowering. This binds the
 * reviewed built-in descriptor in the Compiler trust domain; it is not an App
 * installed-package digest and must not be presented as publisher provenance.
 */
export const SUPABASE_BACKEND_PROVIDER_COMPILER_BUNDLE_DIGEST =
  `sha256:${digestCanonicalBackendValue(
    {
      authorityDomain: 'openpencil.compiler-bundled-backend-provider.v1',
      descriptor: SUPABASE_BACKEND_PROVIDER_DESCRIPTOR
    },
    '$.compilerBundledSupabaseAuthority'
  )}` as const
