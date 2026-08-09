import { describe, expect, test } from 'bun:test'

import { PluginConnectorContractRegistry } from '@open-pencil/core/plugins'

import { RedactedConnectorAuditLog } from '@/app/plugins/connectors/audit'
import { ConnectorAuthorizationRegistry } from '@/app/plugins/connectors/authorization'
import { createConnectorExecutionBroker } from '@/app/plugins/connectors/broker'
import { ConnectorHostAdapterRegistry } from '@/app/plugins/connectors/registry'
import {
  SUPABASE_ACCESS_TOKEN_SLOT_ID,
  SUPABASE_BUSINESS_ADAPTER_ID,
  SUPABASE_BUSINESS_CONNECTOR_ADAPTER,
  SUPABASE_BUSINESS_CONNECTOR_CONTRACT,
  SUPABASE_BUSINESS_CONNECTOR_ID,
  SUPABASE_BUSINESS_CREDENTIAL_REFS,
  SUPABASE_BUSINESS_LIMITS,
  SUPABASE_BUSINESS_ORIGIN_TEMPLATE,
  SUPABASE_BUSINESS_PLUGIN_ID,
  SUPABASE_PUBLISHABLE_KEY_SLOT_ID,
  SUPABASE_TABLE_OPERATION_IDS,
  normalizeSupabaseRowsResponse,
  prepareSupabaseBusinessRequest
} from '@/app/plugins/connectors/supabase-business'
import { ConnectorExecutionError } from '@/app/plugins/connectors/types'
import type { InstalledAppPlugin } from '@/app/plugins/types'

function operation(operationId: string) {
  const found = SUPABASE_BUSINESS_CONNECTOR_CONTRACT.operations.find(
    (entry) => entry.operationId === operationId
  )
  if (!found) throw new Error(`Missing operation: ${operationId}`)
  return found
}

function prepare(operationId: string, parameters: Record<string, unknown>) {
  const selected = operation(operationId)
  return SUPABASE_BUSINESS_CONNECTOR_ADAPTER.prepare({
    contract: SUPABASE_BUSINESS_CONNECTOR_CONTRACT,
    operation: selected,
    parameters: parameters as never,
    signal: new AbortController().signal
  })
}

function installedPlugin(): InstalledAppPlugin {
  return {
    package: {
      trustSource: 'app-bundle',
      digest: 'sha256:supabase-business-v1',
      manifest: {
        format: 'openpencil-plugin',
        schemaVersion: 2,
        plugin: {
          id: SUPABASE_BUSINESS_PLUGIN_ID,
          name: 'Supabase Tables',
          version: '1.0.0'
        },
        publisher: { id: 'open-pencil', name: 'OpenPencil', keyId: 'builtin' },
        engineRange: '>=0.0.0',
        capabilities: [],
        contributions: {
          modules: [],
          connectors: [SUPABASE_BUSINESS_CONNECTOR_CONTRACT]
        }
      }
    },
    enabled: true,
    pinnedDigest: null
  } as InstalledAppPlugin
}

function errorCode(cause: unknown): string | undefined {
  return cause instanceof ConnectorExecutionError ? cause.code : undefined
}

describe('Supabase Tables business connector', () => {
  test('declares four bounded operations on one reviewed dynamic project origin', () => {
    expect(SUPABASE_BUSINESS_CONNECTOR_CONTRACT).toMatchObject({
      pluginId: SUPABASE_BUSINESS_PLUGIN_ID,
      connectorId: SUPABASE_BUSINESS_CONNECTOR_ID,
      adapterId: SUPABASE_BUSINESS_ADAPTER_ID,
      kind: 'data-source',
      network: {
        origins: [],
        originTemplates: [SUPABASE_BUSINESS_ORIGIN_TEMPLATE],
        methods: ['GET', 'POST', 'PATCH', 'DELETE'],
        credentials: 'omit',
        redirects: 'error'
      }
    })
    expect(
      SUPABASE_BUSINESS_CONNECTOR_CONTRACT.operations.map((entry) => [
        entry.operationId,
        entry.kind,
        entry.request?.method,
        entry.request?.originTemplate
      ])
    ).toEqual([
      [SUPABASE_TABLE_OPERATION_IDS.query, 'query', 'GET', SUPABASE_BUSINESS_ORIGIN_TEMPLATE],
      [SUPABASE_TABLE_OPERATION_IDS.insert, 'mutation', 'POST', SUPABASE_BUSINESS_ORIGIN_TEMPLATE],
      [SUPABASE_TABLE_OPERATION_IDS.update, 'mutation', 'PATCH', SUPABASE_BUSINESS_ORIGIN_TEMPLATE],
      [SUPABASE_TABLE_OPERATION_IDS.delete, 'mutation', 'DELETE', SUPABASE_BUSINESS_ORIGIN_TEMPLATE]
    ])
    expect(SUPABASE_BUSINESS_CONNECTOR_CONTRACT.credentialSlots).toEqual([
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
    ])
    expect(SUPABASE_BUSINESS_CREDENTIAL_REFS).toEqual({
      [SUPABASE_PUBLISHABLE_KEY_SLOT_ID]: {
        integrationId: SUPABASE_BUSINESS_PLUGIN_ID,
        profileId: 'default',
        field: SUPABASE_PUBLISHABLE_KEY_SLOT_ID
      },
      [SUPABASE_ACCESS_TOKEN_SLOT_ID]: {
        integrationId: SUPABASE_BUSINESS_PLUGIN_ID,
        profileId: 'default',
        field: SUPABASE_ACCESS_TOKEN_SLOT_ID
      }
    })
  })

  test('prepares bounded query, insert, update, and delete requests without credentials', async () => {
    await expect(
      prepare(SUPABASE_TABLE_OPERATION_IDS.query, {
        projectRef: 'project-ref',
        table: 'tasks',
        columns: ['id', 'title'],
        filters: [{ column: 'status', operator: 'eq', valueJson: '"open"' }],
        limit: 10
      })
    ).resolves.toEqual({
      url: 'https://project-ref.supabase.co/rest/v1/tasks?select=id%2Ctitle&status=eq.open&limit=10',
      headers: { Accept: 'application/json' }
    })

    await expect(
      prepare(SUPABASE_TABLE_OPERATION_IDS.insert, {
        projectRef: 'project-ref',
        table: 'tasks',
        records: [
          {
            fields: [
              { name: 'title', valueJson: '"Ship"' },
              { name: 'done', valueJson: 'false' }
            ]
          }
        ]
      })
    ).resolves.toEqual({
      url: 'https://project-ref.supabase.co/rest/v1/tasks',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: '[{"title":"Ship","done":false}]'
    })

    await expect(
      prepare(SUPABASE_TABLE_OPERATION_IDS.update, {
        projectRef: 'project-ref',
        table: 'tasks',
        fields: [{ name: 'done', valueJson: 'true' }],
        filters: [{ column: 'id', operator: 'eq', valueJson: '7' }]
      })
    ).resolves.toEqual({
      url: 'https://project-ref.supabase.co/rest/v1/tasks?id=eq.7',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'handling=strict, max-affected=100, return=minimal'
      },
      body: '{"done":true}'
    })

    await expect(
      prepare(SUPABASE_TABLE_OPERATION_IDS.delete, {
        projectRef: 'project-ref',
        table: 'tasks',
        filters: [{ column: 'done', operator: 'is', valueJson: 'false' }]
      })
    ).resolves.toEqual({
      url: 'https://project-ref.supabase.co/rest/v1/tasks?done=is.false',
      headers: { Prefer: 'handling=strict, max-affected=100, return=minimal' }
    })
  })

  test('fails closed for origin attacks, unsafe identifiers, unfiltered writes, and ambiguous JSON', async () => {
    await expect(
      prepare(SUPABASE_TABLE_OPERATION_IDS.query, {
        projectRef: 'other.supabase.co',
        table: 'tasks'
      })
    ).rejects.toMatchObject({ code: 'invalid-parameters' })
    await expect(
      prepare(SUPABASE_TABLE_OPERATION_IDS.query, {
        projectRef: 'Project-Ref',
        table: 'tasks'
      })
    ).rejects.toMatchObject({ code: 'invalid-parameters' })
    await expect(
      prepare(SUPABASE_TABLE_OPERATION_IDS.query, {
        projectRef: 'project-ref',
        table: '../private'
      })
    ).rejects.toMatchObject({ code: 'invalid-parameters' })
    await expect(
      prepare(SUPABASE_TABLE_OPERATION_IDS.update, {
        projectRef: 'project-ref',
        table: 'tasks',
        fields: [{ name: 'done', valueJson: 'true' }],
        filters: []
      })
    ).rejects.toMatchObject({ code: 'invalid-parameters' })
    await expect(
      prepare(SUPABASE_TABLE_OPERATION_IDS.delete, {
        projectRef: 'project-ref',
        table: 'tasks',
        filters: []
      })
    ).rejects.toMatchObject({ code: 'invalid-parameters' })
    await expect(
      prepare(SUPABASE_TABLE_OPERATION_IDS.insert, {
        projectRef: 'project-ref',
        table: 'tasks',
        records: [{ fields: [{ name: 'title', valueJson: ' {"x": 1} ' }] }]
      })
    ).rejects.toMatchObject({ code: 'invalid-parameters' })
  })

  test('normalizes arbitrary row values into a bounded fixed result shape', () => {
    expect(
      normalizeSupabaseRowsResponse([
        {
          id: 7,
          title: 'Ship',
          metadata: { priority: 2, labels: ['release', 'urgent'] },
          done: false
        }
      ])
    ).toEqual({
      rows: [
        {
          fields: [
            { name: 'done', valueJson: 'false' },
            { name: 'id', valueJson: '7' },
            {
              name: 'metadata',
              valueJson: '{"labels":["release","urgent"],"priority":2}'
            },
            { name: 'title', valueJson: '"Ship"' }
          ]
        }
      ]
    })
    expect(() => normalizeSupabaseRowsResponse(Array.from({ length: 101 }, () => ({})))).toThrow(
      'row limit'
    )
    expect(() => normalizeSupabaseRowsResponse([{ 'Unsafe-Column': 'value' }])).toThrow(
      'SQL identifier'
    )
  })

  test('rejects server-side Supabase keys in either runtime credential slot', async () => {
    const signal = new AbortController().signal
    for (const slot of SUPABASE_BUSINESS_CONNECTOR_CONTRACT.credentialSlots) {
      const base = {
        contract: SUPABASE_BUSINESS_CONNECTOR_CONTRACT,
        operation: operation(SUPABASE_TABLE_OPERATION_IDS.query),
        slot,
        signal
      }
      await expect(
        Promise.resolve(
          SUPABASE_BUSINESS_CONNECTOR_ADAPTER.validateCredential?.({
            ...base,
            value: 'sb_publishable_example'
          })
        )
      ).resolves.toBe(true)
      await expect(
        Promise.resolve(
          SUPABASE_BUSINESS_CONNECTOR_ADAPTER.validateCredential?.({
            ...base,
            value: 'sb_secret_server_only'
          })
        )
      ).resolves.toBe(false)
      await expect(
        Promise.resolve(
          SUPABASE_BUSINESS_CONNECTOR_ADAPTER.validateCredential?.({
            ...base,
            value: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.fake'
          })
        )
      ).resolves.toBe(false)
    }
  })

  test('executes through the Broker with dynamic origin, runtime-only secrets, and transport caps', async () => {
    const contracts = new PluginConnectorContractRegistry()
    contracts.register(SUPABASE_BUSINESS_CONNECTOR_CONTRACT)
    const adapters = new ConnectorHostAdapterRegistry(contracts)
    adapters.register(SUPABASE_BUSINESS_CONNECTOR_ADAPTER)
    const authorization = new ConnectorAuthorizationRegistry()
    const plugin = installedPlugin()
    authorization.authorize(SUPABASE_BUSINESS_CONNECTOR_CONTRACT, plugin.package.digest, 1)
    const audit = new RedactedConnectorAuditLog()
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    let capturedLimits: Readonly<{ maxResponseBytes: number; timeoutMs: number }> | undefined
    const broker = createConnectorExecutionBroker({
      adapters,
      authorization,
      credentialResolver: {
        resolve: async (reference) =>
          reference.field === SUPABASE_PUBLISHABLE_KEY_SLOT_ID
            ? 'sb_publishable_runtime_only'
            : 'user-access-runtime-only'
      },
      audit,
      fetch: async (input, init, limits) => {
        capturedUrl = String(input)
        capturedInit = init
        capturedLimits = limits
        return new Response(JSON.stringify([{ id: 1, title: 'Ship' }]))
      }
    })

    const result = await broker.execute({
      plugin,
      contract: SUPABASE_BUSINESS_CONNECTOR_CONTRACT,
      operationId: SUPABASE_TABLE_OPERATION_IDS.query,
      parameters: { projectRef: 'project-ref', table: 'tasks', limit: 1 },
      credentialRefs: SUPABASE_BUSINESS_CREDENTIAL_REFS
    })
    expect(result.data).toEqual({
      rows: [
        {
          fields: [
            { name: 'id', valueJson: '1' },
            { name: 'title', valueJson: '"Ship"' }
          ]
        }
      ]
    })
    expect(capturedUrl).toBe('https://project-ref.supabase.co/rest/v1/tasks?select=*&limit=1')
    const headers = new Headers(capturedInit?.headers)
    expect(headers.get('apikey')).toBe('sb_publishable_runtime_only')
    expect(headers.get('authorization')).toBe('Bearer user-access-runtime-only')
    expect(capturedInit).toMatchObject({
      method: 'GET',
      credentials: 'omit',
      redirect: 'error'
    })
    expect(capturedLimits).toEqual({
      maxResponseBytes: SUPABASE_BUSINESS_LIMITS.queryResponseBytes,
      timeoutMs: SUPABASE_BUSINESS_LIMITS.timeoutMs
    })
    expect(JSON.stringify(audit.snapshot())).not.toContain('runtime-only')
  })

  test('requires confirmation on every Supabase mutation and accepts only empty minimal responses', async () => {
    const contracts = new PluginConnectorContractRegistry()
    contracts.register(SUPABASE_BUSINESS_CONNECTOR_CONTRACT)
    const adapters = new ConnectorHostAdapterRegistry(contracts)
    adapters.register(SUPABASE_BUSINESS_CONNECTOR_ADAPTER)
    const authorization = new ConnectorAuthorizationRegistry()
    const plugin = installedPlugin()
    authorization.authorize(SUPABASE_BUSINESS_CONNECTOR_CONTRACT, plugin.package.digest, 1)
    let fetchCalls = 0
    const broker = createConnectorExecutionBroker({
      adapters,
      authorization,
      credentialResolver: {
        resolve: async (reference) =>
          reference.field === SUPABASE_PUBLISHABLE_KEY_SLOT_ID
            ? 'sb_publishable_example'
            : 'user-token'
      },
      audit: new RedactedConnectorAuditLog(),
      fetch: async () => {
        fetchCalls += 1
        return new Response(null, { status: 204 })
      }
    })
    const request = {
      plugin,
      contract: SUPABASE_BUSINESS_CONNECTOR_CONTRACT,
      operationId: SUPABASE_TABLE_OPERATION_IDS.delete,
      parameters: {
        projectRef: 'project-ref',
        table: 'tasks',
        filters: [{ column: 'id', operator: 'eq', valueJson: '7' }]
      },
      credentialRefs: SUPABASE_BUSINESS_CREDENTIAL_REFS
    }
    expect(errorCode(await broker.execute(request).catch((error) => error))).toBe(
      'mutation-confirmation-required'
    )
    expect(fetchCalls).toBe(0)
    await expect(
      broker.execute({ ...request, confirmMutation: async () => true })
    ).resolves.toMatchObject({ data: { ok: true }, httpStatus: 204 })
    expect(fetchCalls).toBe(1)
  })

  test('does not invoke forged contract or operation accessors', () => {
    let toJsonCalls = 0
    let getterCalls = 0
    const forgedContract = {
      ...SUPABASE_BUSINESS_CONNECTOR_CONTRACT,
      toJSON() {
        toJsonCalls += 1
        return SUPABASE_BUSINESS_CONNECTOR_CONTRACT
      }
    }
    const forgedOperation = { ...operation(SUPABASE_TABLE_OPERATION_IDS.query) }
    Object.defineProperty(forgedOperation, 'name', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'Query rows'
      }
    })
    expect(() =>
      prepareSupabaseBusinessRequest({
        contract: forgedContract as never,
        operation: forgedOperation,
        parameters: { projectRef: 'project-ref', table: 'tasks' },
        signal: new AbortController().signal
      })
    ).toThrow('authority does not match')
    expect(toJsonCalls).toBe(0)
    expect(getterCalls).toBe(0)
  })
})
