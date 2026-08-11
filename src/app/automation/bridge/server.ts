/**
 * Browser-side automation handler.
 *
 * Connects to the bridge via WebSocket, receives RPC requests,
 * executes them against the live EditorStore, and sends results back.
 */
import { AUTOMATION_HTTP_PORT } from '@open-pencil/core/constants'
import { randomHex } from '@open-pencil/core/random'

import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import { createAutomationCommandHandlers } from '@/app/automation/bridge/handlers'
import type { EditorStore } from '@/app/editor/active-store'
import { appPluginStore } from '@/app/plugins/app'
import {
  appConnectorAuthorization,
  appConnectorCredentialReadiness,
  isAppConnectorMcpExposed,
  refreshAppConnectorCredentialReadiness
} from '@/app/plugins/connectors/app'
import { listAppPluginMcpTools } from '@/app/plugins/mcp'

const PLUGIN_MCP_OPTIONS = Object.freeze({
  connectorExposure: isAppConnectorMcpExposed,
  connectorNonGetReadOnlyExposure: isAppConnectorMcpExposed
})

export function connectAutomation(getStore: () => EditorStore, authToken: string | null = null) {
  const token = authToken ?? randomHex(32)
  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let intentionalDisconnect = false
  let lastPluginToolsRevision: string | null = null
  const activeRequests = new Map<string, AbortController>()

  const { handleRequest: handleAutomationRequest } =
    createAutomationCommandHandlers(makeFigmaFromStore)

  function announcePluginTools(socket: WebSocket): void {
    if (socket !== ws || socket.readyState !== WebSocket.OPEN) return
    try {
      const revision = listAppPluginMcpTools(appPluginStore, PLUGIN_MCP_OPTIONS).revision
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

  async function handleRequest(
    id: string,
    command: string,
    args: unknown,
    socket: WebSocket
  ): Promise<unknown> {
    activeRequests.get(id)?.abort()
    const controller = new AbortController()
    activeRequests.set(id, controller)
    try {
      const result = await handleAutomationRequest(getStore(), command, args, {
        signal: controller.signal,
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
      if (activeRequests.get(id) === controller) activeRequests.delete(id)
    }
  }

  function connect() {
    let socket: WebSocket
    try {
      socket = new WebSocket(`ws://127.0.0.1:${AUTOMATION_HTTP_PORT}`)
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
          activeRequests.get(msg.id)?.abort()
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
      for (const controller of activeRequests.values()) controller.abort()
      activeRequests.clear()
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
    for (const controller of activeRequests.values()) controller.abort()
    activeRequests.clear()
    ws?.close()
    ws = null
  }

  connect()
  return { disconnect, token }
}
