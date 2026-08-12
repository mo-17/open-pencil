import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'

import {
  addRemoteMCPServer,
  clearRemoteMCPBearerToken,
  parseRemoteMCPSettings,
  remoteMCPBearerCredentialRef,
  remoteMCPCredentialStatus,
  remoteMCPCredentialRefs,
  remoteMCPServerDisplayInfo,
  remoteMCPSettingsSnapshot,
  remoteMCPToolServerDisplayInfo,
  replaceRemoteMCPSettings,
  setRemoteMCPBearerToken,
  updateRemoteMCPServer
} from '@/app/ai/mcp'
import { buildRemoteMCPACPServerConfigs } from '@/app/ai/mcp/acp'
import {
  createRemoteMCPRuntime,
  MAX_REMOTE_MCP_TOOL_PAGES,
  MAX_REMOTE_MCP_TOOL_RESULT_BYTES,
  MAX_REMOTE_MCP_TOOLS_PER_SERVER,
  namespacedRemoteMCPToolName,
  type RemoteMCPClient
} from '@/app/ai/mcp/runtime'
import {
  MAX_REMOTE_MCP_SERVERS,
  normalizeRemoteMCPServerInput,
  normalizeRemoteMCPURL,
  REMOTE_MCP_SETTINGS_VERSION,
  type RemoteMCPServer,
  type RemoteMCPSettings
} from '@/app/ai/mcp/types'
import { appCredentialServices } from '@/app/settings/credentials/app'
import { appCredentialRefs } from '@/app/settings/credentials/persistence'
import { credentialKey } from '@/app/settings/credentials/reference'

const PUBLIC_SERVER: RemoteMCPServer = {
  id: 'mcp-0123456789abcdef',
  name: 'Public docs',
  transport: { type: 'streamable-http', url: 'https://mcp.example.com/tools' },
  auth: { type: 'none' }
}

const PRIVATE_SERVER_ID = 'mcp-fedcba9876543210'

const PRIVATE_SERVER: RemoteMCPServer = {
  id: PRIVATE_SERVER_ID,
  name: 'Private docs',
  transport: { type: 'streamable-http', url: 'https://private.example.com/mcp' },
  auth: { type: 'bearer', credentialProfileId: PRIVATE_SERVER_ID }
}

type ToolDefinition = {
  name: string
  description?: string
  inputSchema: {
    type: 'object'
    properties?: Record<string, object>
  }
}

function toolDefinition(name: string): ToolDefinition {
  return {
    name,
    description: `Run ${name}`,
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string' } }
    }
  }
}

class FakeRemoteMCPClient implements RemoteMCPClient {
  connectCount = 0
  closeCount = 0
  listToolsCount = 0
  calls: Array<{ name: string; args: Record<string, unknown> }> = []
  connectError?: Error
  closeError?: Error
  nextCursor?: (requestCount: number) => string | undefined
  result: unknown = { content: [{ type: 'text', text: 'ok' }] }

  constructor(readonly definitions: ToolDefinition[]) {}

  connect(): Promise<void> {
    this.connectCount += 1
    return this.connectError ? Promise.reject(this.connectError) : Promise.resolve()
  }

  listTools(): Promise<{ tools: ToolDefinition[]; nextCursor?: string }> {
    this.listToolsCount += 1
    return Promise.resolve({
      tools: this.definitions,
      nextCursor: this.nextCursor?.(this.listToolsCount)
    })
  }

  callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ name, args })
    return Promise.resolve(this.result)
  }

  close(): Promise<void> {
    this.closeCount += 1
    return this.closeError ? Promise.reject(this.closeError) : Promise.resolve()
  }
}

let originalSettings: RemoteMCPSettings

beforeEach(() => {
  originalSettings = remoteMCPSettingsSnapshot()
})

afterEach(() => {
  replaceRemoteMCPSettings(originalSettings)
})

describe('remote MCP settings', () => {
  test('accepts HTTPS and loopback HTTP while rejecting insecure remote URLs', () => {
    expect(normalizeRemoteMCPURL('https://mcp.example.com/tools')).toBe(
      'https://mcp.example.com/tools'
    )
    expect(normalizeRemoteMCPURL('http://127.0.0.1:3000/mcp')).toBe('http://127.0.0.1:3000/mcp')
    expect(normalizeRemoteMCPURL('http://[::1]:3000/mcp')).toBe('http://[::1]:3000/mcp')
    expect(() => normalizeRemoteMCPURL('http://mcp.example.com/tools')).toThrow(
      'HTTP is allowed only for loopback hosts'
    )
    expect(() => normalizeRemoteMCPURL('https://token@mcp.example.com/tools')).toThrow(
      'must not contain embedded credentials'
    )
    expect(() =>
      normalizeRemoteMCPServerInput({
        name: 'Invalid auth',
        url: 'https://mcp.example.com/tools',
        authType: 'oauth'
      })
    ).toThrow('authentication type is invalid')
  })

  test('parses v1 settings with stable unique IDs and a bounded server list', () => {
    const parsed = parseRemoteMCPSettings({
      version: REMOTE_MCP_SETTINGS_VERSION,
      servers: [
        PUBLIC_SERVER,
        PUBLIC_SERVER,
        ...Array.from({ length: MAX_REMOTE_MCP_SERVERS + 5 }, (_, index) => ({
          ...PUBLIC_SERVER,
          id: `mcp-${(index + 1).toString(16).padStart(16, '0')}`
        }))
      ]
    })

    expect(parsed?.servers).toHaveLength(MAX_REMOTE_MCP_SERVERS)
    expect(new Set(parsed?.servers.map((server) => server.id)).size).toBe(MAX_REMOTE_MCP_SERVERS)
    expect(parseRemoteMCPSettings({ version: 2, servers: [] })).toBeNull()
  })

  test('rejects bearer credential profile IDs that do not match their server ID', () => {
    const parsed = parseRemoteMCPSettings({
      version: REMOTE_MCP_SETTINGS_VERSION,
      servers: [
        {
          ...PRIVATE_SERVER,
          auth: { type: 'bearer', credentialProfileId: PUBLIC_SERVER.id }
        }
      ]
    })

    expect(parsed).toEqual({ version: REMOTE_MCP_SETTINGS_VERSION, servers: [] })
  })

  test('creates stable IDs and keeps bearer references out of non-secret settings', () => {
    replaceRemoteMCPSettings({ version: REMOTE_MCP_SETTINGS_VERSION, servers: [] })
    const server = addRemoteMCPServer({
      name: 'Internal',
      url: 'https://internal.example.com/mcp',
      authType: 'bearer'
    })

    expect(server.id).toMatch(/^mcp-[a-f0-9]{16}$/)
    expect(server.auth).toEqual({ type: 'bearer', credentialProfileId: server.id })
    expect(JSON.stringify(remoteMCPSettingsSnapshot())).not.toContain('secret')
  })

  test('includes bearer references in credential persistence migration', () => {
    replaceRemoteMCPSettings({
      version: REMOTE_MCP_SETTINGS_VERSION,
      servers: [PUBLIC_SERVER, PRIVATE_SERVER]
    })

    expect(remoteMCPCredentialRefs().map(credentialKey)).toEqual([
      'v1:remote-mcp:mcp-fedcba9876543210:bearer-token'
    ])
    expect(appCredentialRefs().map(credentialKey)).toContain(
      'v1:remote-mcp:mcp-fedcba9876543210:bearer-token'
    )
  })

  test('exposes display metadata and bearer credential status without revealing the token', async () => {
    replaceRemoteMCPSettings({
      version: REMOTE_MCP_SETTINGS_VERSION,
      servers: [PUBLIC_SERVER, PRIVATE_SERVER]
    })
    await clearRemoteMCPBearerToken(PRIVATE_SERVER.id)

    try {
      expect(remoteMCPServerDisplayInfo(PRIVATE_SERVER.id)).toEqual({
        id: PRIVATE_SERVER.id,
        name: 'Private docs',
        origin: 'https://private.example.com'
      })
      expect(
        remoteMCPToolServerDisplayInfo(
          namespacedRemoteMCPToolName(PRIVATE_SERVER.id, 'read.private')
        )
      ).toEqual(remoteMCPServerDisplayInfo(PRIVATE_SERVER.id))
      expect(await remoteMCPCredentialStatus(PUBLIC_SERVER.id)).toBe('not-required')
      expect(await remoteMCPCredentialStatus(PRIVATE_SERVER.id)).toBe('missing')

      await setRemoteMCPBearerToken(PRIVATE_SERVER.id, 'runtime-only-secret')
      expect(await remoteMCPCredentialStatus(PRIVATE_SERVER.id)).toBe('configured')
      expect(JSON.stringify(remoteMCPSettingsSnapshot())).not.toContain('runtime-only-secret')
    } finally {
      await clearRemoteMCPBearerToken(PRIVATE_SERVER.id)
    }
  })

  test('builds bounded ACP HTTP configs with credentials resolved only for session setup', async () => {
    replaceRemoteMCPSettings({
      version: REMOTE_MCP_SETTINGS_VERSION,
      servers: [PUBLIC_SERVER, PRIVATE_SERVER]
    })
    await setRemoteMCPBearerToken(PRIVATE_SERVER.id, 'acp-runtime-secret')

    try {
      expect(await buildRemoteMCPACPServerConfigs([PUBLIC_SERVER.id, PRIVATE_SERVER.id])).toEqual([
        {
          type: 'http',
          name: `remote-${PUBLIC_SERVER.id}`,
          url: PUBLIC_SERVER.transport.url,
          headers: []
        },
        {
          type: 'http',
          name: `remote-${PRIVATE_SERVER.id}`,
          url: PRIVATE_SERVER.transport.url,
          headers: [{ name: 'Authorization', value: 'Bearer acp-runtime-secret' }]
        }
      ])
      expect(JSON.stringify(remoteMCPSettingsSnapshot())).not.toContain('acp-runtime-secret')
    } finally {
      await clearRemoteMCPBearerToken(PRIVATE_SERVER.id)
    }
  })

  test('clears a saved bearer token before changing a server to no authentication', async () => {
    replaceRemoteMCPSettings({
      version: REMOTE_MCP_SETTINGS_VERSION,
      servers: [PRIVATE_SERVER]
    })
    const reference = remoteMCPBearerCredentialRef(PRIVATE_SERVER)
    await setRemoteMCPBearerToken(PRIVATE_SERVER.id, 'remove-on-auth-change')

    await updateRemoteMCPServer(PRIVATE_SERVER.id, {
      name: PRIVATE_SERVER.name,
      url: PRIVATE_SERVER.transport.url,
      authType: 'none'
    })

    expect(await appCredentialServices.manager.status(reference)).toBe('missing')
    expect(remoteMCPSettingsSnapshot().servers[0]?.auth).toEqual({ type: 'none' })
  })

  test('keeps bearer credentials for same-origin paths but clears them before an origin change', async () => {
    replaceRemoteMCPSettings({
      version: REMOTE_MCP_SETTINGS_VERSION,
      servers: [PRIVATE_SERVER]
    })
    const reference = remoteMCPBearerCredentialRef(PRIVATE_SERVER)
    await setRemoteMCPBearerToken(PRIVATE_SERVER.id, 'origin-bound-secret')

    try {
      await expect(
        updateRemoteMCPServer(PRIVATE_SERVER.id, {
          name: PRIVATE_SERVER.name,
          url: 'not a valid URL',
          authType: 'none'
        })
      ).rejects.toThrow('URL is invalid')
      expect(await appCredentialServices.manager.status(reference)).toBe('configured')

      await updateRemoteMCPServer(PRIVATE_SERVER.id, {
        name: PRIVATE_SERVER.name,
        url: 'https://private.example.com/another-mcp-path',
        authType: 'bearer'
      })
      expect(await appCredentialServices.manager.status(reference)).toBe('configured')

      await updateRemoteMCPServer(PRIVATE_SERVER.id, {
        name: PRIVATE_SERVER.name,
        url: 'https://replacement.example.com/mcp',
        authType: 'bearer'
      })
      expect(await appCredentialServices.manager.status(reference)).toBe('missing')
    } finally {
      await appCredentialServices.manager.clear(reference)
    }
  })
})

describe('remote MCP runtime', () => {
  test('completes a real Streamable HTTP handshake and approved tool call over loopback', async () => {
    const protocolMethods: string[] = []
    const serverErrors: unknown[] = []
    let toolCalls = 0
    const serverTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      enableJsonResponse: true
    })
    const mcpServer = new McpServer({ name: 'open-pencil-loopback-test', version: '1' })
    mcpServer.registerTool(
      'echo.value',
      {
        description: 'Echo a value over the real MCP protocol',
        inputSchema: { value: z.string() }
      },
      ({ value }) => {
        toolCalls += 1
        return Promise.resolve({ content: [{ type: 'text' as const, text: `echo:${value}` }] })
      }
    )
    const httpServer = createServer((request, response) => {
      void (async () => {
        if (request.url !== '/mcp') {
          response.writeHead(404).end('Not found')
          return
        }
        const chunks: Uint8Array[] = []
        for await (const chunk of request) chunks.push(chunk)
        const body = Buffer.concat(chunks).toString('utf8')
        const parsedBody = body ? (JSON.parse(body) as { method?: unknown }) : undefined
        if (typeof parsedBody?.method === 'string') protocolMethods.push(parsedBody.method)
        await serverTransport.handleRequest(request, response, parsedBody)
      })().catch((error: unknown) => {
        serverErrors.push(error)
        if (!response.headersSent) response.writeHead(500)
        response.end()
      })
    })
    let runtime: Awaited<ReturnType<typeof createRemoteMCPRuntime>> | undefined
    let executionError: unknown
    const cleanupErrors: unknown[] = []

    try {
      await mcpServer.connect(serverTransport)
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => reject(error)
        httpServer.once('error', onError)
        httpServer.listen(0, '127.0.0.1', () => {
          httpServer.off('error', onError)
          resolve()
        })
      })
      const address = httpServer.address() as AddressInfo
      const loopbackServer: RemoteMCPServer = {
        id: 'mcp-1111111111111111',
        name: 'Loopback protocol test',
        transport: {
          type: 'streamable-http',
          url: `http://127.0.0.1:${address.port}/mcp`
        },
        auth: { type: 'none' }
      }
      runtime = await createRemoteMCPRuntime([loopbackServer.id], {
        servers: [loopbackServer],
        resolveBearerToken: () => Promise.resolve(null)
      })
      const toolName = namespacedRemoteMCPToolName(loopbackServer.id, 'echo.value')
      const remoteTool = runtime.tools[toolName]

      expect(remoteTool.needsApproval).toBeTrue()
      expect(remoteTool.execute).toBeDefined()
      expect(protocolMethods).toContain('initialize')
      expect(protocolMethods).toContain('notifications/initialized')
      expect(protocolMethods).toContain('tools/list')

      const result = await remoteTool.execute?.(
        { value: 'hello' },
        { toolCallId: 'tool-loopback', messages: [] }
      )

      expect(result).toEqual({ content: [{ type: 'text', text: 'echo:hello' }] })
      expect(protocolMethods).toContain('tools/call')
      expect(toolCalls).toBe(1)
      expect(serverErrors).toEqual([])
    } catch (error) {
      executionError = error
    } finally {
      try {
        await runtime?.dispose()
      } catch (error) {
        cleanupErrors.push(error)
      }
      try {
        await mcpServer.close()
      } catch (error) {
        cleanupErrors.push(error)
      }
      if (httpServer.listening) {
        try {
          await new Promise<void>((resolve, reject) => {
            httpServer.close((error) => {
              if (error) reject(error)
              else resolve()
            })
          })
        } catch (error) {
          cleanupErrors.push(error)
        }
      }
    }
    if (executionError !== undefined) {
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [executionError, ...cleanupErrors],
          'Loopback MCP test failed and cleanup was incomplete'
        )
      }
      throw executionError
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, 'Failed to clean up loopback MCP test server')
    }
  })

  test('discovers namespaced tools, requires approval, bounds calls, and disposes once', async () => {
    const client = new FakeRemoteMCPClient([toolDefinition('echo.value')])
    const runtime = await createRemoteMCPRuntime([PUBLIC_SERVER.id], {
      servers: [PUBLIC_SERVER],
      createClient: () => client,
      resolveBearerToken: () => Promise.resolve(null)
    })
    const toolName = namespacedRemoteMCPToolName(PUBLIC_SERVER.id, 'echo.value')
    const remoteTool = runtime.tools[toolName]

    expect(toolName).toBe('mcp__mcp-0123456789abcdef__echo_value')
    expect(remoteTool.needsApproval).toBeTrue()
    expect(client.connectCount).toBe(1)
    expect(remoteTool.execute).toBeDefined()
    const result = await remoteTool.execute?.(
      { value: 'hello' },
      { toolCallId: 'tool-1', messages: [] }
    )
    expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] })
    expect(client.calls).toEqual([{ name: 'echo.value', args: { value: 'hello' } }])

    await runtime.dispose()
    await runtime.dispose()
    expect(client.closeCount).toBe(1)
    await expect(
      remoteTool.execute?.({ value: 'again' }, { toolCallId: 'tool-2', messages: [] })
    ).rejects.toThrow('is closed')
  })

  test('resolves bearer credentials only at runtime', async () => {
    const client = new FakeRemoteMCPClient([])
    const factoryOptions: unknown[] = []
    const runtime = await createRemoteMCPRuntime([PRIVATE_SERVER.id], {
      servers: [PRIVATE_SERVER],
      resolveBearerToken: () => Promise.resolve('runtime-secret'),
      createClient: (options) => {
        factoryOptions.push(options)
        return client
      }
    })

    expect(factoryOptions).toEqual([{ server: PRIVATE_SERVER, bearerToken: 'runtime-secret' }])
    await runtime.dispose()
  })

  test('closes every opened client when a later connection fails', async () => {
    const first = new FakeRemoteMCPClient([])
    const second = new FakeRemoteMCPClient([])
    second.connectError = new Error('offline')

    await expect(
      createRemoteMCPRuntime([PUBLIC_SERVER.id, PRIVATE_SERVER.id], {
        servers: [PUBLIC_SERVER, PRIVATE_SERVER],
        resolveBearerToken: () => Promise.resolve('token'),
        createClient: ({ server }) => (server.id === PUBLIC_SERVER.id ? first : second)
      })
    ).rejects.toThrow('offline')

    expect(first.closeCount).toBe(1)
    expect(second.closeCount).toBe(1)
  })

  test('preserves initialization and cleanup failures in the error cause', async () => {
    const first = new FakeRemoteMCPClient([])
    first.closeError = new Error('close failed')
    const second = new FakeRemoteMCPClient([])
    second.connectError = new Error('offline')

    const failure = await createRemoteMCPRuntime([PUBLIC_SERVER.id, PRIVATE_SERVER.id], {
      servers: [PUBLIC_SERVER, PRIVATE_SERVER],
      resolveBearerToken: () => Promise.resolve('token'),
      createClient: ({ server }) => (server.id === PUBLIC_SERVER.id ? first : second)
    }).then(
      () => null,
      (error: unknown) => error
    )

    expect(failure).toBeInstanceOf(Error)
    if (!(failure instanceof Error)) throw new Error('Expected runtime initialization to fail')
    expect(failure.message).toContain('offline')
    expect(failure.cause).toBeInstanceOf(AggregateError)
    expect((failure.cause as AggregateError).errors).toHaveLength(2)
    expect(first.closeCount).toBe(1)
    expect(second.closeCount).toBe(1)
  })

  test('fails closed on normalized tool-name collisions', async () => {
    const client = new FakeRemoteMCPClient([
      toolDefinition('read.item'),
      toolDefinition('read/item')
    ])

    await expect(
      createRemoteMCPRuntime([PUBLIC_SERVER.id], {
        servers: [PUBLIC_SERVER],
        resolveBearerToken: () => Promise.resolve(null),
        createClient: () => client
      })
    ).rejects.toThrow('tool name collision')
    expect(client.closeCount).toBe(1)
  })

  test('rejects excessive tool counts and oversized results', async () => {
    const excessive = new FakeRemoteMCPClient(
      Array.from({ length: MAX_REMOTE_MCP_TOOLS_PER_SERVER + 1 }, (_, index) =>
        toolDefinition(`tool_${index}`)
      )
    )
    await expect(
      createRemoteMCPRuntime([PUBLIC_SERVER.id], {
        servers: [PUBLIC_SERVER],
        resolveBearerToken: () => Promise.resolve(null),
        createClient: () => excessive
      })
    ).rejects.toThrow(`more than ${MAX_REMOTE_MCP_TOOLS_PER_SERVER} tools`)
    expect(excessive.closeCount).toBe(1)

    const oversized = new FakeRemoteMCPClient([toolDefinition('large_result')])
    oversized.result = {
      content: [{ type: 'text', text: 'x'.repeat(MAX_REMOTE_MCP_TOOL_RESULT_BYTES) }]
    }
    const runtime = await createRemoteMCPRuntime([PUBLIC_SERVER.id], {
      servers: [PUBLIC_SERVER],
      resolveBearerToken: () => Promise.resolve(null),
      createClient: () => oversized
    })
    const remoteTool = runtime.tools[namespacedRemoteMCPToolName(PUBLIC_SERVER.id, 'large_result')]
    await expect(
      remoteTool.execute?.({}, { toolCallId: 'tool-large', messages: [] })
    ).rejects.toThrow(`more than ${MAX_REMOTE_MCP_TOOL_RESULT_BYTES} bytes`)
    await runtime.dispose()
  })

  test('rejects endless tools pagination with unique cursors', async () => {
    const client = new FakeRemoteMCPClient([])
    client.nextCursor = (requestCount) => `cursor-${requestCount}`

    await expect(
      createRemoteMCPRuntime([PUBLIC_SERVER.id], {
        servers: [PUBLIC_SERVER],
        resolveBearerToken: () => Promise.resolve(null),
        createClient: () => client
      })
    ).rejects.toThrow(`more than ${MAX_REMOTE_MCP_TOOL_PAGES} tool pages`)
    expect(client.listToolsCount).toBe(MAX_REMOTE_MCP_TOOL_PAGES)
    expect(client.closeCount).toBe(1)
  })

  test('rejects unknown configured IDs before creating a client', async () => {
    let factoryCalls = 0
    await expect(
      createRemoteMCPRuntime(['mcp-aaaaaaaaaaaaaaaa'], {
        servers: [PUBLIC_SERVER],
        resolveBearerToken: () => Promise.resolve(null),
        createClient: () => {
          factoryCalls += 1
          return new FakeRemoteMCPClient([])
        }
      })
    ).rejects.toThrow('Unknown remote MCP server selected by model')
    expect(factoryCalls).toBe(0)
  })
})
