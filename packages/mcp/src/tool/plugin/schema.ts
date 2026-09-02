import { z } from 'zod'

import { parsePluginObjectParameterSchema } from '@open-pencil/plugin-contracts'

import { PLUGIN_MCP_CATALOG_LIMITS, type PluginMCPToolKind } from '#mcp/tool/plugin/contract'

interface JSONRecord {
  [key: string]: unknown
}

interface SchemaWalkState {
  nodes: number
}

interface PluginMCPOutputSchemaIdentity {
  readonly pluginId: string
  readonly kind: PluginMCPToolKind
  readonly contributionId: string
}

const SCHEMA_KEYS = new Set([
  'type',
  'title',
  'description',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'minProperties',
  'maxProperties'
])
const SCHEMA_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object'])
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

function jsonBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function record(value: unknown, path: string): JSONRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must be a plain object`)
  }
  return value as JSONRecord
}

function exactDataRecord(
  value: unknown,
  path: string,
  expectedKeys: readonly string[]
): JSONRecord {
  const source = record(value, path)
  const keys = Reflect.ownKeys(source)
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) {
    throw new TypeError(`${path} must contain exactly: ${expectedKeys.join(', ')}`)
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${path}.${String(key)} must be an enumerable JSON data property`)
    }
  }
  return source
}

function exactStringEnumSchema(value: unknown, path: string, expected: readonly string[]): void {
  const schema = exactDataRecord(value, path, ['type', 'enum'])
  if (
    schema.type !== 'string' ||
    !Array.isArray(schema.enum) ||
    schema.enum.length !== expected.length ||
    schema.enum.some((entry, index) => entry !== expected[index])
  ) {
    throw new TypeError(`${path} must bind the exact output identity`)
  }
}

function exactStringArray(value: unknown, path: string, expected: readonly string[]): void {
  if (
    !Array.isArray(value) ||
    value.length !== expected.length ||
    value.some((entry, index) => entry !== expected[index])
  ) {
    throw new TypeError(`${path} must contain exactly: ${expected.join(', ')}`)
  }
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${path} must be a finite number`)
  }
  return value
}

function containsNul(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    if (value.charCodeAt(index) === 0) return true
  }
  return false
}

function schemaString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length > PLUGIN_MCP_CATALOG_LIMITS.maxSchemaStringLength) {
    throw new TypeError(
      `${path} must be a string of at most ${PLUGIN_MCP_CATALOG_LIMITS.maxSchemaStringLength} characters`
    )
  }
  if (containsNul(value)) throw new TypeError(`${path} must not contain NUL`)
  return value
}

function schemaEnum(value: unknown, path: string): readonly (string | number | boolean | null)[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new TypeError(`${path} must be a non-empty array with at most 100 entries`)
  }
  const parsed = value.map((entry, index) => {
    if (entry === null || typeof entry === 'boolean') return entry
    if (typeof entry === 'string') return schemaString(entry, `${path}[${index}]`)
    if (typeof entry === 'number') return finiteNumber(entry, `${path}[${index}]`)
    throw new TypeError(`${path}[${index}] must be a JSON primitive`)
  })
  if (new Set(parsed.map((entry) => JSON.stringify(entry))).size !== parsed.length) {
    throw new TypeError(`${path} entries must be unique`)
  }
  return Object.freeze(parsed)
}

function schemaStringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value) || value.length > 128) {
    throw new TypeError(`${path} must be an array with at most 128 entries`)
  }
  const parsed = value.map((entry, index) => schemaString(entry, `${path}[${index}]`))
  if (new Set(parsed).size !== parsed.length) throw new TypeError(`${path} entries must be unique`)
  return Object.freeze(parsed)
}

function schemaProperties(
  value: unknown,
  path: string,
  depth: number,
  state: SchemaWalkState
): Readonly<JSONRecord> {
  const properties = record(value, path)
  if (Object.keys(properties).length > 128) {
    throw new TypeError(`${path} may contain at most 128 properties`)
  }
  const parsed: JSONRecord = {}
  for (const [propertyName, propertySchema] of Object.entries(properties)) {
    if (
      FORBIDDEN_KEYS.has(propertyName) ||
      propertyName.length === 0 ||
      propertyName.length > 128
    ) {
      throw new TypeError(`${path} contains an invalid property name`)
    }
    parsed[propertyName] = schemaNode(propertySchema, `${path}.${propertyName}`, depth + 1, state)
  }
  return Object.freeze(parsed)
}

function schemaEntry(
  key: string,
  value: unknown,
  path: string,
  depth: number,
  state: SchemaWalkState
): unknown {
  if (FORBIDDEN_KEYS.has(key) || !SCHEMA_KEYS.has(key)) {
    throw new TypeError(`${path} is not supported`)
  }
  if (key === 'type') {
    if (typeof value !== 'string' || !SCHEMA_TYPES.has(value)) {
      throw new TypeError(`${path} is not a supported JSON Schema type`)
    }
    return value
  }
  if (key === 'title' || key === 'description') return schemaString(value, path)
  if (key === 'properties') return schemaProperties(value, path, depth, state)
  if (key === 'required') return schemaStringArray(value, path)
  if (key === 'additionalProperties') {
    if (typeof value !== 'boolean') throw new TypeError(`${path} must be a boolean`)
    return value
  }
  if (key === 'items') return schemaNode(value, path, depth + 1, state)
  if (key === 'enum') return schemaEnum(value, path)
  return finiteNumber(value, path)
}

function schemaNode(
  value: unknown,
  path: string,
  depth: number,
  state: SchemaWalkState
): Readonly<JSONRecord> {
  if (depth > PLUGIN_MCP_CATALOG_LIMITS.maxSchemaDepth) {
    throw new TypeError(`${path} exceeds the JSON Schema depth limit`)
  }
  state.nodes += 1
  if (state.nodes > PLUGIN_MCP_CATALOG_LIMITS.maxSchemaNodes) {
    throw new TypeError(`${path} exceeds the JSON Schema node limit`)
  }
  const source = record(value, path)
  const parsed: JSONRecord = {}
  for (const [key, entry] of Object.entries(source)) {
    parsed[key] = schemaEntry(key, entry, `${path}.${key}`, depth, state)
  }
  return Object.freeze(parsed)
}

export function parsePluginMCPInputSchema(
  value: unknown,
  path: string,
  kind: PluginMCPToolKind
): Readonly<Record<string, unknown>> {
  if (kind === 'command' || kind === 'exporter' || kind === 'connector') {
    const parsed = parsePluginObjectParameterSchema(value, path, {
      reserveAutomationTargets: true
    })
    const wireSchema = record(parsed, path)
    try {
      z.fromJSONSchema(wireSchema)
    } catch (cause) {
      throw new TypeError(`${path} could not be converted to a runtime schema`, { cause })
    }
    return wireSchema
  }
  if (jsonBytes(value) > PLUGIN_MCP_CATALOG_LIMITS.maxSchemaBytes) {
    throw new TypeError(`${path} exceeds the JSON Schema byte limit`)
  }
  const parsed = schemaNode(value, path, 0, { nodes: 0 })
  if (parsed.type !== 'object') throw new TypeError(`${path}.type must be object`)
  const properties = record(parsed.properties ?? {}, `${path}.properties`)
  if (Object.hasOwn(properties, 'document_id') || Object.hasOwn(properties, 'page_id')) {
    throw new TypeError(`${path} must not declare reserved automation target properties`)
  }
  const required = Array.isArray(parsed.required) ? parsed.required : []
  for (const requiredName of required) {
    if (!Object.hasOwn(properties, requiredName)) {
      throw new TypeError(`${path}.required must only reference declared properties`)
    }
  }
  try {
    z.fromJSONSchema(parsed)
  } catch (cause) {
    throw new TypeError(`${path} could not be converted to a runtime schema`, { cause })
  }
  return parsed
}

export function parsePluginMCPOutputSchema(
  value: unknown,
  path: string,
  identity: PluginMCPOutputSchemaIdentity
): Readonly<Record<string, unknown>> {
  if (identity.kind !== 'command' && identity.kind !== 'exporter') {
    throw new TypeError(`${path} is supported only for command and exporter tools`)
  }
  if (jsonBytes(value) > PLUGIN_MCP_CATALOG_LIMITS.maxSchemaBytes) {
    throw new TypeError(`${path} exceeds the JSON Schema byte limit`)
  }
  const source = exactDataRecord(value, path, [
    'type',
    'properties',
    'required',
    'additionalProperties',
    'minProperties',
    'maxProperties'
  ])
  const properties = exactDataRecord(source.properties, `${path}.properties`, [
    'pluginId',
    'kind',
    'contributionId',
    'status',
    'message',
    'data'
  ])
  const dataSchema = parsePluginObjectParameterSchema(properties.data, `${path}.properties.data`)
  const dataRequired =
    (dataSchema.required?.length ?? 0) > 0 ||
    (typeof dataSchema.minProperties === 'number' && dataSchema.minProperties > 0)
  const required = [
    'pluginId',
    'kind',
    'contributionId',
    'status',
    'message',
    ...(dataRequired ? ['data'] : [])
  ]
  const emptyDataSchema = Object.freeze({
    type: 'object' as const,
    properties: Object.freeze({}),
    additionalProperties: false
  })
  const parsedShell = parsePluginObjectParameterSchema(
    {
      ...source,
      properties: { ...properties, data: emptyDataSchema }
    },
    path
  )
  if (parsedShell.minProperties !== required.length || parsedShell.maxProperties !== 6) {
    throw new TypeError(`${path} must use the exact execution output property bounds`)
  }
  exactStringArray(parsedShell.required, `${path}.required`, required)
  exactStringEnumSchema(parsedShell.properties.pluginId, `${path}.properties.pluginId`, [
    identity.pluginId
  ])
  exactStringEnumSchema(parsedShell.properties.kind, `${path}.properties.kind`, [identity.kind])
  exactStringEnumSchema(
    parsedShell.properties.contributionId,
    `${path}.properties.contributionId`,
    [identity.contributionId]
  )
  exactStringEnumSchema(parsedShell.properties.status, `${path}.properties.status`, [
    'completed',
    'cancelled'
  ])
  const messageSchema = exactDataRecord(
    parsedShell.properties.message,
    `${path}.properties.message`,
    ['type', 'minLength', 'maxLength']
  )
  if (
    messageSchema.type !== 'string' ||
    messageSchema.minLength !== 1 ||
    messageSchema.maxLength !== PLUGIN_MCP_CATALOG_LIMITS.maxDescriptionLength
  ) {
    throw new TypeError(`${path}.properties.message must use the exact bounded message contract`)
  }
  const wireSchema = record(
    Object.freeze({
      ...parsedShell,
      properties: Object.freeze({
        ...parsedShell.properties,
        data: dataSchema
      })
    }),
    path
  )
  try {
    z.fromJSONSchema(wireSchema)
  } catch (cause) {
    throw new TypeError(`${path} could not be converted to a runtime schema`, { cause })
  }
  return wireSchema
}
