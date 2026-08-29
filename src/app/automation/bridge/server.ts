/**
 * Browser-side automation handler.
 *
 * Connects to the bridge via WebSocket, receives RPC requests,
 * executes them against the live EditorStore, and sends results back.
 */
import { randomHex } from '@open-pencil/core/random'

import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import { createAutomationCommandHandlers } from '@/app/automation/bridge/handlers'
import { DEFAULT_APP_PLUGIN_MCP_OPTIONS } from '@/app/automation/bridge/plugin-mcp-handler'
import { PluginMCPRequestRevocationRegistry } from '@/app/automation/bridge/plugin-mcp-request-revocation'
import type { EditorStore } from '@/app/editor/active-store'
import { appPluginAIAuthorization, appPluginStore } from '@/app/plugins/app'
import {
  appConnectorAuthorization,
  appConnectorCredentialReadiness,
  refreshAppConnectorCredentialReadiness
} from '@/app/plugins/connectors/app'
import { listAppPluginMCPTools } from '@/app/plugins/mcp'

export function connectAutomation(
  getStore: () => EditorStore,
  authToken: string | null = null,
  automationURL = __OPENPENCIL_LOCAL_AUTOMATION_URL__
) {
  const token = authToken ?? randomHex(32)
  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let intentionalDisconnect = false
  let lastPluginToolsRevision: string | null = null
  const activeRequests = new PluginMCPRequestRevocationRegistry()

  const { handleRequest: handleAutomationRequest } =
    createAutomationCommandHandlers(makeFigmaFromStore)

  function announcePluginTools(socket: WebSocket): void {
    if (socket !== ws || socket.readyState !== WebSocket.OPEN) return
    try {
      const revision = listAppPluginMCPTools(
        appPluginStore,
        DEFAULT_APP_PLUGIN_MCP_OPTIONS
      ).revision
      if (revision === lastPluginToolsRevision) return
      lastPluginToolsRevision = revision
      socket.send(JSON.stringify({ type: 'plugin_tools_changed', revision }))
    } catch (error) {
      console.warn(
        '[Automation] Failed to announce plugin MCP tools:',
        error instanceof Error ? error.message : error
      )
    }
  }

  function refreshConnectorCredentialStatuses(): void {
    void refreshAppConnectorCredentialReadiness(appPluginStore.installedConnectors()).catch(
      (error) => {
        console.warn(
          '[Automation] Failed to refresh connector credential status:',
          error instanceof Error ? error.message : error
        )
      }
    )
  }

  const unsubscribePluginTools = appPluginStore.subscribe(() => {
    refreshConnectorCredentialStatuses()
    const socket = ws
    if (socket) announcePluginTools(socket)
  })
  const unsubscribeConnectorTools = appConnectorAuthorization.subscribe(() => {
    refreshConnectorCredentialStatuses()
    const socket = ws
    if (socket) announcePluginTools(socket)
  })
  const unsubscribeConnectorCredentialReadiness = appConnectorCredentialReadiness.subscribe(() => {
    const socket = ws
    if (socket) announcePluginTools(socket)
  })
  const unsubscribePluginAIAuthorization = appPluginAIAuthorization.subscribe((grants) => {
    activeRequests.reconcilePublisherGrants(grants)
    const socket = ws
    if (socket) announcePluginTools(socket)
  })

  async function handleRequest(
    id: string,
    command: string,
    args: unknown,
    socket: WebSocket
  ): Promise<unknown> {
    const controller = activeRequests.start(id)
    try {
      const result = await handleAutomationRequest(getStore(), command, args, {
        signal: controller.signal,
        onPluginMCPResolved(descriptor, publisherGrantId) {
          activeRequests.bind(id, controller, descriptor, publisherGrantId)
        },
        onProgress(progress) {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'progress', id, progress }))
          }
        }
      })
      // Plugin MCP handlers own their completion boundary. In particular, an
      // exporter checks cancellation immediately before its atomic/durable
      // commit; checking again here could report failure after the file was
      // already committed. Other automation commands keep the generic guard.
      if (command !== 'plugin_mcp_tool') controller.signal.throwIfAborted()
      return result
    } finally {
      activeRequests.finish(id, controller)
    }
  }

  function connect() {
    let socket: WebSocket
    try {
      socket = new WebSocket(automationURL)
      ws = socket
    } catch (e) {
      console.error(
        '[Automation] WebSocket constructor failed:',
        e instanceof Error ? e.message : e
      )
      scheduleReconnect()
      return
    }

    socket.onopen = () => {
      console.debug('[Automation] WebSocket connected to MCP server')
      socket.send(JSON.stringify({ type: 'register', token }))
      lastPluginToolsRevision = null
      announcePluginTools(socket)
      refreshConnectorCredentialStatuses()
    }

    socket.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data) as {
          type: string
          id: string
          command: string
          args?: unknown
        }
        if (!msg.id) return
        if (msg.type === 'cancel') {
          activeRequests.cancel(msg.id)
          return
        }
        if (msg.type !== 'request') return
        try {
          const result = await handleRequest(msg.id, msg.command, msg.args, socket)
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'response', id: msg.id, ...(result as object) }))
          }
        } catch (e) {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(
              JSON.stringify({
                type: 'response',
                id: msg.id,
                ok: false,
                error: e instanceof Error ? e.message : String(e)
              })
            )
          }
        }
      } catch (e) {
        console.warn('Failed to parse WebSocket message:', e)
      }
    }

    socket.onclose = (event) => {
      if (ws === socket) {
        ws = null
        lastPluginToolsRevision = null
      }
      activeRequests.abortAll()
      if (intentionalDisconnect || event.code === 1000) return
      console.warn('[Automation] WebSocket closed:', `code=${event.code} reason=${event.reason}`)
      scheduleReconnect()
    }

    socket.onerror = (event) => {
      console.warn('[Automation] WebSocket error:', event)
      socket.close()
    }
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(connect, 2000)
  }

  function disconnect() {
    intentionalDisconnect = true
    clearTimeout(reconnectTimer)
    unsubscribePluginTools()
    unsubscribeConnectorTools()
    unsubscribeConnectorCredentialReadiness()
    unsubscribePluginAIAuthorization()
    activeRequests.abortAll()
    ws?.close()
    ws = null
  }

  connect()
  return { disconnect, token }
}
