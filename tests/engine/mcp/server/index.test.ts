import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdir, stat, symlink, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import { SceneGraph } from '@open-pencil/scene-graph'

import { startServer } from '#mcp/server'
import { createToolDescriptors } from '#mcp/tool/manifest'

import {
  connectMockBrowser,
  openWs,
  readNextResponse,
  waitForBrowserRegistration,
  type HealthResponse,
  type MockBrowser,
  type MockBrowserOptions
} from '#tests/helpers/mcp/server'

const isUnix = process.platform !== 'win32'
const SOCKET_DIR = join(tmpdir(), `openpencil-test-server-${process.pid}`)
const TEST_MCP_ROOT = join(tmpdir(), 'open-pencil-mcp-root')
const TEST_AUTH_TOKEN = 'test-auth-token'
const TEST_CLIENT_AUTH_TOKEN = 'test-client-token'
let testCounter = 0

// ---------------------------------------------------------------------------
// Test client: starts server with ephemeral TCP port, connects mock browser + MCP client
// ---------------------------------------------------------------------------

function testSocketPath(): string | null {
  if (!isUnix) return null
  return join(SOCKET_DIR, `mcp-test-${process.pid}-${++testCounter}.sock`)
}

async function createTestClient(disabledTools: string[] = []) {
  if (isUnix) await mkdir(SOCKET_DIR, { recursive: true })
  const authToken = TEST_CLIENT_AUTH_TOKEN
  const handle = await startServer({
    httpPort: 0,
    withTcp: true,
    socketPath: testSocketPath(),
    authToken,
    disabledTools,
    enableEval: false,
    mcpRoot: null
  })

  const httpPort = handle.httpPort
  if (!httpPort) {
    await handle.close()
    throw new Error('TCP listener not started')
  }

  const graph = new SceneGraph()
  let browser: MockBrowser | undefined
  let client: Client | undefined

  try {
    browser = await connectMockBrowser(httpPort, graph, authToken)
    await waitForBrowserRegistration(httpPort)

    client = new Client({ name: 'test-client', version: '0.0.0' })
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${httpPort}/mcp`),
      {
        requestInit: { headers: { Authorization: `Bearer ${authToken}` } }
      }
    )
    await client.connect(transport)
  } catch (e) {
    await client?.close().catch(() => undefined)
    browser?.close()
    await handle.close()
    throw e
  }

  const safeClient = client
  const safeBrowser = browser
  return {
    client: safeClient,
    graph,
    handle,
    close: async () => {
      const errors: unknown[] = []
      try {
        await safeClient?.close()
      } catch (e) {
        errors.push(e)
      }
      try {
        safeBrowser?.close()
      } catch (e) {
        errors.push(e)
      }
      try {
        await handle.close()
      } catch (e) {
        errors.push(e)
      }
      if (errors.length > 0) throw errors[0]
    }
  }
}

function parseResult(result: { content: { type: string; text?: string }[] }): unknown {
  const textContent = result.content.find((c) => c.type === 'text')
  return textContent?.text ? JSON.parse(textContent.text) : null
}

// ---------------------------------------------------------------------------
// MCP tool + session tests
// ---------------------------------------------------------------------------

describe('MCP server', () => {
  let client: Client
  let graph: SceneGraph
  let cleanup: (() => Promise<void>) | null = null

  beforeEach(async () => {
    try {
      const ctx = await createTestClient()
      client = ctx.client
      graph = ctx.graph
      cleanup = ctx.close
    } catch (e) {
      if (cleanup) await cleanup().catch(() => undefined)
      throw e
    }
  })

  afterEach(async () => {
    if (cleanup) await cleanup()
    cleanup = null
  })

  test('lists all registered tools', async () => {
    const { tools } = await client.listTools()
    const names = tools.map((tool) => tool.name)
    const expectedNames = createToolDescriptors(false)
      .filter((tool) => tool.availability === 'default')
      .map((tool) => tool.name)
      .sort()
    expect([...names].sort()).toEqual(expectedNames)
    expect(names).toContain('check_font')
    expect(names).toContain('audit_font_rendering')
    expect(names).toContain('audit_font_licenses')
    expect(names).toContain('audit_image_assets')
    expect(names).toContain('render')
    expect(names).toContain('get_codegen_prompt')
    const auditFontLicenses = tools.find((tool) => tool.name === 'audit_font_licenses')
    expect(JSON.stringify(auditFontLicenses?.inputSchema)).toContain('commercial_use')
    const auditImageAssets = tools.find((tool) => tool.name === 'audit_image_assets')
    expect(JSON.stringify(auditImageAssets?.inputSchema)).toContain('max_total_references')
    expect(tools.length).toBeGreaterThan(30)
  })

  test('describes effects, capabilities, and runtime availability independently', () => {
    const descriptors = createToolDescriptors(true)
    const byName = new Map(descriptors.map((tool) => [tool.name, tool] as const))
    expect(byName.get('get_page_tree')?.effect).toBe('read')
    expect(byName.get('switch_page')?.effect).toBe('read')
    expect(byName.get('viewport_set')?.effect).toBe('read')
    expect(byName.get('export_image')?.effect).toBe('read')
    expect(byName.get('save_file')?.effect).toBe('write')
    expect(byName.get('update_node')?.effect).toBe('write')
    expect(byName.get('new_document')?.capabilities).toEqual(['document:write', 'filesystem:write'])
    expect(byName.get('eval')?.availability).toBe('eval')
    expect(byName.get('eval')?.capabilities).toContain('code:execute')
  })

  test('omits tools disabled in the generic registration filter', async () => {
    if (cleanup) await cleanup()
    cleanup = null

    const ctx = await createTestClient(['create_shape', 'list_documents'])
    client = ctx.client
    graph = ctx.graph
    cleanup = ctx.close

    const { tools } = await client.listTools()
    const names = tools.map((tool) => tool.name)
    expect(names).not.toContain('create_shape')
    expect(names).not.toContain('list_documents')
    expect(names).toContain('get_page_tree')

    const healthResponse = await fetch(`http://127.0.0.1:${ctx.handle.httpPort}/health`, {
      headers: { Authorization: `Bearer ${TEST_CLIENT_AUTH_TOKEN}` }
    })
    const health = (await healthResponse.json()) as HealthResponse
    const descriptors = health.tools ?? []
    expect(descriptors.find((tool) => tool.name === 'create_shape')?.enabled).toBe(false)
    expect(descriptors.find((tool) => tool.name === 'list_documents')?.enabled).toBe(false)
    expect(descriptors.find((tool) => tool.name === 'get_page_tree')?.enabled).toBe(true)
  })

  test('tools expose standard MCP effect annotations', async () => {
    const { tools } = await client.listTools()
    const byName = new Map(tools.map((tool) => [tool.name, tool] as const))
    expect(byName.get('get_page_tree')?.annotations?.readOnlyHint).toBe(true)
    expect(byName.get('get_page_tree')?.annotations?.destructiveHint).toBe(false)
    expect(byName.get('update_node')?.annotations?.readOnlyHint).toBe(false)
    expect(byName.get('update_node')?.annotations?.destructiveHint).toBe(true)
  })

  test('tools have descriptions and input/output schemas', async () => {
    const { tools } = await client.listTools()
    for (const tool of tools) {
      expect(tool.description).toBeTruthy()
      expect(tool.inputSchema).toBeDefined()
      expect(tool.outputSchema).toBeDefined()
    }
  })

  test('create_shape creates a node on the live canvas', async () => {
    const result = await client.callTool({
      name: 'create_shape',
      arguments: { type: 'FRAME', x: 0, y: 0, width: 200, height: 100, name: 'Test' }
    })
    expect(result.isError).not.toBe(true)
    const data = parseResult(result) as { id: string; name: string; type: string }
    expect(result.structuredContent).toEqual(data)
    expect(result._meta?.openpencil).toMatchObject({
      tool: 'create_shape',
      requestBytes: expect.any(Number),
      resultBytes: expect.any(Number),
      durationMs: expect.any(Number)
    })
    expect(data.type).toBe('FRAME')
    expect(data.name).toBe('Test')

    const node = graph.getNode(data.id)
    expect(node).toBeDefined()
    expect(node?.name).toBe('Test')
  })

  test('set_fill validates and applies color', async () => {
    const create = await client.callTool({
      name: 'create_shape',
      arguments: { type: 'RECTANGLE', x: 0, y: 0, width: 50, height: 50 }
    })
    const { id } = parseResult(create) as { id: string }

    const fill = await client.callTool({
      name: 'set_fill',
      arguments: { id, color: '#00ff00' }
    })
    expect(fill.isError).not.toBe(true)
  })

  test('get_page_tree returns page structure', async () => {
    await client.callTool({
      name: 'create_shape',
      arguments: { type: 'FRAME', x: 0, y: 0, width: 100, height: 100, name: 'F1' }
    })
    const result = await client.callTool({ name: 'get_page_tree', arguments: {} })
    expect(result.isError).not.toBe(true)
    const data = parseResult(result) as { children: { name: string }[] }
    expect(data.children.some((c) => c.name === 'F1')).toBe(true)
  })

  test('delete_node removes a node', async () => {
    const create = await client.callTool({
      name: 'create_shape',
      arguments: { type: 'RECTANGLE', x: 0, y: 0, width: 50, height: 50 }
    })
    const { id } = parseResult(create) as { id: string }

    await client.callTool({ name: 'delete_node', arguments: { id } })

    const get = await client.callTool({ name: 'get_node', arguments: { id } })
    const data = parseResult(get) as { error?: string }
    expect(get.isError).toBe(true)
    expect(get.structuredContent).toEqual(data)
    expect(data.error).toContain('not found')
  })

  test('find_nodes filters by type', async () => {
    await client.callTool({
      name: 'create_shape',
      arguments: { type: 'FRAME', x: 0, y: 0, width: 100, height: 100 }
    })
    await client.callTool({
      name: 'create_shape',
      arguments: { type: 'RECTANGLE', x: 0, y: 0, width: 50, height: 50 }
    })
    await client.callTool({
      name: 'create_shape',
      arguments: { type: 'FRAME', x: 0, y: 0, width: 100, height: 100 }
    })
    const result = await client.callTool({ name: 'find_nodes', arguments: { type: 'FRAME' } })
    const data = parseResult(result) as { count: number }
    expect(data.count).toBe(2)
  })

  test('get_codegen_prompt returns prompt text', async () => {
    const result = await client.callTool({ name: 'get_codegen_prompt', arguments: {} })
    expect(result.isError).not.toBe(true)
    const data = parseResult(result) as { prompt: string }
    expect(data.prompt.length).toBeGreaterThan(100)
  })
})

// ---------------------------------------------------------------------------
// mcpRoot tests
// ---------------------------------------------------------------------------

describe('MCP server with mcpRoot', () => {
  async function postRawRPC(httpPort: number, body: Record<string, unknown>) {
    const response = await fetch(`http://127.0.0.1:${httpPort}/rpc`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TEST_AUTH_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })
    const data: unknown = await response.json()
    if (typeof data !== 'object' || data === null) {
      throw new TypeError('Expected RPC response to be a JSON object')
    }
    return {
      status: response.status,
      data: { ok: 'ok' in data && typeof data.ok === 'boolean' ? data.ok : undefined }
    }
  }

  async function withMCPRootServer(
    mcpRoot: string | null,
    fn: (
      client: Client,
      browser: MockBrowser,
      graph: SceneGraph,
      httpPort: number
    ) => Promise<void>,
    browserOptions: MockBrowserOptions = {}
  ) {
    if (isUnix) await mkdir(SOCKET_DIR, { recursive: true })
    if (mcpRoot) await mkdir(mcpRoot, { recursive: true })
    const handle = await startServer({
      httpPort: 0,
      withTcp: true,
      socketPath: testSocketPath(),
      authToken: TEST_AUTH_TOKEN,
      enableEval: false,
      mcpRoot
    })

    let browser: MockBrowser | null = null
    let client: Client | null = null

    try {
      const httpPort = handle.httpPort
      if (!httpPort) throw new Error('withTcp: true did not produce an HTTP port')

      const graph = new SceneGraph()
      browser = await connectMockBrowser(httpPort, graph, TEST_AUTH_TOKEN, browserOptions)
      await waitForBrowserRegistration(httpPort)

      client = new Client({ name: 'test-root', version: '0.0.0' })
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${httpPort}/mcp`),
        { requestInit: { headers: { Authorization: `Bearer ${TEST_AUTH_TOKEN}` } } }
      )
      await client.connect(transport)

      await fn(client, browser, graph, httpPort)
    } finally {
      await client?.close().catch(() => undefined)
      browser?.close()
      await handle.close()
    }
  }

  test('registers open_file and new_document tools when mcpRoot is set', async () => {
    await withMCPRootServer(TEST_MCP_ROOT, async (client) => {
      const { tools } = await client.listTools()
      const names = tools.map((t) => t.name)
      expect(names).toContain('open_file')
      expect(names).toContain('new_document')
    })
  })

  test('save_file accepts an explicit path inside mcpRoot', async () => {
    await withMCPRootServer(TEST_MCP_ROOT, async (client, browser) => {
      await mkdir(join(TEST_MCP_ROOT, 'unicode'), { recursive: true })
      const savePath = join(TEST_MCP_ROOT, 'unicode', 'пример.fig')
      const result = await client.callTool({
        name: 'save_file',
        arguments: { path: savePath }
      })

      expect(result.isError).not.toBe(true)
      const request = browser.requests.find((item) => item.command === 'save_file')
      // The server sends the path canonicalized at its validation boundary.
      // On macOS, /var -> /private/var; later cross-process FS changes remain possible.
      const { realpath } = await import('node:fs/promises')
      const { dirname, basename } = await import('node:path')
      const canonicalPath = join(await realpath(dirname(savePath)), basename(savePath))
      expect(request?.args).toEqual({ path: canonicalPath })
    })
  })

  test('save_file rejects paths outside mcpRoot', async () => {
    await withMCPRootServer(TEST_MCP_ROOT, async (client, browser) => {
      const result = await client.callTool({
        name: 'save_file',
        arguments: { path: join(join(TEST_MCP_ROOT, '..'), 'outside.fig') }
      })

      expect(result.isError).toBe(true)
      expect(browser.requests.some((item) => item.command === 'save_file')).toBe(false)
    })
  })

  test('pathless save_file validates and pins an existing path inside mcpRoot', async () => {
    const documentPath = join(TEST_MCP_ROOT, 'existing.fig')
    let activeDocumentId = 'doc-1'
    await withMCPRootServer(
      TEST_MCP_ROOT,
      async (client, browser) => {
        const result = await client.callTool({ name: 'save_file', arguments: {} })

        expect(result.isError).not.toBe(true)
        expect(activeDocumentId).toBe('doc-2')
        expect(browser.requests.map((request) => request.command)).toContain('list_documents')
        const request = browser.requests.find((item) => item.command === 'save_file')
        const { realpath } = await import('node:fs/promises')
        const canonicalRoot = await realpath(TEST_MCP_ROOT)
        expect(request?.args).toEqual({
          document_id: 'doc-1',
          path: join(canonicalRoot, 'existing.fig')
        })
      },
      {
        documents: () => [
          {
            id: 'doc-1',
            path: documentPath,
            active: activeDocumentId === 'doc-1'
          },
          {
            id: 'doc-2',
            path: join(TEST_MCP_ROOT, 'other.fig'),
            active: activeDocumentId === 'doc-2'
          }
        ],
        afterDocumentList: () => {
          activeDocumentId = 'doc-2'
        }
      }
    )
  })

  test('registered pathless save_file revalidates a reused document ID at the final bridge', async () => {
    let documentListCount = 0
    await withMCPRootServer(
      TEST_MCP_ROOT,
      async (client, browser) => {
        const result = await client.callTool({ name: 'save_file', arguments: {} })

        expect(result.isError).toBe(true)
        expect(
          browser.requests.filter((request) => request.command === 'list_documents')
        ).toHaveLength(2)
        expect(browser.requests.some((request) => request.command === 'save_file')).toBe(false)
      },
      {
        documents: () => [
          {
            id: 'doc-1',
            path: join(
              TEST_MCP_ROOT,
              documentListCount === 0 ? 'old-authority.fig' : 'new-authority.fig'
            ),
            active: true
          }
        ],
        afterDocumentList: () => {
          documentListCount += 1
        }
      }
    )
  })

  test('pathless save_file rejects an existing path outside mcpRoot before writing', async () => {
    const documentPath = join(TEST_MCP_ROOT, '..', 'outside-existing.fig')
    await withMCPRootServer(
      TEST_MCP_ROOT,
      async (client, browser) => {
        const result = await client.callTool({ name: 'save_file', arguments: {} })

        expect(result.isError).toBe(true)
        expect(browser.requests.some((item) => item.command === 'list_documents')).toBe(true)
        expect(browser.requests.some((item) => item.command === 'save_file')).toBe(false)
      },
      { documentPath }
    )
  })

  test('pathless save_file fails closed when the selected document has no local path', async () => {
    await withMCPRootServer(TEST_MCP_ROOT, async (client, browser) => {
      const result = await client.callTool({ name: 'save_file', arguments: {} })

      expect(result.isError).toBe(true)
      expect(browser.requests.some((item) => item.command === 'save_file')).toBe(false)
    })
  })

  test('pathless save_file remains app-managed when mcpRoot is not configured', async () => {
    await withMCPRootServer(null, async (client, browser, _graph, httpPort) => {
      const result = await client.callTool({ name: 'save_file', arguments: {} })
      const raw = await postRawRPC(httpPort, { command: 'save_file', args: {} })
      const injectedMarker = await postRawRPC(httpPort, {
        command: 'save_file',
        args: { __openpencil_expected_existing_path: '/tmp/injected.fig' }
      })

      expect(result.isError).not.toBe(true)
      expect(raw.status).toBe(200)
      expect(injectedMarker.status).toBe(502)
      expect(browser.requests.some((item) => item.command === 'list_documents')).toBe(false)
      expect(browser.requests.filter((item) => item.command === 'save_file')).toHaveLength(2)
      expect(
        browser.requests.filter((item) => item.command === 'save_file').map((item) => item.args)
      ).toEqual([{}, {}])
    })
  })

  test('raw HTTP RPC rejects explicit file paths outside mcpRoot', async () => {
    await withMCPRootServer(TEST_MCP_ROOT, async (_client, browser, _graph, httpPort) => {
      const outsidePath = join(TEST_MCP_ROOT, '..', 'raw-outside.fig')
      for (const command of ['save_file', 'open_file', 'new_document']) {
        const response = await postRawRPC(httpPort, {
          command,
          args: { path: outsidePath }
        })
        expect(response.status).toBe(502)
        expect(response.data.ok).toBe(false)
      }
      const injectedMarker = await postRawRPC(httpPort, {
        command: 'save_file',
        args: { __openpencil_expected_existing_path: join(TEST_MCP_ROOT, 'injected.fig') }
      })
      expect(injectedMarker.status).toBe(502)
      const markerOnUnrelatedCommand = await postRawRPC(httpPort, {
        command: 'get_current_page',
        args: { __openpencil_expected_existing_path: join(TEST_MCP_ROOT, 'injected.fig') }
      })
      expect(markerOnUnrelatedCommand.status).toBe(502)
      expect(
        browser.requests.some((item) =>
          ['save_file', 'open_file', 'new_document'].includes(item.command)
        )
      ).toBe(false)
    })
  })

  test('raw HTTP pathless save_file rejects an existing path outside mcpRoot', async () => {
    await withMCPRootServer(
      TEST_MCP_ROOT,
      async (_client, browser, _graph, httpPort) => {
        const response = await postRawRPC(httpPort, { command: 'save_file', args: {} })

        expect(response.status).toBe(502)
        expect(response.data.ok).toBe(false)
        expect(browser.requests.some((item) => item.command === 'list_documents')).toBe(true)
        expect(browser.requests.some((item) => item.command === 'save_file')).toBe(false)
      },
      { documentPath: join(TEST_MCP_ROOT, '..', 'raw-existing-outside.fig') }
    )
  })

  test.skipIf(!isUnix)('raw HTTP RPC rejects a path through an outward symlink', async () => {
    const outsideDirectory = join(tmpdir(), `open-pencil-mcp-outside-${process.pid}`)
    await mkdir(outsideDirectory, { recursive: true })
    await withMCPRootServer(TEST_MCP_ROOT, async (_client, browser, _graph, httpPort) => {
      const linkPath = join(TEST_MCP_ROOT, `raw-link-${++testCounter}`)
      await symlink(outsideDirectory, linkPath)
      try {
        const response = await postRawRPC(httpPort, {
          command: 'save_file',
          args: { path: join(linkPath, 'escaped.fig') }
        })
        expect(response.status).toBe(502)
        expect(response.data.ok).toBe(false)
        expect(browser.requests.some((item) => item.command === 'save_file')).toBe(false)
      } finally {
        await unlink(linkPath)
      }
    })
  })

  test('authenticated WebSocket RPC rejects save_file outside mcpRoot', async () => {
    await withMCPRootServer(TEST_MCP_ROOT, async (_client, browser, _graph, httpPort) => {
      const forwardingClient = await openWs(`ws://127.0.0.1:${httpPort}`, TEST_AUTH_TOKEN)
      try {
        forwardingClient.send(
          JSON.stringify({
            type: 'request',
            id: 'raw-ws-outside',
            command: 'save_file',
            args: { path: join(TEST_MCP_ROOT, '..', 'ws-outside.fig') }
          })
        )
        const response = await readNextResponse<{ type: string; ok?: boolean; error?: string }>(
          forwardingClient
        )
        expect(response.type).toBe('response')
        expect(response.ok).toBe(false)
        expect(response.error).toContain('outside the allowed root')
        expect(browser.requests.some((item) => item.command === 'save_file')).toBe(false)
      } finally {
        forwardingClient.close()
      }
    })
  })

  test('does not register open_file when mcpRoot is null', async () => {
    await withMCPRootServer(null, async (client) => {
      const { tools } = await client.listTools()
      const names = tools.map((t) => t.name)
      expect(names).not.toContain('open_file')
      expect(names).not.toContain('new_document')
    })
  })
})

// ---------------------------------------------------------------------------
// GAP-01: server.close() resource cleanup
// ---------------------------------------------------------------------------

describe('MCP server lifecycle', () => {
  test('close() removes the discovery file from disk', async () => {
    if (isUnix) await mkdir(SOCKET_DIR, { recursive: true })
    const { getDiscoveryPath } = await import('#mcp/transport/paths')
    const discoveryPath = await getDiscoveryPath()

    const handle = await startServer({
      httpPort: 0,
      withTcp: true,
      socketPath: testSocketPath(),
      authToken: TEST_AUTH_TOKEN,
      enableEval: false,
      mcpRoot: null
    })
    try {
      expect(await Bun.file(discoveryPath).exists()).toBe(true)
    } finally {
      await handle.close()
    }
    expect(await Bun.file(discoveryPath).exists()).toBe(false)
  })

  test('close() removes the unix socket file from disk', async () => {
    if (!isUnix) return
    await mkdir(SOCKET_DIR, { recursive: true })
    const socketPath = testSocketPath()
    expect(socketPath).toBeTruthy()

    const handle = await startServer({
      httpPort: 0,
      withTcp: true,
      socketPath,
      authToken: TEST_AUTH_TOKEN,
      enableEval: false,
      mcpRoot: null
    })
    try {
      const info = await stat(socketPath)
      expect(info.isSocket()).toBe(true)
    } finally {
      await handle.close()
    }
    await expect(stat(socketPath)).rejects.toThrow()
  })

  test('close() removes socket file when no replacement server is listening', async () => {
    if (!isUnix) return
    await mkdir(SOCKET_DIR, { recursive: true })
    const socketPath = testSocketPath()

    const handle1 = await startServer({
      httpPort: 0,
      withTcp: false,
      socketPath,
      authToken: TEST_AUTH_TOKEN,
      enableEval: false,
      mcpRoot: null
    })
    try {
      expect(handle1.socketPath).toBe(socketPath)
    } finally {
      await handle1.close()
    }
    await expect(stat(socketPath)).rejects.toThrow()
  })

  test('close() is idempotent and does not throw on second call', async () => {
    if (isUnix) await mkdir(SOCKET_DIR, { recursive: true })
    const handle = await startServer({
      httpPort: 0,
      withTcp: true,
      socketPath: testSocketPath(),
      authToken: TEST_AUTH_TOKEN,
      enableEval: false,
      mcpRoot: null
    })
    await handle.close()
    await expect(handle.close()).resolves.toBeUndefined()
  })

  test('close() rejects subsequent RPC requests', async () => {
    if (isUnix) await mkdir(SOCKET_DIR, { recursive: true })
    const handle = await startServer({
      httpPort: 0,
      withTcp: true,
      socketPath: testSocketPath(),
      authToken: TEST_AUTH_TOKEN,
      enableEval: false,
      mcpRoot: null
    })
    const httpPort = handle.httpPort
    if (!httpPort) {
      await handle.close()
      throw new Error('withTcp: true did not produce an HTTP port')
    }

    try {
      const healthyResp = await fetch(`http://127.0.0.1:${httpPort}/health`)
      expect(healthyResp.status).toBe(200)
    } finally {
      await handle.close()
    }

    await expect(fetch(`http://127.0.0.1:${httpPort}/health`)).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// GAP-02: concurrent startServer calls produce non-overlapping servers
// ---------------------------------------------------------------------------

describe('MCP server concurrent startServer', () => {
  test('two simultaneous startServer calls each get their own discovery file and both stay up', async () => {
    if (isUnix) await mkdir(SOCKET_DIR, { recursive: true })
    const { getDiscoveryPath } = await import('#mcp/transport/paths')

    // Use unique socket paths so the two servers don't fight over the
    // socket file. The test still covers discovery atomicity by writing
    // to the same shared discovery path.
    const results = await Promise.allSettled([
      startServer({
        httpPort: 0,
        withTcp: true,
        socketPath: testSocketPath(),
        authToken: 'token-a',
        enableEval: false,
        mcpRoot: null
      }),
      startServer({
        httpPort: 0,
        withTcp: true,
        socketPath: testSocketPath(),
        authToken: 'token-b',
        enableEval: false,
        mcpRoot: null
      })
    ])

    const a = results[0].status === 'fulfilled' ? results[0].value : null
    const b = results[1].status === 'fulfilled' ? results[1].value : null

    if (!a || !b) {
      if (a) await a.close()
      if (b) await b.close()
      throw new Error('Multi-server startup failed')
    }

    try {
      // Both servers are listening on their own ephemeral ports.
      expect(a.httpPort).toBeGreaterThan(0)
      expect(b.httpPort).toBeGreaterThan(0)
      expect(a.httpPort).not.toBe(b.httpPort)

      // Each responds on /health with the expected auth state.
      const aHealth = (await (
        await fetch(`http://127.0.0.1:${a.httpPort}/health`)
      ).json()) as HealthResponse
      const bHealth = (await (
        await fetch(`http://127.0.0.1:${b.httpPort}/health`)
      ).json()) as HealthResponse
      expect(aHealth.status).toBe('no_app')
      expect(bHealth.status).toBe('no_app')

      // Discovery file exists and was last written by one of the two servers
      // (atomic rename guarantees it's a complete file, not interleaved).
      const discoveryPath = await getDiscoveryPath()
      const file = Bun.file(discoveryPath)
      expect(await file.exists()).toBe(true)
      const info = (await file.json()) as { pid: number; authToken: string }
      expect(info.pid).toBe(process.pid)
      expect(['token-a', 'token-b']).toContain(info.authToken)
    } finally {
      await a.close()
      await b.close()
    }
  }, 15000)

  test("closing one server does not delete another server's discovery file", async () => {
    if (isUnix) await mkdir(SOCKET_DIR, { recursive: true })
    const { getDiscoveryPath } = await import('#mcp/transport/paths')

    const a = await startServer({
      httpPort: 0,
      withTcp: true,
      socketPath: testSocketPath(),
      authToken: 'token-a',
      enableEval: false,
      mcpRoot: null
    })
    let b: ServerHandle | undefined
    try {
      b = await startServer({
        httpPort: 0,
        withTcp: true,
        socketPath: testSocketPath(),
        authToken: 'token-b',
        enableEval: false,
        mcpRoot: null
      })
    } catch (err) {
      await a.close()
      throw err
    }

    try {
      // Close server a — its discovery cleanup should NOT remove the file
      // because server b still owns it (different auth token).
      await a.close()

      // Server b should still be healthy and reachable.
      const bHealth = (await (
        await fetch(`http://127.0.0.1:${b.httpPort}/health`)
      ).json()) as HealthResponse
      expect(bHealth.status).toBe('no_app')

      // Discovery file should still exist (owned by server b now).
      const discoveryPath = await getDiscoveryPath()
      const file = Bun.file(discoveryPath)
      expect(await file.exists()).toBe(true)
      const info = (await file.json()) as { authToken: string }
      expect(info.authToken).toBe('token-b')
    } finally {
      await b.close()
    }
  }, 15000)
})
