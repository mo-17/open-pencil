import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import type {
  Agent,
  Client,
  McpServerStdio,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionConfigOption,
  SessionNotification,
  SetSessionConfigOptionRequest
} from '@agentclientprotocol/sdk'
import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'

import { AUTOMATION_WS_PORT } from '@open-pencil/core/constants'
import type { ACPAgentDef } from '@open-pencil/core/constants'

import SYSTEM_PROMPT from '@/app/ai/chat/system-prompt.md?raw'

import {
  beginAcpDiagnostics,
  formatAcpRuntimeContext,
  getAcpDiagnostics,
  recordAcpConfigOptions,
  recordAcpNewSession,
  recordAcpPrompt,
  recordAcpSessionUpdate,
  resetAcpDiagnostics
} from './diagnostics'
import { createACPUpdateMapper } from './map-update'
import { spawnAcpProcess } from './process'

type TauriChild = Awaited<ReturnType<typeof spawnAcpProcess>>['child']

interface ACPDebugEntry {
  ts: number
  type: string
  data: unknown
}

interface ACPSession {
  connection: ClientSideConnection
  sessionId: string
  child: TauriChild
  updates: ReturnType<typeof createSessionUpdateBuffer>
  lifecycle: ACPRequestLifecycle
  configOptions: SessionConfigOption[]
  diagnosticsEnabled: boolean
  dead: boolean
}

interface ACPRequestLifecycle {
  closedError: Error | null
  rejectors: Set<(error: Error) => void>
}

interface ACPChatTransportOptions {
  agentDef: ACPAgentDef
  cwd?: string
  onConfigOptionsChange?: (options: readonly SessionConfigOption[]) => void
}

const MAX_LOG_AGE_MS = 5 * 60 * 1000
const IS_DEV = import.meta.env.DEV
const OPENPENCIL_MCP_HOST = '127.0.0.1'
const OPENPENCIL_MCP_SOURCE = 'packages/mcp/src/stdio.ts'
const TRANSPORT_DESTROYED_MESSAGE = 'ACP transport was destroyed.'
const AGENT_EXITED_MESSAGE = 'Agent process exited unexpectedly.'

const acpDebugLog: ACPDebugEntry[] = []

export function createSessionUpdateBuffer() {
  const pending: SessionNotification[] = []
  let handler: ((params: SessionNotification) => void) | null = null
  let bufferingSetupUpdates = true

  return {
    push(params: SessionNotification): void {
      if (handler) handler(params)
      else if (bufferingSetupUpdates) pending.push(params)
    },
    setHandler(next: ((params: SessionNotification) => void) | null): void {
      handler = next
      if (next) bufferingSetupUpdates = false
    },
    flush(): void {
      const currentHandler = handler
      if (!currentHandler) return
      for (const notification of pending.splice(0)) currentHandler(notification)
    },
    clear(): void {
      pending.length = 0
      bufferingSetupUpdates = false
    }
  }
}

function appendAcpDebugEntry(type: string, data: unknown): void {
  if (!IS_DEV) return
  acpDebugLog.push({ ts: Date.now(), type, data })
}

function pruneOldEntries() {
  const cutoff = Date.now() - MAX_LOG_AGE_MS
  while (acpDebugLog.length > 0 && acpDebugLog[0].ts < cutoff) {
    acpDebugLog.shift()
  }
}

export function getAcpDebugText(): string {
  pruneOldEntries()
  return acpDebugLog
    .map((e) => `[${new Date(e.ts).toISOString()}] ${e.type}\n${JSON.stringify(e.data, null, 2)}`)
    .join('\n\n---\n\n')
}

export function clearAcpDebugLog() {
  acpDebugLog.length = 0
  resetAcpDiagnostics()
}

export function hasAcpDebugEntries(): boolean {
  pruneOldEntries()
  return acpDebugLog.length > 0
}

interface OpenPencilMcpServerConfigOptions {
  isDev?: boolean
  projectRoot?: string
}

export function buildOpenPencilMcpServerConfig(
  cwd: string,
  options: OpenPencilMcpServerConfigOptions = {}
): McpServerStdio {
  const isDev = options.isDev ?? IS_DEV
  const devEntry = isDev
    ? `${options.projectRoot ?? __OPENPENCIL_PROJECT_ROOT__}/${OPENPENCIL_MCP_SOURCE}`
    : null
  return {
    name: 'open-pencil',
    command: devEntry ? 'bun' : 'openpencil-mcp',
    args: devEntry ? [devEntry] : [],
    env: [
      { name: 'HOST', value: OPENPENCIL_MCP_HOST },
      { name: 'WS_PORT', value: String(AUTOMATION_WS_PORT) },
      { name: 'OPENPENCIL_MCP_ROOT', value: cwd }
    ]
  }
}

function isMissingCommandError(message: string): boolean {
  const normalized = message.toLowerCase()
  return normalized.includes('enoent') || normalized.includes('program not found')
}

function missingCommandMessage(agentDef?: ACPAgentDef): string {
  if (!agentDef) return 'ACP agent CLI is not installed.'
  if (!agentDef.installCommand) {
    return `"${agentDef.command}" is not installed. Install it and restart OpenPencil.`
  }
  return `"${agentDef.command}" is not installed. Install it with: ${agentDef.installCommand}`
}

export function formatConnectionError(e: unknown, agentDef?: ACPAgentDef): string {
  let msg: string
  if (e instanceof Error) msg = e.message
  else if (e && typeof e === 'object' && 'message' in e && typeof e.message === 'string') {
    msg = e.message
  } else msg = String(e)
  if (
    msg.includes('ECONNREFUSED') ||
    msg.includes('fetch failed') ||
    msg.includes('Failed to fetch')
  ) {
    return 'MCP server is not running. Make sure the editor is open.'
  }
  if (msg.includes('timeout') || msg.includes('Timeout') || msg.includes('ETIMEDOUT')) {
    return 'MCP server did not respond in time.'
  }
  if (isMissingCommandError(msg)) {
    return missingCommandMessage(agentDef)
  }
  return msg
}

export function buildCrashChunks(
  destroying: boolean,
  textId: string,
  textStarted: boolean
): { chunks: UIMessageChunk[]; shouldNullSession: boolean } {
  if (destroying) return { chunks: [], shouldNullSession: false }
  const chunks: UIMessageChunk[] = []
  if (textStarted) chunks.push({ type: 'text-end', id: textId })
  chunks.push({ type: 'error', errorText: 'Agent process exited unexpectedly.' })
  chunks.push({ type: 'finish-step' })
  chunks.push({ type: 'finish', finishReason: 'error' })
  return { chunks, shouldNullSession: true }
}

export async function requestACPConfigOption(
  connection: Pick<ClientSideConnection, 'setSessionConfigOption'>,
  params: SetSessionConfigOptionRequest
): Promise<SessionConfigOption[]> {
  const result = await connection.setSessionConfigOption(params)
  return result.configOptions
}
function createRequestLifecycle(): ACPRequestLifecycle {
  return { closedError: null, rejectors: new Set() }
}
function closeRequestLifecycle(lifecycle: ACPRequestLifecycle, error: Error): void {
  if (lifecycle.closedError) return
  lifecycle.closedError = error
  for (const reject of lifecycle.rejectors) reject(error)
  lifecycle.rejectors.clear()
}
function requestError(error: unknown): Error {
  return error instanceof Error ? error : new Error(formatConnectionError(error))
}
function requestWithLifecycle<T>(
  lifecycle: ACPRequestLifecycle,
  request: () => Promise<T>
): Promise<T> {
  if (lifecycle.closedError) return Promise.reject(lifecycle.closedError)
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (action: () => void) => {
      if (settled) return
      settled = true
      lifecycle.rejectors.delete(rejectForLifecycle)
      action()
    }
    const rejectForLifecycle = (error: Error) => finish(() => reject(error))

    lifecycle.rejectors.add(rejectForLifecycle)
    try {
      void request().then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(requestError(error)))
      )
    } catch (error) {
      finish(() => reject(requestError(error)))
    }
  })
}

export class ACPChatTransport implements ChatTransport<UIMessage> {
  private session: ACPSession | null = null
  private sessionPromise: Promise<ACPSession> | null = null
  private pendingChild: TauriChild | null = null
  private agentDef: ACPAgentDef
  private cwd: string
  private onConfigOptionsChange: (options: readonly SessionConfigOption[]) => void
  private sentContext = false
  private runtimeContextDirty = true
  private destroying = false
  private requestLifecycle: ACPRequestLifecycle | null = null

  constructor(options: ACPChatTransportOptions) {
    this.agentDef = options.agentDef
    this.cwd = options.cwd ?? '.'
    this.onConfigOptionsChange = options.onConfigOptionsChange ?? (() => undefined)
  }

  async sendMessages({
    messages,
    abortSignal
  }: Parameters<ChatTransport<UIMessage>['sendMessages']>[0]): Promise<
    ReadableStream<UIMessageChunk>
  > {
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')
    const text =
      lastUserMessage?.parts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n') ?? ''

    const activeSession = await this.ensureSession()

    const consumedSystemContext = !this.sentContext
    const consumedRuntimeContext = this.runtimeContextDirty
    const runtimeContext = formatAcpRuntimeContext(getAcpDiagnostics())
    const promptText = [
      ...(consumedSystemContext ? [SYSTEM_PROMPT] : []),
      ...(consumedRuntimeContext ? [runtimeContext] : []),
      text
    ]
      .filter(Boolean)
      .join('\n\n')
    this.sentContext = true
    this.runtimeContextDirty = false

    const { connection, sessionId } = activeSession
    const session = activeSession

    return new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        const updateMapper = createACPUpdateMapper(`acp-${Date.now()}`)
        let closed = false

        function finish(reason: 'stop' | 'other' | 'error', errorText?: string) {
          if (closed) return
          closed = true
          if (errorText) controller.enqueue({ type: 'error', errorText })
          for (const chunk of updateMapper.finish()) controller.enqueue(chunk)
          controller.enqueue({ type: 'finish-step' })
          controller.enqueue({ type: 'finish', finishReason: reason })
          session.updates.setHandler(null)
          controller.close()
        }

        session.updates.setHandler((params) => {
          if (closed) return
          for (const chunk of updateMapper.map(params.update)) controller.enqueue(chunk)
        })

        abortSignal?.addEventListener('abort', () => {
          void connection.cancel({ sessionId })
          finish('stop')
        })

        controller.enqueue({ type: 'start' })
        controller.enqueue({ type: 'start-step' })
        session.updates.flush()

        requestWithLifecycle(session.lifecycle, () =>
          connection.prompt({
            sessionId,
            prompt: [{ type: 'text', text: promptText }]
          })
        )
          .then((result) => {
            if (session.diagnosticsEnabled) {
              appendAcpDebugEntry('prompt_response', result)
              recordAcpPrompt(result)
            }
            finish(result.stopReason === 'end_turn' ? 'stop' : 'other')
            return undefined
          })
          .catch((e) => {
            if (consumedSystemContext) this.sentContext = false
            if (consumedRuntimeContext) this.runtimeContextDirty = true
            finish('error', formatConnectionError(e, this.agentDef))
          })
      }
    })
  }

  async connect(): Promise<void> {
    await this.ensureSession()
  }

  async setSessionConfigOption(configId: string, value: string): Promise<void> {
    const session = await this.ensureSession()
    try {
      const configOptions = await requestWithLifecycle(session.lifecycle, () =>
        requestACPConfigOption(session.connection, {
          sessionId: session.sessionId,
          configId,
          value
        })
      )
      if (this.isDestroying() || this.session !== session || session.dead) {
        throw new Error(TRANSPORT_DESTROYED_MESSAGE)
      }

      session.configOptions = [...configOptions]
      appendAcpDebugEntry('set_config_option_response', { configId, value, configOptions })
      recordAcpConfigOptions(configOptions)
      this.runtimeContextDirty = true
      this.publishConfigOptions(configOptions)
    } catch (error) {
      throw new Error(formatConnectionError(error, this.agentDef))
    }
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null
  }

  async destroy(): Promise<void> {
    this.destroying = true
    this.publishConfigOptions([])
    if (this.requestLifecycle) {
      closeRequestLifecycle(this.requestLifecycle, new Error(TRANSPORT_DESTROYED_MESSAGE))
      this.requestLifecycle = null
    }
    const kills: Array<Promise<void>> = []
    if (this.pendingChild) {
      const child = this.pendingChild
      this.pendingChild = null
      kills.push(child.kill())
    }
    if (this.session) {
      const session = this.session
      session.dead = true
      session.diagnosticsEnabled = false
      session.updates.setHandler(null)
      session.updates.clear()
      this.session = null
      kills.push(session.child.kill())
    }
    await Promise.all(kills)
  }

  private isDestroying(): boolean {
    return this.destroying
  }

  private publishConfigOptions(options: readonly SessionConfigOption[]): void {
    this.onConfigOptionsChange([...options])
  }

  private async ensureSession(): Promise<ACPSession> {
    if (this.isDestroying()) throw new Error(TRANSPORT_DESTROYED_MESSAGE)

    if (this.session?.dead) {
      this.session = null
      this.publishConfigOptions([])
    }
    if (this.session) return this.session

    const pending = this.sessionPromise ?? this.spawnAgent()
    this.sessionPromise = pending
    try {
      const session = await pending
      if (this.isDestroying()) {
        if (!session.dead) {
          session.dead = true
          session.diagnosticsEnabled = false
          session.updates.clear()
          await session.child.kill()
        }
        throw new Error(TRANSPORT_DESTROYED_MESSAGE)
      }

      this.session = session
      this.publishConfigOptions(session.configOptions)
      return session
    } finally {
      if (this.sessionPromise === pending) this.sessionPromise = null
    }
  }

  private async spawnAgent(): Promise<ACPSession> {
    const lifecycle = createRequestLifecycle()
    this.requestLifecycle = lifecycle
    let diagnosticsEnabled = true
    let createdSession: ACPSession | null = null
    const configUpdateState: {
      latest: { sessionId: string; configOptions: SessionConfigOption[] } | null
    } = { latest: null }
    let process: Awaited<ReturnType<typeof spawnAcpProcess>>
    try {
      process = await spawnAcpProcess({
        command: this.agentDef.command,
        args: this.agentDef.args,
        logId: this.agentDef.id,
        destroying: () => this.destroying,
        onUnexpectedClose: () => {
          diagnosticsEnabled = false
          const wasCurrentLifecycle = this.requestLifecycle === lifecycle
          closeRequestLifecycle(lifecycle, new Error(AGENT_EXITED_MESSAGE))
          if (wasCurrentLifecycle) this.requestLifecycle = null
          const session = this.session
          if (session?.lifecycle !== lifecycle) {
            if (!session && wasCurrentLifecycle) this.publishConfigOptions([])
            return
          }
          session.dead = true
          session.diagnosticsEnabled = false
          session.updates.setHandler(null)
          session.updates.clear()
          this.session = null
          this.publishConfigOptions([])
        }
      })
    } catch (e) {
      if (this.requestLifecycle === lifecycle) this.requestLifecycle = null
      throw new Error(formatConnectionError(e, this.agentDef))
    }

    const { child, input, output } = process
    if (this.isDestroying()) {
      await child.kill()
      throw new Error(TRANSPORT_DESTROYED_MESSAGE)
    }
    this.pendingChild = child

    const stream = ndJsonStream(input, output)
    const updates = createSessionUpdateBuffer()
    const clientImpl: Client = {
      async requestPermission(
        params: RequestPermissionRequest
      ): Promise<RequestPermissionResponse> {
        const { requestPermissionFromUser } = await import('@/app/ai/acp/permission')
        return requestPermissionFromUser(params)
      },

      sessionUpdate: async (params: SessionNotification): Promise<void> => {
        if (this.isDestroying()) return
        if (diagnosticsEnabled) {
          appendAcpDebugEntry(params.update.sessionUpdate, params)
          recordAcpSessionUpdate(params.update)
        }
        if (params.update.sessionUpdate === 'config_option_update') {
          const configOptions = [...params.update.configOptions]
          configUpdateState.latest = { sessionId: params.sessionId, configOptions }
          let session: ACPSession | null = null
          if (createdSession?.sessionId === params.sessionId) {
            session = createdSession
          } else if (
            this.session?.lifecycle === lifecycle &&
            this.session.sessionId === params.sessionId
          ) {
            session = this.session
          }
          if (session) {
            session.configOptions = configOptions
            this.runtimeContextDirty = true
            if (this.session === session) this.publishConfigOptions(configOptions)
          }
        }
        updates.push(params)
      }
    }

    const connection = new ClientSideConnection((_agent: Agent) => clientImpl, stream)
    try {
      const initializeResult = await requestWithLifecycle(lifecycle, () =>
        connection.initialize({
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {}
        })
      )
      if (this.isDestroying()) throw new Error(TRANSPORT_DESTROYED_MESSAGE)
      appendAcpDebugEntry('initialize_response', initializeResult)

      beginAcpDiagnostics(this.agentDef.name)
      const sessionResult = await requestWithLifecycle(lifecycle, () =>
        connection.newSession({
          cwd: this.cwd,
          mcpServers: [buildOpenPencilMcpServerConfig(this.cwd)]
        })
      )
      if (this.isDestroying()) throw new Error(TRANSPORT_DESTROYED_MESSAGE)
      appendAcpDebugEntry('new_session_response', sessionResult)
      recordAcpNewSession(sessionResult)

      const latestConfigUpdate = configUpdateState.latest
      const configOptions =
        latestConfigUpdate?.sessionId === sessionResult.sessionId
          ? latestConfigUpdate.configOptions
          : [...(sessionResult.configOptions ?? [])]
      if (latestConfigUpdate?.sessionId === sessionResult.sessionId) {
        recordAcpConfigOptions(configOptions)
      }

      const session: ACPSession = {
        connection,
        sessionId: sessionResult.sessionId,
        child,
        updates,
        lifecycle,
        configOptions,
        dead: false,
        get diagnosticsEnabled() {
          return diagnosticsEnabled
        },
        set diagnosticsEnabled(value) {
          diagnosticsEnabled = value
        }
      }
      createdSession = session
      this.sentContext = false
      this.runtimeContextDirty = true

      if (this.pendingChild === child) this.pendingChild = null
      return session
    } catch (e) {
      diagnosticsEnabled = false
      updates.clear()
      const message = this.isDestroying()
        ? TRANSPORT_DESTROYED_MESSAGE
        : formatConnectionError(e, this.agentDef)
      closeRequestLifecycle(lifecycle, new Error(message))
      if (this.requestLifecycle === lifecycle) this.requestLifecycle = null
      if (this.pendingChild === child) {
        this.pendingChild = null
        void child.kill()
      }
      throw new Error(message)
    }
  }
}
