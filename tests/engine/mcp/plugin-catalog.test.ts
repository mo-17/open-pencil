import { afterEach, describe, expect, test } from 'bun:test'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import { appPluginMcpToolName } from '@/app/plugins/mcp'

import {
  PLUGIN_MCP_CATALOG_LIMITS,
  createPluginMcpCatalog,
  createPluginMcpController,
  parsePluginMcpCatalogResponse,
  registerPluginMcpTools
} from '#mcp/tool/plugin/catalog'

const SLIDE_MENU_TOOL_NAME = appPluginMcpToolName('open-pencil.slide-menu', 'module', 'slide-menu')
const VIDEO_TOOL_NAME = appPluginMcpToolName('open-pencil.video', 'module', 'video')

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

    catalog.clear()
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['static_tool'])
    const removedCall = await client.callTool({
      name: SLIDE_MENU_TOOL_NAME,
      arguments: { x: 40 }
    })
    expect(removedCall.isError).toBe(true)
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })
    expect(listChanged).toBeGreaterThanOrEqual(2)
  })

  test('keeps the last verified list only on success and clears it on refresh failure', async () => {
    let shouldFail = false
    const controller = createPluginMcpController({
      async sendRpc(body) {
        expect(body).toEqual({ command: 'plugin_mcp_tools', args: {} })
        if (shouldFail) throw new Error('app disconnected')
        return response([descriptor()])
      }
    })
    closeTasks.push(async () => controller.close())

    await controller.refresh()
    expect(controller.catalog.current().tools).toHaveLength(1)
    shouldFail = true
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
