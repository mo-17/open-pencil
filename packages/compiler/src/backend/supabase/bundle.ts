import { canonicalBackendValue } from '../canonical'
import type {
  BackendProviderAdapter,
  BackendProviderAdapterContext,
  BackendProviderBundle
} from '../contracts'
import {
  createSupabaseDataPlan,
  createSupabaseMigrationPlan,
  createSupabaseServerPlan,
  emitSupabaseDataArtifacts,
  emitSupabaseMigrationArtifact,
  emitSupabaseServerArtifacts
} from './artifacts'
import { SUPABASE_BACKEND_PROVIDER_DESCRIPTOR } from './descriptor'
import { createSupabaseSecurityProposal, emitSupabaseSecurityArtifacts } from './policy'
import { validateSupabaseBackendProvider } from './validation'

const SUPABASE_DATA_ADAPTER: BackendProviderAdapter = Object.freeze({
  capabilities: Object.freeze(['data.read', 'data.write', 'storage.objects'] as const),
  outputs: Object.freeze(['client-config', 'database-schema'] as const),
  plan: createSupabaseDataPlan,
  emit: (context: BackendProviderAdapterContext) => emitSupabaseDataArtifacts(context)
})

const SUPABASE_AUTH_ADAPTER: BackendProviderAdapter = Object.freeze({
  capabilities: Object.freeze(['auth.identity', 'auth.roles'] as const),
  outputs: Object.freeze([] as const),
  plan: (context: BackendProviderAdapterContext) =>
    canonicalBackendValue(
      {
        format: 'openpencil.supabase-auth-plan.v1',
        version: 1,
        applicationId: context.application.applicationId,
        auth: context.application.auth,
        privilegedCredentialAllowed: false
      },
      '$.supabase.authPlan'
    ),
  emit: () => Object.freeze([])
})

const SUPABASE_SERVER_ADAPTER: BackendProviderAdapter = Object.freeze({
  capabilities: Object.freeze(['server.functions', 'server.http'] as const),
  outputs: Object.freeze(['deployment-manifest', 'server-runtime'] as const),
  plan: createSupabaseServerPlan,
  emit: (context: BackendProviderAdapterContext) => emitSupabaseServerArtifacts(context)
})

const SUPABASE_SECURITY_POLICY_ADAPTER: BackendProviderAdapter = Object.freeze({
  capabilities: Object.freeze(['policy.row-level'] as const),
  outputs: Object.freeze(['security-policy'] as const),
  plan: createSupabaseSecurityProposal,
  emit: (context: BackendProviderAdapterContext) => emitSupabaseSecurityArtifacts(context)
})

const SUPABASE_MIGRATIONS_ADAPTER: BackendProviderAdapter = Object.freeze({
  capabilities: Object.freeze(['migrations.schema'] as const),
  outputs: Object.freeze(['migration-plan'] as const),
  plan: createSupabaseMigrationPlan,
  emit: (context: BackendProviderAdapterContext) => emitSupabaseMigrationArtifact(context)
})

/** Reviewed, pure Compiler adapter. It has no environment/network/filesystem/apply handle. */
export const SUPABASE_BACKEND_PROVIDER_BUNDLE = Object.freeze({
  descriptor: SUPABASE_BACKEND_PROVIDER_DESCRIPTOR,
  data: SUPABASE_DATA_ADAPTER,
  auth: SUPABASE_AUTH_ADAPTER,
  server: SUPABASE_SERVER_ADAPTER,
  securityPolicy: SUPABASE_SECURITY_POLICY_ADAPTER,
  migrations: SUPABASE_MIGRATIONS_ADAPTER,
  validate: validateSupabaseBackendProvider
}) satisfies BackendProviderBundle
