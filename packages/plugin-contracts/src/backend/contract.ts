import { parseBoundedManifestArray as array } from '@open-pencil/scene-graph'

import type { PluginContributionDataContractV2 } from '../parameter-schema'
import { createBackendProviderContributionParser } from './contribution-parser'
import { BACKEND_PROVIDER_LEXICAL_LIMITS } from './lexical'

export const PLUGIN_BACKEND_PROVIDER_CONTRACT_VERSION = 1 as const
export const PLUGIN_BACKEND_PROVIDER_MODEL_VERSION = 1 as const

/**
 * Provider support vocabulary mirrored by the compiler's exhaustive capability negotiation.
 * These strings declare support only; they do not grant host or deployment authority.
 */
export const PLUGIN_BACKEND_PROVIDER_CAPABILITIES = Object.freeze([
  'auth.identity',
  'auth.roles',
  'data.read',
  'data.write',
  'migrations.data',
  'migrations.schema',
  'policy.row-level',
  'realtime.subscribe',
  'server.functions',
  'server.http',
  'storage.objects',
  'transactions.atomic'
] as const)

export type PluginBackendProviderCapabilityV1 =
  (typeof PLUGIN_BACKEND_PROVIDER_CAPABILITIES)[number]

export const PLUGIN_BACKEND_PROVIDER_OUTPUT_KINDS = Object.freeze([
  'client-config',
  'database-schema',
  'deployment-manifest',
  'migration-plan',
  'security-policy',
  'server-runtime'
] as const)

export type PluginBackendProviderOutputKindV1 =
  (typeof PLUGIN_BACKEND_PROVIDER_OUTPUT_KINDS)[number]

/**
 * Contract v1 intentionally grants no host authority. Apply, network, credential, filesystem,
 * process, and deployment permissions remain exclusively owned by the host release controller.
 */
export type PluginBackendProviderPermissionV1 = never

export const PLUGIN_BACKEND_PROVIDER_LIMITS = Object.freeze({
  maxBytes: 64 * 1024,
  maxIdLength: 64,
  maxNameLength: 128,
  maxDescriptionLength: 1_000,
  maxSupportedModelVersions: 4,
  maxCapabilities: PLUGIN_BACKEND_PROVIDER_CAPABILITIES.length,
  maxOutputKinds: PLUGIN_BACKEND_PROVIDER_OUTPUT_KINDS.length,
  maxPermissions: 0,
  maxConfigurationBytes: 64 * 1024,
  maxConfigurationEnumValues: 32,
  maxConfigurationSymbolLength: BACKEND_PROVIDER_LEXICAL_LIMITS.maxSymbolLength
})

/**
 * Shared data-only provider declaration shape. Each contract revision fixes its own version,
 * model vocabulary, capabilities, and output-kind vocabulary through the type parameters.
 */
export interface PluginBackendProviderContributionShape<
  ContractVersion extends number,
  SupportedModelVersions extends readonly number[],
  Capability extends string,
  OutputKind extends string
> {
  readonly providerId: string
  readonly contributionId: string
  readonly name: string
  readonly description: string
  readonly adapterId: string
  readonly contractVersion: ContractVersion
  readonly supportedModelVersions: SupportedModelVersions
  readonly capabilities: readonly Capability[]
  readonly configuration: PluginContributionDataContractV2
  readonly outputKinds: readonly OutputKind[]
  readonly permissions: readonly []
}

export type PluginBackendProviderContributionV1 = PluginBackendProviderContributionShape<
  typeof PLUGIN_BACKEND_PROVIDER_CONTRACT_VERSION,
  readonly [typeof PLUGIN_BACKEND_PROVIDER_MODEL_VERSION],
  PluginBackendProviderCapabilityV1,
  PluginBackendProviderOutputKindV1
>

function supportedModelVersions(
  value: unknown,
  path: string
): readonly [typeof PLUGIN_BACKEND_PROVIDER_MODEL_VERSION] {
  const versions = array(value, path, PLUGIN_BACKEND_PROVIDER_LIMITS.maxSupportedModelVersions)
  if (versions.length !== 1 || versions[0] !== PLUGIN_BACKEND_PROVIDER_MODEL_VERSION) {
    throw new TypeError(
      `${path} must contain only supported backend model version ${PLUGIN_BACKEND_PROVIDER_MODEL_VERSION}`
    )
  }
  return Object.freeze([PLUGIN_BACKEND_PROVIDER_MODEL_VERSION])
}

const parseContribution = createBackendProviderContributionParser({
  contractVersion: PLUGIN_BACKEND_PROVIDER_CONTRACT_VERSION,
  limits: PLUGIN_BACKEND_PROVIDER_LIMITS,
  capabilities: PLUGIN_BACKEND_PROVIDER_CAPABILITIES,
  outputKinds: PLUGIN_BACKEND_PROVIDER_OUTPUT_KINDS,
  parseModelVersions: supportedModelVersions
})

export function parsePluginBackendProviderContribution(
  value: unknown,
  path = 'backendProvider'
): PluginBackendProviderContributionV1 {
  return parseContribution(value, path)
}
