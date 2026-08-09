import { describe, expect, test } from 'bun:test'

import { PluginConnectorContractRegistry } from '@open-pencil/core/plugins'

import { ConnectorHostAdapterRegistry } from '@/app/plugins/connectors/registry'
import {
  SUPABASE_SCHEMA_INSPECTOR_ADAPTER,
  SUPABASE_SCHEMA_INSPECTOR_ADAPTER_ID,
  SUPABASE_SCHEMA_INSPECTOR_CONNECTOR_ID,
  SUPABASE_SCHEMA_INSPECTOR_CONTRACT,
  SUPABASE_SCHEMA_INSPECTOR_CREDENTIAL_REFS,
  SUPABASE_SCHEMA_INSPECTOR_LIMITS,
  SUPABASE_SCHEMA_INSPECTOR_OPERATION_ID,
  SUPABASE_SCHEMA_INSPECTOR_PAT_SLOT_ID,
  SUPABASE_SCHEMA_INSPECTOR_PLUGIN_ID,
  parseSupabaseSchemaInspectorResponse,
  prepareSupabaseSchemaInspectorRequest
} from '@/app/plugins/connectors/supabase-schema-inspector'

function prepare(
  parameters: Record<string, string>,
  signal: AbortSignal = new AbortController().signal
) {
  return SUPABASE_SCHEMA_INSPECTOR_ADAPTER.prepare({
    contract: SUPABASE_SCHEMA_INSPECTOR_CONTRACT,
    operation: SUPABASE_SCHEMA_INSPECTOR_CONTRACT.operations[0],
    parameters,
    signal
  })
}

describe('Supabase Schema Inspector reference connector', () => {
  test('declares one exact read-only Management API authority and central PAT reference', () => {
    expect(SUPABASE_SCHEMA_INSPECTOR_CONTRACT).toMatchObject({
      pluginId: SUPABASE_SCHEMA_INSPECTOR_PLUGIN_ID,
      connectorId: SUPABASE_SCHEMA_INSPECTOR_CONNECTOR_ID,
      adapterId: SUPABASE_SCHEMA_INSPECTOR_ADAPTER_ID,
      kind: 'data-source',
      network: {
        origins: ['https://api.supabase.com'],
        methods: ['GET'],
        credentials: 'omit',
        redirects: 'error'
      }
    })
    expect(SUPABASE_SCHEMA_INSPECTOR_CONTRACT.credentialSlots).toEqual([
      {
        slotId: SUPABASE_SCHEMA_INSPECTOR_PAT_SLOT_ID,
        label: 'Supabase personal access token',
        kind: 'bearer-token',
        required: true
      }
    ])
    expect(SUPABASE_SCHEMA_INSPECTOR_CONTRACT.operations).toHaveLength(1)
    expect(SUPABASE_SCHEMA_INSPECTOR_CONTRACT.operations[0]).toMatchObject({
      operationId: SUPABASE_SCHEMA_INSPECTOR_OPERATION_ID,
      kind: 'query',
      credentialSlots: [SUPABASE_SCHEMA_INSPECTOR_PAT_SLOT_ID],
      request: {
        origin: 'https://api.supabase.com',
        method: 'GET',
        pathTemplate: '/v1/projects/{projectRef}/database/openapi',
        maxResponseBytes: SUPABASE_SCHEMA_INSPECTOR_LIMITS.upstreamResponseBytes
      }
    })
    expect(
      SUPABASE_SCHEMA_INSPECTOR_CONTRACT.operations[0].parameters.schema.properties.projectRef
    ).toMatchObject({ maxLength: 63 })
    expect(
      SUPABASE_SCHEMA_INSPECTOR_CONTRACT.operations[0].parameters.schema.properties.schema
    ).toMatchObject({ maxLength: 63 })
    expect(SUPABASE_SCHEMA_INSPECTOR_CREDENTIAL_REFS).toEqual({
      [SUPABASE_SCHEMA_INSPECTOR_PAT_SLOT_ID]: {
        integrationId: SUPABASE_SCHEMA_INSPECTOR_PLUGIN_ID,
        profileId: 'default',
        field: SUPABASE_SCHEMA_INSPECTOR_PAT_SLOT_ID
      }
    })
    expect(JSON.stringify(SUPABASE_SCHEMA_INSPECTOR_CONTRACT)).not.toContain('sbp_')
  })

  test('registers against the exact public contract and host adapter identity', () => {
    const contracts = new PluginConnectorContractRegistry()
    contracts.register(SUPABASE_SCHEMA_INSPECTOR_CONTRACT)
    contracts.freeze()
    const adapters = new ConnectorHostAdapterRegistry(contracts)

    expect(adapters.register(SUPABASE_SCHEMA_INSPECTOR_ADAPTER)).toBe(
      SUPABASE_SCHEMA_INSPECTOR_ADAPTER
    )
    expect(adapters.resolve(SUPABASE_SCHEMA_INSPECTOR_CONTRACT)).toBe(
      SUPABASE_SCHEMA_INSPECTOR_ADAPTER
    )
  })

  test('prepares only the reviewed path and non-sensitive Accept header without fetching', async () => {
    await expect(prepare({ projectRef: 'project-ref', schema: 'private data' })).resolves.toEqual({
      url: 'https://api.supabase.com/v1/projects/project-ref/database/openapi?schema=private+data',
      headers: { Accept: 'application/json' }
    })
    await expect(prepare({ projectRef: 'project-ref' })).resolves.toEqual({
      url: 'https://api.supabase.com/v1/projects/project-ref/database/openapi?schema=public',
      headers: { Accept: 'application/json' }
    })

    const prepared = await prepare({ projectRef: 'project-ref' })
    expect(prepared.body).toBeUndefined()
    expect(new Headers(prepared.headers).has('authorization')).toBe(false)
    expect(new Headers(prepared.headers).has('cookie')).toBe(false)
  })

  test('fails closed for invalid parameters, altered authority, and cancellation', async () => {
    await expect(prepare({ projectRef: '../other' })).rejects.toMatchObject({
      code: 'invalid-parameters'
    })
    await expect(prepare({ projectRef: 'Project-Ref' })).rejects.toMatchObject({
      code: 'invalid-parameters'
    })
    await expect(prepare({ projectRef: 'p'.repeat(64) })).rejects.toMatchObject({
      code: 'invalid-parameters'
    })
    await expect(prepare({ projectRef: 'project-ref', schema: ' public ' })).rejects.toMatchObject({
      code: 'invalid-parameters'
    })

    const alteredContract = {
      ...SUPABASE_SCHEMA_INSPECTOR_CONTRACT,
      adapterId: 'open-pencil.connector.unreviewed'
    }
    expect(() =>
      prepareSupabaseSchemaInspectorRequest({
        contract: alteredContract,
        operation: SUPABASE_SCHEMA_INSPECTOR_CONTRACT.operations[0],
        parameters: { projectRef: 'project-ref' },
        signal: new AbortController().signal
      })
    ).toThrow('authority does not match')

    const controller = new AbortController()
    controller.abort('private abort reason')
    await expect(prepare({ projectRef: 'project-ref' }, controller.signal)).rejects.toMatchObject({
      code: 'aborted',
      message: 'Supabase schema inspection was aborted.'
    })
  })

  test('canonicalizes authority without invoking forged getters or toJSON hooks', () => {
    let toJsonCalls = 0
    let getterCalls = 0
    const forgedContract = {
      ...SUPABASE_SCHEMA_INSPECTOR_CONTRACT,
      toJSON() {
        toJsonCalls += 1
        return SUPABASE_SCHEMA_INSPECTOR_CONTRACT
      }
    }
    const forgedOperation = { ...SUPABASE_SCHEMA_INSPECTOR_CONTRACT.operations[0] }
    Object.defineProperty(forgedOperation, 'name', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'Inspect schema'
      }
    })

    expect(() =>
      prepareSupabaseSchemaInspectorRequest({
        contract: forgedContract as never,
        operation: forgedOperation,
        parameters: { projectRef: 'project-ref' },
        signal: new AbortController().signal
      })
    ).toThrow('authority does not match')
    expect(toJsonCalls).toBe(0)
    expect(getterCalls).toBe(0)
  })

  test('converts OpenAPI to the existing bounded schema catalog', () => {
    const openApi = {
      definitions: {
        todos: {
          required: ['id'],
          properties: {
            id: { type: 'integer', format: 'int8' },
            title: { type: 'string', description: 'Task title' }
          }
        }
      }
    }
    const catalog = parseSupabaseSchemaInspectorResponse(openApi, {
      projectRef: 'project-ref',
      schema: 'public'
    })

    expect(
      SUPABASE_SCHEMA_INSPECTOR_ADAPTER.transformResponse?.(openApi, {
        contract: SUPABASE_SCHEMA_INSPECTOR_CONTRACT,
        operation: SUPABASE_SCHEMA_INSPECTOR_CONTRACT.operations[0],
        parameters: { projectRef: 'project-ref', schema: 'public' },
        signal: new AbortController().signal
      })
    ).toEqual(catalog)

    expect(catalog).toEqual({
      version: 1,
      projectRef: 'project-ref',
      schema: 'public',
      tables: [
        {
          name: 'todos',
          required: ['id'],
          columns: [
            { name: 'id', type: 'integer', required: true, nullable: false, format: 'int8' },
            {
              name: 'title',
              type: 'string',
              required: false,
              nullable: false,
              description: 'Task title'
            }
          ],
          relations: []
        }
      ]
    })
    expect(new TextEncoder().encode(JSON.stringify(catalog)).byteLength).toBeLessThanOrEqual(
      SUPABASE_SCHEMA_INSPECTOR_LIMITS.resultBytes
    )
  })

  test('rejects unsupported and oversized transformed responses without exposing response data', () => {
    expect(() =>
      parseSupabaseSchemaInspectorResponse(
        { unexpected: 'secret response body' },
        { projectRef: 'project-ref' }
      )
    ).toThrow('invalid or unsupported')

    const definitions = Object.fromEntries(
      Array.from({ length: 256 }, (_, index) => [
        `table_${String(index).padStart(3, '0')}`,
        {
          description: 'x'.repeat(2_048),
          properties: { id: { type: 'integer', description: 'y'.repeat(2_048) } }
        }
      ])
    )
    expect(() =>
      parseSupabaseSchemaInspectorResponse(
        { definitions },
        { projectRef: 'project-ref', schema: 'public' }
      )
    ).toThrow('exceeds the connector result limit')
  })
})
