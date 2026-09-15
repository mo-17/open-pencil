import { describe, expect, test } from 'bun:test'
import { tmpdir } from 'node:os'

import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { McpServer } from '@modelcontextprotocol/server'

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
  test('validates native tool inputs and carries SDK v2 progress and cancellation over the protocol', async () => {
    const server = new McpServer({ name: 'request-context-test', version: '1' })
    const client = new Client({ name: 'request-context-client', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const started = Promise.withResolvers<undefined>()
    const cancelled = Promise.withResolvers<undefined>()
    let calls = 0
    registerTools(server, {
      policy: { allowEval: false, disabledTools: [] },
      mcpRoot: tmpdir(),
      async sendRPC(_request, context) {
        calls++
        context?.onProgress?.({ phase: 'rendering', completed: 1, total: 2 })
        started.resolve(undefined)
        return new Promise((_resolve, reject) => {
          context?.signal?.addEventListener(
            'abort',
            () => {
              cancelled.resolve(undefined)
              reject(new DOMException('Request cancelled', 'AbortError'))
            },
            { once: true }
          )
        })
      }
    })
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
      const invalid = await client.callTool({ name: 'get_node', arguments: {} })
      expect(invalid.isError).toBe(true)
      expect(calls).toBe(0)
      const controller = new AbortController()
      const progress: number[] = []
      const request = client.callTool(
        {
          name: 'export_motion_animation',
          arguments: { format: 'png-sequence', path: 'cancelled-before-write' }
        },
        {
          signal: controller.signal,
          onprogress: (value) => {
            progress.push(value.progress)
          }
        }
      )
      const outcome = request.catch((error: unknown) => error)
      await started.promise
      controller.abort(new Error('Stop protocol test'))
      await outcome
      await cancelled.promise
      expect(calls).toBe(1)
      expect(progress).toEqual([1])
    } finally {
      await client.close()
      await server.close()
    }
  })

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
