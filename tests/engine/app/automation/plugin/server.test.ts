import { expect, test } from 'bun:test'

import type { PluginManifest } from '@open-pencil/plugin-contracts'

import { DEFAULT_APP_PLUGIN_MCP_OPTIONS } from '@/app/automation/bridge/plugin-mcp-handler'
import { connectAutomation } from '@/app/automation/bridge/server'
import { createEditorStore } from '@/app/editor/session'
import { appPluginAIAuthorization, appPluginStore, appPluginStoreReady } from '@/app/plugins/app'
import { createBundledPluginCatalog } from '@/app/plugins/catalog'
import {
  AIRTABLE_RECORDS_CONNECTOR_ID,
  AIRTABLE_RECORDS_PLUGIN_ID
} from '@/app/plugins/connectors/airtable-records'
import {
  appConnectorAuthorization,
  appConnectorCredentialReadiness,
  refreshAppConnectorCredentialReadiness
} from '@/app/plugins/connectors/app'
import { ACCESSIBILITY_AUDIT_COMMAND, ACCESSIBILITY_AUDIT_PLUGIN_ID } from '@/app/plugins/host/ids'
import { listAppPluginMCPTools } from '@/app/plugins/mcp'
import { createMemoryAppPluginStateStorage } from '@/app/plugins/storage'
import { createAppPluginStore } from '@/app/plugins/store'
import type { InstalledAppPlugin } from '@/app/plugins/types'
import { appCredentialServices } from '@/app/settings/credentials/app'
import { credentialRef } from '@/app/settings/credentials/reference'
import { closeTab, createTab, getActiveTabId, switchTab } from '@/app/tabs'

const TEST_AUTOMATION_URL = 'ws://127.0.0.1:25500'

interface AutomationTestMessage {
  type?: string
  id?: string
  ok?: boolean
  error?: string
}

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

test('automation bridge aborts a bound publisher request when its exact grant is revoked', async () => {
  const fixtureStore = createAppPluginStore({
    storage: createMemoryAppPluginStateStorage(),
    catalog: createBundledPluginCatalog(),
    activationCompatibilityPolicy: () => ({ ok: true }),
    engineVersion: '0.0.0'
  })
  await fixtureStore.load()
  await fixtureStore.install(ACCESSIBILITY_AUDIT_PLUGIN_ID)
  await fixtureStore.setEnabled(ACCESSIBILITY_AUDIT_PLUGIN_ID, true)
  const installed = fixtureStore
    .installedCommands()
    .find(({ plugin }) => plugin.package.manifest.plugin.id === ACCESSIBILITY_AUDIT_PLUGIN_ID)
  if (!installed) throw new Error('Expected accessibility audit command')
  const publisherKeyId = 'automation-test.publisher-key'
  const packageDigest = 'R'.repeat(43)
  const manifest = {
    ...structuredClone(installed.plugin.package.manifest),
    publisher: {
      id: 'automation-test.publisher',
      name: 'Automation Test Publisher',
      keyId: publisherKeyId
    },
    integrity: {
      algorithm: 'SHA-256',
      digest: packageDigest,
      signature: {
        algorithm: 'Ed25519',
        keyId: publisherKeyId,
        value: 'automation-test-signature'
      }
    }
  } as PluginManifest
  const accepted = {
    manifest,
    verifiedDigest: packageDigest,
    verifiedKeyId: publisherKeyId
  }
  const publisherPlugin: InstalledAppPlugin = {
    package: {
      trustSource: 'publisher-signature',
      manifest,
      digest: packageDigest,
      verifiedPackage: accepted
    },
    enabled: true,
    pinnedDigest: null,
    installedState: {
      version: 1,
      enabled: true,
      accepted,
      history: []
    }
  }
  const publisherCommand = { ...installed, plugin: publisherPlugin }
  const originalSnapshot = appPluginStore.snapshot
  const originalInstalledCommands = appPluginStore.installedCommands
  const originalRequireGrant = appPluginAIAuthorization.requireGrant
  const originalWebSocket = globalThis.WebSocket
  const originalAbortController = globalThis.AbortController
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const sent: string[] = []
  const requestControllers: AbortController[] = []
  const previousActiveTabId = getActiveTabId()
  let revokeDuringCall = false
  let connection: ReturnType<typeof connectAutomation> | undefined
  let testTabId: string | undefined

  class RecordingAbortController extends originalAbortController {
    constructor() {
      super()
      requestControllers.push(this)
    }
  }

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

    message(value: unknown): void {
      this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent)
    }
  }

  const request = Object.freeze({
    pluginId: ACCESSIBILITY_AUDIT_PLUGIN_ID,
    kind: 'command' as const,
    contributionId: ACCESSIBILITY_AUDIT_COMMAND.commandId
  })

  try {
    Reflect.set(appPluginStore, 'snapshot', () => {
      const snapshot = originalSnapshot()
      return {
        ...snapshot,
        installed: [
          ...snapshot.installed.filter(
            ({ package: value }) => value.manifest.plugin.id !== ACCESSIBILITY_AUDIT_PLUGIN_ID
          ),
          publisherPlugin
        ]
      }
    })
    Reflect.set(appPluginStore, 'installedCommands', () => [publisherCommand])
    const grant = appPluginAIAuthorization.grant(appPluginAIAuthorization.review(request))
    Reflect.set(
      appPluginAIAuthorization,
      'requireGrant',
      (...args: Parameters<typeof originalRequireGrant>) => {
        const current = originalRequireGrant(...args)
        if (revokeDuringCall && current.grantId === grant.grantId) {
          revokeDuringCall = false
          queueMicrotask(() => appPluginAIAuthorization.revoke(request))
        }
        return current
      }
    )
    Reflect.set(globalThis, 'AbortController', RecordingAbortController)
    Reflect.set(globalThis, 'WebSocket', FakeWebSocket)
    Reflect.set(globalThis, 'window', { openPencil: {} })

    const catalog = listAppPluginMCPTools(appPluginStore, DEFAULT_APP_PLUGIN_MCP_OPTIONS)
    const descriptor = catalog.tools.find(
      ({ pluginId, contributionId }) =>
        pluginId === ACCESSIBILITY_AUDIT_PLUGIN_ID &&
        contributionId === ACCESSIBILITY_AUDIT_COMMAND.commandId
    )
    if (!descriptor) throw new Error('Expected granted Publisher command descriptor')
    const editor = createEditorStore()
    testTabId = createTab(editor).id
    connection = connectAutomation(() => editor, 'publisher-test-token', TEST_AUTOMATION_URL)
    const socket = FakeWebSocket.instances[0]
    if (!socket) throw new Error('Expected automation WebSocket')
    socket.open()
    revokeDuringCall = true
    socket.message({
      type: 'request',
      id: 'publisher-request',
      command: 'plugin_mcp_tool',
      args: {
        name: descriptor.name,
        pluginId: descriptor.pluginId,
        expectedCatalogRevision: catalog.revision,
        expectedDescriptor: {
          name: descriptor.name,
          title: descriptor.title,
          pluginId: descriptor.pluginId,
          kind: descriptor.kind,
          contributionId: descriptor.contributionId,
          authority: descriptor.authority
        },
        args: {}
      }
    })

    let response: AutomationTestMessage | undefined
    for (let index = 0; index < 100 && !response; index += 1) {
      response = sent
        .map((value) => JSON.parse(value) as AutomationTestMessage)
        .find((value) => value.type === 'response' && value.id === 'publisher-request')
      if (!response) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 5)
        })
      }
    }

    expect(response).toMatchObject({
      type: 'response',
      id: 'publisher-request',
      ok: false,
      error: 'Automation request cancelled'
    })
    const revokedController = requestControllers.find(
      ({ signal }) =>
        signal.aborted &&
        signal.reason instanceof Error &&
        signal.reason.message === 'Third-party plugin AI grant was revoked'
    )
    expect(revokedController?.signal.aborted).toBe(true)
    expect(appPluginAIAuthorization.snapshot()).not.toContainEqual(grant)
  } finally {
    connection?.disconnect()
    if (testTabId) await closeTab(testTabId)
    if (previousActiveTabId) switchTab(previousActiveTabId)
    Reflect.set(appPluginAIAuthorization, 'requireGrant', originalRequireGrant)
    appPluginAIAuthorization.revoke(request)
    Reflect.set(appPluginStore, 'snapshot', originalSnapshot)
    Reflect.set(appPluginStore, 'installedCommands', originalInstalledCommands)
    Reflect.set(globalThis, 'AbortController', originalAbortController)
    Reflect.set(globalThis, 'WebSocket', originalWebSocket)
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})
