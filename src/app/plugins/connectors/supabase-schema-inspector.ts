import {
  PLUGIN_CONNECTOR_CONTRACT_FORMAT,
  PLUGIN_CONNECTOR_CONTRACT_SCHEMA_VERSION,
  PLUGIN_PARAMETER_VALUE_LIMITS,
  parsePluginConnectorContract,
  parsePluginObjectParameterValue,
  type PluginConnectorContractV1,
  type PluginConnectorOperationV1,
  type PluginObjectParameterSchemaV2,
  type PluginParameterValue
} from '@open-pencil/plugin-contracts'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import {
  SUPABASE_MANAGEMENT_API_ORIGIN,
  SUPABASE_OPENAPI_MAX_RESPONSE_BYTES,
  SUPABASE_OPENAPI_REQUEST_TIMEOUT_MS,
  normalizeSupabaseSchemaName,
  projectRefFromSupabaseURL,
  supabaseOpenAPIURL
} from '@/app/lowcode/supabase/management-client'
import {
  SUPABASE_SCHEMA_CATALOG_LIMITS,
  SUPABASE_SCHEMA_CATALOG_VERSION,
  parseSupabaseSchemaCatalog,
  type SupabaseSchemaCatalog,
  type SupabaseSchemaCatalogIdentity
} from '@/app/lowcode/supabase/schema-catalog'
import { credentialRef } from '@/app/settings/credentials/reference'

import {
  CONNECTOR_EXECUTION_LIMITS,
  ConnectorExecutionError,
  type ConnectorHostAdapter,
  type PrepareConnectorRequestContext,
  type PreparedConnectorRequest
} from './types'

export const SUPABASE_SCHEMA_INSPECTOR_PLUGIN_ID = 'open-pencil.supabase-schema-inspector'
export const SUPABASE_SCHEMA_INSPECTOR_CONNECTOR_ID = 'supabase.schema-inspector'
export const SUPABASE_SCHEMA_INSPECTOR_ADAPTER_ID =
  'open-pencil.connector.supabase-schema-inspector'
export const SUPABASE_SCHEMA_INSPECTOR_OPERATION_ID = 'inspect-schema'
export const SUPABASE_SCHEMA_INSPECTOR_PAT_SLOT_ID = 'management-pat'

export const SUPABASE_SCHEMA_INSPECTOR_LIMITS = Object.freeze({
  timeoutMs: SUPABASE_OPENAPI_REQUEST_TIMEOUT_MS,
  upstreamResponseBytes: SUPABASE_OPENAPI_MAX_RESPONSE_BYTES,
  resultBytes: Math.min(
    CONNECTOR_EXECUTION_LIMITS.maxResponseBytes,
    PLUGIN_PARAMETER_VALUE_LIMITS.maxBytes
  ),
  parameterBytes: 512
})

const STRING_63 = Object.freeze({ type: 'string' as const, minLength: 1, maxLength: 63 })
const STRING_128 = Object.freeze({ type: 'string' as const, minLength: 1, maxLength: 128 })
const STRING_2K = Object.freeze({ type: 'string' as const, minLength: 1, maxLength: 2_048 })

const PARAMETERS_SCHEMA: PluginObjectParameterSchemaV2 = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    projectRef: STRING_63,
    schema: STRING_63
  }),
  required: Object.freeze(['projectRef']),
  additionalProperties: false,
  minProperties: 1,
  maxProperties: 2
})

const COLUMN_SCHEMA: PluginObjectParameterSchemaV2 = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    name: STRING_128,
    type: STRING_128,
    required: Object.freeze({ type: 'boolean' as const }),
    nullable: Object.freeze({ type: 'boolean' as const }),
    format: STRING_128,
    description: STRING_2K
  }),
  required: Object.freeze(['name', 'type', 'required', 'nullable']),
  additionalProperties: false,
  minProperties: 4,
  maxProperties: 6
})

const RELATION_SCHEMA: PluginObjectParameterSchemaV2 = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    sourceColumn: STRING_128,
    targetTable: STRING_128,
    targetColumn: STRING_128
  }),
  required: Object.freeze(['sourceColumn', 'targetTable']),
  additionalProperties: false,
  minProperties: 2,
  maxProperties: 3
})

const TABLE_SCHEMA: PluginObjectParameterSchemaV2 = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    name: STRING_128,
    description: STRING_2K,
    required: Object.freeze({
      type: 'array' as const,
      items: STRING_128,
      maxItems: SUPABASE_SCHEMA_CATALOG_LIMITS.maxColumnsPerTable
    }),
    columns: Object.freeze({
      type: 'array' as const,
      items: COLUMN_SCHEMA,
      maxItems: SUPABASE_SCHEMA_CATALOG_LIMITS.maxColumnsPerTable
    }),
    relations: Object.freeze({
      type: 'array' as const,
      items: RELATION_SCHEMA,
      maxItems: SUPABASE_SCHEMA_CATALOG_LIMITS.maxRelationsPerTable
    })
  }),
  required: Object.freeze(['name', 'required', 'columns', 'relations']),
  additionalProperties: false,
  minProperties: 4,
  maxProperties: 5
})

const RESULT_SCHEMA: PluginObjectParameterSchemaV2 = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    version: Object.freeze({
      type: 'integer' as const,
      enum: Object.freeze([SUPABASE_SCHEMA_CATALOG_VERSION])
    }),
    projectRef: STRING_63,
    schema: STRING_63,
    tables: Object.freeze({
      type: 'array' as const,
      items: TABLE_SCHEMA,
      maxItems: SUPABASE_SCHEMA_CATALOG_LIMITS.maxTables
    })
  }),
  required: Object.freeze(['version', 'projectRef', 'schema', 'tables']),
  additionalProperties: false,
  minProperties: 4,
  maxProperties: 4
})

export const SUPABASE_SCHEMA_INSPECTOR_CONTRACT: PluginConnectorContractV1 =
  parsePluginConnectorContract({
    format: PLUGIN_CONNECTOR_CONTRACT_FORMAT,
    schemaVersion: PLUGIN_CONNECTOR_CONTRACT_SCHEMA_VERSION,
    pluginId: SUPABASE_SCHEMA_INSPECTOR_PLUGIN_ID,
    connectorId: SUPABASE_SCHEMA_INSPECTOR_CONNECTOR_ID,
    adapterId: SUPABASE_SCHEMA_INSPECTOR_ADAPTER_ID,
    name: 'Supabase Schema Inspector',
    description:
      'Read a bounded database schema catalog through the reviewed Supabase Management API adapter.',
    kind: 'data-source',
    network: {
      origins: [SUPABASE_MANAGEMENT_API_ORIGIN],
      methods: ['GET'],
      credentials: 'omit',
      redirects: 'error'
    },
    credentialSlots: [
      {
        slotId: SUPABASE_SCHEMA_INSPECTOR_PAT_SLOT_ID,
        label: 'Supabase personal access token',
        kind: 'bearer-token',
        required: true
      }
    ],
    operations: [
      {
        operationId: SUPABASE_SCHEMA_INSPECTOR_OPERATION_ID,
        name: 'Inspect schema',
        description: 'Read a bounded schema catalog for one Supabase project and schema.',
        kind: 'query',
        credentialSlots: [SUPABASE_SCHEMA_INSPECTOR_PAT_SLOT_ID],
        request: {
          origin: SUPABASE_MANAGEMENT_API_ORIGIN,
          method: 'GET',
          pathTemplate: '/v1/projects/{projectRef}/database/openapi',
          maxResponseBytes: SUPABASE_SCHEMA_INSPECTOR_LIMITS.upstreamResponseBytes
        },
        parameters: {
          schema: PARAMETERS_SCHEMA,
          maxBytes: SUPABASE_SCHEMA_INSPECTOR_LIMITS.parameterBytes
        },
        result: {
          schema: RESULT_SCHEMA,
          maxBytes: SUPABASE_SCHEMA_INSPECTOR_LIMITS.resultBytes
        }
      }
    ]
  })

export const SUPABASE_SCHEMA_INSPECTOR_CREDENTIAL_REFS = Object.freeze({
  [SUPABASE_SCHEMA_INSPECTOR_PAT_SLOT_ID]: credentialRef(
    SUPABASE_SCHEMA_INSPECTOR_PLUGIN_ID,
    SUPABASE_SCHEMA_INSPECTOR_PAT_SLOT_ID
  )
})

export const SUPABASE_SCHEMA_INSPECTOR_EXECUTION_DEFAULTS = Object.freeze({
  credentialRefs: SUPABASE_SCHEMA_INSPECTOR_CREDENTIAL_REFS,
  timeoutMs: SUPABASE_SCHEMA_INSPECTOR_LIMITS.timeoutMs
})

type SupabaseSchemaInspectorParameters = Readonly<SupabaseSchemaCatalogIdentity>

function invalidParameters(message: string, cause?: unknown): ConnectorExecutionError {
  return new ConnectorExecutionError(
    'invalid-parameters',
    message,
    cause === undefined ? undefined : { cause }
  )
}

function normalizedParameters(parameters: unknown): SupabaseSchemaInspectorParameters {
  let parsed: Readonly<{ [key: string]: unknown }>
  try {
    parsed = parsePluginObjectParameterValue(
      parameters,
      PARAMETERS_SCHEMA,
      SUPABASE_SCHEMA_INSPECTOR_LIMITS.parameterBytes,
      'Supabase schema inspector parameters'
    )
  } catch (cause) {
    throw invalidParameters('Supabase schema inspector parameters are invalid.', cause)
  }

  const rawProjectRef = parsed.projectRef
  const rawSchema = parsed.schema
  if (
    typeof rawProjectRef !== 'string' ||
    (rawSchema !== undefined && typeof rawSchema !== 'string')
  ) {
    throw invalidParameters('Supabase schema inspector parameters are invalid.')
  }

  try {
    const projectRef = projectRefFromSupabaseURL(`https://${rawProjectRef}.supabase.co`)
    const schema = normalizeSupabaseSchemaName(rawSchema)
    if (projectRef !== rawProjectRef || (rawSchema !== undefined && schema !== rawSchema)) {
      throw invalidParameters('Supabase project reference and schema must be canonical.')
    }
    return Object.freeze({ projectRef, schema })
  } catch (cause) {
    if (cause instanceof ConnectorExecutionError) throw cause
    throw invalidParameters('Supabase project reference or schema is invalid.', cause)
  }
}

function assertExactAuthority(
  contract: PluginConnectorContractV1,
  operation: PluginConnectorOperationV1
): void {
  const expectedOperation = SUPABASE_SCHEMA_INSPECTOR_CONTRACT.operations[0]
  let parsedContract: PluginConnectorContractV1
  let parsedOperation: PluginConnectorOperationV1
  try {
    parsedContract = parsePluginConnectorContract(contract)
    parsedOperation = parsePluginConnectorContract({
      ...SUPABASE_SCHEMA_INSPECTOR_CONTRACT,
      operations: [operation]
    }).operations[0]
  } catch {
    throw new ConnectorExecutionError(
      'authority-mismatch',
      'Supabase schema inspector authority does not match the reviewed adapter contract.'
    )
  }
  if (
    JSON.stringify(parsedContract) !== JSON.stringify(SUPABASE_SCHEMA_INSPECTOR_CONTRACT) ||
    JSON.stringify(parsedOperation) !== JSON.stringify(expectedOperation)
  ) {
    throw new ConnectorExecutionError(
      'authority-mismatch',
      'Supabase schema inspector authority does not match the reviewed adapter contract.'
    )
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw new ConnectorExecutionError('aborted', 'Supabase schema inspection was aborted.')
}

export function prepareSupabaseSchemaInspectorRequest(
  context: PrepareConnectorRequestContext
): PreparedConnectorRequest {
  throwIfAborted(context.signal)
  assertExactAuthority(context.contract, context.operation)
  const parameters = normalizedParameters(context.parameters)
  throwIfAborted(context.signal)
  return Object.freeze({
    url: supabaseOpenAPIURL(parameters.projectRef, parameters.schema),
    headers: Object.freeze({ Accept: 'application/json' })
  })
}

/**
 * Convert the reviewed Management API response to the existing bounded schema catalog.
 * The broker calls this through its host-owned post-response transform hook before the final
 * result contract is validated.
 */
export function parseSupabaseSchemaInspectorResponse(
  openAPI: unknown,
  parameters: Readonly<JSONObject>
): SupabaseSchemaCatalog {
  const identity = normalizedParameters(parameters)
  let catalog: SupabaseSchemaCatalog
  try {
    catalog = parseSupabaseSchemaCatalog(openAPI, identity)
  } catch (cause) {
    throw new ConnectorExecutionError(
      'invalid-response',
      'Supabase returned an invalid or unsupported schema description.',
      { cause }
    )
  }
  if (
    new TextEncoder().encode(JSON.stringify(catalog)).byteLength >
    SUPABASE_SCHEMA_INSPECTOR_LIMITS.resultBytes
  ) {
    throw new ConnectorExecutionError(
      'response-too-large',
      'Supabase schema catalog exceeds the connector result limit.'
    )
  }
  return catalog
}

export const SUPABASE_SCHEMA_INSPECTOR_ADAPTER: ConnectorHostAdapter = Object.freeze({
  pluginId: SUPABASE_SCHEMA_INSPECTOR_PLUGIN_ID,
  connectorId: SUPABASE_SCHEMA_INSPECTOR_CONNECTOR_ID,
  adapterId: SUPABASE_SCHEMA_INSPECTOR_ADAPTER_ID,
  contract: SUPABASE_SCHEMA_INSPECTOR_CONTRACT,
  prepare(context: PrepareConnectorRequestContext) {
    return Promise.resolve().then(() => prepareSupabaseSchemaInspectorRequest(context))
  },
  transformResponse(value: unknown, context: PrepareConnectorRequestContext): PluginParameterValue {
    throwIfAborted(context.signal)
    assertExactAuthority(context.contract, context.operation)
    const catalog = parseSupabaseSchemaInspectorResponse(value, context.parameters)
    throwIfAborted(context.signal)
    return parsePluginObjectParameterValue(
      catalog,
      RESULT_SCHEMA,
      SUPABASE_SCHEMA_INSPECTOR_LIMITS.resultBytes,
      'Supabase schema inspector result'
    )
  }
})
