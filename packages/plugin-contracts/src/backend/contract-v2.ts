import { parseBoundedManifestArray as array } from '@open-pencil/scene-graph'

import {
  PLUGIN_BACKEND_PROVIDER_CONTRACT_VERSION,
  parsePluginBackendProviderContribution,
  type PluginBackendProviderContributionShape,
  type PluginBackendProviderContributionV1
} from './contract'
import {
  createBackendProviderContributionParser,
  readBackendProviderContractVersion
} from './contribution-parser'
import { BACKEND_PROVIDER_LEXICAL_LIMITS } from './lexical'

/**
 * Contract v2 is a separate, fail-closed revision. Contract v1 constants and parsing remain
 * untouched so an existing signed manifest retains its exact meaning and canonical bytes.
 */
export const PLUGIN_BACKEND_PROVIDER_CONTRACT_VERSION_V2 = 2 as const
export const PLUGIN_BACKEND_PROVIDER_MODEL_VERSION_V2 = 2 as const

/**
 * Provider support vocabulary for Backend model v2. These values are inert feature claims only:
 * the trusted host still owns credentials, networking, migration Apply, deployment, and runtime
 * invocation authority.
 */
export const PLUGIN_BACKEND_PROVIDER_CAPABILITIES_V2 = Object.freeze([
  'audit.events',
  'auth.identity',
  'auth.roles',
  'data.read',
  'data.write',
  'drift.detect',
  'events.data-change',
  'jobs.schedule',
  'migrations.backfill',
  'migrations.data',
  'migrations.schema',
  'observability.logs',
  'observability.metrics',
  'observability.traces',
  'policy.row-level',
  'queues.consume',
  'queues.publish',
  'realtime.subscribe',
  'server.functions',
  'server.http',
  'storage.objects',
  'transactions.atomic',
  'webhooks.deliver',
  'webhooks.receive',
  'workflows.durable-execution',
  'workflows.idempotency',
  'workflows.retry'
] as const)

export type PluginBackendProviderCapabilityV2 =
  (typeof PLUGIN_BACKEND_PROVIDER_CAPABILITIES_V2)[number]

export const PLUGIN_BACKEND_PROVIDER_OUTPUT_KINDS_V2 = Object.freeze([
  'client-config',
  'database-schema',
  'deployment-manifest',
  'migration-plan',
  'security-policy',
  'server-runtime'
] as const)

export type PluginBackendProviderOutputKindV2 =
  (typeof PLUGIN_BACKEND_PROVIDER_OUTPUT_KINDS_V2)[number]
export type PluginBackendProviderModelVersionV2 =
  | 1
  | typeof PLUGIN_BACKEND_PROVIDER_MODEL_VERSION_V2
export type PluginBackendProviderPermissionV2 = never

export const PLUGIN_BACKEND_PROVIDER_LIMITS_V2 = Object.freeze({
  maxBytes: 64 * 1024,
  maxIdLength: 64,
  maxNameLength: 128,
  maxDescriptionLength: 1_000,
  maxSupportedModelVersions: 2,
  maxCapabilities: PLUGIN_BACKEND_PROVIDER_CAPABILITIES_V2.length,
  maxOutputKinds: PLUGIN_BACKEND_PROVIDER_OUTPUT_KINDS_V2.length,
  maxPermissions: 0,
  maxConfigurationBytes: 64 * 1024,
  maxConfigurationEnumValues: 32,
  maxConfigurationSymbolLength: BACKEND_PROVIDER_LEXICAL_LIMITS.maxSymbolLength
})

/** Model 2 is mandatory; model 1 may additionally be declared for a reviewed lowering path. */
export type PluginBackendProviderContributionV2 = PluginBackendProviderContributionShape<
  typeof PLUGIN_BACKEND_PROVIDER_CONTRACT_VERSION_V2,
  readonly PluginBackendProviderModelVersionV2[],
  PluginBackendProviderCapabilityV2,
  PluginBackendProviderOutputKindV2
>

export type PluginBackendProviderContribution =
  | PluginBackendProviderContributionV1
  | PluginBackendProviderContributionV2

const MODEL_VERSIONS = new Set<PluginBackendProviderModelVersionV2>([1, 2])

function supportedModelVersions(
  value: unknown,
  path: string
): readonly PluginBackendProviderModelVersionV2[] {
  const source = array(value, path, PLUGIN_BACKEND_PROVIDER_LIMITS_V2.maxSupportedModelVersions)
  if (source.length === 0) throw new TypeError(`${path} must not be empty`)
  const versions: PluginBackendProviderModelVersionV2[] = []
  for (const [index, entry] of source.entries()) {
    if (
      !Number.isSafeInteger(entry) ||
      !MODEL_VERSIONS.has(entry as PluginBackendProviderModelVersionV2)
    ) {
      throw new TypeError(`${path}[${index}] is not a supported backend model version`)
    }
    versions.push(entry as PluginBackendProviderModelVersionV2)
  }
  if (new Set(versions).size !== versions.length) {
    throw new TypeError(`${path} contains duplicate backend model versions`)
  }
  if (versions.some((entry, index) => index > 0 && versions[index - 1] >= entry)) {
    throw new TypeError(`${path} must be sorted in ascending order`)
  }
  if (!versions.includes(PLUGIN_BACKEND_PROVIDER_MODEL_VERSION_V2)) {
    throw new TypeError(
      `${path} must include backend model version ${PLUGIN_BACKEND_PROVIDER_MODEL_VERSION_V2}`
    )
  }
  return Object.freeze(versions)
}

const parseContribution = createBackendProviderContributionParser({
  contractVersion: PLUGIN_BACKEND_PROVIDER_CONTRACT_VERSION_V2,
  limits: PLUGIN_BACKEND_PROVIDER_LIMITS_V2,
  capabilities: PLUGIN_BACKEND_PROVIDER_CAPABILITIES_V2,
  outputKinds: PLUGIN_BACKEND_PROVIDER_OUTPUT_KINDS_V2,
  parseModelVersions: supportedModelVersions
})

export function parsePluginBackendProviderContributionV2(
  value: unknown,
  path = 'backendProvider'
): PluginBackendProviderContributionV2 {
  return parseContribution(value, path)
}

/**
 * Explicit version dispatcher for hosts that opt into contract v2. Calling the established v1
 * parser for version 1 preserves its normalization and rejection behavior.
 */
export function parseVersionedPluginBackendProviderContribution(
  value: unknown,
  path = 'backendProvider'
): PluginBackendProviderContribution {
  const contractVersion = readBackendProviderContractVersion(value, path)
  if (contractVersion === PLUGIN_BACKEND_PROVIDER_CONTRACT_VERSION) {
    return parsePluginBackendProviderContribution(value, path)
  }
  if (contractVersion === PLUGIN_BACKEND_PROVIDER_CONTRACT_VERSION_V2) {
    return parsePluginBackendProviderContributionV2(value, path)
  }
  throw new TypeError(`${path}.contractVersion is not supported`)
}
