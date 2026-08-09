/* eslint-disable max-lines -- Schema and value validation share one bounded contract surface. */
export const PLUGIN_PARAMETER_SCHEMA_LIMITS = Object.freeze({
  maxBytes: 32 * 1024,
  maxDepth: 12,
  maxNodes: 512,
  maxProperties: 128,
  maxEnumValues: 100,
  maxStringLength: 4_096,
  maxPropertyNameLength: 128
})

export const PLUGIN_PARAMETER_VALUE_LIMITS = Object.freeze({
  maxBytes: 512 * 1024,
  maxNodes: 65_536,
  maxStringLength: 512 * 1024
})

export type PluginParameterSchemaPrimitive = string | number | boolean | null
export type PluginParameterSchemaType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'array'
  | 'object'

interface PluginParameterSchemaBaseV2 {
  readonly title?: string
  readonly description?: string
  readonly enum?: readonly PluginParameterSchemaPrimitive[]
}

export interface PluginStringParameterSchemaV2 extends PluginParameterSchemaBaseV2 {
  readonly type: 'string'
  readonly minLength?: number
  readonly maxLength?: number
}

export interface PluginNumberParameterSchemaV2 extends PluginParameterSchemaBaseV2 {
  readonly type: 'number' | 'integer'
  readonly minimum?: number
  readonly maximum?: number
  readonly exclusiveMinimum?: number
  readonly exclusiveMaximum?: number
  readonly multipleOf?: number
}

export interface PluginBooleanParameterSchemaV2 extends PluginParameterSchemaBaseV2 {
  readonly type: 'boolean'
}

export interface PluginArrayParameterSchemaV2 extends PluginParameterSchemaBaseV2 {
  readonly type: 'array'
  readonly items: PluginParameterSchemaV2
  readonly minItems?: number
  readonly maxItems?: number
}

export interface PluginObjectParameterSchemaV2 extends PluginParameterSchemaBaseV2 {
  readonly type: 'object'
  readonly properties: Readonly<Record<string, PluginParameterSchemaV2>>
  readonly required?: readonly string[]
  readonly additionalProperties: false
  readonly minProperties?: number
  readonly maxProperties?: number
}

/**
 * Shared bounded JSON object contract used by manifest contributions and connector operations.
 *
 * This lives beside the schema parser so connector contracts can be embedded in a manifest
 * without introducing a manifest <-> connector-contract module cycle.
 */
export interface PluginContributionDataContractV2 {
  readonly schema: PluginObjectParameterSchemaV2
  readonly maxBytes: number
}

export type PluginParameterSchemaV2 =
  | PluginStringParameterSchemaV2
  | PluginNumberParameterSchemaV2
  | PluginBooleanParameterSchemaV2
  | PluginArrayParameterSchemaV2
  | PluginObjectParameterSchemaV2

export type PluginParameterValuePrimitive = string | number | boolean | null
export type PluginParameterValue =
  | PluginParameterValuePrimitive
  | readonly PluginParameterValue[]
  | Readonly<{ [key: string]: PluginParameterValue }>

interface SchemaWalkState {
  nodes: number
}

interface PluginSchemaRecord {
  [key: string]: unknown
}

type PluginSchemaCommon = Pick<PluginParameterSchemaBaseV2, 'title' | 'description' | 'enum'>

const COMMON_KEYS = new Set(['type', 'title', 'description', 'enum'])
const TYPE_KEYS = Object.freeze({
  string: new Set([...COMMON_KEYS, 'minLength', 'maxLength']),
  number: new Set([
    ...COMMON_KEYS,
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'multipleOf'
  ]),
  integer: new Set([
    ...COMMON_KEYS,
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'multipleOf'
  ]),
  boolean: COMMON_KEYS,
  array: new Set([...COMMON_KEYS, 'items', 'minItems', 'maxItems']),
  object: new Set([
    ...COMMON_KEYS,
    'properties',
    'required',
    'additionalProperties',
    'minProperties',
    'maxProperties'
  ])
})
const SCHEMA_TYPES = new Set<PluginParameterSchemaType>([
  'string',
  'number',
  'integer',
  'boolean',
  'array',
  'object'
])
const UNSAFE_PROPERTY_NAMES = new Set(['__proto__', 'prototype', 'constructor'])
const RESERVED_PARAMETER_NAMES = new Set(['document_id', 'page_id'])
const SCHEMA_INPUT_MAX_DEPTH = PLUGIN_PARAMETER_SCHEMA_LIMITS.maxDepth * 3 + 4
const JSON_ENCODER = new TextEncoder()

interface SchemaInputWalkState {
  nodes: number
  bytes: number
  readonly ancestors: WeakSet<object>
}

function addSchemaInputBytes(state: SchemaInputWalkState, bytes: number, path: string): void {
  state.bytes += bytes
  if (state.bytes > PLUGIN_PARAMETER_SCHEMA_LIMITS.maxBytes) {
    throw new TypeError(`${path} exceeds the JSON Schema byte limit`)
  }
}

function primitiveJsonBytes(value: PluginParameterSchemaPrimitive): number {
  return JSON_ENCODER.encode(JSON.stringify(value)).byteLength
}

function schemaInputDataProperty(descriptor: PropertyDescriptor, path: string): unknown {
  if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
    throw new TypeError(`${path} must only contain enumerable JSON data properties`)
  }
  return descriptor.value
}

function boundedOwnKeys(
  value: object,
  path: string,
  maximum: number,
  limitName: 'JSON Schema' | 'JSON value'
): readonly PropertyKey[] {
  const keys = Reflect.ownKeys(value)
  if (keys.length > maximum) {
    throw new TypeError(`${path} exceeds the ${limitName} node limit`)
  }
  return keys
}

function plainArrayKeys(
  value: readonly unknown[],
  path: string,
  maximum: number,
  limitName: 'JSON Schema' | 'JSON value'
): readonly PropertyKey[] {
  const keys = boundedOwnKeys(value, path, maximum, limitName)
  if (
    keys.some(
      (key) =>
        typeof key !== 'string' ||
        (key !== 'length' && (!/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))
    )
  ) {
    throw new TypeError(`${path} must not contain custom array properties`)
  }
  return keys
}

function plainRecordKeys(
  value: object,
  path: string,
  maximum: number,
  limitName: 'JSON Schema' | 'JSON value'
): readonly string[] {
  const keys = boundedOwnKeys(value, path, maximum, limitName)
  if (keys.some((key) => typeof key !== 'string')) {
    throw new TypeError(`${path} must not contain symbol properties`)
  }
  return keys as string[]
}

function cloneSchemaInputArray(
  value: readonly unknown[],
  path: string,
  depth: number,
  state: SchemaInputWalkState
): readonly unknown[] {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${path} must be a plain array`)
  }
  if (value.length > PLUGIN_PARAMETER_SCHEMA_LIMITS.maxNodes) {
    throw new TypeError(`${path} exceeds the JSON Schema node limit`)
  }
  plainArrayKeys(value, path, PLUGIN_PARAMETER_SCHEMA_LIMITS.maxNodes + 1, 'JSON Schema')
  addSchemaInputBytes(state, 2 + Math.max(0, value.length - 1), path)
  state.ancestors.add(value)
  try {
    const cloned: unknown[] = []
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor) throw new TypeError(`${path} must not contain array holes`)
      const entry = schemaInputDataProperty(descriptor, `${path}[${index}]`)
      cloned.push(cloneSchemaInputNode(entry, `${path}[${index}]`, depth + 1, state))
    }
    return Object.freeze(cloned)
  } finally {
    state.ancestors.delete(value)
  }
}

function cloneSchemaInputRecord(
  value: object,
  path: string,
  depth: number,
  state: SchemaInputWalkState
): PluginSchemaRecord {
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must be a plain object`)
  }
  const stringKeys = plainRecordKeys(
    value,
    path,
    PLUGIN_PARAMETER_SCHEMA_LIMITS.maxNodes,
    'JSON Schema'
  )
  addSchemaInputBytes(state, 2 + Math.max(0, stringKeys.length - 1), path)
  state.ancestors.add(value)
  try {
    const cloned: PluginSchemaRecord = Object.create(null) as PluginSchemaRecord
    for (const key of stringKeys) {
      if (key.length > PLUGIN_PARAMETER_SCHEMA_LIMITS.maxPropertyNameLength) {
        throw new TypeError(`${path} contains an oversized property name`)
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor) throw new TypeError(`${path}.${key} is unavailable`)
      const entry = schemaInputDataProperty(descriptor, `${path}.${key}`)
      addSchemaInputBytes(state, primitiveJsonBytes(key) + 1, `${path}.${key}`)
      Object.defineProperty(cloned, key, {
        value: cloneSchemaInputNode(entry, `${path}.${key}`, depth + 1, state),
        enumerable: true,
        configurable: false,
        writable: false
      })
    }
    return Object.freeze(cloned)
  } finally {
    state.ancestors.delete(value)
  }
}

function cloneSchemaInputNode(
  value: unknown,
  path: string,
  depth: number,
  state: SchemaInputWalkState
): unknown {
  if (depth > SCHEMA_INPUT_MAX_DEPTH) {
    throw new TypeError(`${path} exceeds the JSON Schema input depth limit`)
  }
  state.nodes += 1
  if (state.nodes > PLUGIN_PARAMETER_SCHEMA_LIMITS.maxNodes) {
    throw new TypeError(`${path} exceeds the JSON Schema node limit`)
  }
  if (value === null || typeof value === 'boolean') {
    addSchemaInputBytes(state, primitiveJsonBytes(value), path)
    return value
  }
  if (typeof value === 'string') {
    if (value.length > PLUGIN_PARAMETER_SCHEMA_LIMITS.maxBytes) {
      throw new TypeError(`${path} exceeds the JSON Schema byte limit`)
    }
    addSchemaInputBytes(state, primitiveJsonBytes(value), path)
    if (value.length > PLUGIN_PARAMETER_SCHEMA_LIMITS.maxStringLength) {
      throw new TypeError(`${path} exceeds the JSON Schema string length limit`)
    }
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} must be a finite number`)
    addSchemaInputBytes(state, primitiveJsonBytes(value), path)
    return value
  }
  if (typeof value !== 'object') {
    throw new TypeError(`${path} must contain only JSON values`)
  }
  if (state.ancestors.has(value)) throw new TypeError(`${path} must not contain circular values`)
  return Array.isArray(value)
    ? cloneSchemaInputArray(value, path, depth, state)
    : cloneSchemaInputRecord(value, path, depth, state)
}

function cloneSchemaInput(value: unknown, path: string): unknown {
  return cloneSchemaInputNode(value, path, 0, {
    nodes: 0,
    bytes: 0,
    ancestors: new WeakSet()
  })
}

function encodedBytes(value: unknown): number {
  if (
    value === undefined ||
    typeof value === 'bigint' ||
    typeof value === 'function' ||
    typeof value === 'symbol'
  ) {
    return Number.POSITIVE_INFINITY
  }
  try {
    const serialized = JSON.stringify(value)
    return JSON_ENCODER.encode(serialized).byteLength
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function plainRecord(value: unknown, path: string): PluginSchemaRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must be a plain object`)
  }
  return value as PluginSchemaRecord
}

function schemaText(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length > PLUGIN_PARAMETER_SCHEMA_LIMITS.maxStringLength) {
    throw new TypeError(
      `${path} must be a string of at most ${PLUGIN_PARAMETER_SCHEMA_LIMITS.maxStringLength} characters`
    )
  }
  if (value.normalize('NFC') !== value) throw new TypeError(`${path} must use NFC normalization`)
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint <= 31 || codePoint === 127) {
      throw new TypeError(`${path} must not contain control characters`)
    }
  }
  return value
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${path} must be a finite number`)
  }
  return value
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer`)
  }
  return value as number
}

function primitiveMatchesType(
  value: PluginParameterSchemaPrimitive,
  type: PluginParameterSchemaType
): boolean {
  if (value === null) return false
  if (type === 'string') return typeof value === 'string'
  if (type === 'number') return typeof value === 'number'
  if (type === 'integer') return typeof value === 'number' && Number.isSafeInteger(value)
  if (type === 'boolean') return typeof value === 'boolean'
  return false
}

function schemaEnum(
  value: unknown,
  path: string,
  type: PluginParameterSchemaType
): readonly PluginParameterSchemaPrimitive[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > PLUGIN_PARAMETER_SCHEMA_LIMITS.maxEnumValues
  ) {
    throw new TypeError(
      `${path} must contain between 1 and ${PLUGIN_PARAMETER_SCHEMA_LIMITS.maxEnumValues} entries`
    )
  }
  const parsed = value.map((entry, index): PluginParameterSchemaPrimitive => {
    if (typeof entry === 'string') return schemaText(entry, `${path}[${index}]`)
    if (typeof entry === 'number') return finiteNumber(entry, `${path}[${index}]`)
    if (typeof entry === 'boolean' || entry === null) return entry
    throw new TypeError(`${path}[${index}] must be a JSON primitive`)
  })
  if (type === 'array' || type === 'object') {
    throw new TypeError(`${path} is not supported for ${type} schemas`)
  }
  if (parsed.some((entry) => !primitiveMatchesType(entry, type))) {
    throw new TypeError(`${path} entries must match schema type ${type}`)
  }
  if (new Set(parsed.map((entry) => JSON.stringify(entry))).size !== parsed.length) {
    throw new TypeError(`${path} entries must be unique`)
  }
  return Object.freeze(parsed)
}

function assertOnlySupportedKeys(
  source: PluginSchemaRecord,
  path: string,
  type: PluginParameterSchemaType
): void {
  const allowed = TYPE_KEYS[type]
  for (const key of Object.keys(source)) {
    if (!allowed.has(key)) throw new TypeError(`${path}.${key} is not supported`)
  }
}

function schemaBound(value: unknown, path: string, integer: boolean): number {
  return integer ? nonNegativeInteger(value, path) : finiteNumber(value, path)
}

function parseBounds(
  source: PluginSchemaRecord,
  path: string,
  minimumKey: 'minimum' | 'minLength' | 'minItems' | 'minProperties',
  maximumKey: 'maximum' | 'maxLength' | 'maxItems' | 'maxProperties',
  integer: boolean
): Partial<Record<string, number>> {
  const minimum = Object.hasOwn(source, minimumKey)
    ? schemaBound(source[minimumKey], `${path}.${minimumKey}`, integer)
    : undefined
  const maximum = Object.hasOwn(source, maximumKey)
    ? schemaBound(source[maximumKey], `${path}.${maximumKey}`, integer)
    : undefined
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
    throw new TypeError(`${path}.${minimumKey} may not exceed ${path}.${maximumKey}`)
  }
  return {
    ...(minimum === undefined ? {} : { [minimumKey]: minimum }),
    ...(maximum === undefined ? {} : { [maximumKey]: maximum })
  }
}

function propertyName(value: string, path: string): string {
  if (
    value.length === 0 ||
    value.length > PLUGIN_PARAMETER_SCHEMA_LIMITS.maxPropertyNameLength ||
    value.normalize('NFC') !== value ||
    UNSAFE_PROPERTY_NAMES.has(value)
  ) {
    throw new TypeError(`${path} contains an invalid property name`)
  }
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint <= 31 || codePoint === 127) {
      throw new TypeError(`${path} contains an invalid property name`)
    }
  }
  return value
}

function schemaType(source: PluginSchemaRecord, path: string): PluginParameterSchemaType {
  if (
    typeof source.type !== 'string' ||
    !SCHEMA_TYPES.has(source.type as PluginParameterSchemaType)
  ) {
    throw new TypeError(`${path}.type is not a supported JSON Schema type`)
  }
  return source.type as PluginParameterSchemaType
}

function commonSchemaEntries(
  source: PluginSchemaRecord,
  path: string,
  type: PluginParameterSchemaType
): PluginSchemaCommon {
  return {
    ...(Object.hasOwn(source, 'title') ? { title: schemaText(source.title, `${path}.title`) } : {}),
    ...(Object.hasOwn(source, 'description')
      ? { description: schemaText(source.description, `${path}.description`) }
      : {}),
    ...(Object.hasOwn(source, 'enum')
      ? { enum: schemaEnum(source.enum, `${path}.enum`, type) }
      : {})
  }
}

function numberSchema(
  source: PluginSchemaRecord,
  path: string,
  type: 'number' | 'integer',
  common: PluginSchemaCommon
): PluginNumberParameterSchemaV2 {
  const numberBounds = parseBounds(source, path, 'minimum', 'maximum', false)
  const exclusiveMinimum = Object.hasOwn(source, 'exclusiveMinimum')
    ? finiteNumber(source.exclusiveMinimum, `${path}.exclusiveMinimum`)
    : undefined
  const exclusiveMaximum = Object.hasOwn(source, 'exclusiveMaximum')
    ? finiteNumber(source.exclusiveMaximum, `${path}.exclusiveMaximum`)
    : undefined
  if (
    exclusiveMinimum !== undefined &&
    exclusiveMaximum !== undefined &&
    exclusiveMinimum >= exclusiveMaximum
  ) {
    throw new TypeError(`${path}.exclusiveMinimum must be less than ${path}.exclusiveMaximum`)
  }
  const multipleOf = Object.hasOwn(source, 'multipleOf')
    ? finiteNumber(source.multipleOf, `${path}.multipleOf`)
    : undefined
  if (multipleOf !== undefined && multipleOf <= 0) {
    throw new TypeError(`${path}.multipleOf must be greater than zero`)
  }
  return Object.freeze({
    type,
    ...common,
    ...numberBounds,
    ...(exclusiveMinimum === undefined ? {} : { exclusiveMinimum }),
    ...(exclusiveMaximum === undefined ? {} : { exclusiveMaximum }),
    ...(multipleOf === undefined ? {} : { multipleOf })
  }) as PluginNumberParameterSchemaV2
}

function objectProperties(
  source: PluginSchemaRecord,
  path: string,
  depth: number,
  state: SchemaWalkState
): Readonly<Record<string, PluginParameterSchemaV2>> {
  const rawProperties = Object.hasOwn(source, 'properties')
    ? plainRecord(source.properties, `${path}.properties`)
    : {}
  const entries = Object.entries(rawProperties)
  if (entries.length > PLUGIN_PARAMETER_SCHEMA_LIMITS.maxProperties) {
    throw new TypeError(
      `${path}.properties may contain at most ${PLUGIN_PARAMETER_SCHEMA_LIMITS.maxProperties} properties`
    )
  }
  const properties: Record<string, PluginParameterSchemaV2> = {}
  for (const [rawName, propertySchema] of entries) {
    const name = propertyName(rawName, `${path}.properties`)
    properties[name] = parseSchemaNode(
      propertySchema,
      `${path}.properties.${name}`,
      depth + 1,
      state
    )
  }
  return Object.freeze(properties)
}

function requiredProperties(
  source: PluginSchemaRecord,
  path: string,
  properties: Readonly<Record<string, PluginParameterSchemaV2>>
): readonly string[] | undefined {
  if (!Object.hasOwn(source, 'required')) return undefined
  if (
    !Array.isArray(source.required) ||
    source.required.length > PLUGIN_PARAMETER_SCHEMA_LIMITS.maxProperties
  ) {
    throw new TypeError(
      `${path}.required must be an array with at most ${PLUGIN_PARAMETER_SCHEMA_LIMITS.maxProperties} entries`
    )
  }
  const required = source.required.map((entry, index) => {
    if (typeof entry !== 'string') {
      throw new TypeError(`${path}.required[${index}] must be a string`)
    }
    return propertyName(entry, `${path}.required`)
  })
  if (new Set(required).size !== required.length) {
    throw new TypeError(`${path}.required entries must be unique`)
  }
  if (required.some((name) => !Object.hasOwn(properties, name))) {
    throw new TypeError(`${path}.required must only reference declared properties`)
  }
  return Object.freeze(required)
}

function objectSchema(
  source: PluginSchemaRecord,
  path: string,
  depth: number,
  state: SchemaWalkState,
  common: PluginSchemaCommon
): PluginObjectParameterSchemaV2 {
  if (Object.hasOwn(source, 'additionalProperties') && source.additionalProperties !== false) {
    throw new TypeError(`${path}.additionalProperties must be false`)
  }
  const properties = objectProperties(source, path, depth, state)
  const required = requiredProperties(source, path, properties)
  return Object.freeze({
    type: 'object',
    ...common,
    properties,
    ...(required ? { required } : {}),
    additionalProperties: false,
    ...parseBounds(source, path, 'minProperties', 'maxProperties', true)
  }) as PluginObjectParameterSchemaV2
}

function parseSchemaNode(
  value: unknown,
  path: string,
  depth: number,
  state: SchemaWalkState
): PluginParameterSchemaV2 {
  if (depth > PLUGIN_PARAMETER_SCHEMA_LIMITS.maxDepth) {
    throw new TypeError(`${path} exceeds the JSON Schema depth limit`)
  }
  state.nodes += 1
  if (state.nodes > PLUGIN_PARAMETER_SCHEMA_LIMITS.maxNodes) {
    throw new TypeError(`${path} exceeds the JSON Schema node limit`)
  }
  const source = plainRecord(value, path)
  const type = schemaType(source, path)
  assertOnlySupportedKeys(source, path, type)
  const common = commonSchemaEntries(source, path, type)
  if (type === 'string') {
    return Object.freeze({
      type,
      ...common,
      ...parseBounds(source, path, 'minLength', 'maxLength', true)
    }) as PluginStringParameterSchemaV2
  }
  if (type === 'number' || type === 'integer') {
    return numberSchema(source, path, type, common)
  }
  if (type === 'boolean') return Object.freeze({ type, ...common })
  if (type === 'array') {
    if (!Object.hasOwn(source, 'items')) throw new TypeError(`${path}.items is required`)
    return Object.freeze({
      type,
      ...common,
      items: parseSchemaNode(source.items, `${path}.items`, depth + 1, state),
      ...parseBounds(source, path, 'minItems', 'maxItems', true)
    }) as PluginArrayParameterSchemaV2
  }
  return objectSchema(source, path, depth, state, common)
}

export interface ParsePluginParameterSchemaOptions {
  readonly reserveAutomationTargets?: boolean
}

export function parsePluginParameterSchema(
  value: unknown,
  path = 'plugin parameter schema',
  options: ParsePluginParameterSchemaOptions = {}
): PluginParameterSchemaV2 {
  const normalized = cloneSchemaInput(value, path)
  const parsed = parseSchemaNode(normalized, path, 0, { nodes: 0 })
  if (options.reserveAutomationTargets && parsed.type === 'object') {
    for (const reserved of RESERVED_PARAMETER_NAMES) {
      if (Object.hasOwn(parsed.properties, reserved)) {
        throw new TypeError(
          `${path} must not declare reserved automation target property ${reserved}`
        )
      }
    }
  }
  return parsed
}

export function parsePluginObjectParameterSchema(
  value: unknown,
  path = 'plugin parameter schema',
  options: ParsePluginParameterSchemaOptions = {}
): PluginObjectParameterSchemaV2 {
  const parsed = parsePluginParameterSchema(value, path, options)
  if (parsed.type !== 'object') throw new TypeError(`${path}.type must be object`)
  return parsed
}

interface ParameterValueWalkState {
  nodes: number
  bytes: number
  readonly maxBytes: number
  readonly ancestors: WeakSet<object>
}

function addParameterValueBytes(state: ParameterValueWalkState, bytes: number, path: string): void {
  state.bytes += bytes
  if (state.bytes > state.maxBytes) {
    throw new TypeError(`${path} exceeds the ${state.maxBytes}-byte contract limit`)
  }
}

function assertDataProperty(descriptor: PropertyDescriptor, path: string): void {
  if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
    throw new TypeError(`${path} must only contain enumerable JSON data properties`)
  }
}

function parameterEnum(
  schema: PluginParameterSchemaV2,
  value: PluginParameterValuePrimitive,
  path: string
): void {
  if (schema.enum && !schema.enum.some((candidate) => candidate === value)) {
    throw new TypeError(`${path} is not one of the allowed enum values`)
  }
}

function parameterString(
  value: unknown,
  schema: PluginStringParameterSchemaV2,
  path: string
): string {
  if (typeof value !== 'string') throw new TypeError(`${path} must be a string`)
  if (value.length > PLUGIN_PARAMETER_VALUE_LIMITS.maxStringLength) {
    throw new TypeError(`${path} exceeds the global string length limit`)
  }
  let length = 0
  for (const _character of value) length += 1
  if (schema.minLength !== undefined && length < schema.minLength) {
    throw new TypeError(`${path} must contain at least ${schema.minLength} characters`)
  }
  if (schema.maxLength !== undefined && length > schema.maxLength) {
    throw new TypeError(`${path} must contain at most ${schema.maxLength} characters`)
  }
  parameterEnum(schema, value, path)
  return value
}

function isMultipleOf(value: number, multiple: number): boolean {
  const quotient = value / multiple
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(quotient)) * 8
  return Math.abs(quotient - Math.round(quotient)) <= tolerance
}

function parameterNumber(
  value: unknown,
  schema: PluginNumberParameterSchemaV2,
  path: string
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${path} must be a finite number`)
  }
  if (schema.type === 'integer' && !Number.isSafeInteger(value)) {
    throw new TypeError(`${path} must be a safe integer`)
  }
  if (schema.minimum !== undefined && value < schema.minimum) {
    throw new TypeError(`${path} must be at least ${schema.minimum}`)
  }
  if (schema.maximum !== undefined && value > schema.maximum) {
    throw new TypeError(`${path} must be at most ${schema.maximum}`)
  }
  if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
    throw new TypeError(`${path} must be greater than ${schema.exclusiveMinimum}`)
  }
  if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) {
    throw new TypeError(`${path} must be less than ${schema.exclusiveMaximum}`)
  }
  if (schema.multipleOf !== undefined && !isMultipleOf(value, schema.multipleOf)) {
    throw new TypeError(`${path} must be a multiple of ${schema.multipleOf}`)
  }
  parameterEnum(schema, value, path)
  return value
}

function enterParameterContainer(
  value: object,
  path: string,
  state: ParameterValueWalkState
): void {
  if (state.ancestors.has(value)) throw new TypeError(`${path} must not contain circular values`)
  state.ancestors.add(value)
}

function parameterArray(
  value: unknown,
  schema: PluginArrayParameterSchemaV2,
  path: string,
  state: ParameterValueWalkState
): readonly PluginParameterValue[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${path} must be a plain array`)
  }
  if (value.length > PLUGIN_PARAMETER_VALUE_LIMITS.maxNodes) {
    throw new TypeError(`${path} exceeds the JSON value node limit`)
  }
  addParameterValueBytes(state, 2 + Math.max(0, value.length - 1), path)
  enterParameterContainer(value, path, state)
  try {
    plainArrayKeys(value, path, PLUGIN_PARAMETER_VALUE_LIMITS.maxNodes, 'JSON value')
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) throw new TypeError(`${path} must not contain array holes`)
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor) throw new TypeError(`${path}[${index}] is unavailable`)
      assertDataProperty(descriptor, `${path}[${index}]`)
    }
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      throw new TypeError(`${path} must contain at least ${schema.minItems} items`)
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      throw new TypeError(`${path} must contain at most ${schema.maxItems} items`)
    }
    return Object.freeze(
      value.map((entry, index) =>
        parameterValueNode(entry, schema.items, `${path}[${index}]`, state)
      )
    )
  } finally {
    state.ancestors.delete(value)
  }
}

function parameterObject(
  value: unknown,
  schema: PluginObjectParameterSchemaV2,
  path: string,
  state: ParameterValueWalkState
): Readonly<{ [key: string]: PluginParameterValue }> {
  const source = plainRecord(value, path)
  enterParameterContainer(source, path, state)
  try {
    const stringKeys = plainRecordKeys(
      source,
      path,
      PLUGIN_PARAMETER_VALUE_LIMITS.maxNodes,
      'JSON value'
    )
    addParameterValueBytes(state, 2 + Math.max(0, stringKeys.length - 1), path)
    for (const key of stringKeys) {
      if (UNSAFE_PROPERTY_NAMES.has(key)) throw new TypeError(`${path} contains unsafe key ${key}`)
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor) throw new TypeError(`${path}.${key} is unavailable`)
      assertDataProperty(descriptor, `${path}.${key}`)
      if (!Object.hasOwn(schema.properties, key)) {
        throw new TypeError(`${path}.${key} is not supported by the parameter schema`)
      }
      addParameterValueBytes(state, encodedBytes(key) + 1, `${path}.${key}`)
    }
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(source, required)) {
        throw new TypeError(`${path}.${required} is required`)
      }
    }
    if (schema.minProperties !== undefined && stringKeys.length < schema.minProperties) {
      throw new TypeError(`${path} must contain at least ${schema.minProperties} properties`)
    }
    if (schema.maxProperties !== undefined && stringKeys.length > schema.maxProperties) {
      throw new TypeError(`${path} must contain at most ${schema.maxProperties} properties`)
    }
    const parsed: { [key: string]: PluginParameterValue } = {}
    for (const key of stringKeys) {
      parsed[key] = parameterValueNode(source[key], schema.properties[key], `${path}.${key}`, state)
    }
    return Object.freeze(parsed)
  } finally {
    state.ancestors.delete(source)
  }
}

function parameterValueNode(
  value: unknown,
  schema: PluginParameterSchemaV2,
  path: string,
  state: ParameterValueWalkState
): PluginParameterValue {
  state.nodes += 1
  if (state.nodes > PLUGIN_PARAMETER_VALUE_LIMITS.maxNodes) {
    throw new TypeError(`${path} exceeds the JSON value node limit`)
  }
  if (schema.type === 'string') {
    const parsed = parameterString(value, schema, path)
    addParameterValueBytes(state, encodedBytes(parsed), path)
    return parsed
  }
  if (schema.type === 'number' || schema.type === 'integer') {
    const parsed = parameterNumber(value, schema, path)
    addParameterValueBytes(state, encodedBytes(parsed), path)
    return parsed
  }
  if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') throw new TypeError(`${path} must be a boolean`)
    parameterEnum(schema, value, path)
    addParameterValueBytes(state, value ? 4 : 5, path)
    return value
  }
  if (schema.type === 'array') return parameterArray(value, schema, path, state)
  return parameterObject(value, schema as PluginObjectParameterSchemaV2, path, state)
}

export function parsePluginParameterValue(
  value: unknown,
  schema: PluginParameterSchemaV2,
  maxBytes: number,
  path = 'plugin parameter value'
): PluginParameterValue {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0 ||
    maxBytes > PLUGIN_PARAMETER_VALUE_LIMITS.maxBytes
  ) {
    throw new TypeError(
      `Plugin parameter value maxBytes must be between 1 and ${PLUGIN_PARAMETER_VALUE_LIMITS.maxBytes}`
    )
  }
  const parsedSchema = parsePluginParameterSchema(schema, `${path} schema`)
  const parsed = parameterValueNode(value, parsedSchema, path, {
    nodes: 0,
    bytes: 0,
    maxBytes,
    ancestors: new WeakSet()
  })
  if (encodedBytes(parsed) > maxBytes) {
    throw new TypeError(`${path} exceeds the ${maxBytes}-byte contract limit`)
  }
  return parsed
}

export function parsePluginObjectParameterValue(
  value: unknown,
  schema: PluginObjectParameterSchemaV2,
  maxBytes: number,
  path = 'plugin parameter value'
): Readonly<{ [key: string]: PluginParameterValue }> {
  const parsed = parsePluginParameterValue(value, schema, maxBytes, path)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError(`${path} must be an object`)
  }
  return parsed as Readonly<{ [key: string]: PluginParameterValue }>
}
