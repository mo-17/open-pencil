import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { dynamicTool, jsonSchema } from 'ai'
import type { ToolSet } from 'ai'

import { resolveRemoteMcpBearerToken } from '@/app/ai/mcp/credentials'
import { remoteMcpSettings } from '@/app/ai/mcp/store'
import {
  MAX_REMOTE_MCP_SERVERS_PER_MODEL,
  type RemoteMcpServer,
  type RemoteMcpServerId
} from '@/app/ai/mcp/types'
import { settleRuntimeDisposals } from '@/app/ai/runtime-disposal'

export const MAX_REMOTE_MCP_TOOLS_PER_SERVER = 64
export const MAX_REMOTE_MCP_TOOLS_TOTAL = 128
export const MAX_REMOTE_MCP_TOOL_PAGES = 16
export const MAX_REMOTE_MCP_TOOL_NAME_LENGTH = 64
export const MAX_REMOTE_MCP_TOOL_DESCRIPTION_LENGTH = 4_096
export const MAX_REMOTE_MCP_TOOL_DEFINITIONS_BYTES = 256 * 1024
export const MAX_REMOTE_MCP_TOOL_RESULT_BYTES = 512 * 1024
export const MAX_REMOTE_MCP_TRANSPORT_RESPONSE_BYTES = 1024 * 1024
export const REMOTE_MCP_CONNECT_TIMEOUT_MS = 10_000
export const REMOTE_MCP_LIST_TOOLS_TIMEOUT_MS = 10_000
export const REMOTE_MCP_DISCOVERY_TIMEOUT_MS = 30_000
export const REMOTE_MCP_INITIALIZATION_TIMEOUT_MS = 60_000
export const REMOTE_MCP_TOOL_CALL_TIMEOUT_MS = 60_000
export const REMOTE_MCP_CLOSE_TIMEOUT_MS = 5_000

type SdkListToolsResult = Awaited<ReturnType<Client['listTools']>>
type SdkToolDefinition = SdkListToolsResult['tools'][number]

export interface RemoteMcpClient {
  connect(signal: AbortSignal): Promise<void>
  listTools(cursor: string | undefined, signal: AbortSignal): Promise<SdkListToolsResult>
  callTool(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>
  close(): Promise<void>
}

export type RemoteMcpClientFactoryOptions = {
  server: RemoteMcpServer
  bearerToken: string | null
}

export type RemoteMcpRuntimeDependencies = {
  servers?: readonly RemoteMcpServer[]
  signal?: AbortSignal
  resolveBearerToken?: (server: RemoteMcpServer) => Promise<string | null>
  createClient?: (options: RemoteMcpClientFactoryOptions) => RemoteMcpClient
}

export type RemoteMcpRuntime = {
  tools: ToolSet
  dispose(): Promise<void>
}

type RemoteMcpToolArguments = Record<string, unknown>

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function signalError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted', 'AbortError')
}

function runWithTimeout<T>(
  label: string,
  timeoutMs: number,
  outerSignal: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController()
    let settled = false
    const cleanup = () => {
      clearTimeout(timer)
      outerSignal?.removeEventListener('abort', onOuterAbort)
    }
    const finish = (action: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      action()
    }
    const onOuterAbort = () => {
      const error = outerSignal
        ? signalError(outerSignal)
        : new DOMException('Aborted', 'AbortError')
      controller.abort(error)
      finish(() => reject(error))
    }
    const timer = setTimeout(() => {
      const error = new Error(`${label} timed out after ${timeoutMs}ms`)
      controller.abort(error)
      finish(() => reject(error))
    }, timeoutMs)

    if (outerSignal?.aborted) {
      onOuterAbort()
      return
    }
    outerSignal?.addEventListener('abort', onOuterAbort, { once: true })
    void Promise.resolve()
      .then(() => operation(controller.signal))
      .then(
        (value) => finish(() => resolve(value)),
        (error: unknown) =>
          finish(() => reject(error instanceof Error ? error : new Error(String(error))))
      )
  })
}

function transportResponseTooLargeError(): Error {
  return new Error(
    `Remote MCP transport response exceeds ${MAX_REMOTE_MCP_TRANSPORT_RESPONSE_BYTES} bytes`
  )
}

async function cancelResponseBody(response: Response, reason: unknown): Promise<void> {
  await response.body?.cancel(reason).catch(() => undefined)
}

function parseContentLength(response: Response): number | null {
  const value = response.headers.get('content-length')
  if (!value || !/^\d+$/.test(value)) return null
  const length = Number(value)
  return Number.isSafeInteger(length) ? length : Number.POSITIVE_INFINITY
}

function withBoundedResponseBody(response: Response): Response {
  if (!response.body) return response
  const reader = response.body.getReader()
  let receivedBytes = 0
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read()
        if (next.done) {
          controller.close()
          return
        }
        receivedBytes += next.value.byteLength
        if (receivedBytes > MAX_REMOTE_MCP_TRANSPORT_RESPONSE_BYTES) {
          const error = transportResponseTooLargeError()
          await reader.cancel(error).catch(() => undefined)
          controller.error(error)
          return
        }
        controller.enqueue(next.value)
      } catch (error) {
        controller.error(error)
      }
    },
    cancel: (reason) => reader.cancel(reason)
  })
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  })
}

function createRemoteMcpFetch(fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    const response = await fetchImpl(input, { ...init, redirect: 'error' })
    const contentLength = parseContentLength(response)
    if (contentLength !== null && contentLength > MAX_REMOTE_MCP_TRANSPORT_RESPONSE_BYTES) {
      const error = transportResponseTooLargeError()
      await cancelResponseBody(response, error)
      throw error
    }
    return withBoundedResponseBody(response)
  }
}

export function createSdkRemoteMcpClient(
  { server, bearerToken }: RemoteMcpClientFactoryOptions,
  fetchImpl: typeof fetch = globalThis.fetch
): RemoteMcpClient {
  const headers = new Headers()
  if (bearerToken) headers.set('Authorization', `Bearer ${bearerToken}`)
  const transport = new StreamableHTTPClientTransport(new URL(server.transport.url), {
    requestInit: { headers, redirect: 'error' },
    fetch: createRemoteMcpFetch(fetchImpl),
    reconnectionOptions: {
      initialReconnectionDelay: 1_000,
      maxReconnectionDelay: 5_000,
      reconnectionDelayGrowFactor: 2,
      maxRetries: 1
    }
  })
  const client = new Client({ name: 'open-pencil', version: '1' }, { capabilities: {} })

  return {
    connect: (signal) =>
      client.connect(transport, { signal, timeout: REMOTE_MCP_CONNECT_TIMEOUT_MS }),
    listTools: (cursor, signal) =>
      client.listTools(cursor ? { cursor } : undefined, {
        signal,
        timeout: REMOTE_MCP_LIST_TOOLS_TIMEOUT_MS
      }),
    callTool: (name, args, signal) =>
      client.callTool({ name, arguments: args }, undefined, {
        signal,
        timeout: REMOTE_MCP_TOOL_CALL_TIMEOUT_MS,
        maxTotalTimeout: REMOTE_MCP_TOOL_CALL_TIMEOUT_MS
      }),
    close: () => client.close()
  }
}

function serializedBytes(value: unknown, label: string): number {
  let serialized: unknown
  try {
    serialized = JSON.stringify(value)
  } catch (error) {
    throw new Error(`${label} is not JSON serializable`, { cause: error })
  }
  if (typeof serialized !== 'string') throw new Error(`${label} is not JSON serializable`)
  return new TextEncoder().encode(serialized).byteLength
}

function assertBoundedToolResult(server: RemoteMcpServer, toolName: string, result: unknown): void {
  if (
    serializedBytes(result, `Remote MCP tool result for ${toolName}`) >
    MAX_REMOTE_MCP_TOOL_RESULT_BYTES
  ) {
    throw new Error(
      `Remote MCP tool "${toolName}" from "${server.name}" returned more than ${MAX_REMOTE_MCP_TOOL_RESULT_BYTES} bytes`
    )
  }
}

function safeRemoteToolSegment(remoteName: string): string {
  return remoteName
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[-_]+|[-_]+$/g, '')
}

function isRemoteMcpToolArguments(value: unknown): value is RemoteMcpToolArguments {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function namespacedRemoteMcpToolName(
  serverId: RemoteMcpServerId,
  remoteName: string
): string {
  const prefix = `mcp__${serverId}__`
  const available = MAX_REMOTE_MCP_TOOL_NAME_LENGTH - prefix.length
  const safeName = safeRemoteToolSegment(remoteName).slice(0, Math.max(0, available))
  if (!safeName) {
    throw new Error(`Remote MCP tool name "${remoteName}" cannot be normalized safely`)
  }
  return `${prefix}${safeName}`
}

function toolSchema(definition: SdkToolDefinition): Parameters<typeof jsonSchema>[0] {
  return definition.inputSchema as Parameters<typeof jsonSchema>[0]
}

async function discoverTools(
  client: RemoteMcpClient,
  server: RemoteMcpServer,
  signal: AbortSignal | undefined
): Promise<SdkToolDefinition[]> {
  const definitions: SdkToolDefinition[] = []
  const seenCursors = new Set<string>()
  let cursor: string | undefined
  let definitionBytes = 0
  let pageCount = 0

  do {
    pageCount += 1
    if (pageCount > MAX_REMOTE_MCP_TOOL_PAGES) {
      throw new Error(
        `Remote MCP server "${server.name}" exposes more than ${MAX_REMOTE_MCP_TOOL_PAGES} tool pages`
      )
    }
    const requestCursor = cursor
    const page = await runWithTimeout(
      `Listing tools from remote MCP server "${server.name}"`,
      REMOTE_MCP_LIST_TOOLS_TIMEOUT_MS,
      signal,
      (requestSignal) => client.listTools(requestCursor, requestSignal)
    )
    for (const definition of page.tools) {
      definitions.push(definition)
      if (definitions.length > MAX_REMOTE_MCP_TOOLS_PER_SERVER) {
        throw new Error(
          `Remote MCP server "${server.name}" exposes more than ${MAX_REMOTE_MCP_TOOLS_PER_SERVER} tools`
        )
      }
      definitionBytes += serializedBytes(definition, `Tool definition ${definition.name}`)
      if (definitionBytes > MAX_REMOTE_MCP_TOOL_DEFINITIONS_BYTES) {
        throw new Error(
          `Remote MCP server "${server.name}" tool definitions exceed ${MAX_REMOTE_MCP_TOOL_DEFINITIONS_BYTES} bytes`
        )
      }
    }
    cursor = page.nextCursor
    if (cursor) {
      if (seenCursors.has(cursor)) {
        throw new Error(`Remote MCP server "${server.name}" repeated a tools cursor`)
      }
      seenCursors.add(cursor)
    }
  } while (cursor)

  return definitions
}

function createTool(
  client: RemoteMcpClient,
  server: RemoteMcpServer,
  definition: SdkToolDefinition,
  disposed: () => boolean
) {
  return dynamicTool({
    title: definition.title ?? definition.annotations?.title ?? definition.name,
    description: definition.description?.slice(0, MAX_REMOTE_MCP_TOOL_DESCRIPTION_LENGTH),
    inputSchema: jsonSchema(toolSchema(definition)),
    needsApproval: true,
    execute: async (input, options) => {
      if (disposed()) throw new Error(`Remote MCP server "${server.name}" is closed`)
      if (!isRemoteMcpToolArguments(input)) {
        throw new Error(`Remote MCP tool "${definition.name}" requires an object input`)
      }
      const result = await runWithTimeout(
        `Remote MCP tool "${definition.name}"`,
        REMOTE_MCP_TOOL_CALL_TIMEOUT_MS,
        options.abortSignal,
        (signal) => client.callTool(definition.name, input, signal)
      )
      assertBoundedToolResult(server, definition.name, result)
      return result
    }
  })
}

export function selectRemoteMcpServers(
  serverIds: readonly string[],
  configuredServers: readonly RemoteMcpServer[]
): RemoteMcpServer[] {
  const uniqueIds = [...new Set(serverIds)]
  if (uniqueIds.length > MAX_REMOTE_MCP_SERVERS_PER_MODEL) {
    throw new Error(
      `A model can use at most ${MAX_REMOTE_MCP_SERVERS_PER_MODEL} remote MCP servers`
    )
  }
  const byId = new Map(configuredServers.map((server) => [server.id, server] as const))
  return uniqueIds.map((id) => {
    const server = byId.get(id as RemoteMcpServerId)
    if (!server) throw new Error(`Unknown remote MCP server selected by model: ${id}`)
    return server
  })
}

function createDisposer(clients: RemoteMcpClient[], markDisposed: () => void): () => Promise<void> {
  let promise: Promise<void> | undefined
  return () => {
    if (promise) return promise
    markDisposed()
    promise = settleRuntimeDisposals(
      clients.map(
        (client) => () =>
          runWithTimeout('Closing remote MCP client', REMOTE_MCP_CLOSE_TIMEOUT_MS, undefined, () =>
            client.close()
          )
      ),
      'Failed to close remote MCP clients'
    )
    return promise
  }
}

export async function createRemoteMcpRuntime(
  serverIds: readonly string[],
  dependencies: RemoteMcpRuntimeDependencies = {}
): Promise<RemoteMcpRuntime> {
  const servers = selectRemoteMcpServers(
    serverIds,
    dependencies.servers ?? remoteMcpSettings.value.servers
  )
  const resolveBearerToken = dependencies.resolveBearerToken ?? resolveRemoteMcpBearerToken
  const createClient = dependencies.createClient ?? createSdkRemoteMcpClient
  const clients: RemoteMcpClient[] = []
  const tools: ToolSet = {}
  let disposed = false
  const isDisposed = () => disposed
  const dispose = createDisposer(clients, () => {
    disposed = true
  })

  try {
    await runWithTimeout(
      'Initializing remote MCP runtime',
      REMOTE_MCP_INITIALIZATION_TIMEOUT_MS,
      dependencies.signal,
      async (initializationSignal) => {
        for (const server of servers) {
          const bearerToken = await resolveBearerToken(server)
          if (initializationSignal.aborted) throw signalError(initializationSignal)
          if (server.auth.type === 'bearer' && !bearerToken) {
            throw new Error(
              `Bearer credential is unavailable for remote MCP server "${server.name}"`
            )
          }
          const client = createClient({ server, bearerToken })
          clients.push(client)
          await runWithTimeout(
            `Connecting to remote MCP server "${server.name}"`,
            REMOTE_MCP_CONNECT_TIMEOUT_MS,
            initializationSignal,
            (signal) => client.connect(signal)
          )
          const definitions = await runWithTimeout(
            `Discovering tools from remote MCP server "${server.name}"`,
            REMOTE_MCP_DISCOVERY_TIMEOUT_MS,
            initializationSignal,
            (signal) => discoverTools(client, server, signal)
          )
          if (Object.keys(tools).length + definitions.length > MAX_REMOTE_MCP_TOOLS_TOTAL) {
            throw new Error(
              `Selected remote MCP servers expose more than ${MAX_REMOTE_MCP_TOOLS_TOTAL} tools`
            )
          }
          for (const definition of definitions) {
            const name = namespacedRemoteMcpToolName(server.id, definition.name)
            if (name in tools) {
              throw new Error(
                `Remote MCP tool name collision after normalization: "${definition.name}" on "${server.name}"`
              )
            }
            tools[name] = createTool(client, server, definition, isDisposed)
          }
        }
      }
    )
    return { tools, dispose }
  } catch (error) {
    let cause: unknown = error
    try {
      await dispose()
    } catch (cleanupError) {
      cause = new AggregateError(
        [error, cleanupError],
        'Remote MCP runtime initialization failed and cleanup was incomplete'
      )
    }
    throw new Error(`Remote MCP runtime initialization failed: ${errorMessage(error)}`, {
      cause
    })
  }
}

export function mergeRemoteMcpTools(baseTools: ToolSet, remoteTools: ToolSet): ToolSet {
  const conflicts = Object.keys(remoteTools).filter((name) => name in baseTools)
  if (conflicts.length > 0) {
    throw new Error(`Remote MCP tool name conflicts with an existing tool: ${conflicts.join(', ')}`)
  }
  return { ...baseTools, ...remoteTools }
}
