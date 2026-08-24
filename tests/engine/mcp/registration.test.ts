import { describe, expect, test } from 'bun:test'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { MCPResult } from '#mcp/result'
import { registerTools } from '#mcp/tool/registration'

interface RegisteredDefinition {
  outputSchema?: unknown
}

type RegisteredHandler = (args: Record<string, unknown>) => Promise<MCPResult>

function captureRegistration(sendRPC: () => Promise<unknown>): {
  definitions: Map<string, RegisteredDefinition>
  handlers: Map<string, RegisteredHandler>
} {
  const definitions = new Map<string, RegisteredDefinition>()
  const handlers = new Map<string, RegisteredHandler>()
  const server = Object.create(McpServer.prototype) as McpServer
  Object.defineProperty(server, 'registerTool', {
    value(name: string, definition: RegisteredDefinition, handler: RegisteredHandler): void {
      definitions.set(name, definition)
      handlers.set(name, handler)
    }
  })

  registerTools(server, { policy: { allowEval: false, disabledTools: [] }, sendRPC })
  return { definitions, handlers }
}

describe('MCP tool result registration', () => {
  test('advertises structured output and maps { error } domain results to MCP errors', async () => {
    const { definitions, handlers } = captureRegistration(async () => ({
      ok: true,
      result: { error: 'Node "missing" not found' }
    }))

    expect(definitions.get('get_node')?.outputSchema).toBeDefined()
    const result = await handlers.get('get_node')?.({ id: 'missing' })
    expect(result?.isError).toBe(true)
    expect(result?.structuredContent).toEqual({ error: 'Node "missing" not found' })
  })

  test('maps { ok: false, error } domain results to MCP errors', async () => {
    const { handlers } = captureRegistration(async () => ({
      ok: true,
      result: { ok: false, error: 'Invalid lowcode patch' }
    }))

    const result = await handlers.get('read_lowcode_node')?.({ id: 'missing' })
    expect(result?.isError).toBe(true)
    expect(result?.structuredContent).toEqual({ error: 'Invalid lowcode patch' })
  })

  test('preserves successful domain envelopes as structured content', async () => {
    const success = { ok: true, data: { id: '1:2', updated: ['events'] } }
    const { handlers } = captureRegistration(async () => ({ ok: true, result: success }))

    const result = await handlers.get('read_lowcode_node')?.({ id: '1:2' })
    expect(result?.isError).toBeUndefined()
    expect(result?.structuredContent).toEqual(success)
  })
})
