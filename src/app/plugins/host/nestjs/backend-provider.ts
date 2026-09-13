import { parsePluginBackendProviderContribution } from '@open-pencil/plugin-contracts'

export const NESTJS_BACKEND_PROVIDER_PLUGIN_ID = 'open-pencil.nestjs-backend'
export const NESTJS_BACKEND_PROVIDER_ID = 'nestjs'
export const NESTJS_BACKEND_PROVIDER_ADAPTER_ID = 'open-pencil.backend.nestjs'
export const NESTJS_BACKEND_PROVIDER_ADAPTER_VERSION = '1.0.0'

/** Exact App catalog package digest; independent of Compiler-local selection authority. */
export const NESTJS_BACKEND_PROVIDER_PACKAGE_DIGEST =
  'app-bundle-sha256:qG0zYtpjTrxD4loguIHYYQ_j3jxRFVTLjHqEdrVRHEU'

/** Inert source-generation declaration. It grants no execution or deployment permissions. */
export const NESTJS_BACKEND_PROVIDER_CONTRIBUTION = parsePluginBackendProviderContribution({
  providerId: NESTJS_BACKEND_PROVIDER_ID,
  contributionId: 'nestjs.backend',
  name: 'Nest Backend',
  description:
    'Emits deterministic Nest backend artifacts through the host-reviewed compiler adapter.',
  adapterId: NESTJS_BACKEND_PROVIDER_ADAPTER_ID,
  contractVersion: 1,
  supportedModelVersions: [1],
  capabilities: [
    'auth.identity',
    'auth.roles',
    'data.read',
    'data.write',
    'migrations.schema',
    'policy.row-level',
    'server.functions',
    'server.http',
    'transactions.atomic'
  ],
  configuration: {
    schema: { type: 'object', properties: {}, additionalProperties: false, maxProperties: 0 },
    maxBytes: 2
  },
  outputKinds: [
    'client-config',
    'database-schema',
    'migration-plan',
    'security-policy',
    'server-runtime'
  ],
  permissions: []
})
