import { expect, test } from 'bun:test'

import { connectAutomation } from '@/app/automation/bridge/server'
import { createEditorStore } from '@/app/editor/session'
import { appPluginStore, appPluginStoreReady } from '@/app/plugins/app'
import {
  AIRTABLE_RECORDS_CONNECTOR_ID,
  AIRTABLE_RECORDS_PLUGIN_ID
} from '@/app/plugins/connectors/airtable-records'
import { appConnectorAuthorization } from '@/app/plugins/connectors/app'

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

test('automation bridge announces connector tools after authorization and revocation', async () => {
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

  await appPluginStoreReady
  const previousPlugin = appPluginStore
    .snapshot()
    .installed.find(({ package: value }) => value.manifest.plugin.id === AIRTABLE_RECORDS_PLUGIN_ID)
  if (!previousPlugin) {
    await appPluginStore.install(AIRTABLE_RECORDS_PLUGIN_ID)
  }
  await appPluginStore.setEnabled(AIRTABLE_RECORDS_PLUGIN_ID, true)
  const connector = appPluginStore.connector(
    AIRTABLE_RECORDS_PLUGIN_ID,
    AIRTABLE_RECORDS_CONNECTOR_ID
  )
  if (!connector) throw new Error('Expected installed Airtable connector')

  Reflect.set(globalThis, 'WebSocket', FakeWebSocket)
  const editor = createEditorStore()
  const connection = connectAutomation(() => editor, 'connector-test-token')
  try {
    const socket = FakeWebSocket.instances[0]
    if (!socket) throw new Error('Expected automation WebSocket')
    socket.open()
    const initialAnnouncementCount = sent.length

    appConnectorAuthorization.authorize(connector.contribution, connector.plugin.package.digest)
    expect(sent.length).toBe(initialAnnouncementCount + 1)
    expect(JSON.parse(sent.at(-1) ?? '{}')).toMatchObject({
      type: 'plugin_tools_changed',
      revision: expect.stringMatching(/^plugin-mcp-v2-[a-f0-9]{64}$/)
    })

    appConnectorAuthorization.revoke(AIRTABLE_RECORDS_PLUGIN_ID, AIRTABLE_RECORDS_CONNECTOR_ID)
    expect(sent.length).toBe(initialAnnouncementCount + 2)
    expect(JSON.parse(sent.at(-1) ?? '{}')).toMatchObject({
      type: 'plugin_tools_changed',
      revision: expect.stringMatching(/^plugin-mcp-v2-[a-f0-9]{64}$/)
    })
  } finally {
    appConnectorAuthorization.revoke(AIRTABLE_RECORDS_PLUGIN_ID, AIRTABLE_RECORDS_CONNECTOR_ID)
    connection.disconnect()
    Reflect.set(globalThis, 'WebSocket', originalWebSocket)
    if (!previousPlugin) await appPluginStore.uninstall(AIRTABLE_RECORDS_PLUGIN_ID)
    else if (!previousPlugin.enabled) {
      await appPluginStore.setEnabled(AIRTABLE_RECORDS_PLUGIN_ID, false)
    }
  }
})
