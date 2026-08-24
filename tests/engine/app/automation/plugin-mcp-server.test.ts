import { expect, test } from 'bun:test'

import { connectAutomation } from '@/app/automation/bridge/server'
import { createEditorStore } from '@/app/editor/session'
import { appPluginStore, appPluginStoreReady } from '@/app/plugins/app'
import {
  AIRTABLE_RECORDS_CONNECTOR_ID,
  AIRTABLE_RECORDS_PLUGIN_ID
} from '@/app/plugins/connectors/airtable-records'
import {
  appConnectorAuthorization,
  appConnectorCredentialReadiness,
  refreshAppConnectorCredentialReadiness
} from '@/app/plugins/connectors/app'
import { appCredentialServices } from '@/app/settings/credentials/app'
import { credentialRef } from '@/app/settings/credentials/reference'

const TEST_AUTOMATION_URL = 'ws://127.0.0.1:25500'

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
  const connection = connectAutomation(() => editor, 'test-token', TEST_AUTOMATION_URL)
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
  const requiredSlot = connector.contribution.credentialSlots.find((slot) => slot.required)
  if (!requiredSlot) throw new Error('Expected required Airtable credential')
  const reference = credentialRef(AIRTABLE_RECORDS_PLUGIN_ID, requiredSlot.slotId)
  const previousCredential = await appCredentialServices.resolver.resolve(reference)
  await appCredentialServices.manager.set(reference, 'plugin-mcp-server-test-credential')

  Reflect.set(globalThis, 'WebSocket', FakeWebSocket)
  const editor = createEditorStore()
  const connection = connectAutomation(() => editor, 'connector-test-token', TEST_AUTOMATION_URL)
  try {
    const socket = FakeWebSocket.instances[0]
    if (!socket) throw new Error('Expected automation WebSocket')
    socket.open()
    const initialAnnouncementCount = sent.length

    appConnectorAuthorization.authorize(connector.contribution, connector.plugin.package.digest)
    for (let index = 0; index < 100 && sent.length === initialAnnouncementCount; index += 1) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 5)
      })
    }
    expect(sent.length).toBe(initialAnnouncementCount + 1)
    expect(JSON.parse(sent.at(-1) ?? '{}')).toMatchObject({
      type: 'plugin_tools_changed',
      revision: expect.stringMatching(/^plugin-mcp-v2-[a-f0-9]{64}$/)
    })

    await appCredentialServices.manager.clear(reference)
    await refreshAppConnectorCredentialReadiness(appPluginStore.installedConnectors())
    expect(sent.length).toBe(initialAnnouncementCount + 2)

    await appCredentialServices.manager.set(reference, 'replacement-plugin-mcp-test-credential')
    await refreshAppConnectorCredentialReadiness(appPluginStore.installedConnectors())
    expect(sent.length).toBe(initialAnnouncementCount + 3)

    appConnectorAuthorization.revoke(AIRTABLE_RECORDS_PLUGIN_ID, AIRTABLE_RECORDS_CONNECTOR_ID)
    expect(sent.length).toBe(initialAnnouncementCount + 4)
    expect(JSON.parse(sent.at(-1) ?? '{}')).toMatchObject({
      type: 'plugin_tools_changed',
      revision: expect.stringMatching(/^plugin-mcp-v2-[a-f0-9]{64}$/)
    })
  } finally {
    appConnectorAuthorization.revoke(AIRTABLE_RECORDS_PLUGIN_ID, AIRTABLE_RECORDS_CONNECTOR_ID)
    appConnectorCredentialReadiness.clear()
    connection.disconnect()
    Reflect.set(globalThis, 'WebSocket', originalWebSocket)
    if (previousCredential === null) await appCredentialServices.manager.clear(reference)
    else await appCredentialServices.manager.set(reference, previousCredential)
    if (!previousPlugin) await appPluginStore.uninstall(AIRTABLE_RECORDS_PLUGIN_ID)
    else if (!previousPlugin.enabled) {
      await appPluginStore.setEnabled(AIRTABLE_RECORDS_PLUGIN_ID, false)
    }
  }
})
