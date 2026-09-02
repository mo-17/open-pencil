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
import { SUPABASE_BACKEND_PROVIDER_PLUGIN_ID } from '@/app/plugins/host/backend-provider'
import {
  appPluginMCPConnectorContributionId as appPluginMCPConnectorContributionID,
  appPluginMCPToolName,
  listAppPluginMCPTools
} from '@/app/plugins/mcp'
import { createMemoryAppPluginStateStorage } from '@/app/plugins/storage'
import { createAppPluginStore } from '@/app/plugins/store'

import {
  PLUGIN_MCP_CATALOG_LIMITS,
  createPluginMCPCatalog,
  createPluginMCPController,
  parsePluginMCPCatalogResponse,
  registerPluginMCPTools
} from '#mcp/tool/plugin/catalog'

const SLIDE_MENU_TOOL_NAME = appPluginMCPToolName('open-pencil.slide-menu', 'module', 'slide-menu')
const VIDEO_TOOL_NAME = appPluginMCPToolName('open-pencil.video', 'module', 'video')
const AUDIT_TOOL_NAME = appPluginMCPToolName('acme.analytics', 'command', 'accessibility-audit')
const TOKENS_TOOL_NAME = appPluginMCPToolName('acme.analytics', 'exporter', 'design-tokens')
const AIRTABLE_CONNECTOR_CONTRIBUTION_ID = appPluginMCPConnectorContributionID(
  AIRTABLE_RECORDS_CONNECTOR_ID,
  AIRTABLE_LIST_RECORDS_OPERATION_ID
)
const AIRTABLE_TOOL_NAME = appPluginMCPToolName(
  AIRTABLE_RECORDS_PLUGIN_ID,
  'connector',
  AIRTABLE_CONNECTOR_CONTRIBUTION_ID
)

function authority(overrides: Record<string, unknown> = {}) {
  return {
    trustSource: 'app-bundle',
    packageDigest: `app-bundle-sha256:${'A'.repeat(43)}`,
    pluginVersion: '1.0.0',
    publisherId: 'open-pencil',
    publisherKeyId: 'app-bundle-v1',
    adapterId: 'open-pencil.slide-menu',
    ...overrides
  }
}

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
    authority: authority(),
    ...overrides
  }
}

function response(tools: unknown[], revision = 'revision-1') {
  return { ok: true, result: { revision, tools } }
}

function expectedDescriptor(
  value: ReturnType<typeof descriptor>
): Omit<ReturnType<typeof descriptor>, 'description' | 'inputSchema' | 'outputSchema'> {
  const {
    description: _description,
    inputSchema: _inputSchema,
    outputSchema: _outputSchema,
    ...expected
  } = value
  return expected
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

function executionOutputSchema(
  kind: 'command' | 'exporter',
  contributionId: string,
  dataSchema: Record<string, unknown> = {
    type: 'object',
    properties: { inserted: { type: 'boolean' } },
    required: ['inserted'],
    additionalProperties: false,
    minProperties: 1,
    maxProperties: 1
  }
) {
  const dataRequired =
    (Array.isArray(dataSchema.required) && dataSchema.required.length > 0) ||
    (typeof dataSchema.minProperties === 'number' && dataSchema.minProperties > 0)
  const required = [
    'pluginId',
    'kind',
    'contributionId',
    'status',
    'message',
    ...(dataRequired ? ['data'] : [])
  ]
  return {
    type: 'object',
    properties: {
      pluginId: { type: 'string', enum: ['acme.analytics'] },
      kind: { type: 'string', enum: [kind] },
      contributionId: { type: 'string', enum: [contributionId] },
      status: { type: 'string', enum: ['completed', 'cancelled'] },
      message: { type: 'string', minLength: 1, maxLength: 2_000 },
      data: dataSchema
    },
    required,
    additionalProperties: false,
    minProperties: required.length,
    maxProperties: 6
  }
}

function commandDescriptor(inputSchema: unknown = commandInputSchema()) {
  return descriptor({
    name: AUDIT_TOOL_NAME,
    title: 'Run Accessibility Audit',
    description: 'Run the installed accessibility audit command.',
    inputSchema,
    outputSchema: executionOutputSchema('command', 'accessibility-audit'),
    pluginId: 'acme.analytics',
    kind: 'command',
    contributionId: 'accessibility-audit',
    authority: authority({
      publisherId: 'acme',
      publisherKeyId: 'acme-v1',
      adapterId: 'acme.accessibility-audit'
    })
  })
}

function exporterDescriptor(inputSchema: unknown = commandInputSchema()) {
  return descriptor({
    name: TOKENS_TOOL_NAME,
    title: 'Export Design Tokens',
    description: 'Run the installed design tokens exporter.',
    inputSchema,
    outputSchema: executionOutputSchema('exporter', 'design-tokens'),
    pluginId: 'acme.analytics',
    kind: 'exporter',
    contributionId: 'design-tokens',
    authority: authority({
      publisherId: 'acme',
      publisherKeyId: 'acme-v1',
      adapterId: 'acme.design-tokens'
    })
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
    authority: authority({ adapterId: 'open-pencil.connector.airtable-records' }),
    ...overrides
  })
}

function nestedArraySchema(depth: number): Record<string, unknown> {
  if (depth === 0) return { type: 'boolean' }
  return { type: 'array', items: nestedArraySchema(depth - 1) }
}

function maxDepthResultSchema(arrayCount: number): Record<string, unknown> {
  let value: Record<string, unknown> = { type: 'boolean' }
  for (let index = 0; index < arrayCount; index += 1) {
    value = { type: 'array', items: value, maxItems: 1 }
  }
  return {
    type: 'object',
    properties: { value },
    required: ['value'],
    additionalProperties: false
  }
}

function rawNodeBoundaryResultSchema(extraNode = false): Record<string, unknown> {
  return {
    type: 'object',
    title: 't',
    description: 'd',
    properties: Object.fromEntries(
      Array.from({ length: 84 }, (_, index) => [
        `g${index}`,
        {
          type: 'object',
          properties: {
            value: {
              type: 'boolean',
              ...(extraNode && index === 0 ? { title: 'x' } : {})
            }
          },
          additionalProperties: false
        }
      ])
    ),
    additionalProperties: false,
    minProperties: 0,
    maxProperties: 84
  }
}

describe('plugin MCP catalog validation', () => {
  test('does not transfer a previous stable name to a sequential slug-colliding plugin', () => {
    const catalog = createPluginMCPCatalog()
    const firstName = appPluginMCPToolName('foo-bar', 'module', 'panel')
    const replacementName = appPluginMCPToolName('foo_bar', 'module', 'panel')
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
    const parsed = parsePluginMCPCatalogResponse(
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
    expect(parsed.tools[0]?.authority).toEqual(authority())
  })

  test('requires exact bounded package authority and rejects forged records', () => {
    const signedAuthority = authority({
      trustSource: 'publisher-signature',
      packageDigest: 'B'.repeat(43),
      publisherId: 'acme',
      publisherKeyId: 'acme-release-v1'
    })
    expect(
      parsePluginMCPCatalogResponse(response([descriptor({ authority: signedAuthority })])).tools[0]
        ?.authority
    ).toEqual(signedAuthority)

    const legacy = descriptor()
    Reflect.deleteProperty(legacy, 'authority')
    expect(() => parsePluginMCPCatalogResponse(response([legacy]))).toThrow('authority is required')

    expect(() =>
      parsePluginMCPCatalogResponse(
        response([descriptor({ authority: authority({ extraAuthority: true }) })])
      )
    ).toThrow('extraAuthority is not supported')
    expect(() =>
      parsePluginMCPCatalogResponse({ ...response([descriptor()]), error: 'forged success' })
    ).toThrow('error is not supported on a successful response')
    expect(() =>
      parsePluginMCPCatalogResponse(
        response([descriptor({ authority: authority({ trustSource: 'local-directory' }) })])
      )
    ).toThrow('trustSource is not supported')
    expect(() =>
      parsePluginMCPCatalogResponse(
        response([
          descriptor({
            authority: authority({
              trustSource: 'publisher-signature',
              packageDigest: `app-bundle-sha256:${'A'.repeat(43)}`
            })
          })
        ])
      )
    ).toThrow('packageDigest does not match')
    expect(() =>
      parsePluginMCPCatalogResponse(
        response([descriptor({ authority: authority({ pluginVersion: '1.0.0-beta.1' }) })])
      )
    ).toThrow('stable semantic version')
    expect(() =>
      parsePluginMCPCatalogResponse(
        response([
          descriptor({
            authority: authority({
              packageDigest: 'A'.repeat(PLUGIN_MCP_CATALOG_LIMITS.maxPackageDigestLength + 1)
            })
          })
        ])
      )
    ).toThrow(`at most ${PLUGIN_MCP_CATALOG_LIMITS.maxPackageDigestLength}`)

    let getterInvoked = false
    const forgedAuthority = authority()
    Object.defineProperty(forgedAuthority, 'publisherKeyId', {
      enumerable: true,
      get() {
        getterInvoked = true
        return 'forged-key'
      }
    })
    expect(() =>
      parsePluginMCPCatalogResponse(response([descriptor({ authority: forgedAuthority })]))
    ).toThrow('enumerable data property')
    expect(getterInvoked).toBe(false)
  })

  test('accepts strict bounded v2 command, exporter, and connector parameter schemas', () => {
    const parsed = parsePluginMCPCatalogResponse(
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
      expect(tool.outputSchema).toMatchObject({
        type: 'object',
        additionalProperties: false,
        properties: {
          data: { type: 'object', additionalProperties: false }
        }
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

    const live = listAppPluginMCPTools(store, { connectorExposure: () => true })
    const parsed = parsePluginMCPCatalogResponse(response(live.tools, live.revision))
    expect(parsed.tools.some(({ kind }) => kind === 'module')).toBe(true)
    expect(
      parsed.tools.filter(({ pluginId }) => pluginId === SUPABASE_BACKEND_PROVIDER_PLUGIN_ID)
    ).toHaveLength(2)
    for (const tool of parsed.tools.filter(
      ({ pluginId }) => pluginId === SUPABASE_BACKEND_PROVIDER_PLUGIN_ID
    )) {
      expect(tool.outputSchema).toMatchObject({
        type: 'object',
        additionalProperties: false,
        properties: {
          pluginId: { type: 'string', enum: [SUPABASE_BACKEND_PROVIDER_PLUGIN_ID] },
          kind: { type: 'string', enum: ['command'] },
          contributionId: { type: 'string', enum: [tool.contributionId] },
          status: { type: 'string', enum: ['completed', 'cancelled'] },
          data: {
            type: 'object',
            additionalProperties: false,
            properties: {
              safety: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  credentialResolution: { type: 'string', enum: ['forbidden'] },
                  sideEffects: { type: 'string', enum: ['none'] },
                  applyAvailable: { type: 'boolean', enum: [false] }
                }
              }
            }
          }
        }
      })
      expect(tool.outputSchema?.required).toContain('data')
    }
    expect(parsed.tools.find(({ kind }) => kind === 'connector')).toMatchObject({
      pluginId: AIRTABLE_RECORDS_PLUGIN_ID,
      contributionId: AIRTABLE_CONNECTOR_CONTRIBUTION_ID
    })
  })

  test('rejects duplicate names, static-name collisions, reserved targets, and unsafe schemas', () => {
    expect(() => parsePluginMCPCatalogResponse(response([descriptor(), descriptor()]))).toThrow(
      'names must be unique'
    )
    expect(() =>
      parsePluginMCPCatalogResponse(response([descriptor({ name: 'get_node' })]))
    ).toThrow('reserved plugin tool namespace')
    expect(() =>
      parsePluginMCPCatalogResponse(
        response([descriptor({ pluginId: 'open-pencil.replacement-slide-menu' })])
      )
    ).toThrow('identity suffix does not match its canonical contribution')
    expect(() =>
      parsePluginMCPCatalogResponse(response([descriptor({ kind: 'command' })]))
    ).toThrow('name action does not match')
    expect(() =>
      parsePluginMCPCatalogResponse(
        response([
          connectorDescriptor({
            ...connectorInputSchema(),
            additionalProperties: true
          })
        ])
      )
    ).toThrow()
    expect(() =>
      parsePluginMCPCatalogResponse(
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
      parsePluginMCPCatalogResponse(
        response([
          connectorDescriptor(connectorInputSchema(), {
            name: AIRTABLE_TOOL_NAME.replace('__query_', '__run_')
          })
        ])
      )
    ).toThrow('name action does not match')
    expect(() =>
      parsePluginMCPCatalogResponse(
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
      parsePluginMCPCatalogResponse(
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
        name: appPluginMCPToolName(`publisher-${index}`, 'module', `module-${index}`),
        pluginId: `publisher-${index}`,
        contributionId: `module-${index}`
      })
    )
    expect(() => parsePluginMCPCatalogResponse(response(tools))).toThrow(
      `at most ${PLUGIN_MCP_CATALOG_LIMITS.maxTools}`
    )
  })

  test('fails the whole catalog when bounded descriptors exceed the catalog byte limit', () => {
    const tools = Array.from({ length: PLUGIN_MCP_CATALOG_LIMITS.maxTools }, (_, index) =>
      descriptor({
        name: appPluginMCPToolName(`publisher-${index}`, 'module', `module-${index}`),
        description: 'x'.repeat(PLUGIN_MCP_CATALOG_LIMITS.maxDescriptionLength),
        pluginId: `publisher-${index}`,
        contributionId: `module-${index}`
      })
    )
    expect(() => parsePluginMCPCatalogResponse(response(tools))).toThrow('catalog byte limit')
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
        parsePluginMCPCatalogResponse(response([commandDescriptor(invalidSchema)]))
      ).toThrow()
    }

    expect(() =>
      parsePluginMCPCatalogResponse(
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
      parsePluginMCPCatalogResponse(
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
      parsePluginMCPCatalogResponse(
        response([
          commandDescriptor({
            type: 'object',
            properties: nodeHeavyProperties,
            additionalProperties: false
          })
        ])
      )
    ).toThrow('node limit')

    for (const invalidOutputSchema of [
      { ...executionOutputSchema('command', 'accessibility-audit'), additionalProperties: true },
      {
        type: 'object',
        properties: {
          result: nestedArraySchema(PLUGIN_MCP_CATALOG_LIMITS.maxSchemaDepth + 1)
        },
        additionalProperties: false
      }
    ]) {
      expect(() =>
        parsePluginMCPCatalogResponse(
          response([
            {
              ...commandDescriptor(),
              outputSchema: invalidOutputSchema
            }
          ])
        )
      ).toThrow()
    }
  })

  test('budgets a fixed execution envelope separately from its bounded result schema', () => {
    for (const dataSchema of [maxDepthResultSchema(11), rawNodeBoundaryResultSchema()]) {
      expect(
        parsePluginMCPCatalogResponse(
          response([
            descriptor(),
            {
              ...commandDescriptor(),
              outputSchema: executionOutputSchema('command', 'accessibility-audit', dataSchema)
            }
          ])
        ).tools
      ).toHaveLength(2)
    }

    for (const dataSchema of [maxDepthResultSchema(12), rawNodeBoundaryResultSchema(true)]) {
      expect(() =>
        parsePluginMCPCatalogResponse(
          response([
            {
              ...commandDescriptor(),
              outputSchema: executionOutputSchema('command', 'accessibility-audit', dataSchema)
            }
          ])
        )
      ).toThrow()
    }

    const valid = executionOutputSchema('command', 'accessibility-audit')
    const properties = valid.properties
    for (const outputSchema of [
      { ...valid, maxProperties: 7 },
      { ...valid, unexpected: true },
      { ...valid, properties: { ...properties, pluginId: { type: 'string', enum: ['wrong'] } } },
      { ...valid, properties: { ...properties, kind: { type: 'string', enum: ['exporter'] } } },
      {
        ...valid,
        properties: {
          ...properties,
          contributionId: { type: 'string', enum: ['wrong-contribution'] }
        }
      },
      { ...valid, required: ['pluginId'], minProperties: 1 }
    ]) {
      expect(() =>
        parsePluginMCPCatalogResponse(response([{ ...commandDescriptor(), outputSchema }]))
      ).toThrow()
    }

    expect(() =>
      parsePluginMCPCatalogResponse(
        response([
          descriptor({
            outputSchema: executionOutputSchema('command', 'slide-menu')
          })
        ])
      )
    ).toThrow('only for command and exporter')

    const nearLimitDataSchema = {
      type: 'object',
      properties: Object.fromEntries(
        Array.from({ length: 8 }, (_, index) => [
          `p${index}`,
          { type: 'string', description: 'x'.repeat(4_000) }
        ])
      ),
      additionalProperties: false
    }
    const oversizedWireSchema = executionOutputSchema(
      'command',
      'accessibility-audit',
      nearLimitDataSchema
    )
    expect(new TextEncoder().encode(JSON.stringify(nearLimitDataSchema)).byteLength).toBeLessThan(
      PLUGIN_MCP_CATALOG_LIMITS.maxSchemaBytes
    )
    expect(
      new TextEncoder().encode(JSON.stringify(oversizedWireSchema)).byteLength
    ).toBeGreaterThan(PLUGIN_MCP_CATALOG_LIMITS.maxSchemaBytes)
    expect(() =>
      parsePluginMCPCatalogResponse(
        response([{ ...commandDescriptor(), outputSchema: oversizedWireSchema }])
      )
    ).toThrow('byte limit')
  })
})

describe('dynamic plugin MCP registration', () => {
  const closeTasks: Array<() => Promise<void>> = []

  afterEach(async () => {
    await Promise.allSettled(closeTasks.splice(0).map((close) => close()))
  })

  test('changes tools/list, emits list_changed, and revalidates calls through the app', async () => {
    const catalog = createPluginMCPCatalog()
    const rpcCalls: Record<string, unknown>[] = []
    let commandFailure: 'domain' | 'rpc' | 'throw' | null = null
    const server = new McpServer({ name: 'plugin-test-server', version: '0.0.0' })
    server.registerTool('static_tool', { inputSchema: z.object({}) }, async () => ({
      content: [{ type: 'text', text: '{}' }]
    }))
    const registration = registerPluginMCPTools(server, {
      catalog,
      async sendRPC(body) {
        rpcCalls.push(body)
        const args = body.args as { pluginId?: unknown }
        if (args.pluginId === 'acme.analytics') {
          if (commandFailure === 'rpc') return { ok: false, error: 'RPC command denied' }
          if (commandFailure === 'domain') {
            return { ok: true, result: { ok: false, error: 'Domain command denied' } }
          }
          if (commandFailure === 'throw') throw new Error('Command transport failed')
          return {
            ok: true,
            result: {
              pluginId: 'acme.analytics',
              kind: 'command',
              contributionId: 'accessibility-audit',
              status: 'completed',
              message: 'Audit completed',
              data: { inserted: true }
            }
          }
        }
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
        document_id: { type: 'string', minLength: 1, maxLength: 128 },
        page_id: { type: 'string', minLength: 1, maxLength: 128 }
      }
    })
    expect(listed.find((tool) => tool.name === SLIDE_MENU_TOOL_NAME)?._meta).toMatchObject({
      openpencil: { authority: authority() }
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
          expectedCatalogRevision: 'revision-1',
          expectedDescriptor: expectedDescriptor(descriptor()),
          args: { x: 40 }
        }
      }
    ])

    catalog.replace(response([commandDescriptor()], 'command-string'))
    const commandTools = (await client.listTools()).tools
    expect(commandTools.map(({ name }) => name).sort()).toEqual([AUDIT_TOOL_NAME, 'static_tool'])
    expect(commandTools.find(({ name }) => name === AUDIT_TOOL_NAME)?.outputSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: { data: { type: 'object', additionalProperties: false } }
    })
    const commandCall = await client.callTool({
      name: AUDIT_TOOL_NAME,
      arguments: { scope: 'selection', document_id: 'document-2' }
    })
    expect(commandCall.structuredContent).toMatchObject({
      pluginId: 'acme.analytics',
      kind: 'command',
      contributionId: 'accessibility-audit',
      data: { inserted: true }
    })
    for (const [failure, message] of [
      ['rpc', 'RPC command denied'],
      ['domain', 'Domain command denied'],
      ['throw', 'Command transport failed']
    ] as const) {
      commandFailure = failure
      const failed = await client.callTool({
        name: AUDIT_TOOL_NAME,
        arguments: { scope: 'selection', document_id: 'document-2' }
      })
      expect(failed.isError).toBe(true)
      expect(failed.structuredContent).toBeUndefined()
      expect(JSON.stringify(failed.content)).toContain(message)
    }
    commandFailure = null
    expect(rpcCalls.at(-1)).toEqual({
      command: 'plugin_mcp_tool',
      args: {
        document_id: 'document-2',
        name: AUDIT_TOOL_NAME,
        pluginId: 'acme.analytics',
        expectedCatalogRevision: 'command-string',
        expectedDescriptor: expectedDescriptor(commandDescriptor()),
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
        expectedCatalogRevision: 'connector-integer',
        expectedDescriptor: expectedDescriptor(connectorDescriptor()),
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
    const controller = createPluginMCPController({
      async sendRPC(body) {
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
    const controller = createPluginMCPController({
      sendRPC() {
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
