import type {
  PluginConnectorOperationV1,
  PluginObjectParameterSchemaV2,
  PluginParameterSchemaPrimitive,
  PluginParameterSchemaType,
  PluginParameterSchemaV2
} from '@open-pencil/core/plugins'
import type { Locale } from '@open-pencil/vue'

import {
  BUNDLED_CONNECTOR_OPERATION_HELP,
  bundledConnectorOperationHelpKey,
  type ConnectorOperationLocalizedFieldText
} from './help-bundled'

export const CONNECTOR_OPERATION_HELP_LIMITS = Object.freeze({ maxFields: 128 })

export type ConnectorOperationFieldBounds = Readonly<{
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
  exclusiveMaximum?: number
  multipleOf?: number
  minItems?: number
  maxItems?: number
  minProperties?: number
  maxProperties?: number
}>

export type ConnectorOperationFieldHelp = Readonly<{
  path: string
  type: PluginParameterSchemaType
  itemType: PluginParameterSchemaType | null
  required: boolean
  label: string
  description: string
  enumValues: readonly PluginParameterSchemaPrimitive[]
  bounds: ConnectorOperationFieldBounds
  itemEnumValues: readonly PluginParameterSchemaPrimitive[]
  itemBounds: ConnectorOperationFieldBounds | null
  constraintTokens: readonly string[]
}>

export type ConnectorOperationHelp = Readonly<{
  fields: readonly ConnectorOperationFieldHelp[]
  truncated: boolean
  exampleJson: string | null
}>

function fieldBounds(schema: PluginParameterSchemaV2): ConnectorOperationFieldBounds {
  const bounds: Record<string, number> = {}
  function add(name: string, value: number | undefined): void {
    if (value !== undefined) bounds[name] = value
  }
  if (schema.type === 'string') {
    add('minLength', schema.minLength)
    add('maxLength', schema.maxLength)
  }
  if (schema.type === 'number' || schema.type === 'integer') {
    add('minimum', schema.minimum)
    add('maximum', schema.maximum)
    add('exclusiveMinimum', schema.exclusiveMinimum)
    add('exclusiveMaximum', schema.exclusiveMaximum)
    add('multipleOf', schema.multipleOf)
  }
  if (schema.type === 'array') {
    add('minItems', schema.minItems)
    add('maxItems', schema.maxItems)
  }
  if (schema.type === 'object') {
    add('minProperties', schema.minProperties)
    add('maxProperties', schema.maxProperties)
  }
  return Object.freeze(bounds)
}

function constraintTokens(
  schema: PluginParameterSchemaV2,
  bounds: ConnectorOperationFieldBounds,
  prefix = ''
): readonly string[] {
  const tokens: string[] = []
  if (schema.enum?.length) tokens.push(`${prefix}enum=${schema.enum.map(String).join('|')}`)
  for (const [name, value] of Object.entries(bounds)) {
    tokens.push(`${prefix}${name}=${value}`)
  }
  if (schema.type === 'array') {
    tokens.push(...constraintTokens(schema.items, fieldBounds(schema.items), `${prefix}items.`))
  }
  return Object.freeze(tokens)
}

function itemType(schema: PluginParameterSchemaV2): PluginParameterSchemaType | null {
  return schema.type === 'array' ? schema.items.type : null
}

function fallbackFieldName(path: string): string {
  const last = path.split('.').at(-1) ?? path
  return last.replace(/\[\]$/u, '')
}

function localizedFieldText(
  localized: ConnectorOperationLocalizedFieldText | undefined,
  locale: Locale
): Readonly<{ label: string; description: string }> | null {
  if (!localized) return null
  return locale === 'zh-CN' ? localized.zhCN : localized.en
}

function fieldHelp(
  path: string,
  schema: PluginParameterSchemaV2,
  required: boolean,
  localized: ConnectorOperationLocalizedFieldText | undefined,
  locale: Locale
): ConnectorOperationFieldHelp {
  const copy = localizedFieldText(localized, locale)
  const bounds = fieldBounds(schema)
  return Object.freeze({
    path,
    type: schema.type,
    itemType: itemType(schema),
    required,
    label: copy?.label ?? schema.title ?? fallbackFieldName(path),
    description: copy?.description ?? schema.description ?? schema.type,
    enumValues: Object.freeze([...(schema.enum ?? [])]),
    bounds,
    itemEnumValues: Object.freeze([...(schema.type === 'array' ? (schema.items.enum ?? []) : [])]),
    itemBounds: schema.type === 'array' ? fieldBounds(schema.items) : null,
    constraintTokens: constraintTokens(schema, bounds)
  })
}

function flattenObjectSchema(
  schema: PluginObjectParameterSchemaV2,
  localizedFields: Readonly<Record<string, ConnectorOperationLocalizedFieldText>>,
  locale: Locale
): Readonly<{ fields: readonly ConnectorOperationFieldHelp[]; truncated: boolean }> {
  const fields: ConnectorOperationFieldHelp[] = []
  let truncated = false

  function visitObject(current: PluginObjectParameterSchemaV2, prefix: string): void {
    const required = new Set(current.required)
    for (const [name, child] of Object.entries(current.properties)) {
      if (fields.length >= CONNECTOR_OPERATION_HELP_LIMITS.maxFields) {
        truncated = true
        return
      }
      const path = prefix ? `${prefix}.${name}` : name
      fields.push(fieldHelp(path, child, required.has(name), localizedFields[path], locale))
      if (child.type === 'object') visitObject(child, path)
      else if (child.type === 'array' && child.items.type === 'object') {
        visitObject(child.items, `${path}[]`)
      }
      if (truncated) return
    }
  }

  visitObject(schema, '')
  return Object.freeze({ fields: Object.freeze(fields), truncated })
}

export function connectorOperationHelp(
  pluginId: string,
  operation: PluginConnectorOperationV1,
  locale: Locale
): ConnectorOperationHelp {
  const definition =
    BUNDLED_CONNECTOR_OPERATION_HELP[
      bundledConnectorOperationHelpKey(pluginId, operation.operationId)
    ]
  const flattened = flattenObjectSchema(
    operation.parameters.schema,
    definition?.fields ?? Object.freeze({}),
    locale
  )
  const exampleJson = definition ? JSON.stringify(definition.example, null, 2) : null
  return Object.freeze({ ...flattened, exampleJson })
}
