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

export function connectAutomation(getStore: () => EditorStore, authToken: string | null = null) {
  const token = authToken ?? randomHex(32)
  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let intentionalDisconnect = false
  const activeRequests = new Map<string, AbortController>()

  const { handleRequest: handleAutomationRequest } =
    createAutomationCommandHandlers(makeFigmaFromStore)

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
      return await handleAutomationRequest(getStore(), command, args, {
        signal: controller.signal,
        onProgress(progress) {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'progress', id, progress }))
          }
        }
      })
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
          socket.send(JSON.stringify({ type: 'response', id: msg.id, ...(result as object) }))
        } catch (e) {
          socket.send(
            JSON.stringify({
              type: 'response',
              id: msg.id,
              ok: false,
              error: e instanceof Error ? e.message : String(e)
            })
          )
        }
      } catch (e) {
        console.warn('Failed to parse WebSocket message:', e)
      }
    }

    socket.onclose = (event) => {
      if (ws === socket) ws = null
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
    for (const controller of activeRequests.values()) controller.abort()
    activeRequests.clear()
    ws?.close()
    ws = null
  }

  connect()
  return { disconnect, token }
}
