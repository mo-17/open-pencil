import {
  canonicalManifestValue,
  parseBoundedManifestArray as array,
  parseExactManifestRecord as record
} from '@open-pencil/scene-graph'

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

export interface PluginBackendProviderContributionV1 {
  readonly providerId: string
  readonly contributionId: string
  readonly name: string
  readonly description: string
  readonly adapterId: string
  readonly contractVersion: typeof PLUGIN_BACKEND_PROVIDER_CONTRACT_VERSION
  readonly supportedModelVersions: readonly [typeof PLUGIN_BACKEND_PROVIDER_MODEL_VERSION]
  readonly capabilities: readonly PluginBackendProviderCapabilityV1[]
  readonly configuration: PluginContributionDataContractV2
  readonly outputKinds: readonly PluginBackendProviderOutputKindV1[]
  readonly permissions: readonly []
}

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
const CAPABILITIES = new Set<PluginBackendProviderCapabilityV1>(
  PLUGIN_BACKEND_PROVIDER_CAPABILITIES
)
const OUTPUT_KINDS = new Set<PluginBackendProviderOutputKindV1>(
  PLUGIN_BACKEND_PROVIDER_OUTPUT_KINDS
)
/** Contract v1 accepts only reviewed inert setting vocabulary. New semantics require a new
 * contract revision instead of expanding authority through an arbitrary property name. */
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
    value.length > PLUGIN_BACKEND_PROVIDER_LIMITS.maxIdLength ||
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
  if (schema.title !== undefined) {
    assertInertBackendProviderText(schema.title, `${path}.title`)
  }
  if (schema.description !== undefined) {
    assertInertBackendProviderText(schema.description, `${path}.description`)
  }
  if (schema.type === 'string' && schema.enum) {
    if (schema.enum.length > PLUGIN_BACKEND_PROVIDER_LIMITS.maxConfigurationEnumValues) {
      throw new TypeError(
        `${path}.enum must contain at most ${PLUGIN_BACKEND_PROVIDER_LIMITS.maxConfigurationEnumValues} symbolic values`
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
    (source.maxBytes as number) > PLUGIN_BACKEND_PROVIDER_LIMITS.maxConfigurationBytes ||
    (source.maxBytes as number) > PLUGIN_PARAMETER_VALUE_LIMITS.maxBytes
  ) {
    throw new TypeError(
      `${path}.maxBytes must be between 2 and ${PLUGIN_BACKEND_PROVIDER_LIMITS.maxConfigurationBytes}`
    )
  }
  const schema = parsePluginObjectParameterSchema(source.schema, `${path}.schema`)
  assertConfigurationSchemaIsDataOnly(schema, `${path}.schema`)
  return Object.freeze({ schema, maxBytes: source.maxBytes as number })
}

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

function permissions(value: unknown, path: string): readonly [] {
  const parsed = array(value, path, PLUGIN_BACKEND_PROVIDER_LIMITS.maxPermissions)
  if (parsed.length !== 0) throw new TypeError(`${path} must be empty for contract version 1`)
  return Object.freeze([])
}

function assertContributionSize(value: unknown, path: string): void {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalManifestValue(value))).byteLength
  if (bytes > PLUGIN_BACKEND_PROVIDER_LIMITS.maxBytes) {
    throw new TypeError(`${path} may not exceed ${PLUGIN_BACKEND_PROVIDER_LIMITS.maxBytes} bytes`)
  }
}

export function parsePluginBackendProviderContribution(
  value: unknown,
  path = 'backendProvider'
): PluginBackendProviderContributionV1 {
  assertBackendProviderInputDataProperties(value, path)
  const source = record(value, path, CONTRIBUTION_KEYS, CONTRIBUTION_KEYS)
  if (source.contractVersion !== PLUGIN_BACKEND_PROVIDER_CONTRACT_VERSION) {
    throw new TypeError(`${path}.contractVersion is not supported`)
  }
  const parsed = Object.freeze({
    providerId: identifier(source.providerId, `${path}.providerId`),
    contributionId: identifier(source.contributionId, `${path}.contributionId`),
    name: inertDisplayText(
      source.name,
      `${path}.name`,
      PLUGIN_BACKEND_PROVIDER_LIMITS.maxNameLength
    ),
    description: inertDisplayText(
      source.description,
      `${path}.description`,
      PLUGIN_BACKEND_PROVIDER_LIMITS.maxDescriptionLength,
      true
    ),
    adapterId: identifier(source.adapterId, `${path}.adapterId`),
    contractVersion: PLUGIN_BACKEND_PROVIDER_CONTRACT_VERSION,
    supportedModelVersions: supportedModelVersions(
      source.supportedModelVersions,
      `${path}.supportedModelVersions`
    ),
    capabilities: sortedUniqueArray(
      source.capabilities,
      `${path}.capabilities`,
      PLUGIN_BACKEND_PROVIDER_LIMITS.maxCapabilities,
      CAPABILITIES,
      'backend capability'
    ),
    configuration: configuration(source.configuration, `${path}.configuration`),
    outputKinds: sortedUniqueArray(
      source.outputKinds,
      `${path}.outputKinds`,
      PLUGIN_BACKEND_PROVIDER_LIMITS.maxOutputKinds,
      OUTPUT_KINDS,
      'backend output kind'
    ),
    permissions: permissions(source.permissions, `${path}.permissions`)
  })
  assertContributionSize(parsed, path)
  return parsed
}
