/* eslint-disable max-lines -- Descriptor parsing, request shaping, and response safety form one review boundary. */
import {
  parsePluginConnectorContract,
  parsePluginObjectParameterValue,
  type PluginConnectorContractV1,
  type PluginConnectorCredentialKindV1,
  type PluginConnectorHttpMethodV1,
  type PluginConnectorKindV1,
  type PluginConnectorOperationKindV1,
  type PluginConnectorOperationV1,
  type PluginObjectParameterSchemaV2,
  type PluginParameterValue
} from '@open-pencil/plugin-contracts'

import { credentialRef } from '@/app/settings/credentials/reference'
import type { CredentialRef } from '@/app/settings/credentials/types'

import type { JSONTraversalState } from '../json-data'
import { resolveConnectorOperationOrigin, resolveConnectorOperationPath } from './broker'
import {
  ConnectorExecutionError,
  type ConnectorHostAdapter,
  type ConnectorParameterObject,
  type PrepareConnectorRequestContext,
  type PreparedConnectorRequest,
  type ValidateConnectorCredentialContext
} from './types'

const TEXT_ENCODER = new TextEncoder()
const CONFIGURED_HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/
const QUERY_NAME = /^(?:[A-Za-z][A-Za-z0-9_.[\]-]{0,127}|\$[A-Za-z][A-Za-z0-9_.[\]-]{0,126})$/
const JSON_FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/
const RESERVED_HEADERS = new Set([
  'authorization',
  'connection',
  'content-length',
  'cookie',
  'host',
  'origin',
  'proxy-authorization',
  'referer'
])
const UNSAFE_JSON_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export const REVIEWED_REST_CONNECTOR_LIMITS = Object.freeze({
  defaultParameterBytes: 32 * 1024,
  defaultResultBytes: 256 * 1024,
  defaultResponseBytes: 512 * 1024,
  defaultRequestBodyBytes: 256 * 1024,
  maxRequestBodyBytes: 512 * 1024,
  maxMappings: 128,
  maxStaticHeaders: 16,
  maxJsonNodes: 8_192,
  maxResponsePickDepth: 16
})

export interface ReviewedRestCredentialSpec {
  readonly slotId: string
  readonly label: string
  readonly kind: Extract<PluginConnectorCredentialKindV1, 'api-key' | 'bearer-token'>
  readonly required?: boolean
  /** API keys require an explicit reviewed header. Bearer tokens use Authorization automatically. */
  readonly headerName?: string
}

export interface ReviewedRestQueryMapping {
  readonly parameter: string
  readonly name: string
  /** Arrays are repeated by default (`tag=a&tag=b`) or may use one comma-separated value. */
  readonly array?: 'repeat' | 'comma'
}

export interface ReviewedRestJSONBodyMapping {
  readonly parameter: string
  readonly name?: string
}

export interface ReviewedRestJSONBodySpec {
  /** Only explicitly reviewed parameter fields enter the request body. */
  readonly fields?: readonly ReviewedRestJSONBodyMapping[]
  /** Host-reviewed builder for APIs whose JSON envelope does not mirror parameter names. */
  readonly build?: (
    parameters: ConnectorParameterObject,
    context: Readonly<{
      operation: PluginConnectorOperationV1
      mutationAttemptId?: string
      signal: AbortSignal
    }>
  ) => unknown
  readonly maxBytes?: number
}

export interface ReviewedRestResponseContext {
  readonly operation: PluginConnectorOperationV1
  readonly parameters: ConnectorParameterObject
  readonly signal: AbortSignal
}

export interface ReviewedRestParameterValidationContext {
  readonly operation: PluginConnectorOperationV1
  readonly signal: AbortSignal
}

export interface ReviewedRestOperationSpec {
  readonly operationId: string
  readonly name: string
  readonly description: string
  readonly kind: Extract<PluginConnectorOperationKindV1, 'query' | 'mutation'>
  readonly method: PluginConnectorHttpMethodV1
  /** A reviewed root-relative path; placeholders must occupy a complete segment. */
  readonly pathTemplate: string
  readonly credentialSlots?: readonly string[]
  readonly parameters: PluginObjectParameterSchemaV2
  readonly parameterMaxBytes?: number
  readonly result: PluginObjectParameterSchemaV2
  readonly resultMaxBytes?: number
  readonly maxResponseBytes?: number
  /** Explicit host policy; only these operations may be exposed as read-only MCP tools. */
  readonly mcpReadOnly: boolean
  readonly query?: readonly ReviewedRestQueryMapping[]
  readonly jsonBody?: ReviewedRestJSONBodySpec
  /** Static, non-sensitive headers only. Credential/reserved headers are rejected. */
  readonly headers?: Readonly<Record<string, string>>
  /** For mutations, insert the host-owned attempt UUID immediately before dispatch. */
  readonly idempotencyHeader?: string
  /** Select a nested response data property before normalization (for example `['data']`). */
  readonly responsePath?: readonly string[]
  /** Optional safe example surfaced to operation-help UIs. */
  readonly example?: ConnectorParameterObject
  /** Host-reviewed cross-field validation after the declared parameter schema has parsed. */
  readonly validateParameters?: (
    parameters: ConnectorParameterObject,
    context: ReviewedRestParameterValidationContext
  ) => void
  /** Host-reviewed response projection; its output is still parsed against `result`. */
  readonly transformResponse?: (value: unknown, context: ReviewedRestResponseContext) => unknown
}

export interface ReviewedRestConnectorSpec {
  readonly pluginId: string
  readonly connectorId: string
  readonly adapterId: string
  readonly name: string
  readonly description: string
  readonly kind?: Extract<PluginConnectorKindV1, 'data-source' | 'action'>
  /** One exact canonical HTTPS origin. Runtime parameters can never replace it. */
  readonly origin: string
  readonly credentials?: readonly ReviewedRestCredentialSpec[]
  readonly operations: readonly ReviewedRestOperationSpec[]
  readonly validateCredential?: (
    context: ValidateConnectorCredentialContext
  ) => boolean | Promise<boolean>
}

export interface ReviewedRestConnector {
  readonly contract: PluginConnectorContractV1
  readonly adapter: ConnectorHostAdapter
  readonly operations: Readonly<Record<string, PluginConnectorOperationV1>>
  readonly metadata: Readonly<{
    credentialSlots: readonly Readonly<{
      slotId: string
      label: string
      kind: ReviewedRestCredentialSpec['kind']
      required: boolean
      headerName?: string
    }>[]
    operations: readonly Readonly<{
      operationId: string
      name: string
      description: string
      kind: ReviewedRestOperationSpec['kind']
      mcpReadOnly: boolean
      credentialSlots: readonly string[]
      example: ConnectorParameterObject | null
    }>[]
    mcpReadOnlyOperationIds: readonly string[]
  }>
  /** Build runtime-only credential references without ever reading the credential values. */
  credentialRefs(profileId?: string): Readonly<Record<string, CredentialRef>>
}

interface NormalizedQueryMapping {
  readonly parameter: string
  readonly name: string
  readonly array: 'repeat' | 'comma'
}

interface NormalizedBodyMapping {
  readonly parameter: string
  readonly name: string
}

interface NormalizedOperationSpec {
  readonly operationId: string
  readonly query: readonly NormalizedQueryMapping[]
  readonly body: readonly NormalizedBodyMapping[] | null
  readonly buildBody?: ReviewedRestJSONBodySpec['build']
  readonly maxBodyBytes: number
  readonly headers: Readonly<Record<string, string>>
  readonly idempotencyHeader?: string
  readonly responsePath: readonly string[]
  readonly validateParameters?: ReviewedRestOperationSpec['validateParameters']
  readonly transformResponse?: ReviewedRestOperationSpec['transformResponse']
}

function connectorError(
  code: 'authority-mismatch' | 'invalid-parameters' | 'adapter-failed',
  message: string,
  cause?: unknown
) {
  return new ConnectorExecutionError(code, message, cause === undefined ? undefined : { cause })
}

function boundedPositiveInteger(
  value: number | undefined,
  fallback: number,
  maximum: number
): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 2 || result > maximum) {
    throw new TypeError(`Reviewed REST byte limit must be between 2 and ${maximum}`)
  }
  return result
}

function exactHeaderName(value: string, path: string): string {
  if (!CONFIGURED_HEADER_NAME.test(value)) throw new TypeError(`${path} is not a valid header name`)
  const normalized = value.toLowerCase()
  if (
    RESERVED_HEADERS.has(normalized) ||
    normalized.startsWith('proxy-') ||
    normalized.startsWith('sec-')
  ) {
    throw new TypeError(`${path} is reserved by the connector host`)
  }
  return value
}

function normalizedStaticHeaders(value: unknown, path: string): Readonly<Record<string, string>> {
  if (value === undefined) return Object.freeze({})
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} must be a plain record`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must be a plain record`)
  }
  const keys = Reflect.ownKeys(value)
  if (
    keys.length > REVIEWED_REST_CONNECTOR_LIMITS.maxStaticHeaders ||
    keys.some((key) => typeof key !== 'string')
  ) {
    throw new TypeError(`${path} exceeds the static header limit`)
  }
  const headers: Record<string, string> = Object.create(null) as Record<string, string>
  const normalizedNames = new Set<string>()
  for (const key of keys as string[]) {
    const name = exactHeaderName(key, `${path}.${key}`)
    const normalized = name.toLowerCase()
    if (normalizedNames.has(normalized)) throw new TypeError(`${path} contains a duplicate header`)
    normalizedNames.add(normalized)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (
      !descriptor?.enumerable ||
      !Object.hasOwn(descriptor, 'value') ||
      typeof descriptor.value !== 'string' ||
      descriptor.value.length === 0 ||
      /[\r\n]/.test(descriptor.value) ||
      TEXT_ENCODER.encode(descriptor.value).byteLength > 8 * 1024
    ) {
      throw new TypeError(`${path}.${key} must be a bounded static string`)
    }
    headers[name] = descriptor.value
  }
  return Object.freeze(headers)
}

function assertSchemaParameter(
  schema: PluginObjectParameterSchemaV2,
  parameter: string,
  path: string
): void {
  if (!Object.hasOwn(schema.properties, parameter)) {
    throw new TypeError(`${path} references unknown parameter ${parameter}`)
  }
}

function normalizedQueryMappings(
  operation: ReviewedRestOperationSpec
): readonly NormalizedQueryMapping[] {
  const source = operation.query ?? []
  if (source.length > REVIEWED_REST_CONNECTOR_LIMITS.maxMappings) {
    throw new TypeError(`Reviewed REST ${operation.operationId} query mapping exceeds the limit`)
  }
  const parameters = new Set<string>()
  const names = new Set<string>()
  return Object.freeze(
    source.map((entry, index) => {
      const path = `Reviewed REST ${operation.operationId} query[${index}]`
      assertSchemaParameter(operation.parameters, entry.parameter, path)
      if (!QUERY_NAME.test(entry.name)) throw new TypeError(`${path}.name is not allowed`)
      if (parameters.has(entry.parameter)) throw new TypeError(`${path}.parameter is duplicated`)
      if (names.has(entry.name)) throw new TypeError(`${path}.name is duplicated`)
      parameters.add(entry.parameter)
      names.add(entry.name)
      return Object.freeze({
        parameter: entry.parameter,
        name: entry.name,
        array: entry.array ?? 'repeat'
      })
    })
  )
}

function normalizedBodyMappings(
  operation: ReviewedRestOperationSpec
): readonly NormalizedBodyMapping[] | null {
  if (!operation.jsonBody) return null
  if (operation.method === 'GET')
    throw new TypeError('Reviewed REST GET operations cannot use a body')
  const source = operation.jsonBody.fields ?? []
  if ((source.length === 0) === (operation.jsonBody.build === undefined)) {
    throw new TypeError(
      `Reviewed REST ${operation.operationId} body must declare either fields or one builder`
    )
  }
  if (operation.jsonBody.build) return Object.freeze([])
  if (source.length === 0 || source.length > REVIEWED_REST_CONNECTOR_LIMITS.maxMappings) {
    throw new TypeError(`Reviewed REST ${operation.operationId} body fields are invalid`)
  }
  const parameters = new Set<string>()
  const names = new Set<string>()
  return Object.freeze(
    source.map((entry, index) => {
      const path = `Reviewed REST ${operation.operationId} body[${index}]`
      assertSchemaParameter(operation.parameters, entry.parameter, path)
      const name = entry.name ?? entry.parameter
      if (!JSON_FIELD_NAME.test(name) || UNSAFE_JSON_KEYS.has(name)) {
        throw new TypeError(`${path}.name is not allowed`)
      }
      if (parameters.has(entry.parameter)) throw new TypeError(`${path}.parameter is duplicated`)
      if (names.has(name)) throw new TypeError(`${path}.name is duplicated`)
      parameters.add(entry.parameter)
      names.add(name)
      return Object.freeze({ parameter: entry.parameter, name })
    })
  )
}

function normalizedCredentials(spec: ReviewedRestConnectorSpec) {
  return (spec.credentials ?? []).map((slot) => {
    if (slot.kind !== 'api-key') {
      if (slot.headerName !== undefined) {
        throw new TypeError(
          `Reviewed REST bearer slot cannot choose its injection header: ${slot.slotId}`
        )
      }
      return {
        slotId: slot.slotId,
        label: slot.label,
        kind: slot.kind,
        required: slot.required ?? true
      }
    }
    if (!slot.headerName) {
      throw new TypeError(`Reviewed REST API key slot requires a header: ${slot.slotId}`)
    }
    return {
      slotId: slot.slotId,
      label: slot.label,
      kind: slot.kind,
      required: slot.required ?? true,
      injection: { location: 'header' as const, name: slot.headerName.toLowerCase() }
    }
  })
}

function assertOperationKindAndMethod(operation: ReviewedRestOperationSpec): void {
  if (typeof operation.mcpReadOnly !== 'boolean') {
    throw new TypeError('Reviewed REST operations require an explicit mcpReadOnly policy')
  }
  if (operation.kind === 'query' && operation.method !== 'GET' && operation.method !== 'POST') {
    throw new TypeError('Reviewed REST query operations must use GET or POST')
  }
  if (operation.kind === 'mutation' && operation.method === 'GET') {
    throw new TypeError('Reviewed REST mutation operations cannot use GET')
  }
  if (operation.kind === 'mutation' && operation.mcpReadOnly) {
    throw new TypeError('Reviewed REST mutations cannot be exposed as read-only MCP operations')
  }
  if (operation.idempotencyHeader && operation.kind !== 'mutation') {
    throw new TypeError('Reviewed REST idempotency headers are only valid for mutations')
  }
}

function contractOperation(spec: ReviewedRestConnectorSpec, operation: ReviewedRestOperationSpec) {
  assertOperationKindAndMethod(operation)
  return {
    operationId: operation.operationId,
    name: operation.name,
    description: operation.description,
    kind: operation.kind,
    credentialSlots: [...(operation.credentialSlots ?? [])],
    request: {
      origin: spec.origin,
      method: operation.method,
      pathTemplate: operation.pathTemplate,
      maxResponseBytes: boundedPositiveInteger(
        operation.maxResponseBytes,
        REVIEWED_REST_CONNECTOR_LIMITS.defaultResponseBytes,
        4 * 1024 * 1024
      )
    },
    parameters: {
      schema: operation.parameters,
      maxBytes: boundedPositiveInteger(
        operation.parameterMaxBytes,
        REVIEWED_REST_CONNECTOR_LIMITS.defaultParameterBytes,
        512 * 1024
      )
    },
    result: {
      schema: operation.result,
      maxBytes: boundedPositiveInteger(
        operation.resultMaxBytes,
        REVIEWED_REST_CONNECTOR_LIMITS.defaultResultBytes,
        512 * 1024
      )
    }
  }
}

function normalizedOperation(
  source: ReviewedRestOperationSpec,
  reviewed: PluginConnectorOperationV1
): NormalizedOperationSpec {
  const headers = normalizedStaticHeaders(
    source.headers,
    `Reviewed REST ${source.operationId} headers`
  )
  const idempotencyHeader = source.idempotencyHeader
    ? exactHeaderName(source.idempotencyHeader, 'Reviewed REST idempotency header')
    : undefined
  if (
    idempotencyHeader &&
    Object.keys(headers).some((name) => name.toLowerCase() === idempotencyHeader.toLowerCase())
  ) {
    throw new TypeError('Reviewed REST idempotency header collides with a static header')
  }
  if (idempotencyHeader?.toLowerCase() === 'content-type') {
    throw new TypeError('Reviewed REST idempotency header cannot replace Content-Type')
  }
  const contentType = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === 'content-type'
  )?.[1]
  if (
    source.jsonBody &&
    contentType !== undefined &&
    contentType.toLowerCase() !== 'application/json'
  ) {
    throw new TypeError('Reviewed REST JSON bodies require application/json Content-Type')
  }
  return Object.freeze({
    operationId: reviewed.operationId,
    query: normalizedQueryMappings(source),
    body: normalizedBodyMappings(source),
    ...(source.jsonBody?.build === undefined ? {} : { buildBody: source.jsonBody.build }),
    maxBodyBytes: boundedPositiveInteger(
      source.jsonBody?.maxBytes,
      REVIEWED_REST_CONNECTOR_LIMITS.defaultRequestBodyBytes,
      REVIEWED_REST_CONNECTOR_LIMITS.maxRequestBodyBytes
    ),
    headers,
    responsePath: normalizedResponsePath(source),
    ...(source.validateParameters === undefined
      ? {}
      : { validateParameters: source.validateParameters }),
    ...(idempotencyHeader === undefined ? {} : { idempotencyHeader }),
    ...(source.transformResponse === undefined
      ? {}
      : { transformResponse: source.transformResponse })
  })
}

function normalizedResponsePath(operation: ReviewedRestOperationSpec): readonly string[] {
  const path = operation.responsePath ?? []
  if (path.length > REVIEWED_REST_CONNECTOR_LIMITS.maxResponsePickDepth) {
    throw new TypeError(`Reviewed REST ${operation.operationId} response path is too deep`)
  }
  return Object.freeze(
    path.map((segment, index) => {
      if (!JSON_FIELD_NAME.test(segment) || UNSAFE_JSON_KEYS.has(segment)) {
        throw new TypeError(
          `Reviewed REST ${operation.operationId} responsePath[${index}] is not allowed`
        )
      }
      return segment
    })
  )
}

function assertReviewedAuthority(
  contract: PluginConnectorContractV1,
  operation: PluginConnectorOperationV1,
  reviewedContract: PluginConnectorContractV1,
  reviewedContractJSON: string,
  reviewedOperationJSON: Readonly<Record<string, string>>
): PluginConnectorOperationV1 {
  try {
    if (JSON.stringify(parsePluginConnectorContract(contract)) !== reviewedContractJSON) {
      throw new Error('contract mismatch')
    }
    const parsed = parsePluginConnectorContract({
      ...reviewedContract,
      operations: [operation]
    }).operations[0]
    if (JSON.stringify(parsed) !== reviewedOperationJSON[parsed.operationId]) {
      throw new Error('operation mismatch')
    }
    const reviewed = reviewedContract.operations.find(
      (candidate) => candidate.operationId === parsed.operationId
    )
    if (!reviewed) throw new Error('operation unavailable')
    return reviewed
  } catch (cause) {
    throw connectorError(
      'authority-mismatch',
      'Reviewed REST connector authority does not match its host adapter',
      cause
    )
  }
}

function parsedParameters(
  context: PrepareConnectorRequestContext,
  operation: PluginConnectorOperationV1
): ConnectorParameterObject {
  return parsePluginObjectParameterValue(
    context.parameters,
    operation.parameters.schema,
    operation.parameters.maxBytes,
    `Reviewed REST ${operation.operationId} parameters`
  ) as ConnectorParameterObject
}

function validatedParameters(
  context: PrepareConnectorRequestContext,
  operation: PluginConnectorOperationV1,
  normalized: NormalizedOperationSpec
): ConnectorParameterObject {
  const parameters = parsedParameters(context, operation)
  if (!normalized.validateParameters) return parameters
  try {
    context.signal.throwIfAborted()
    normalized.validateParameters(parameters, { operation, signal: context.signal })
    context.signal.throwIfAborted()
    return parameters
  } catch (cause) {
    if (context.signal.aborted) throw context.signal.reason
    if (cause instanceof ConnectorExecutionError) throw cause
    throw connectorError(
      'invalid-parameters',
      `Reviewed REST ${operation.operationId} parameters violate the reviewed operation policy`,
      cause
    )
  }
}

function queryScalar(value: PluginParameterValue, path: string): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  throw new TypeError(`${path} must be a string, number, boolean, or an array of those values`)
}

function appendQuery(
  url: URL,
  mappings: readonly NormalizedQueryMapping[],
  parameters: ConnectorParameterObject
): void {
  for (const mapping of mappings) {
    const value = parameters[mapping.parameter]
    if (value === undefined) continue
    if (!Array.isArray(value)) {
      url.searchParams.append(mapping.name, queryScalar(value, mapping.parameter))
      continue
    }
    const values = value.map((entry, index) => queryScalar(entry, `${mapping.parameter}[${index}]`))
    if (mapping.array === 'comma') {
      if (values.length > 0) url.searchParams.append(mapping.name, values.join(','))
      continue
    }
    for (const entry of values) url.searchParams.append(mapping.name, entry)
  }
}

function enumerableDataValue(value: object, key: string, path: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
    throw new TypeError(`${path} must be an enumerable data property`)
  }
  return descriptor.value
}

function pureJSONArray(
  value: unknown[],
  path: string,
  state: JSONTraversalState
): readonly PluginParameterValue[] {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${path} must contain plain arrays only`)
  }
  const keys = Reflect.ownKeys(value)
  const custom = keys.some(
    (key) =>
      typeof key !== 'string' ||
      (key !== 'length' && (!/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))
  )
  if (custom) throw new TypeError(`${path} arrays must not contain custom properties`)
  const result: PluginParameterValue[] = []
  for (let index = 0; index < value.length; index += 1) {
    const itemPath = `${path}[${index}]`
    result.push(pureJSONValue(enumerableDataValue(value, String(index), itemPath), itemPath, state))
  }
  return Object.freeze(result)
}

function pureJSONRecord(
  value: object,
  path: string,
  state: JSONTraversalState
): Readonly<Record<string, PluginParameterValue>> {
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must contain plain objects only`)
  }
  const result: Record<string, PluginParameterValue> = Object.create(null) as Record<
    string,
    PluginParameterValue
  >
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || UNSAFE_JSON_KEYS.has(key)) {
      throw new TypeError(`${path} contains an unsafe JSON property`)
    }
    const propertyPath = `${path}.${key}`
    result[key] = pureJSONValue(enumerableDataValue(value, key, propertyPath), propertyPath, state)
  }
  return Object.freeze(result)
}

function pureJSONContainer(
  value: object,
  path: string,
  state: JSONTraversalState
): PluginParameterValue {
  if (state.ancestors.has(value)) throw new TypeError(`${path} must not contain cycles`)
  state.ancestors.add(value)
  try {
    return Array.isArray(value)
      ? pureJSONArray(value, path, state)
      : pureJSONRecord(value, path, state)
  } finally {
    state.ancestors.delete(value)
  }
}

function pureJSONValue(
  value: unknown,
  path: string,
  state: JSONTraversalState
): PluginParameterValue {
  state.nodes += 1
  if (state.nodes > REVIEWED_REST_CONNECTOR_LIMITS.maxJsonNodes) {
    throw new TypeError(`${path} exceeds the JSON node limit`)
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} must contain finite JSON numbers`)
    return value
  }
  if (typeof value !== 'object') throw new TypeError(`${path} must contain JSON data only`)
  return pureJSONContainer(value, path, state)
}

function serializedJSONBody(value: unknown, maximum: number): string {
  const safe = pureJSONValue(value, 'Reviewed REST JSON body', {
    nodes: 0,
    ancestors: new WeakSet()
  })
  const serialized = JSON.stringify(safe)
  if (TEXT_ENCODER.encode(serialized).byteLength > maximum) {
    throw new TypeError('Reviewed REST JSON request body exceeds its byte limit')
  }
  return serialized
}

function mappedJSONBody(
  mappings: readonly NormalizedBodyMapping[],
  parameters: ConnectorParameterObject,
  maximum: number
): string {
  const body: Record<string, PluginParameterValue> = Object.create(null) as Record<
    string,
    PluginParameterValue
  >
  for (const mapping of mappings) {
    const value = parameters[mapping.parameter]
    if (value !== undefined) body[mapping.name] = value
  }
  return serializedJSONBody(body, maximum)
}

function pickedResponse(value: unknown, path: readonly string[]): unknown {
  let current = value
  for (const segment of path) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) {
      throw new TypeError(`Reviewed REST response path is unavailable at ${segment}`)
    }
    const prototype = Object.getPrototypeOf(current)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Reviewed REST response path must traverse plain JSON objects')
    }
    const descriptor = Object.getOwnPropertyDescriptor(current, segment)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`Reviewed REST response path is unavailable at ${segment}`)
    }
    current = descriptor.value
  }
  return current
}

function prepareRequest(
  context: PrepareConnectorRequestContext,
  reviewed: PluginConnectorOperationV1,
  normalized: NormalizedOperationSpec
): PreparedConnectorRequest {
  context.signal.throwIfAborted()
  const parameters = validatedParameters(context, reviewed, normalized)
  const url = new URL(
    resolveConnectorOperationPath(reviewed, parameters),
    resolveConnectorOperationOrigin(reviewed, parameters)
  )
  appendQuery(url, normalized.query, parameters)
  const headers: Record<string, string> = { ...normalized.headers }
  let body: string | undefined
  if (normalized.body) {
    if (!Object.keys(headers).some((name) => name.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json'
    }
    const bodyValue = normalized.buildBody
      ? normalized.buildBody(parameters, {
          operation: reviewed,
          ...(context.mutationAttemptId === undefined
            ? {}
            : { mutationAttemptId: context.mutationAttemptId }),
          signal: context.signal
        })
      : null
    body = normalized.buildBody
      ? serializedJSONBody(bodyValue, normalized.maxBodyBytes)
      : mappedJSONBody(normalized.body, parameters, normalized.maxBodyBytes)
  }
  if (normalized.idempotencyHeader) {
    if (!context.mutationAttemptId) {
      throw new TypeError('Reviewed REST mutation attempt ID is required for idempotency')
    }
    headers[normalized.idempotencyHeader] = context.mutationAttemptId
  }
  context.signal.throwIfAborted()
  return Object.freeze({
    url: url.href,
    ...(Object.keys(headers).length === 0 ? {} : { headers: Object.freeze(headers) }),
    ...(body === undefined ? {} : { body })
  })
}

/**
 * Build one host-reviewed REST contract/adapter pair from static application code.
 *
 * The adapter never receives credentials. API keys are injected into the declared header by the
 * broker, bearer tokens use Authorization, and ordinary query values come only from the operation
 * parameter schema. Secret-bearing query parameters intentionally remain unsupported by V1.
 */
export function createReviewedRestConnector(
  spec: ReviewedRestConnectorSpec
): ReviewedRestConnector {
  if (spec.operations.length === 0) {
    throw new TypeError('Reviewed REST connector requires at least one operation')
  }
  const contract = parsePluginConnectorContract({
    format: 'openpencil-plugin-connector-contract',
    schemaVersion: 1,
    pluginId: spec.pluginId,
    connectorId: spec.connectorId,
    adapterId: spec.adapterId,
    name: spec.name,
    description: spec.description,
    kind: spec.kind ?? 'data-source',
    network: {
      origins: [spec.origin],
      methods: [...new Set(spec.operations.map((operation) => operation.method))],
      credentials: 'omit',
      redirects: 'error'
    },
    credentialSlots: normalizedCredentials(spec),
    operations: spec.operations.map((operation) => contractOperation(spec, operation))
  })
  const reviewedContractJSON = JSON.stringify(contract)
  const reviewedOperationJSON = Object.freeze(
    Object.fromEntries(
      contract.operations.map((operation) => [operation.operationId, JSON.stringify(operation)])
    )
  )
  const operations = Object.freeze(
    Object.fromEntries(contract.operations.map((operation) => [operation.operationId, operation]))
  )
  const normalized = new Map<string, NormalizedOperationSpec>()
  for (const [index, reviewed] of contract.operations.entries()) {
    normalized.set(reviewed.operationId, normalizedOperation(spec.operations[index], reviewed))
  }
  const validateCredential = spec.validateCredential
  const operationMetadata = Object.freeze(
    contract.operations.map((operation, index) => {
      const source = spec.operations[index]
      const example =
        source.example === undefined
          ? null
          : (parsePluginObjectParameterValue(
              source.example,
              operation.parameters.schema,
              operation.parameters.maxBytes,
              `Reviewed REST ${operation.operationId} example`
            ) as ConnectorParameterObject)
      return Object.freeze({
        operationId: operation.operationId,
        name: operation.name,
        description: operation.description,
        kind: source.kind,
        mcpReadOnly: source.mcpReadOnly,
        credentialSlots: Object.freeze([...operation.credentialSlots]),
        example
      })
    })
  )
  const metadata = Object.freeze({
    credentialSlots: Object.freeze(
      contract.credentialSlots.map((slot) =>
        Object.freeze({
          slotId: slot.slotId,
          label: slot.label,
          kind: slot.kind as ReviewedRestCredentialSpec['kind'],
          required: slot.required,
          ...(slot.injection === undefined ? {} : { headerName: slot.injection.name })
        })
      )
    ),
    operations: operationMetadata,
    mcpReadOnlyOperationIds: Object.freeze(
      operationMetadata
        .filter((operation) => operation.mcpReadOnly)
        .map((operation) => operation.operationId)
    )
  })
  const adapter: ConnectorHostAdapter = Object.freeze({
    pluginId: contract.pluginId,
    connectorId: contract.connectorId,
    adapterId: contract.adapterId,
    contract,
    mcpReadOnlyOperationIds: Object.freeze(
      contract.operations
        .filter(
          (operation) =>
            operation.request?.method === 'POST' &&
            metadata.mcpReadOnlyOperationIds.includes(operation.operationId)
        )
        .map((operation) => operation.operationId)
    ),
    validateCredential(context: ValidateConnectorCredentialContext) {
      context.signal.throwIfAborted()
      const generic =
        context.value.length > 0 &&
        context.value === context.value.trim() &&
        !/\p{Cc}/u.test(context.value)
      if (!generic || !validateCredential) return generic
      return validateCredential(context)
    },
    prepare(context: PrepareConnectorRequestContext): Promise<PreparedConnectorRequest> {
      return Promise.resolve().then(() => {
        const operation = assertReviewedAuthority(
          context.contract,
          context.operation,
          contract,
          reviewedContractJSON,
          reviewedOperationJSON
        )
        const operationSpec = normalized.get(operation.operationId)
        if (!operationSpec) {
          throw connectorError('authority-mismatch', 'Reviewed REST operation is unavailable')
        }
        return prepareRequest(context, operation, operationSpec)
      })
    },
    async transformResponse(
      value: unknown,
      context: PrepareConnectorRequestContext
    ): Promise<PluginParameterValue> {
      context.signal.throwIfAborted()
      const operation = assertReviewedAuthority(
        context.contract,
        context.operation,
        contract,
        reviewedContractJSON,
        reviewedOperationJSON
      )
      const operationSpec = normalized.get(operation.operationId)
      if (!operationSpec) {
        throw connectorError('authority-mismatch', 'Reviewed REST operation is unavailable')
      }
      const parameters = validatedParameters(context, operation, operationSpec)
      let transformed: unknown = pureJSONValue(
        pickedResponse(value, operationSpec.responsePath),
        `Reviewed REST ${operation.operationId} upstream result`,
        { nodes: 0, ancestors: new WeakSet() }
      )
      if (operationSpec.transformResponse) {
        try {
          transformed = await operationSpec.transformResponse(transformed, {
            operation,
            parameters,
            signal: context.signal
          })
        } catch (cause) {
          if (context.signal.aborted) throw context.signal.reason
          throw connectorError('adapter-failed', 'Reviewed REST response transform failed', cause)
        }
      }
      context.signal.throwIfAborted()
      return parsePluginObjectParameterValue(
        transformed,
        operation.result.schema,
        operation.result.maxBytes,
        `Reviewed REST ${operation.operationId} result`
      )
    }
  })
  return Object.freeze({
    contract,
    adapter,
    operations,
    metadata,
    credentialRefs(profileId = 'default') {
      return Object.freeze(
        Object.fromEntries(
          contract.credentialSlots.map((slot) => [
            slot.slotId,
            credentialRef(contract.pluginId, slot.slotId, profileId)
          ])
        )
      )
    }
  })
}
