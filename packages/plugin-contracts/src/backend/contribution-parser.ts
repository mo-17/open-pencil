import {
  canonicalManifestValue,
  parseBoundedManifestArray as array,
  parseExactManifestRecord as record
} from '@open-pencil/scene-graph'

import {
  PLUGIN_PARAMETER_VALUE_LIMITS,
  parsePluginObjectParameterSchema,
  type PluginContributionDataContractV2,
  type PluginParameterSchemaV2
} from '../parameter-schema'
import { parseSortedUniqueStringArray } from '../parse-helpers'
import {
  assertBackendProviderInputDataProperties,
  assertInertBackendProviderText,
  backendProviderTextWords
} from './lexical'

interface BackendProviderParserLimits {
  readonly maxBytes: number
  readonly maxIdLength: number
  readonly maxNameLength: number
  readonly maxDescriptionLength: number
  readonly maxCapabilities: number
  readonly maxOutputKinds: number
  readonly maxPermissions: 0
  readonly maxConfigurationBytes: number
  readonly maxConfigurationEnumValues: number
}

interface BackendProviderParserPolicy<
  Version extends number,
  ModelVersions extends readonly number[],
  Capability extends string,
  OutputKind extends string
> {
  readonly contractVersion: Version
  readonly limits: BackendProviderParserLimits
  readonly capabilities: readonly Capability[]
  readonly outputKinds: readonly OutputKind[]
  readonly parseModelVersions: (value: unknown, path: string) => ModelVersions
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
/** Fixed shared v1/v2 setting vocabulary; sharing the parser does not expand either contract. */
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

function readContributionRecord(value: unknown, path: string) {
  assertBackendProviderInputDataProperties(value, path)
  return record(value, path, CONTRIBUTION_KEYS, CONTRIBUTION_KEYS)
}

export function readBackendProviderContractVersion(value: unknown, path: string): unknown {
  return readContributionRecord(value, path).contractVersion
}

/** Internal only: public versioned entrypoints bind their fixed policy at module initialization. */
export function createBackendProviderContributionParser<
  Version extends number,
  ModelVersions extends readonly number[],
  Capability extends string,
  OutputKind extends string
>(policy: BackendProviderParserPolicy<Version, ModelVersions, Capability, OutputKind>) {
  const { contractVersion, parseModelVersions } = policy
  const limits = Object.freeze({ ...policy.limits })
  const capabilities = new Set(policy.capabilities)
  const outputKinds = new Set(policy.outputKinds)

  function identifier(value: unknown, path: string): string {
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      value.length > limits.maxIdLength ||
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
      throw new TypeError(
        `${path} must not request endpoint, credential, code, or command authority`
      )
    }
    if (words.length === 0 || words.some((word) => !CONFIGURATION_DATA_WORDS.has(word))) {
      throw new TypeError(
        `${path} must not request endpoint, credential, code, or command authority`
      )
    }
  }

  function assertConfigurationSchemaIsDataOnly(
    schema: PluginParameterSchemaV2,
    path: string
  ): void {
    if (schema.title !== undefined) {
      assertInertBackendProviderText(schema.title, `${path}.title`)
    }
    if (schema.description !== undefined) {
      assertInertBackendProviderText(schema.description, `${path}.description`)
    }
    if (schema.type === 'string' && schema.enum) {
      if (schema.enum.length > limits.maxConfigurationEnumValues) {
        throw new TypeError(
          `${path}.enum must contain at most ${limits.maxConfigurationEnumValues} symbolic values`
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
      (source.maxBytes as number) > limits.maxConfigurationBytes ||
      (source.maxBytes as number) > PLUGIN_PARAMETER_VALUE_LIMITS.maxBytes
    ) {
      throw new TypeError(`${path}.maxBytes must be between 2 and ${limits.maxConfigurationBytes}`)
    }
    const schema = parsePluginObjectParameterSchema(source.schema, `${path}.schema`)
    assertConfigurationSchemaIsDataOnly(schema, `${path}.schema`)
    return Object.freeze({ schema, maxBytes: source.maxBytes as number })
  }

  function permissions(value: unknown, path: string): readonly [] {
    const parsed = array(value, path, limits.maxPermissions)
    if (parsed.length !== 0)
      throw new TypeError(`${path} must be empty for contract version ${contractVersion}`)
    return Object.freeze([])
  }

  function assertContributionSize(value: unknown, path: string): void {
    const bytes = new TextEncoder().encode(JSON.stringify(canonicalManifestValue(value))).byteLength
    if (bytes > limits.maxBytes) {
      throw new TypeError(`${path} may not exceed ${limits.maxBytes} bytes`)
    }
  }

  return function parseContribution(value: unknown, path: string) {
    const source = readContributionRecord(value, path)
    if (source.contractVersion !== contractVersion) {
      throw new TypeError(`${path}.contractVersion is not supported`)
    }
    const parsed = Object.freeze({
      providerId: identifier(source.providerId, `${path}.providerId`),
      contributionId: identifier(source.contributionId, `${path}.contributionId`),
      name: inertDisplayText(source.name, `${path}.name`, limits.maxNameLength),
      description: inertDisplayText(
        source.description,
        `${path}.description`,
        limits.maxDescriptionLength,
        true
      ),
      adapterId: identifier(source.adapterId, `${path}.adapterId`),
      contractVersion,
      supportedModelVersions: parseModelVersions(
        source.supportedModelVersions,
        `${path}.supportedModelVersions`
      ),
      capabilities: sortedUniqueArray(
        source.capabilities,
        `${path}.capabilities`,
        limits.maxCapabilities,
        capabilities,
        'backend capability'
      ),
      configuration: configuration(source.configuration, `${path}.configuration`),
      outputKinds: sortedUniqueArray(
        source.outputKinds,
        `${path}.outputKinds`,
        limits.maxOutputKinds,
        outputKinds,
        'backend output kind'
      ),
      permissions: permissions(source.permissions, `${path}.permissions`)
    })
    assertContributionSize(parsed, path)
    return parsed
  }
}
