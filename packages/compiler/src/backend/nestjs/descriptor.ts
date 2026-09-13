import { digestCanonicalBackendValue } from '../canonical'
import type { BackendProviderDescriptor } from '../contracts'

export const NESTJS_BACKEND_PROVIDER_PLUGIN_ID = 'open-pencil.nestjs-backend' as const
export const NESTJS_BACKEND_PROVIDER_CONTRIBUTION_ID = 'nestjs.backend' as const
export const NESTJS_BACKEND_PROVIDER_ID = 'nestjs' as const
export const NESTJS_BACKEND_PROVIDER_ADAPTER_ID = 'open-pencil.backend.nestjs' as const
export const NESTJS_BACKEND_PROVIDER_ADAPTER_VERSION = '1.0.0' as const

export const NESTJS_BACKEND_PROVIDER_DESCRIPTOR = Object.freeze({
  pluginId: NESTJS_BACKEND_PROVIDER_PLUGIN_ID,
  contributionId: NESTJS_BACKEND_PROVIDER_CONTRIBUTION_ID,
  providerId: NESTJS_BACKEND_PROVIDER_ID,
  adapterId: NESTJS_BACKEND_PROVIDER_ADAPTER_ID,
  adapterVersion: NESTJS_BACKEND_PROVIDER_ADAPTER_VERSION,
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
    'transactions.atomic'
  ] as const),
  outputs: Object.freeze([
    'client-config',
    'database-schema',
    'migration-plan',
    'security-policy',
    'server-runtime'
  ] as const)
}) satisfies BackendProviderDescriptor

/** Compiler-local identity, distinct from the installed App package's manifest digest. */
export const NESTJS_BACKEND_PROVIDER_COMPILER_BUNDLE_DIGEST =
  'sha256:' +
  digestCanonicalBackendValue(
    {
      authorityDomain: 'openpencil.compiler-bundled-backend-provider.v1',
      descriptor: NESTJS_BACKEND_PROVIDER_DESCRIPTOR
    },
    '$.compilerBundledNestJSAuthority'
  )
