import { afterEach, describe, expect, test } from 'bun:test'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import { createBundledPluginCatalog } from '@/app/plugins/catalog'
import {
  AIRTABLE_LIST_RECORDS_OPERATION_ID,
  AIRTABLE_RECORDS_CONNECTOR_ID,
  AIRTABLE_RECORDS_PLUGIN_ID
} from '@/app/plugins/connectors/airtable-records'
import {
  appPluginMcpConnectorContributionId,
  appPluginMcpToolName,
  listAppPluginMcpTools
} from '@/app/plugins/mcp'
import { createMemoryAppPluginStateStorage } from '@/app/plugins/storage'
import { createAppPluginStore } from '@/app/plugins/store'

import {
  PLUGIN_MCP_CATALOG_LIMITS,
  createPluginMcpCatalog,
  createPluginMcpController,
  parsePluginMcpCatalogResponse,
  registerPluginMcpTools
} from '#mcp/tool/plugin/catalog'

const SLIDE_MENU_TOOL_NAME = appPluginMcpToolName('open-pencil.slide-menu', 'module', 'slide-menu')
const VIDEO_TOOL_NAME = appPluginMcpToolName('open-pencil.video', 'module', 'video')
const AUDIT_TOOL_NAME = appPluginMcpToolName('acme.analytics', 'command', 'accessibility-audit')
const TOKENS_TOOL_NAME = appPluginMcpToolName('acme.analytics', 'exporter', 'design-tokens')
const AIRTABLE_CONNECTOR_CONTRIBUTION_ID = appPluginMcpConnectorContributionId(
  AIRTABLE_RECORDS_CONNECTOR_ID,
  AIRTABLE_LIST_RECORDS_OPERATION_ID
)
const AIRTABLE_TOOL_NAME = appPluginMcpToolName(
  AIRTABLE_RECORDS_PLUGIN_ID,
  'connector',
  AIRTABLE_CONNECTOR_CONTRIBUTION_ID
)

function descriptor(overrides: Record<string, unknown> = {}) {
  return {
    name: SLIDE_MENU_TOOL_NAME,
    title: 'Add Slide Menu',
    description: 'Insert an installed Slide Menu module into the current document.',
    inputSchema: {
      type: 'object',
      properties: {
        config: {
          type: 'object',
          description: 'Module configuration validated by the trusted host adapter.',
          additionalProperties: true
        },
        x: { type: 'number', minimum: -100_000, maximum: 100_000 },
        name: { type: 'string', minLength: 1, maxLength: 128 }
      },
      additionalProperties: false
    },
    pluginId: 'open-pencil.slide-menu',
    kind: 'module',
    contributionId: 'slide-menu',
    ...overrides
  }
}

function response(tools: unknown[], revision = 'revision-1') {
  return { ok: true, result: { revision, tools } }
}

function commandInputSchema(valueType: 'integer' | 'string' = 'string') {
  return {
    type: 'object',
    properties: {
      scope:
        valueType === 'string'
          ? { type: 'string', enum: ['document', 'selection'] }
          : { type: 'integer', minimum: 0, maximum: 10 }
    },
    required: ['scope'],
    additionalProperties: false
  }
}

function commandDescriptor(inputSchema: unknown = commandInputSchema()) {
  return descriptor({
    name: AUDIT_TOOL_NAME,
    title: 'Run Accessibility Audit',
    description: 'Run the installed accessibility audit command.',
    inputSchema,
    pluginId: 'acme.analytics',
    kind: 'command',
    contributionId: 'accessibility-audit'
  })
}

function exporterDescriptor(inputSchema: unknown = commandInputSchema()) {
  return descriptor({
    name: TOKENS_TOOL_NAME,
    title: 'Export Design Tokens',
    description: 'Run the installed design tokens exporter.',
    inputSchema,
    pluginId: 'acme.analytics',
    kind: 'exporter',
    contributionId: 'design-tokens'
  })
}

function connectorInputSchema(pageSizeType: 'integer' | 'string' = 'integer') {
  return {
    type: 'object',
    properties: {
      baseId: { type: 'string', minLength: 4, maxLength: 64 },
      tableId: { type: 'string', minLength: 4, maxLength: 64 },
      pageSize:
        pageSizeType === 'integer'
          ? { type: 'integer', minimum: 1, maximum: 100 }
          : { type: 'string', minLength: 1, maxLength: 3 }
    },
    required: ['baseId', 'tableId'],
    additionalProperties: false
  }
}

function connectorDescriptor(
  inputSchema: unknown = connectorInputSchema(),
  overrides: Record<string, unknown> = {}
) {
  return descriptor({
    name: AIRTABLE_TOOL_NAME,
    title: 'Query Airtable Records',
    description: 'Query bounded records through the installed Airtable connector.',
    inputSchema,
    pluginId: AIRTABLE_RECORDS_PLUGIN_ID,
    kind: 'connector',
    contributionId: AIRTABLE_CONNECTOR_CONTRIBUTION_ID,
    ...overrides
  })
}

function nestedArraySchema(depth: number): Record<string, unknown> {
  if (depth === 0) return { type: 'boolean' }
  return { type: 'array', items: nestedArraySchema(depth - 1) }
}

describe('plugin MCP catalog validation', () => {
  test('does not transfer a previous stable name to a sequential slug-colliding plugin', () => {
    const catalog = createPluginMcpCatalog()
    const firstName = appPluginMcpToolName('foo-bar', 'module', 'panel')
    const replacementName = appPluginMcpToolName('foo_bar', 'module', 'panel')
    catalog.replace(
      response(
        [descriptor({ name: firstName, pluginId: 'foo-bar', contributionId: 'panel' })],
        'first'
      )
    )
    expect(catalog.get(firstName)?.pluginId).toBe('foo-bar')

    catalog.replace(
      response(
        [
          descriptor({
            name: replacementName,
            pluginId: 'foo_bar',
            contributionId: 'panel'
          })
        ],
        'replacement'
      )
    )
    expect(catalog.get(firstName)).toBeUndefined()
    expect(catalog.get(replacementName)?.pluginId).toBe('foo_bar')
  })

  test('accepts the bounded host schema and sorts stable plugin tool names', () => {
    const parsed = parsePluginMcpCatalogResponse(
      response([
        descriptor({
          name: VIDEO_TOOL_NAME,
          pluginId: 'open-pencil.video',
          contributionId: 'video'
        }),
        descriptor()
      ])
    )

    expect(parsed.tools.map((tool) => tool.name)).toEqual([SLIDE_MENU_TOOL_NAME, VIDEO_TOOL_NAME])
    expect(parsed.tools[0]?.inputSchema).toEqual(descriptor().inputSchema)
    expect(parsed.tools[0]?.inputSchema).toMatchObject({
      properties: { config: { additionalProperties: true } }
    })
  })

  test('accepts strict bounded v2 command, exporter, and connector parameter schemas', () => {
    const parsed = parsePluginMcpCatalogResponse(
      response([commandDescriptor(), exporterDescriptor(), connectorDescriptor()])
    )

    expect(
      parsed.tools.map(({ name }) => name).sort((left, right) => left.localeCompare(right))
    ).toEqual(
      [AIRTABLE_TOOL_NAME, AUDIT_TOOL_NAME, TOKENS_TOOL_NAME].sort((left, right) =>
        left.localeCompare(right)
      )
    )
    for (const tool of parsed.tools.filter(({ kind }) => kind !== 'connector')) {
      expect(tool.inputSchema).toMatchObject({
        type: 'object',
        required: ['scope'],
        additionalProperties: false
      })
    }
    expect(parsed.tools.find(({ kind }) => kind === 'connector')).toMatchObject({
      name: AIRTABLE_TOOL_NAME,
      pluginId: AIRTABLE_RECORDS_PLUGIN_ID,
      contributionId: AIRTABLE_CONNECTOR_CONTRIBUTION_ID,
      inputSchema: {
        type: 'object',
        required: ['baseId', 'tableId'],
        additionalProperties: false
      }
    })
  })

  test('accepts the live app catalog for an authorized connector without clearing other tools', async () => {
    const store = createAppPluginStore({
      storage: createMemoryAppPluginStateStorage(),
      catalog: createBundledPluginCatalog(),
      activationCompatibilityPolicy: () => ({ ok: true }),
      engineVersion: '0.0.0'
    })
    await store.load()
    await store.install(AIRTABLE_RECORDS_PLUGIN_ID)
    await store.setEnabled(AIRTABLE_RECORDS_PLUGIN_ID, true)

    const live = listAppPluginMcpTools(store, { connectorExposure: () => true })
    const parsed = parsePluginMcpCatalogResponse(response(live.tools, live.revision))
    expect(parsed.tools.some(({ kind }) => kind === 'module')).toBe(true)
    expect(parsed.tools.find(({ kind }) => kind === 'connector')).toMatchObject({
      pluginId: AIRTABLE_RECORDS_PLUGIN_ID,
      contributionId: AIRTABLE_CONNECTOR_CONTRIBUTION_ID
    })
  })

  test('rejects duplicate names, static-name collisions, reserved targets, and unsafe schemas', () => {
    expect(() => parsePluginMcpCatalogResponse(response([descriptor(), descriptor()]))).toThrow(
      'names must be unique'
    )
    expect(() =>
      parsePluginMcpCatalogResponse(response([descriptor({ name: 'get_node' })]))
    ).toThrow('reserved plugin tool namespace')
    expect(() =>
      parsePluginMcpCatalogResponse(
        response([descriptor({ pluginId: 'open-pencil.replacement-slide-menu' })])
      )
    ).toThrow('identity suffix does not match its canonical contribution')
    expect(() =>
      parsePluginMcpCatalogResponse(response([descriptor({ kind: 'command' })]))
    ).toThrow('name action does not match')
    expect(() =>
      parsePluginMcpCatalogResponse(
        response([
          connectorDescriptor({
            ...connectorInputSchema(),
            additionalProperties: true
          })
        ])
      )
    ).toThrow()
    expect(() =>
      parsePluginMcpCatalogResponse(
        response([
          connectorDescriptor({
            type: 'object',
            properties: { document_id: { type: 'string' } },
            additionalProperties: false
          })
        ])
      )
    ).toThrow('reserved automation target')
    expect(() =>
      parsePluginMcpCatalogResponse(
        response([
          connectorDescriptor(connectorInputSchema(), {
            name: AIRTABLE_TOOL_NAME.replace('__query_', '__run_')
          })
        ])
      )
    ).toThrow('name action does not match')
    expect(() =>
      parsePluginMcpCatalogResponse(
        response([
          descriptor({
            inputSchema: {
              type: 'object',
              properties: { document_id: { type: 'string' } },
              additionalProperties: false
            }
          })
        ])
      )
    ).toThrow('reserved automation target')
    expect(() =>
      parsePluginMcpCatalogResponse(
        response([
          descriptor({
            inputSchema: {
              type: 'object',
              properties: { payload: { $ref: '#/$defs/payload' } }
            }
          })
        ])
      )
    ).toThrow('$ref is not supported')
  })

  test('fails the whole catalog when the dynamic tool count exceeds the bound', () => {
    const tools = Array.from({ length: PLUGIN_MCP_CATALOG_LIMITS.maxTools + 1 }, (_, index) =>
      descriptor({
        name: appPluginMcpToolName(`publisher-${index}`, 'module', `module-${index}`),
        pluginId: `publisher-${index}`,
        contributionId: `module-${index}`
      })
    )
    expect(() => parsePluginMcpCatalogResponse(response(tools))).toThrow(
      `at most ${PLUGIN_MCP_CATALOG_LIMITS.maxTools}`
    )
  })

  test('fails closed for open, unknown, oversized, deep, or node-heavy v2 schemas', () => {
    for (const invalidSchema of [
      { ...commandInputSchema(), additionalProperties: true },
      { type: 'object', properties: { value: { type: 'string', pattern: '.*' } } },
      { type: 'object', properties: { value: { oneOf: [{ type: 'string' }] } } },
      { type: 'object', properties: { value: { $ref: '#/$defs/value' } } },
      { type: 'object', properties: { value: { type: 'unknown' } } },
      { type: 'object', properties: { document_id: { type: 'string' } } },
      { type: 'object', properties: { page_id: { type: 'string' } } }
    ]) {
      expect(() =>
        parsePluginMcpCatalogResponse(response([commandDescriptor(invalidSchema)]))
      ).toThrow()
    }

    expect(() =>
      parsePluginMcpCatalogResponse(
        response([
          commandDescriptor({
            type: 'object',
            description: 'x'.repeat(PLUGIN_MCP_CATALOG_LIMITS.maxSchemaBytes),
            properties: {},
            additionalProperties: false
          })
        ])
      )
    ).toThrow('byte limit')

    expect(() =>
      parsePluginMcpCatalogResponse(
        response([
          commandDescriptor({
            type: 'object',
            properties: {
              value: nestedArraySchema(PLUGIN_MCP_CATALOG_LIMITS.maxSchemaDepth + 1)
            },
            additionalProperties: false
          })
        ])
      )
    ).toThrow('depth limit')

    const nodeHeavyProperties = Object.fromEntries(
      Array.from({ length: 128 }, (_, index) => [
        `group${index}`,
        {
          type: 'object',
          properties: {
            a: { type: 'boolean' },
            b: { type: 'boolean' },
            c: { type: 'boolean' }
          },
          additionalProperties: false
        }
      ])
    )
    expect(() =>
      parsePluginMcpCatalogResponse(
        response([
          commandDescriptor({
            type: 'object',
            properties: nodeHeavyProperties,
            additionalProperties: false
          })
        ])
      )
    ).toThrow('node limit')
  })
})

describe('dynamic plugin MCP registration', () => {
  const closeTasks: Array<() => Promise<void>> = []

  afterEach(async () => {
    await Promise.allSettled(closeTasks.splice(0).map((close) => close()))
  })

  test('changes tools/list, emits list_changed, and revalidates calls through the app', async () => {
    const catalog = createPluginMcpCatalog()
    const rpcCalls: Record<string, unknown>[] = []
    const server = new McpServer({ name: 'plugin-test-server', version: '0.0.0' })
    server.registerTool('static_tool', { inputSchema: z.object({}) }, async () => ({
      content: [{ type: 'text', text: '{}' }]
    }))
    const registration = registerPluginMcpTools(server, {
      catalog,
      async sendRpc(body) {
        rpcCalls.push(body)
        return { ok: true, result: { inserted: true } }
      }
    })
    const client = new Client({ name: 'plugin-test-client', version: '0.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    let listChanged = 0
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      listChanged += 1
    })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    closeTasks.push(async () => {
      registration.dispose()
      await client.close()
      await server.close()
    })

    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['static_tool'])

    catalog.replace(response([descriptor()]))
    const listed = (await client.listTools()).tools
    expect(listed.map((tool) => tool.name).sort()).toEqual([SLIDE_MENU_TOOL_NAME, 'static_tool'])
    expect(listed.find((tool) => tool.name === SLIDE_MENU_TOOL_NAME)?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        document_id: { type: 'string' },
        page_id: { type: 'string' }
      }
    })

    const called = await client.callTool({
      name: SLIDE_MENU_TOOL_NAME,
      arguments: { x: 40, document_id: 'document-1', page_id: 'page-1' }
    })
    expect(called.structuredContent).toEqual({ inserted: true })
    expect(rpcCalls).toEqual([
      {
        command: 'plugin_mcp_tool',
        args: {
          document_id: 'document-1',
          page_id: 'page-1',
          name: SLIDE_MENU_TOOL_NAME,
          pluginId: 'open-pencil.slide-menu',
          args: { x: 40 }
        }
      }
    ])

    catalog.replace(response([commandDescriptor()], 'command-string'))
    expect((await client.listTools()).tools.map(({ name }) => name).sort()).toEqual([
      AUDIT_TOOL_NAME,
      'static_tool'
    ])
    await client.callTool({
      name: AUDIT_TOOL_NAME,
      arguments: { scope: 'selection', document_id: 'document-2' }
    })
    expect(rpcCalls.at(-1)).toEqual({
      command: 'plugin_mcp_tool',
      args: {
        document_id: 'document-2',
        name: AUDIT_TOOL_NAME,
        pluginId: 'acme.analytics',
        args: { scope: 'selection' }
      }
    })

    catalog.replace(response([commandDescriptor(commandInputSchema('integer'))], 'command-integer'))
    const callsBeforeStaleValidation = rpcCalls.length
    const staleCall = await client.callTool({
      name: AUDIT_TOOL_NAME,
      arguments: { scope: 'selection' }
    })
    expect(staleCall.isError).toBe(true)
    expect(JSON.stringify(staleCall.content)).toContain('Input validation error')
    expect(rpcCalls).toHaveLength(callsBeforeStaleValidation)
    await client.callTool({ name: AUDIT_TOOL_NAME, arguments: { scope: 4 } })
    expect(rpcCalls.at(-1)).toMatchObject({
      command: 'plugin_mcp_tool',
      args: { args: { scope: 4 } }
    })

    catalog.replace(response([connectorDescriptor()], 'connector-integer'))
    expect(
      (await client.listTools()).tools
        .map(({ name }) => name)
        .sort((left, right) => left.localeCompare(right))
    ).toEqual([AIRTABLE_TOOL_NAME, 'static_tool'])
    await client.callTool({
      name: AIRTABLE_TOOL_NAME,
      arguments: {
        baseId: 'appBase123',
        tableId: 'tblTable123',
        pageSize: 25,
        document_id: 'document-3'
      }
    })
    expect(rpcCalls.at(-1)).toEqual({
      command: 'plugin_mcp_tool',
      args: {
        document_id: 'document-3',
        name: AIRTABLE_TOOL_NAME,
        pluginId: AIRTABLE_RECORDS_PLUGIN_ID,
        args: { baseId: 'appBase123', tableId: 'tblTable123', pageSize: 25 }
      }
    })

    catalog.replace(
      response([connectorDescriptor(connectorInputSchema('string'))], 'connector-string')
    )
    const callsBeforeConnectorStaleValidation = rpcCalls.length
    const staleConnectorCall = await client.callTool({
      name: AIRTABLE_TOOL_NAME,
      arguments: { baseId: 'appBase123', tableId: 'tblTable123', pageSize: 25 }
    })
    expect(staleConnectorCall.isError).toBe(true)
    expect(JSON.stringify(staleConnectorCall.content)).toContain('Input validation error')
    expect(rpcCalls).toHaveLength(callsBeforeConnectorStaleValidation)
    await client.callTool({
      name: AIRTABLE_TOOL_NAME,
      arguments: { baseId: 'appBase123', tableId: 'tblTable123', pageSize: '25' }
    })
    expect(rpcCalls.at(-1)).toMatchObject({
      command: 'plugin_mcp_tool',
      args: { args: { baseId: 'appBase123', tableId: 'tblTable123', pageSize: '25' } }
    })

    catalog.clear()
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['static_tool'])
    const removedCall = await client.callTool({
      name: AIRTABLE_TOOL_NAME,
      arguments: { baseId: 'appBase123', tableId: 'tblTable123', pageSize: '25' }
    })
    expect(removedCall.isError).toBe(true)
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })
    expect(listChanged).toBeGreaterThanOrEqual(2)
  })

  test('keeps the last verified list only on success and clears it on refresh failure', async () => {
    let responseMode: 'disconnected' | 'invalid' | 'valid' = 'valid'
    const controller = createPluginMcpController({
      async sendRpc(body) {
        expect(body).toEqual({ command: 'plugin_mcp_tools', args: {} })
        if (responseMode === 'disconnected') throw new Error('app disconnected')
        if (responseMode === 'invalid') {
          return response(
            [
              commandDescriptor({
                ...commandInputSchema(),
                additionalProperties: true
              })
            ],
            'invalid-schema'
          )
        }
        return response([descriptor()])
      }
    })
    closeTasks.push(async () => controller.close())

    await controller.refresh()
    expect(controller.catalog.current().tools).toHaveLength(1)
    responseMode = 'invalid'
    await controller.refresh()
    expect(controller.catalog.current()).toEqual({ revision: '', tools: [] })
    responseMode = 'valid'
    await controller.refresh()
    expect(controller.catalog.current().tools).toHaveLength(1)
    responseMode = 'disconnected'
    await controller.refresh()
    expect(controller.catalog.current()).toEqual({ revision: '', tools: [] })
  })

  test('queues an invalidation received while an older catalog request is in flight', async () => {
    let resolveFirst = (_value: unknown) => undefined
    const firstResponse = new Promise<unknown>((resolve) => {
      resolveFirst = resolve
    })
    let calls = 0
    const controller = createPluginMcpController({
      sendRpc() {
        calls += 1
        if (calls === 1) return firstResponse
        return Promise.resolve(
          response(
            [
              descriptor({
                name: VIDEO_TOOL_NAME,
                pluginId: 'open-pencil.video',
                contributionId: 'video'
              })
            ],
            'revision-b'
          )
        )
      }
    })
    closeTasks.push(async () => controller.close())

    const first = controller.refresh()
    const invalidation = controller.refresh()
    expect(calls).toBe(1)
    resolveFirst(response([descriptor()], 'revision-a'))
    await Promise.all([first, invalidation])

    expect(calls).toBe(2)
    expect(controller.catalog.current()).toMatchObject({
      revision: 'revision-b',
      tools: [{ name: VIDEO_TOOL_NAME }]
    })
  })
})
