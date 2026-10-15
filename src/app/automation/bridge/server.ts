/**
 * Browser-side automation handler.
 *
 * Connects to the bridge via WebSocket, receives RPC requests,
 * executes them against the live EditorStore, and sends results back.
 */
import * as v from 'valibot'

import { randomHex } from '@open-pencil/scene-graph/random'

import { endAgentSession, readAgentSession } from '@/app/automation/agents'
import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import { createAutomationCommandHandlers } from '@/app/automation/bridge/handlers'
import { DEFAULT_APP_PLUGIN_MCP_OPTIONS } from '@/app/automation/bridge/plugin-mcp-handler'
import { PluginMCPRequestRevocationRegistry } from '@/app/automation/bridge/plugin-mcp-request-revocation'
import { isUnknownRecord } from '@/app/automation/bridge/target'
import type { EditorStore } from '@/app/editor/active-store'
import { appPluginAIAuthorization, appPluginStore } from '@/app/plugins/app'
import {
  appConnectorAuthorization,
  appConnectorCredentialReadiness,
  refreshAppConnectorCredentialReadiness
} from '@/app/plugins/connectors/app'
import { listAppPluginMCPTools } from '@/app/plugins/mcp'

/** Requests from the MCP bridge; other message types (such as the register prompt) are ignored. */
const AutomationRequestJSON = v.pipe(
  v.string(),
  v.parseJson(),
  v.union([
    v.object({
      type: v.literal('request'),
      id: v.pipe(v.string(), v.nonEmpty()),
      command: v.string(),
      args: v.optional(v.unknown())
    }),
    v.object({ type: v.literal('cancel'), id: v.pipe(v.string(), v.nonEmpty()) })
  ])
)

/**
 * The connections each MCP session's calls came over, across bridges: restarting MCP opens a new
 * bridge while the old socket is still closing, and that close must not end a session the new
 * connection carries, so a session ends only with its last connection.
 */
const sessionSockets = new Map<string, Set<WebSocket>>()

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
        const parsed = v.safeParse(AutomationRequestJSON, event.data)
        if (!parsed.success) {
          if (parsed.issues.some((issue) => issue.type === 'parse_json'))
            console.warn('Failed to parse WebSocket message:', v.summarize(parsed.issues))
          return
        }
        const msg = parsed.output
        if (msg.type === 'cancel') {
          activeRequests.cancel(msg.id)
          return
        }
        const session = isUnknownRecord(msg.args) ? readAgentSession(msg.args.agent) : null
        if (session) {
          const sockets = sessionSockets.get(session.session) ?? new Set<WebSocket>()
          sockets.add(socket)
          sessionSockets.set(session.session, sockets)
        }
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
      for (const [id, sockets] of sessionSockets) {
        if (!sockets.delete(socket) || sockets.size > 0) continue
        sessionSockets.delete(id)
        endAgentSession(id)
      }
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
