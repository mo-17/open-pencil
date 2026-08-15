import {
  parsePluginConnectorContract,
  parsePluginObjectParameterValue,
  type PluginConnectorContractV1,
  type PluginConnectorOperationV1,
  type PluginParameterValue
} from '@open-pencil/plugin-contracts'
import type { JSONObject, JSONValue } from '@open-pencil/scene-graph/primitives'

import {
  strictPlainDataRecord,
  type JSONTraversalState,
  type PluginJSONDataRecord
} from '@/app/plugins/json-data'

import type {
  ConnectorHostAdapter,
  PrepareConnectorRequestContext,
  PreparedConnectorRequest
} from './types'

export const AIRTABLE_RECORDS_PLUGIN_ID = 'open-pencil.airtable'
export const AIRTABLE_RECORDS_CONNECTOR_ID = 'airtable.records'
export const AIRTABLE_RECORDS_ADAPTER_ID = 'open-pencil.connector.airtable'
export const AIRTABLE_RECORDS_ORIGIN = 'https://api.airtable.com'
export const AIRTABLE_RECORDS_CREDENTIAL_SLOT_ID = 'access-token'
export const AIRTABLE_LIST_RECORDS_OPERATION_ID = 'list-records'

export const AIRTABLE_RECORDS_LIMITS = Object.freeze({
  pageSize: 100,
  offsetLength: 512,
  records: 100,
  fieldsPerRecord: 128,
  fieldNameLength: 256,
  fieldValueJsonBytes: 16 * 1024,
  responseBytes: 512 * 1024,
  resultBytes: 256 * 1024,
  jsonDepth: 12,
  jsonNodes: 16_384,
  jsonArrayItems: 1_024,
  jsonObjectProperties: 256
})

const FIELD_ENTRY_SCHEMA = Object.freeze({
  type: 'object' as const,
  properties: Object.freeze({
    name: Object.freeze({
      type: 'string' as const,
      minLength: 1,
      maxLength: AIRTABLE_RECORDS_LIMITS.fieldNameLength
    }),
    valueJson: Object.freeze({
      type: 'string' as const,
      maxLength: AIRTABLE_RECORDS_LIMITS.fieldValueJsonBytes
    })
  }),
  required: Object.freeze(['name', 'valueJson']),
  additionalProperties: false as const,
  minProperties: 2,
  maxProperties: 2
})

const RECORD_SCHEMA = Object.freeze({
  type: 'object' as const,
  properties: Object.freeze({
    id: Object.freeze({ type: 'string' as const, minLength: 4, maxLength: 64 }),
    createdTime: Object.freeze({ type: 'string' as const, minLength: 1, maxLength: 64 }),
    fields: Object.freeze({
      type: 'array' as const,
      items: FIELD_ENTRY_SCHEMA,
      maxItems: AIRTABLE_RECORDS_LIMITS.fieldsPerRecord
    })
  }),
  required: Object.freeze(['id', 'createdTime', 'fields']),
  additionalProperties: false as const,
  minProperties: 3,
  maxProperties: 3
})

export const AIRTABLE_RECORDS_CONNECTOR_CONTRACT = parsePluginConnectorContract({
  format: 'openpencil-plugin-connector-contract',
  schemaVersion: 1,
  pluginId: AIRTABLE_RECORDS_PLUGIN_ID,
  connectorId: AIRTABLE_RECORDS_CONNECTOR_ID,
  adapterId: AIRTABLE_RECORDS_ADAPTER_ID,
  name: 'Airtable Records',
  description: 'List a bounded page of Airtable records through a reviewed read-only host adapter.',
  kind: 'data-source',
  network: {
    origins: [AIRTABLE_RECORDS_ORIGIN],
    methods: ['GET'],
    credentials: 'omit',
    redirects: 'error'
  },
  credentialSlots: [
    {
      slotId: AIRTABLE_RECORDS_CREDENTIAL_SLOT_ID,
      label: 'Personal access token',
      kind: 'bearer-token',
      required: true
    }
  ],
  operations: [
    {
      operationId: AIRTABLE_LIST_RECORDS_OPERATION_ID,
      name: 'List records',
      description: 'List one bounded page of records by stable Airtable base and table IDs.',
      kind: 'query',
      credentialSlots: [AIRTABLE_RECORDS_CREDENTIAL_SLOT_ID],
      request: {
        origin: AIRTABLE_RECORDS_ORIGIN,
        method: 'GET',
        pathTemplate: '/v0/{baseId}/{tableId}',
        maxResponseBytes: AIRTABLE_RECORDS_LIMITS.responseBytes
      },
      parameters: {
        schema: {
          type: 'object',
          properties: {
            baseId: { type: 'string', minLength: 4, maxLength: 64 },
            tableId: { type: 'string', minLength: 4, maxLength: 64 },
            pageSize: {
              type: 'integer',
              minimum: 1,
              maximum: AIRTABLE_RECORDS_LIMITS.pageSize
            },
            offset: {
              type: 'string',
              minLength: 1,
              maxLength: AIRTABLE_RECORDS_LIMITS.offsetLength
            }
          },
          required: ['baseId', 'tableId'],
          additionalProperties: false,
          minProperties: 2,
          maxProperties: 4
        },
        maxBytes: 2 * 1024
      },
      result: {
        schema: {
          type: 'object',
          properties: {
            records: {
              type: 'array',
              items: RECORD_SCHEMA,
              maxItems: AIRTABLE_RECORDS_LIMITS.records
            },
            hasMore: { type: 'boolean' },
            offset: {
              type: 'string',
              minLength: 1,
              maxLength: AIRTABLE_RECORDS_LIMITS.offsetLength
            }
          },
          required: ['records', 'hasMore'],
          additionalProperties: false,
          minProperties: 2,
          maxProperties: 3
        },
        maxBytes: AIRTABLE_RECORDS_LIMITS.resultBytes
      }
    }
  ]
})

function requiredListOperation(): PluginConnectorOperationV1 {
  const operation = AIRTABLE_RECORDS_CONNECTOR_CONTRACT.operations.at(0)
  if (!operation || operation.operationId !== AIRTABLE_LIST_RECORDS_OPERATION_ID) {
    throw new Error('Airtable Records reviewed operation is unavailable')
  }
  return operation
}

export const AIRTABLE_LIST_RECORDS_OPERATION = requiredListOperation()

const REVIEWED_CONTRACT_JSON = JSON.stringify(AIRTABLE_RECORDS_CONNECTOR_CONTRACT)
const REVIEWED_OPERATION_JSON = JSON.stringify(AIRTABLE_LIST_RECORDS_OPERATION)
const BASE_ID = /^app[A-Za-z0-9]{1,61}$/
const TABLE_ID = /^tbl[A-Za-z0-9]{1,61}$/
const RECORD_ID = /^rec[A-Za-z0-9]{1,61}$/
const OFFSET = /^[A-Za-z0-9._~/-]{1,512}$/
const CREATED_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/
const TEXT_ENCODER = new TextEncoder()

function assertReviewedAuthority(
  contract: PluginConnectorContractV1,
  operation: PluginConnectorOperationV1
): void {
  const parsed = parsePluginConnectorContract(contract)
  if (JSON.stringify(parsed) !== REVIEWED_CONTRACT_JSON) {
    throw new Error('Airtable Records connector authority does not match the reviewed contract')
  }
  const operationEnvelope = parsePluginConnectorContract({
    ...AIRTABLE_RECORDS_CONNECTOR_CONTRACT,
    operations: [operation]
  })
  if (JSON.stringify(operationEnvelope.operations[0]) !== REVIEWED_OPERATION_JSON) {
    throw new Error('Airtable Records operation does not match the reviewed list-records authority')
  }
}

function stableAirtableId(value: unknown, pattern: RegExp, label: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new TypeError(`${label} must be a stable Airtable ID`)
  }
  return value
}

function paginationOffset(value: unknown, label = 'Airtable pagination offset'): string {
  if (typeof value !== 'string' || !OFFSET.test(value)) {
    throw new TypeError(`${label} is invalid`)
  }
  return value
}

function prepareListRecordsRequest(
  context: PrepareConnectorRequestContext
): PreparedConnectorRequest {
  context.signal.throwIfAborted()
  assertReviewedAuthority(context.contract, context.operation)
  const parameters = parsePluginObjectParameterValue(
    context.parameters,
    AIRTABLE_LIST_RECORDS_OPERATION.parameters.schema,
    AIRTABLE_LIST_RECORDS_OPERATION.parameters.maxBytes,
    'Airtable list-records parameters'
  )
  const baseId = stableAirtableId(parameters.baseId, BASE_ID, 'Airtable baseId')
  const tableId = stableAirtableId(parameters.tableId, TABLE_ID, 'Airtable tableId')
  const pageSize =
    typeof parameters.pageSize === 'number' ? parameters.pageSize : AIRTABLE_RECORDS_LIMITS.pageSize

  const url = new URL(
    `/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(tableId)}`,
    AIRTABLE_RECORDS_ORIGIN
  )
  url.searchParams.set('pageSize', String(pageSize))
  if (Object.hasOwn(parameters, 'offset')) {
    url.searchParams.set('offset', paginationOffset(parameters.offset))
  }
  context.signal.throwIfAborted()
  return Object.freeze({ url: url.href })
}

function exactDataRecord(
  value: unknown,
  path: string,
  allowed: ReadonlySet<string>,
  required: ReadonlySet<string>
): PluginJSONDataRecord {
  const source = strictPlainDataRecord(value, path)
  const keys = Object.keys(source)
  for (const key of keys) {
    if (!allowed.has(key)) throw new TypeError(`${path}.${key} is not supported`)
  }
  for (const key of required) {
    if (!Object.hasOwn(source, key)) throw new TypeError(`${path}.${key} is required`)
  }
  return source
}

function plainDataArray(value: unknown, path: string, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${path} must be an array`)
  }
  if (value.length > maximum) throw new TypeError(`${path} exceeds the ${maximum}-item limit`)
  const keys = Reflect.ownKeys(value)
  if (
    keys.some(
      (key) =>
        typeof key !== 'string' ||
        (key !== 'length' &&
          (!/^\d+$/.test(key) || String(Number(key)) !== key || Number(key) >= value.length))
    )
  ) {
    throw new TypeError(`${path} must not contain custom fields`)
  }
  const items: unknown[] = []
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${path}[${index}] must be an enumerable data item`)
    }
    items.push(descriptor.value)
  }
  return items
}

type JSONWalkState = JSONTraversalState

function normalizedJSONValue(
  value: unknown,
  path: string,
  depth: number,
  state: JSONWalkState
): JSONValue {
  if (depth > AIRTABLE_RECORDS_LIMITS.jsonDepth) {
    throw new TypeError(`${path} exceeds the Airtable field JSON depth limit`)
  }
  state.nodes += 1
  if (state.nodes > AIRTABLE_RECORDS_LIMITS.jsonNodes) {
    throw new TypeError(`${path} exceeds the Airtable response JSON node limit`)
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value as JSONValue
  }
  if (typeof value !== 'object') throw new TypeError(`${path} must contain JSON data`)
  if (state.ancestors.has(value)) throw new TypeError(`${path} must not contain cycles`)
  state.ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      const values = plainDataArray(value, path, AIRTABLE_RECORDS_LIMITS.jsonArrayItems)
      return values.map((entry, index) =>
        normalizedJSONValue(entry, `${path}[${index}]`, depth + 1, state)
      )
    }
    const source = strictPlainDataRecord(value, path)
    const keys = Object.keys(source).sort()
    if (keys.length > AIRTABLE_RECORDS_LIMITS.jsonObjectProperties) {
      throw new TypeError(`${path} exceeds the Airtable field object property limit`)
    }
    const normalized = Object.create(null) as Record<string, JSONValue>
    for (const key of keys) {
      normalized[key] = normalizedJSONValue(source[key], `${path}.${key}`, depth + 1, state)
    }
    return normalized
  } finally {
    state.ancestors.delete(value)
  }
}

function fieldValueJSON(value: unknown, path: string, state: JSONWalkState): string {
  const serialized = JSON.stringify(normalizedJSONValue(value, path, 0, state))
  if (TEXT_ENCODER.encode(serialized).byteLength > AIRTABLE_RECORDS_LIMITS.fieldValueJsonBytes) {
    throw new TypeError(`${path} exceeds the Airtable field JSON byte limit`)
  }
  return serialized
}

function fieldName(value: string, path: string): string {
  const normalized = value.normalize('NFC')
  if (
    normalized.length === 0 ||
    normalized.length > AIRTABLE_RECORDS_LIMITS.fieldNameLength ||
    /\p{Cc}/u.test(normalized)
  ) {
    throw new TypeError(`${path} is invalid`)
  }
  return normalized
}

function normalizedFields(
  value: unknown,
  path: string,
  state: JSONWalkState
): readonly JSONObject[] {
  const source = strictPlainDataRecord(value, path)
  const keys = Object.keys(source).sort()
  if (keys.length > AIRTABLE_RECORDS_LIMITS.fieldsPerRecord) {
    throw new TypeError(`${path} exceeds the Airtable field-count limit`)
  }
  const names = new Set<string>()
  const fields = keys.map((key) => {
    const name = fieldName(key, `${path}.${key}`)
    if (names.has(name)) throw new TypeError(`${path} contains duplicate normalized field names`)
    names.add(name)
    return Object.freeze({
      name,
      valueJson: fieldValueJSON(source[key], `${path}.${key}`, state)
    })
  })
  return Object.freeze(fields)
}

const RECORD_KEYS = new Set(['id', 'createdTime', 'fields'])
const RESPONSE_KEYS = new Set(['records', 'offset'])

function normalizedRecord(value: unknown, path: string, state: JSONWalkState): JSONObject {
  const source = exactDataRecord(value, path, RECORD_KEYS, RECORD_KEYS)
  const id = stableAirtableId(source.id, RECORD_ID, `${path}.id`)
  if (typeof source.createdTime !== 'string' || !CREATED_TIME.test(source.createdTime)) {
    throw new TypeError(`${path}.createdTime must be a UTC ISO timestamp`)
  }
  return Object.freeze({
    id,
    createdTime: source.createdTime,
    fields: normalizedFields(source.fields, `${path}.fields`, state)
  })
}

/**
 * Normalize the Airtable response before the broker validates the declared result contract.
 * Arbitrary Airtable field objects become a bounded array of name/canonical-JSON pairs.
 */
export function normalizeAirtableListRecordsResponse(
  value: unknown
): Readonly<{ [key: string]: PluginParameterValue }> {
  const source = exactDataRecord(
    value,
    'Airtable list-records response',
    RESPONSE_KEYS,
    new Set(['records'])
  )
  const records = plainDataArray(
    source.records,
    'Airtable list-records response.records',
    AIRTABLE_RECORDS_LIMITS.records
  )
  const state: JSONWalkState = { nodes: 0, ancestors: new WeakSet() }
  const normalizedRecords = records.map((record, index) =>
    normalizedRecord(record, `Airtable list-records response.records[${index}]`, state)
  )
  const offset =
    source.offset === undefined
      ? undefined
      : paginationOffset(source.offset, 'Airtable list-records response.offset')
  const normalized = {
    records: normalizedRecords,
    hasMore: offset !== undefined,
    ...(offset === undefined ? {} : { offset })
  }
  return parsePluginObjectParameterValue(
    normalized,
    AIRTABLE_LIST_RECORDS_OPERATION.result.schema,
    AIRTABLE_LIST_RECORDS_OPERATION.result.maxBytes,
    'Airtable normalized list-records result'
  )
}

export interface AirtableRecordsConnectorAdapter extends ConnectorHostAdapter {
  normalizeListRecordsResponse(value: unknown): Readonly<{ [key: string]: PluginParameterValue }>
}

/**
 * Host-reviewed, read-only request shaper. It never sees a credential value: the connector broker
 * owns runtime resolution of the declared bearer slot and injects Authorization after validation.
 */
export const AIRTABLE_RECORDS_CONNECTOR_ADAPTER: AirtableRecordsConnectorAdapter = Object.freeze({
  pluginId: AIRTABLE_RECORDS_PLUGIN_ID,
  connectorId: AIRTABLE_RECORDS_CONNECTOR_ID,
  adapterId: AIRTABLE_RECORDS_ADAPTER_ID,
  contract: AIRTABLE_RECORDS_CONNECTOR_CONTRACT,
  async prepare(context: PrepareConnectorRequestContext): Promise<PreparedConnectorRequest> {
    return prepareListRecordsRequest(context)
  },
  transformResponse(value: unknown, context: PrepareConnectorRequestContext): PluginParameterValue {
    context.signal.throwIfAborted()
    assertReviewedAuthority(context.contract, context.operation)
    const normalized = normalizeAirtableListRecordsResponse(value)
    context.signal.throwIfAborted()
    return normalized
  },
  normalizeListRecordsResponse: normalizeAirtableListRecordsResponse
})
