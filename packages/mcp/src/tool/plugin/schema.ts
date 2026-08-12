import { z } from 'zod'

import { parsePluginObjectParameterSchema } from '@open-pencil/core/plugins'

import { PLUGIN_MCP_CATALOG_LIMITS, type PluginMCPToolKind } from '#mcp/tool/plugin/contract'

interface JSONRecord {
  [key: string]: unknown
}

interface SchemaWalkState {
  nodes: number
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
