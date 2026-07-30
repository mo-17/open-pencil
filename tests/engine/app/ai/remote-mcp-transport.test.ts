import { describe, expect, test } from 'bun:test'

import {
  createSdkRemoteMcpClient,
  MAX_REMOTE_MCP_TRANSPORT_RESPONSE_BYTES
} from '@/app/ai/mcp/runtime'
import type { RemoteMcpServer } from '@/app/ai/mcp/types'

const SERVER: RemoteMcpServer = {
  id: 'mcp-0123456789abcdef',
  name: 'Transport bounds',
  transport: { type: 'streamable-http', url: 'https://mcp.example.com/tools' },
  auth: { type: 'none' }
}

async function expectOversizedResponse(fetchImpl: typeof fetch): Promise<void> {
  const client = createSdkRemoteMcpClient({ server: SERVER, bearerToken: null }, fetchImpl)
  try {
    await expect(client.connect(new AbortController().signal)).rejects.toThrow(
      `exceeds ${MAX_REMOTE_MCP_TRANSPORT_RESPONSE_BYTES} bytes`
    )
  } finally {
    await client.close()
  }
}

describe('remote MCP transport bounds', () => {
  test('rejects oversized Content-Length before SDK parsing', async () => {
    await expectOversizedResponse((() =>
      Promise.resolve(
        new Response('not valid MCP JSON', {
          headers: {
            'content-length': String(MAX_REMOTE_MCP_TRANSPORT_RESPONSE_BYTES + 1),
            'content-type': 'application/json'
          }
        })
      )) as typeof fetch)
  })

  test('counts streamed bytes when Content-Length is absent', async () => {
    await expectOversizedResponse((() =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(MAX_REMOTE_MCP_TRANSPORT_RESPONSE_BYTES + 1))
              controller.close()
            }
          }),
          { headers: { 'content-type': 'application/json' } }
        )
      )) as typeof fetch)
  })
})
