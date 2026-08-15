/* eslint-disable max-lines -- Contract, request shaping, and response normalization share one review boundary. */
import {
  PLUGIN_CONNECTOR_CONTRACT_FORMAT,
  PLUGIN_CONNECTOR_CONTRACT_SCHEMA_VERSION,
  parsePluginConnectorContract,
  parsePluginObjectParameterValue,
  type PluginConnectorContractV1,
  type PluginConnectorOperationV1,
  type PluginObjectParameterSchemaV2,
  type PluginParameterValue
} from '@open-pencil/core/plugins'
import { detectSupabaseSecretKey } from '@open-pencil/lowcode'

import { projectRefFromSupabaseURL } from '@/app/lowcode/supabase/management-client'
import type { JSONTraversalState } from '@/app/plugins/json-data'
import { credentialRef } from '@/app/settings/credentials/reference'

import { resolveConnectorOperationOrigin, resolveConnectorOperationPath } from './broker'
import {
  ConnectorExecutionError,
  type ConnectorHostAdapter,
  type ConnectorParameterObject,
  type PrepareConnectorRequestContext,
  type PreparedConnectorRequest,
  type ValidateConnectorCredentialContext
} from './types'

export const SUPABASE_BUSINESS_PLUGIN_ID = 'open-pencil.supabase-business'
export const SUPABASE_BUSINESS_CONNECTOR_ID = 'supabase.tables'
export const SUPABASE_BUSINESS_ADAPTER_ID = 'open-pencil.connector.supabase-tables'
export const SUPABASE_BUSINESS_ORIGIN_TEMPLATE = 'https://{projectRef}.supabase.co'
export const SUPABASE_PUBLISHABLE_KEY_SLOT_ID = 'publishable-key'
export const SUPABASE_ACCESS_TOKEN_SLOT_ID = 'access-token'

export const SUPABASE_TABLE_OPERATION_IDS = Object.freeze({
  query: 'query-rows',
  insert: 'insert-rows',
  update: 'update-rows',
  delete: 'delete-rows'
})

export const SUPABASE_BUSINESS_LIMITS = Object.freeze({
  timeoutMs: 15_000,
  parameterBytes: 256 * 1024,
  queryResponseBytes: 512 * 1024,
  mutationResponseBytes: 4 * 1024,
  resultBytes: 512 * 1024,
  maxRows: 100,
  maxFields: 64,
  maxFilters: 16,
  maxJsonValueBytes: 4 * 1024,
  maxJsonDepth: 12,
  maxJsonNodes: 4_096
})

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/
const FILTER_OPERATORS = Object.freeze([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'like',
  'ilike',
  'is'
] as const)
type FilterOperator = (typeof FILTER_OPERATORS)[number]
const FILTER_OPERATOR_SET: ReadonlySet<string> = new Set(FILTER_OPERATORS)
const TEXT_ENCODER = new TextEncoder()
const UNSAFE_PROPERTY_NAMES = new Set(['__proto__', 'prototype', 'constructor'])
const BOUNDED_AFFECTED_ROWS_PREFERENCE = `handling=strict, max-affected=${SUPABASE_BUSINESS_LIMITS.maxRows}, return=minimal`

const PROJECT_REF_SCHEMA = Object.freeze({ type: 'string' as const, minLength: 1, maxLength: 63 })
const IDENTIFIER_SCHEMA = Object.freeze({ type: 'string' as const, minLength: 1, maxLength: 63 })
const JSON_SOURCE_SCHEMA = Object.freeze({
  type: 'string' as const,
  minLength: 1,
  maxLength: SUPABASE_BUSINESS_LIMITS.maxJsonValueBytes
})

const FIELD_SCHEMA: PluginObjectParameterSchemaV2 = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    name: IDENTIFIER_SCHEMA,
    valueJson: JSON_SOURCE_SCHEMA
  }),
  required: Object.freeze(['name', 'valueJson']),
  additionalProperties: false,
  minProperties: 2,
  maxProperties: 2
})

const FILTER_SCHEMA: PluginObjectParameterSchemaV2 = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    column: IDENTIFIER_SCHEMA,
    operator: Object.freeze({
      type: 'string' as const,
      enum: FILTER_OPERATORS
    }),
    valueJson: JSON_SOURCE_SCHEMA
  }),
  required: Object.freeze(['column', 'operator', 'valueJson']),
  additionalProperties: false,
  minProperties: 3,
  maxProperties: 3
})

const RECORD_INPUT_SCHEMA: PluginObjectParameterSchemaV2 = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    fields: Object.freeze({
      type: 'array' as const,
      items: FIELD_SCHEMA,
      minItems: 1,
      maxItems: SUPABASE_BUSINESS_LIMITS.maxFields
    })
  }),
  required: Object.freeze(['fields']),
  additionalProperties: false,
  minProperties: 1,
  maxProperties: 1
})

const NORMALIZED_ROW_SCHEMA: PluginObjectParameterSchemaV2 = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    fields: Object.freeze({
      type: 'array' as const,
      items: FIELD_SCHEMA,
      maxItems: SUPABASE_BUSINESS_LIMITS.maxFields
    })
  }),
  required: Object.freeze(['fields']),
  additionalProperties: false,
  minProperties: 1,
  maxProperties: 1
})

const FILTERS_OPTIONAL_SCHEMA = Object.freeze({
  type: 'array' as const,
  items: FILTER_SCHEMA,
  maxItems: SUPABASE_BUSINESS_LIMITS.maxFilters
})
const FILTERS_REQUIRED_SCHEMA = Object.freeze({
  ...FILTERS_OPTIONAL_SCHEMA,
  minItems: 1
})
const FIELDS_SCHEMA = Object.freeze({
  type: 'array' as const,
  items: FIELD_SCHEMA,
  minItems: 1,
  maxItems: SUPABASE_BUSINESS_LIMITS.maxFields
})

const QUERY_PARAMETERS_SCHEMA: PluginObjectParameterSchemaV2 = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    projectRef: PROJECT_REF_SCHEMA,
    table: IDENTIFIER_SCHEMA,
    columns: Object.freeze({
      type: 'array' as const,
      items: IDENTIFIER_SCHEMA,
      minItems: 1,
      maxItems: SUPABASE_BUSINESS_LIMITS.maxFields
    }),
    filters: FILTERS_OPTIONAL_SCHEMA,
    limit: Object.freeze({
      type: 'integer' as const,
      minimum: 1,
      maximum: SUPABASE_BUSINESS_LIMITS.maxRows
    })
  }),
  required: Object.freeze(['projectRef', 'table']),
  additionalProperties: false,
  minProperties: 2,
  maxProperties: 5
})

const INSERT_PARAMETERS_SCHEMA: PluginObjectParameterSchemaV2 = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    projectRef: PROJECT_REF_SCHEMA,
    table: IDENTIFIER_SCHEMA,
    records: Object.freeze({
      type: 'array' as const,
      items: RECORD_INPUT_SCHEMA,
      minItems: 1,
      maxItems: SUPABASE_BUSINESS_LIMITS.maxRows
    })
  }),
  required: Object.freeze(['projectRef', 'table', 'records']),
  additionalProperties: false,
  minProperties: 3,
  maxProperties: 3
})

const UPDATE_PARAMETERS_SCHEMA: PluginObjectParameterSchemaV2 = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    projectRef: PROJECT_REF_SCHEMA,
    table: IDENTIFIER_SCHEMA,
    fields: FIELDS_SCHEMA,
    filters: FILTERS_REQUIRED_SCHEMA
  }),
  required: Object.freeze(['projectRef', 'table', 'fields', 'filters']),
  additionalProperties: false,
  minProperties: 4,
  maxProperties: 4
})

const DELETE_PARAMETERS_SCHEMA: PluginObjectParameterSchemaV2 = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    projectRef: PROJECT_REF_SCHEMA,
    table: IDENTIFIER_SCHEMA,
    filters: FILTERS_REQUIRED_SCHEMA
  }),
  required: Object.freeze(['projectRef', 'table', 'filters']),
  additionalProperties: false,
  minProperties: 3,
  maxProperties: 3
})

const QUERY_RESULT_SCHEMA: PluginObjectParameterSchemaV2 = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    rows: Object.freeze({
      type: 'array' as const,
      items: NORMALIZED_ROW_SCHEMA,
      maxItems: SUPABASE_BUSINESS_LIMITS.maxRows
    })
  }),
  required: Object.freeze(['rows']),
  additionalProperties: false,
  minProperties: 1,
  maxProperties: 1
})

const MUTATION_RESULT_SCHEMA: PluginObjectParameterSchemaV2 = Object.freeze({
  type: 'object',
  properties: Object.freeze({ ok: Object.freeze({ type: 'boolean' as const }) }),
  required: Object.freeze(['ok']),
  additionalProperties: false,
  minProperties: 1,
  maxProperties: 1
})

const CREDENTIAL_SLOTS = Object.freeze([
  SUPABASE_PUBLISHABLE_KEY_SLOT_ID,
  SUPABASE_ACCESS_TOKEN_SLOT_ID
])

function operation(
  operationId: string,
  name: string,
  description: string,
  kind: 'query' | 'mutation',
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  parameters: PluginObjectParameterSchemaV2
) {
  const query = kind === 'query'
  return {
    operationId,
    name,
    description,
    kind,
    credentialSlots: CREDENTIAL_SLOTS,
    request: {
      originTemplate: SUPABASE_BUSINESS_ORIGIN_TEMPLATE,
      method,
      pathTemplate: '/rest/v1/{table}',
      maxResponseBytes: query
        ? SUPABASE_BUSINESS_LIMITS.queryResponseBytes
        : SUPABASE_BUSINESS_LIMITS.mutationResponseBytes
    },
    parameters: {
      schema: parameters,
      maxBytes: SUPABASE_BUSINESS_LIMITS.parameterBytes
    },
    result: {
      schema: query ? QUERY_RESULT_SCHEMA : MUTATION_RESULT_SCHEMA,
      maxBytes: query ? SUPABASE_BUSINESS_LIMITS.resultBytes : 32
    }
  }
}

export const SUPABASE_BUSINESS_CONNECTOR_CONTRACT: PluginConnectorContractV1 =
  parsePluginConnectorContract({
    format: PLUGIN_CONNECTOR_CONTRACT_FORMAT,
    schemaVersion: PLUGIN_CONNECTOR_CONTRACT_SCHEMA_VERSION,
    pluginId: SUPABASE_BUSINESS_PLUGIN_ID,
    connectorId: SUPABASE_BUSINESS_CONNECTOR_ID,
    adapterId: SUPABASE_BUSINESS_ADAPTER_ID,
    name: 'Supabase Tables',
    description:
      'Query and mutate bounded rows in the public schema of one canonical Supabase project.',
    kind: 'data-source',
    network: {
      origins: [],
      originTemplates: [SUPABASE_BUSINESS_ORIGIN_TEMPLATE],
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      credentials: 'omit',
      redirects: 'error'
    },
    credentialSlots: [
      {
        slotId: SUPABASE_PUBLISHABLE_KEY_SLOT_ID,
        label: 'Supabase publishable or legacy anon key',
        kind: 'api-key',
        required: true,
        injection: { location: 'header', name: 'apikey' }
      },
      {
        slotId: SUPABASE_ACCESS_TOKEN_SLOT_ID,
        label: 'Supabase user access token or legacy anon key',
        kind: 'bearer-token',
        required: true
      }
    ],
    operations: [
      operation(
        SUPABASE_TABLE_OPERATION_IDS.query,
        'Query rows',
        'Read at most 100 rows using bounded columns and scalar filters.',
        'query',
        'GET',
        QUERY_PARAMETERS_SCHEMA
      ),
      operation(
        SUPABASE_TABLE_OPERATION_IDS.insert,
        'Insert rows',
        'Insert at most 100 bounded records after explicit confirmation.',
        'mutation',
        'POST',
        INSERT_PARAMETERS_SCHEMA
      ),
      operation(
        SUPABASE_TABLE_OPERATION_IDS.update,
        'Update rows',
        'Update bounded fields with at least one filter after explicit confirmation.',
        'mutation',
        'PATCH',
        UPDATE_PARAMETERS_SCHEMA
      ),
      operation(
        SUPABASE_TABLE_OPERATION_IDS.delete,
        'Delete rows',
        'Delete rows with at least one filter after explicit confirmation.',
        'mutation',
        'DELETE',
        DELETE_PARAMETERS_SCHEMA
      )
    ]
  })

export const SUPABASE_BUSINESS_CREDENTIAL_REFS = Object.freeze({
  [SUPABASE_PUBLISHABLE_KEY_SLOT_ID]: credentialRef(
    SUPABASE_BUSINESS_PLUGIN_ID,
    SUPABASE_PUBLISHABLE_KEY_SLOT_ID
  ),
  [SUPABASE_ACCESS_TOKEN_SLOT_ID]: credentialRef(
    SUPABASE_BUSINESS_PLUGIN_ID,
    SUPABASE_ACCESS_TOKEN_SLOT_ID
  )
})

export const SUPABASE_BUSINESS_EXECUTION_DEFAULTS = Object.freeze({
  credentialRefs: SUPABASE_BUSINESS_CREDENTIAL_REFS,
  timeoutMs: SUPABASE_BUSINESS_LIMITS.timeoutMs
})

interface FieldValue {
  readonly name: string
  readonly value: unknown
}

interface SupabaseJSONRecord {
  [key: string]: unknown
}

interface FilterValue {
  readonly column: string
  readonly operator: FilterOperator
  readonly wireValue: string
}

function invalidParameters(message: string, cause?: unknown): ConnectorExecutionError {
  return new ConnectorExecutionError(
    'invalid-parameters',
    message,
    cause === undefined ? undefined : { cause }
  )
}

function invalidResponse(message: string, cause?: unknown): ConnectorExecutionError {
  return new ConnectorExecutionError(
    'invalid-response',
    message,
    cause === undefined ? undefined : { cause }
  )
}

function assertIdentifier(value: unknown, path: string): string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
    throw invalidParameters(`${path} must be a canonical lowercase SQL identifier.`)
  }
  return value
}

function canonicalProjectRef(value: unknown): string {
  if (typeof value !== 'string') throw invalidParameters('Supabase projectRef is invalid.')
  try {
    const projectRef = projectRefFromSupabaseURL(`https://${value}.supabase.co`)
    if (projectRef !== value) throw invalidParameters('Supabase projectRef must be canonical.')
    return projectRef
  } catch (cause) {
    if (cause instanceof ConnectorExecutionError) throw cause
    throw invalidParameters('Supabase projectRef is invalid.', cause)
  }
}

function parseCanonicalJSON(value: unknown, path: string): unknown {
  if (typeof value !== 'string') throw invalidParameters(`${path} must be canonical JSON.`)
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch (cause) {
    throw invalidParameters(`${path} must be valid JSON.`, cause)
  }
  if (JSON.stringify(parsed) !== value) {
    throw invalidParameters(`${path} must use compact canonical JSON.`)
  }
  return parsed
}

function normalizeFields(value: PluginParameterValue, path: string): readonly FieldValue[] {
  if (!Array.isArray(value)) throw invalidParameters(`${path} must be an array.`)
  const fields = value.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw invalidParameters(`${path}[${index}] must be an object.`)
    }
    const name = assertIdentifier(entry.name, `${path}[${index}].name`)
    return Object.freeze({
      name,
      value: parseCanonicalJSON(entry.valueJson, `${path}[${index}].valueJson`)
    })
  })
  if (new Set(fields.map((field) => field.name)).size !== fields.length) {
    throw invalidParameters(`${path} must not contain duplicate field names.`)
  }
  return Object.freeze(fields)
}

function normalizeFilter(entry: PluginParameterValue, path: string): FilterValue {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    throw invalidParameters(`${path} must be an object.`)
  }
  const source = entry as Readonly<Record<string, PluginParameterValue>>
  const column = assertIdentifier(source.column, `${path}.column`)
  const operator = source.operator
  if (!isFilterOperator(operator)) {
    throw invalidParameters(`${path}.operator is not supported.`)
  }
  const parsed = parseCanonicalJSON(source.valueJson, `${path}.valueJson`)
  if (
    parsed !== null &&
    typeof parsed !== 'string' &&
    typeof parsed !== 'number' &&
    typeof parsed !== 'boolean'
  ) {
    throw invalidParameters(`${path}.valueJson must contain a JSON scalar.`)
  }
  if (operator === 'is' && parsed !== null && typeof parsed !== 'boolean') {
    throw invalidParameters(`${path}.valueJson for is must be null or boolean.`)
  }
  if ((operator === 'like' || operator === 'ilike') && typeof parsed !== 'string') {
    throw invalidParameters(`${path}.valueJson for ${operator} must be a string.`)
  }
  if (operator !== 'is' && parsed === null) {
    throw invalidParameters(`${path}.valueJson null requires the is operator.`)
  }
  return Object.freeze({
    column,
    operator,
    wireValue: parsed === null ? 'null' : String(parsed)
  })
}

function isFilterOperator(value: unknown): value is FilterOperator {
  return typeof value === 'string' && FILTER_OPERATOR_SET.has(value)
}

function normalizeFilters(
  value: PluginParameterValue | undefined,
  path: string,
  required: boolean
): readonly FilterValue[] {
  if (value === undefined) {
    if (required) throw invalidParameters(`${path} must contain at least one filter.`)
    return Object.freeze([])
  }
  if (!Array.isArray(value) || (required && value.length === 0)) {
    throw invalidParameters(`${path} must contain at least one filter.`)
  }
  return Object.freeze(value.map((entry, index) => normalizeFilter(entry, `${path}[${index}]`)))
}

function operationParameters(
  parameters: ConnectorParameterObject,
  operationValue: PluginConnectorOperationV1
): ConnectorParameterObject {
  try {
    return parsePluginObjectParameterValue(
      parameters,
      operationValue.parameters.schema,
      operationValue.parameters.maxBytes,
      'Supabase Tables parameters'
    ) as ConnectorParameterObject
  } catch (cause) {
    throw invalidParameters('Supabase Tables parameters are invalid.', cause)
  }
}

function assertExactAuthority(
  contract: PluginConnectorContractV1,
  operationValue: PluginConnectorOperationV1
): PluginConnectorOperationV1 {
  let parsedContract: PluginConnectorContractV1
  let parsedOperation: PluginConnectorOperationV1
  try {
    parsedContract = parsePluginConnectorContract(contract)
    parsedOperation = parsePluginConnectorContract({
      ...SUPABASE_BUSINESS_CONNECTOR_CONTRACT,
      operations: [operationValue]
    }).operations[0]
  } catch {
    throw new ConnectorExecutionError(
      'authority-mismatch',
      'Supabase Tables authority does not match the reviewed adapter contract.'
    )
  }
  const expected = SUPABASE_BUSINESS_CONNECTOR_CONTRACT.operations.find(
    (operation) => operation.operationId === parsedOperation.operationId
  )
  if (
    !expected ||
    JSON.stringify(parsedContract) !== JSON.stringify(SUPABASE_BUSINESS_CONNECTOR_CONTRACT) ||
    JSON.stringify(parsedOperation) !== JSON.stringify(expected)
  ) {
    throw new ConnectorExecutionError(
      'authority-mismatch',
      'Supabase Tables authority does not match the reviewed adapter contract.'
    )
  }
  return expected
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new ConnectorExecutionError('aborted', 'Supabase Tables operation was aborted.')
  }
}

function tableURL(
  operationValue: PluginConnectorOperationV1,
  parameters: ConnectorParameterObject
): URL {
  canonicalProjectRef(parameters.projectRef)
  assertIdentifier(parameters.table, 'Supabase table')
  const origin = resolveConnectorOperationOrigin(operationValue, parameters)
  return new URL(resolveConnectorOperationPath(operationValue, parameters), `${origin}/`)
}

function appendFilters(url: URL, filters: readonly FilterValue[]): void {
  for (const filter of filters) {
    url.searchParams.append(filter.column, `${filter.operator}.${filter.wireValue}`)
  }
}

function fieldsRecord(fields: readonly FieldValue[]): SupabaseJSONRecord {
  const result = Object.create(null) as SupabaseJSONRecord
  for (const field of fields) result[field.name] = field.value
  return result
}

function prepareQuery(
  operationValue: PluginConnectorOperationV1,
  parameters: ConnectorParameterObject
): PreparedConnectorRequest {
  const url = tableURL(operationValue, parameters)
  const columns = Object.hasOwn(parameters, 'columns') ? parameters.columns : undefined
  if (columns !== undefined) {
    if (!Array.isArray(columns)) throw invalidParameters('Supabase columns must be an array.')
    const normalized = columns.map((column, index) =>
      assertIdentifier(column, `Supabase columns[${index}]`)
    )
    if (new Set(normalized).size !== normalized.length) {
      throw invalidParameters('Supabase columns must not contain duplicates.')
    }
    url.searchParams.set('select', normalized.join(','))
  } else {
    url.searchParams.set('select', '*')
  }
  appendFilters(url, normalizeFilters(parameters.filters, 'Supabase filters', false))
  const limit = Object.hasOwn(parameters, 'limit')
    ? parameters.limit
    : SUPABASE_BUSINESS_LIMITS.maxRows
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit)) {
    throw invalidParameters('Supabase limit must be an integer.')
  }
  url.searchParams.set('limit', String(limit))
  return Object.freeze({ url: url.href, headers: Object.freeze({ Accept: 'application/json' }) })
}

function prepareInsert(
  operationValue: PluginConnectorOperationV1,
  parameters: ConnectorParameterObject
): PreparedConnectorRequest {
  const url = tableURL(operationValue, parameters)
  const records = parameters.records
  if (!Array.isArray(records)) throw invalidParameters('Supabase records must be an array.')
  const body = records.map((record, index) => {
    if (typeof record !== 'object' || record === null || Array.isArray(record)) {
      throw invalidParameters(`Supabase records[${index}] must be an object.`)
    }
    return fieldsRecord(normalizeFields(record.fields, `Supabase records[${index}].fields`))
  })
  return Object.freeze({
    url: url.href,
    headers: Object.freeze({
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    }),
    body: JSON.stringify(body)
  })
}

function prepareUpdate(
  operationValue: PluginConnectorOperationV1,
  parameters: ConnectorParameterObject
): PreparedConnectorRequest {
  const url = tableURL(operationValue, parameters)
  appendFilters(url, normalizeFilters(parameters.filters, 'Supabase filters', true))
  if (parameters.fields === undefined) {
    throw invalidParameters('Supabase fields are required for update operations.')
  }
  return Object.freeze({
    url: url.href,
    headers: Object.freeze({
      'Content-Type': 'application/json',
      Prefer: BOUNDED_AFFECTED_ROWS_PREFERENCE
    }),
    body: JSON.stringify(fieldsRecord(normalizeFields(parameters.fields, 'Supabase fields')))
  })
}

function prepareDelete(
  operationValue: PluginConnectorOperationV1,
  parameters: ConnectorParameterObject
): PreparedConnectorRequest {
  const url = tableURL(operationValue, parameters)
  appendFilters(url, normalizeFilters(parameters.filters, 'Supabase filters', true))
  return Object.freeze({
    url: url.href,
    headers: Object.freeze({ Prefer: BOUNDED_AFFECTED_ROWS_PREFERENCE })
  })
}

export function prepareSupabaseBusinessRequest(
  context: PrepareConnectorRequestContext
): PreparedConnectorRequest {
  throwIfAborted(context.signal)
  const operationValue = assertExactAuthority(context.contract, context.operation)
  const parameters = operationParameters(context.parameters, operationValue)
  throwIfAborted(context.signal)
  if (operationValue.operationId === SUPABASE_TABLE_OPERATION_IDS.query) {
    return prepareQuery(operationValue, parameters)
  }
  if (operationValue.operationId === SUPABASE_TABLE_OPERATION_IDS.insert) {
    return prepareInsert(operationValue, parameters)
  }
  if (operationValue.operationId === SUPABASE_TABLE_OPERATION_IDS.update) {
    return prepareUpdate(operationValue, parameters)
  }
  if (operationValue.operationId === SUPABASE_TABLE_OPERATION_IDS.delete) {
    return prepareDelete(operationValue, parameters)
  }
  throw new ConnectorExecutionError('authority-mismatch', 'Supabase Tables operation is unknown.')
}

type JSONWalkState = JSONTraversalState

function responseDataRecord(value: unknown, path: string): Readonly<SupabaseJSONRecord> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw invalidResponse(`${path} must be a plain object.`)
  }
  const keys = Reflect.ownKeys(value)
  if (
    keys.length > SUPABASE_BUSINESS_LIMITS.maxFields ||
    keys.some((key) => typeof key !== 'string')
  ) {
    throw invalidResponse(`${path} exceeds the field limit.`)
  }
  const result = Object.create(null) as SupabaseJSONRecord
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw invalidResponse(`${path} must contain data properties only.`)
    }
    result[key] = descriptor.value
  }
  return result
}

function cloneResponseJSON(
  value: unknown,
  path: string,
  depth: number,
  state: JSONWalkState
): unknown {
  state.nodes += 1
  if (
    state.nodes > SUPABASE_BUSINESS_LIMITS.maxJsonNodes ||
    depth > SUPABASE_BUSINESS_LIMITS.maxJsonDepth
  ) {
    throw invalidResponse(`${path} exceeds the JSON complexity limit.`)
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalidResponse(`${path} contains a non-finite number.`)
    return value
  }
  if (typeof value !== 'object') throw invalidResponse(`${path} contains a non-JSON value.`)
  if (state.ancestors.has(value)) throw invalidResponse(`${path} contains a circular value.`)
  state.ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || value.length > 256) {
        throw invalidResponse(`${path} contains an invalid array.`)
      }
      return value.map((entry, index) =>
        cloneResponseJSON(entry, `${path}[${index}]`, depth + 1, state)
      )
    }
    const source = responseDataRecord(value, path)
    const result = Object.create(null) as SupabaseJSONRecord
    for (const key of Object.keys(source).sort()) {
      if (
        key.length === 0 ||
        key.length > 128 ||
        UNSAFE_PROPERTY_NAMES.has(key) ||
        /\p{Cc}/u.test(key)
      ) {
        throw invalidResponse(`${path} contains an invalid JSON property name.`)
      }
      result[key] = cloneResponseJSON(source[key], `${path}.${key}`, depth + 1, state)
    }
    return result
  } finally {
    state.ancestors.delete(value)
  }
}

function responseValueJSON(value: unknown, path: string, state: JSONWalkState): string {
  const source = JSON.stringify(cloneResponseJSON(value, path, 0, state))
  if (TEXT_ENCODER.encode(source).byteLength > SUPABASE_BUSINESS_LIMITS.maxJsonValueBytes) {
    throw invalidResponse(`${path} exceeds the JSON value limit.`)
  }
  return source
}

export function normalizeSupabaseRowsResponse(
  value: unknown
): Readonly<{ [key: string]: PluginParameterValue }> {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw invalidResponse('Supabase query response must be a row array.')
  }
  if (value.length > SUPABASE_BUSINESS_LIMITS.maxRows) {
    throw invalidResponse('Supabase query response exceeds the row limit.')
  }
  const state: JSONWalkState = { nodes: 0, ancestors: new WeakSet() }
  const rows = value.map((row, rowIndex) => {
    const source = responseDataRecord(row, `Supabase rows[${rowIndex}]`)
    const fields = Object.keys(source)
      .sort()
      .map((name) => ({
        name: responseIdentifier(name, `Supabase rows[${rowIndex}] field`),
        valueJson: responseValueJSON(source[name], `Supabase rows[${rowIndex}].${name}`, state)
      }))
    return Object.freeze({ fields: Object.freeze(fields) })
  })
  return parsePluginObjectParameterValue(
    { rows },
    QUERY_RESULT_SCHEMA,
    SUPABASE_BUSINESS_LIMITS.resultBytes,
    'Supabase normalized rows result'
  )
}

function responseIdentifier(value: string, path: string): string {
  if (!IDENTIFIER.test(value)) {
    throw invalidResponse(`${path} must be a canonical lowercase SQL identifier.`)
  }
  return value
}

function normalizeMutationResponse(value: unknown): Readonly<{ ok: true }> {
  const source = responseDataRecord(value, 'Supabase mutation response')
  if (Object.keys(source).length !== 0) {
    throw invalidResponse('Supabase mutation response must be empty with return=minimal.')
  }
  return Object.freeze({ ok: true })
}

function validateSupabaseCredential(context: ValidateConnectorCredentialContext): boolean {
  context.signal.throwIfAborted()
  const value = context.value
  return (
    value.length > 0 &&
    value === value.trim() &&
    !/\p{Cc}/u.test(value) &&
    !detectSupabaseSecretKey(value)
  )
}

export const SUPABASE_BUSINESS_CONNECTOR_ADAPTER: ConnectorHostAdapter = Object.freeze({
  pluginId: SUPABASE_BUSINESS_PLUGIN_ID,
  connectorId: SUPABASE_BUSINESS_CONNECTOR_ID,
  adapterId: SUPABASE_BUSINESS_ADAPTER_ID,
  contract: SUPABASE_BUSINESS_CONNECTOR_CONTRACT,
  validateCredential: validateSupabaseCredential,
  prepare(context: PrepareConnectorRequestContext): Promise<PreparedConnectorRequest> {
    return Promise.resolve().then(() => prepareSupabaseBusinessRequest(context))
  },
  transformResponse(value: unknown, context: PrepareConnectorRequestContext): PluginParameterValue {
    throwIfAborted(context.signal)
    const operationValue = assertExactAuthority(context.contract, context.operation)
    const normalized =
      operationValue.operationId === SUPABASE_TABLE_OPERATION_IDS.query
        ? normalizeSupabaseRowsResponse(value)
        : normalizeMutationResponse(value)
    throwIfAborted(context.signal)
    return normalized
  }
})
