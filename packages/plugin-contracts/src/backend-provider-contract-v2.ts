import {
  canonicalManifestValue,
  parseBoundedManifestArray as array,
  parseExactManifestRecord as record
} from '@open-pencil/scene-graph'

import {
  PLUGIN_BACKEND_PROVIDER_CONTRACT_VERSION,
  parsePluginBackendProviderContribution,
  type PluginBackendProviderContributionV1
} from './backend-provider-contract'
import {
  BACKEND_PROVIDER_LEXICAL_LIMITS,
  assertBackendProviderInputDataProperties,
  assertInertBackendProviderText,
  backendProviderTextWords
} from './backend-provider-lexical'
import {
  PLUGIN_PARAMETER_VALUE_LIMITS,
  parsePluginObjectParameterSchema,
  type PluginContributionDataContractV2,
  type PluginParameterSchemaV2
} from './parameter-schema'
import { parseSortedUniqueStringArray } from './parse-helpers'

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

export interface PluginBackendProviderContributionV2 {
  readonly providerId: string
  readonly contributionId: string
  readonly name: string
  readonly description: string
  readonly adapterId: string
  readonly contractVersion: typeof PLUGIN_BACKEND_PROVIDER_CONTRACT_VERSION_V2
  /** Model 2 is mandatory; model 1 may additionally be declared for a reviewed lowering path. */
  readonly supportedModelVersions: readonly PluginBackendProviderModelVersionV2[]
  readonly capabilities: readonly PluginBackendProviderCapabilityV2[]
  readonly configuration: PluginContributionDataContractV2
  readonly outputKinds: readonly PluginBackendProviderOutputKindV2[]
  /** A provider declaration is data, never an authority grant. */
  readonly permissions: readonly []
}

export type PluginBackendProviderContribution =
  | PluginBackendProviderContributionV1
  | PluginBackendProviderContributionV2

const CONTRIBUTION_KEYS = new Set([
  'providerId',
  'contributionId',
  'name',
  'description',
  'adapterId',
  'contractVersion',
  'supportedModelVersions',
  'capabilities',
  'configuration',
  'outputKinds',
  'permissions'
])
const CONFIGURATION_KEYS = new Set(['schema', 'maxBytes'])
const IDENTIFIER = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/
const CAPABILITIES = new Set<PluginBackendProviderCapabilityV2>(
  PLUGIN_BACKEND_PROVIDER_CAPABILITIES_V2
)
const OUTPUT_KINDS = new Set<PluginBackendProviderOutputKindV2>(
  PLUGIN_BACKEND_PROVIDER_OUTPUT_KINDS_V2
)
const MODEL_VERSIONS = new Set<PluginBackendProviderModelVersionV2>([1, 2])

/** Keep configuration descriptive and symbolic. Runtime authority belongs to the host. */
const CONFIGURATION_DATA_WORDS = new Set([
  'enabled',
  'feature',
  'features',
  'flag',
  'flags',
  'id',
  'label',
  'mode',
  'name',
  'namespace',
  'option',
  'options',
  'project',
  'ref',
  'region',
  'schema',
  'strategy',
  'tag',
  'tags',
  'variant',
  'version'
])

function identifier(value: unknown, path: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > PLUGIN_BACKEND_PROVIDER_LIMITS_V2.maxIdLength ||
    !IDENTIFIER.test(value)
  ) {
    throw new TypeError(`${path} must be a stable lowercase identifier`)
  }
  assertInertBackendProviderText(value, path, {
    symbolic: true,
    allowQualifiedIdentifier: true
  })
  return value
}

function text(value: unknown, path: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maximum) {
    throw new TypeError(`${path} must be a string with at most ${maximum} characters`)
  }
  const parsed = value.normalize('NFC').trim()
  if ((!allowEmpty && parsed.length === 0) || parsed.length > maximum) {
    throw new TypeError(`${path} must contain ${allowEmpty ? 0 : 1} to ${maximum} characters`)
  }
  if (/\p{Cc}/u.test(parsed)) throw new TypeError(`${path} must not contain control characters`)
  return parsed
}

function inertDisplayText(
  value: unknown,
  path: string,
  maximum: number,
  allowEmpty = false
): string {
  const parsed = text(value, path, maximum, allowEmpty)
  assertInertBackendProviderText(parsed, path)
  return parsed
}

function sortedUniqueArray<Value extends string>(
  value: unknown,
  path: string,
  maximum: number,
  allowed: ReadonlySet<Value>,
  label: string
): readonly Value[] {
  const source = array(value, path, maximum)
  if (source.length === 0) throw new TypeError(`${path} must not be empty`)
  return parseSortedUniqueStringArray(source, path, {
    maximumEntries: maximum,
    duplicateLabel: `${label}s`,
    parseEntry(entry, entryPath) {
      if (typeof entry !== 'string' || !allowed.has(entry as Value)) {
        throw new TypeError(`${entryPath} is not a supported ${label}`)
      }
      return entry as Value
    }
  })
}

function assertConfigurationPropertyName(value: string, path: string): void {
  const words = backendProviderTextWords(value)
  try {
    assertInertBackendProviderText(value, path, { symbolic: true })
  } catch {
    throw new TypeError(`${path} must not request endpoint, credential, code, or command authority`)
  }
  if (words.length === 0 || words.some((word) => !CONFIGURATION_DATA_WORDS.has(word))) {
    throw new TypeError(`${path} must not request endpoint, credential, code, or command authority`)
  }
}

function assertConfigurationSchemaIsDataOnly(schema: PluginParameterSchemaV2, path: string): void {
  if (schema.title !== undefined) assertInertBackendProviderText(schema.title, `${path}.title`)
  if (schema.description !== undefined) {
    assertInertBackendProviderText(schema.description, `${path}.description`)
  }
  if (schema.type === 'string' && schema.enum) {
    if (schema.enum.length > PLUGIN_BACKEND_PROVIDER_LIMITS_V2.maxConfigurationEnumValues) {
      throw new TypeError(
        `${path}.enum must contain at most ${PLUGIN_BACKEND_PROVIDER_LIMITS_V2.maxConfigurationEnumValues} symbolic values`
      )
    }
    for (const [index, value] of schema.enum.entries()) {
      if (typeof value !== 'string') throw new TypeError(`${path}.enum must contain strings`)
      assertInertBackendProviderText(value, `${path}.enum[${index}]`, { symbolic: true })
    }
  }
  if (schema.type === 'array') {
    assertConfigurationSchemaIsDataOnly(schema.items, `${path}.items`)
    return
  }
  if (schema.type !== 'object') return
  for (const [index, [name, property]] of Object.entries(schema.properties).entries()) {
    const propertyPath = `${path}.properties[${index}]`
    assertConfigurationPropertyName(name, `${propertyPath}.name`)
    assertConfigurationSchemaIsDataOnly(property, propertyPath)
  }
}

function configuration(value: unknown, path: string): PluginContributionDataContractV2 {
  const source = record(value, path, CONFIGURATION_KEYS, CONFIGURATION_KEYS)
  if (
    !Number.isSafeInteger(source.maxBytes) ||
    (source.maxBytes as number) < 2 ||
    (source.maxBytes as number) > PLUGIN_BACKEND_PROVIDER_LIMITS_V2.maxConfigurationBytes ||
    (source.maxBytes as number) > PLUGIN_PARAMETER_VALUE_LIMITS.maxBytes
  ) {
    throw new TypeError(
      `${path}.maxBytes must be between 2 and ${PLUGIN_BACKEND_PROVIDER_LIMITS_V2.maxConfigurationBytes}`
    )
  }
  const schema = parsePluginObjectParameterSchema(source.schema, `${path}.schema`)
  assertConfigurationSchemaIsDataOnly(schema, `${path}.schema`)
  return Object.freeze({ schema, maxBytes: source.maxBytes as number })
}

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

function permissions(value: unknown, path: string): readonly [] {
  const parsed = array(value, path, PLUGIN_BACKEND_PROVIDER_LIMITS_V2.maxPermissions)
  if (parsed.length !== 0) throw new TypeError(`${path} must be empty for contract version 2`)
  return Object.freeze([])
}

function assertContributionSize(value: unknown, path: string): void {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalManifestValue(value))).byteLength
  if (bytes > PLUGIN_BACKEND_PROVIDER_LIMITS_V2.maxBytes) {
    throw new TypeError(
      `${path} may not exceed ${PLUGIN_BACKEND_PROVIDER_LIMITS_V2.maxBytes} bytes`
    )
  }
}

export function parsePluginBackendProviderContributionV2(
  value: unknown,
  path = 'backendProvider'
): PluginBackendProviderContributionV2 {
  assertBackendProviderInputDataProperties(value, path)
  const source = record(value, path, CONTRIBUTION_KEYS, CONTRIBUTION_KEYS)
  if (source.contractVersion !== PLUGIN_BACKEND_PROVIDER_CONTRACT_VERSION_V2) {
    throw new TypeError(`${path}.contractVersion is not supported`)
  }
  const parsed = Object.freeze({
    providerId: identifier(source.providerId, `${path}.providerId`),
    contributionId: identifier(source.contributionId, `${path}.contributionId`),
    name: inertDisplayText(
      source.name,
      `${path}.name`,
      PLUGIN_BACKEND_PROVIDER_LIMITS_V2.maxNameLength
    ),
    description: inertDisplayText(
      source.description,
      `${path}.description`,
      PLUGIN_BACKEND_PROVIDER_LIMITS_V2.maxDescriptionLength,
      true
    ),
    adapterId: identifier(source.adapterId, `${path}.adapterId`),
    contractVersion: PLUGIN_BACKEND_PROVIDER_CONTRACT_VERSION_V2,
    supportedModelVersions: supportedModelVersions(
      source.supportedModelVersions,
      `${path}.supportedModelVersions`
    ),
    capabilities: sortedUniqueArray(
      source.capabilities,
      `${path}.capabilities`,
      PLUGIN_BACKEND_PROVIDER_LIMITS_V2.maxCapabilities,
      CAPABILITIES,
      'backend capability'
    ),
    configuration: configuration(source.configuration, `${path}.configuration`),
    outputKinds: sortedUniqueArray(
      source.outputKinds,
      `${path}.outputKinds`,
      PLUGIN_BACKEND_PROVIDER_LIMITS_V2.maxOutputKinds,
      OUTPUT_KINDS,
      'backend output kind'
    ),
    permissions: permissions(source.permissions, `${path}.permissions`)
  })
  assertContributionSize(parsed, path)
  return parsed
}

/**
 * Explicit version dispatcher for hosts that opt into contract v2. Calling the established v1
 * parser for version 1 preserves its normalization and rejection behavior.
 */
export function parseVersionedPluginBackendProviderContribution(
  value: unknown,
  path = 'backendProvider'
): PluginBackendProviderContribution {
  assertBackendProviderInputDataProperties(value, path)
  const source = record(value, path, CONTRIBUTION_KEYS, CONTRIBUTION_KEYS)
  if (source.contractVersion === PLUGIN_BACKEND_PROVIDER_CONTRACT_VERSION) {
    return parsePluginBackendProviderContribution(value, path)
  }
  if (source.contractVersion === PLUGIN_BACKEND_PROVIDER_CONTRACT_VERSION_V2) {
    return parsePluginBackendProviderContributionV2(value, path)
  }
  throw new TypeError(`${path}.contractVersion is not supported`)
}
