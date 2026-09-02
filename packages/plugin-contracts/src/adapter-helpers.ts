/**
 * Bounded parsing helpers for reviewed host adapters.
 * These helpers validate data; they do not grant or execute plugin authority.
 */
import {
  parsePluginBackendProviderContribution,
  type PluginBackendProviderContributionV1
} from './backend-provider-contract'
import {
  assertBackendProviderInputDataProperties,
  assertInertBackendProviderText,
  backendProviderTextWords
} from './backend-provider-lexical'
import {
  parsePluginObjectParameterValue,
  type PluginParameterSchemaV2,
  type PluginParameterValue
} from './parameter-schema'

function allowsOpaqueIdentifier(name: string): boolean {
  const words = backendProviderTextWords(name)
  return words.includes('id') || words.includes('ref')
}

function freezePluginParameterValue(
  value: PluginParameterValue,
  schema: PluginParameterSchemaV2,
  allowOpaqueIdentifier: boolean,
  path: string
): PluginParameterValue {
  if (typeof value === 'string') {
    assertInertBackendProviderText(value, path, { allowOpaqueIdentifier })
    return value
  }
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    if (schema.type !== 'array') throw new TypeError(`${path} must match its reviewed schema`)
    value.forEach((entry, index) =>
      freezePluginParameterValue(entry, schema.items, allowOpaqueIdentifier, `${path}[${index}]`)
    )
    return Object.freeze(value)
  }
  if (schema.type !== 'object') throw new TypeError(`${path} must match its reviewed schema`)
  Object.entries(value).forEach(([name, entry], index) => {
    if (!Object.hasOwn(schema.properties, name)) {
      throw new TypeError(`${path}.values[${index}] is not reviewed`)
    }
    const propertySchema = schema.properties[name]
    freezePluginParameterValue(
      entry,
      propertySchema,
      allowsOpaqueIdentifier(name),
      `${path}.values[${index}]`
    )
  })
  return Object.freeze(value)
}

/** Validate and deeply freeze a defensive clone for a reviewed host/compiler adapter. */
export function parsePluginBackendProviderConfiguration(
  contribution: PluginBackendProviderContributionV1,
  value: unknown,
  path = 'backendProvider.configurationValue'
): Readonly<{ [key: string]: PluginParameterValue }> {
  assertBackendProviderInputDataProperties(value, path)
  const parsedContribution = parsePluginBackendProviderContribution(contribution)
  return freezePluginParameterValue(
    parsePluginObjectParameterValue(
      value,
      parsedContribution.configuration.schema,
      parsedContribution.configuration.maxBytes,
      path
    ),
    parsedContribution.configuration.schema,
    false,
    path
  ) as Readonly<{ [key: string]: PluginParameterValue }>
}

export * from './parse-helpers'
