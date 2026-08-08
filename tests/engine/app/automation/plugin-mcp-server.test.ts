import { expect, test } from 'bun:test'

import { connectAutomation } from '@/app/automation/bridge/server'
import { createEditorStore } from '@/app/editor/session'

test('automation bridge announces the current dynamic plugin tool revision after registration', () => {
  const originalWebSocket = globalThis.WebSocket
  const sent: string[] = []

  class FakeWebSocket {
    static readonly OPEN = 1
    static readonly instances: FakeWebSocket[] = []
    readonly readyState = FakeWebSocket.OPEN
    onopen: ((event: Event) => void) | null = null
    onmessage: ((event: MessageEvent) => void) | null = null
    onclose: ((event: CloseEvent) => void) | null = null
    onerror: ((event: Event) => void) | null = null

    constructor(_url: string) {
      FakeWebSocket.instances.push(this)
    }

    send(value: string): void {
      sent.push(value)
    }

    close(): void {
      this.onclose?.({ code: 1000, reason: '' } as CloseEvent)
    }

    open(): void {
      this.onopen?.(new Event('open'))
    }
  }

  Reflect.set(globalThis, 'WebSocket', FakeWebSocket)
  const editor = createEditorStore()
  const connection = connectAutomation(() => editor, 'test-token')
  try {
    const socket = FakeWebSocket.instances[0]
    if (!socket) throw new Error('Expected automation WebSocket')
    socket.open()
    expect(JSON.parse(sent[0])).toEqual({ type: 'register', token: 'test-token' })
    expect(JSON.parse(sent[1])).toMatchObject({
      type: 'plugin_tools_changed',
      revision: expect.stringMatching(/^plugin-mcp-v2-[a-f0-9]{64}$/)
    })
  } finally {
    connection.disconnect()
    Reflect.set(globalThis, 'WebSocket', originalWebSocket)
  }
})
