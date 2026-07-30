/* oxlint-disable eslint/max-lines -- ACP process, session, prompt drain, and permission cancellation share one protocol lifecycle boundary. */
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import type {
  Agent,
  Client,
  ContentBlock,
  McpServer,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionConfigOption,
  SessionNotification,
  SetSessionConfigOptionRequest
} from '@agentclientprotocol/sdk'
import {
  isFileUIPart,
  type ChatTransport,
  type FileUIPart,
  type UIMessage,
  type UIMessageChunk
} from 'ai'

import { decodeBase64, encodeBase64 } from '@open-pencil/core/bytes'
import { AUTOMATION_HTTP_PORT, type ACPAgentDef } from '@open-pencil/core/constants'

import {
  DEFAULT_VISUAL_ATTACHMENT_LIMITS,
  MAX_VISUAL_ATTACHMENTS,
  MAX_VISUAL_ATTACHMENT_TOTAL_BYTES,
  formatVisualReferenceSourceContext,
  sniffVisualAttachmentMediaType,
  SUPPORTED_VISUAL_ATTACHMENT_TYPES,
  type VisualAttachmentMediaType
} from '@/app/ai/chat/attachments'
import { INTERRUPTED_TOOL_ERROR } from '@/app/ai/chat/interruption'
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
import { cancelPermissionsForSession, requestPermissionFromUser } from './permission'
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
  supportsImagePrompts: boolean
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
  cancelDrainTimeoutMs?: number
}

interface ACPActivePrompt {
  session: ACPSession
  done: Promise<void>
  resolveDone: () => void
  cancelRequested: boolean
  cancelTimer?: ReturnType<typeof setTimeout>
}

const MAX_LOG_AGE_MS = 5 * 60 * 1000
const IS_DEV = import.meta.env.DEV
const TRANSPORT_DESTROYED_MESSAGE = 'ACP transport was destroyed.'
const AGENT_EXITED_MESSAGE = 'Agent process exited unexpectedly.'
const ACP_CANCEL_DRAIN_TIMEOUT_MS = 3_000
const ACP_MAX_IMAGE_BYTES = DEFAULT_VISUAL_ATTACHMENT_LIMITS.maxOutputBytes
const STRICT_BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

const acpDebugLog: ACPDebugEntry[] = []

function abortError(): Error {
  const error = new Error('ACP request cancelled')
  error.name = 'AbortError'
  return error
}

function attachmentLabel(part: FileUIPart, index: number): string {
  return part.filename ? ` ${JSON.stringify(part.filename.slice(0, 100))}` : ` #${index + 1}`
}

function supportedImageMediaType(mediaType: string): VisualAttachmentMediaType | undefined {
  return SUPPORTED_VISUAL_ATTACHMENT_TYPES.find((candidate) => candidate === mediaType)
}

function requireSupportedImageMediaType(
  part: FileUIPart,
  index: number
): VisualAttachmentMediaType {
  const mediaType = supportedImageMediaType(part.mediaType)
  if (mediaType) return mediaType
  throw new Error(
    `File attachment${attachmentLabel(part, index)} cannot be sent over ACP. Only PNG, JPEG, and WebP image attachments are supported. Remove it or attach a supported image.`
  )
}

function toACPImageContent(
  part: FileUIPart,
  index: number
): { content: ContentBlock; byteLength: number } {
  const label = attachmentLabel(part, index)
  const mediaType = requireSupportedImageMediaType(part, index)

  const separator = part.url.indexOf(',')
  const header = separator !== -1 ? part.url.slice(0, separator) : ''
  const match = /^data:([^;,]+);base64$/.exec(header)
  if (!match) {
    throw new Error(
      `Image attachment${label} must use an embedded base64 data URL. Reattach it from your device and try again.`
    )
  }
  if (match[1] !== mediaType) {
    throw new Error(
      `Image attachment${label} declares ${JSON.stringify(mediaType)}, but its data URL contains ${JSON.stringify(match[1])}. Reattach the image and try again.`
    )
  }

  const data = part.url.slice(separator + 1)
  if (!data) throw new Error(`Image attachment${label} is empty. Reattach it and try again.`)
  const maxEncodedLength = Math.ceil(ACP_MAX_IMAGE_BYTES / 3) * 4
  if (data.length > maxEncodedLength) {
    throw new Error(
      `Image attachment${label} exceeds the 2 MiB ACP image limit. Resize or compress it and try again.`
    )
  }
  if (!STRICT_BASE64_PATTERN.test(data)) {
    throw new Error(
      `Image attachment${label} contains invalid base64 data. Reattach it and try again.`
    )
  }

  let bytes: Uint8Array
  try {
    bytes = decodeBase64(data)
  } catch {
    throw new Error(
      `Image attachment${label} contains invalid base64 data. Reattach it and try again.`
    )
  }
  if (encodeBase64(bytes) !== data) {
    throw new Error(
      `Image attachment${label} contains non-canonical base64 data. Reattach it and try again.`
    )
  }
  if (bytes.byteLength === 0) {
    throw new Error(`Image attachment${label} is empty. Reattach it and try again.`)
  }
  if (bytes.byteLength > ACP_MAX_IMAGE_BYTES) {
    throw new Error(
      `Image attachment${label} exceeds the 2 MiB ACP image limit. Resize or compress it and try again.`
    )
  }
  if (sniffVisualAttachmentMediaType(bytes) !== mediaType) {
    throw new Error(
      `Image attachment${label} contents do not match its declared media type. Reattach it and try again.`
    )
  }

  return {
    content: {
      type: 'image',
      data,
      mimeType: mediaType
    },
    byteLength: bytes.byteLength
  }
}

function toACPImageContents(parts: FileUIPart[]): ContentBlock[] {
  parts.forEach(requireSupportedImageMediaType)
  if (parts.length > MAX_VISUAL_ATTACHMENTS) {
    throw new Error(
      `ACP prompts support up to ${MAX_VISUAL_ATTACHMENTS} image attachments. Remove some images and try again.`
    )
  }

  let totalBytes = 0
  return parts.map((part, index) => {
    const image = toACPImageContent(part, index)
    totalBytes += image.byteLength
    if (totalBytes > MAX_VISUAL_ATTACHMENT_TOTAL_BYTES) {
      throw new Error(
        'The combined ACP image attachments exceed the 6 MiB limit. Remove or compress some images and try again.'
      )
    }
    return image.content
  })
}

function waitWithAbort(promise: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      cleanup()
      reject(abortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    void promise.then(
      () => {
        cleanup()
        resolve()
        return undefined
      },
      (error: unknown) => {
        cleanup()
        reject(error instanceof Error ? error : new Error('ACP prompt failed', { cause: error }))
        return undefined
      }
    )
  })
}

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

export function buildOpenPencilMcpServerConfig(authToken: string | null): McpServer {
  return {
    type: 'http',
    name: 'open-pencil',
    url: `http://127.0.0.1:${AUTOMATION_HTTP_PORT}/mcp`,
    headers: authToken ? [{ name: 'Authorization', value: `Bearer ${authToken}` }] : []
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
  private activePrompt: ACPActivePrompt | null = null
  private cancellingSessionIds = new Set<string>()
  private cancelDrainTimeoutMs: number

  constructor(options: ACPChatTransportOptions) {
    this.agentDef = options.agentDef
    this.cwd = options.cwd ?? '.'
    this.onConfigOptionsChange = options.onConfigOptionsChange ?? (() => undefined)
    this.cancelDrainTimeoutMs = options.cancelDrainTimeoutMs ?? ACP_CANCEL_DRAIN_TIMEOUT_MS
  }

  async sendMessages({
    messages,
    abortSignal
  }: Parameters<ChatTransport<UIMessage>['sendMessages']>[0]): Promise<
    ReadableStream<UIMessageChunk>
  > {
    if (abortSignal?.aborted) throw abortError()
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')
    const fileAttachments = lastUserMessage?.parts.filter(isFileUIPart) ?? []
    const imageContent = toACPImageContents(fileAttachments)
    const text =
      lastUserMessage?.parts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n') ?? ''
    const visualReferenceSourceContext = lastUserMessage
      ? formatVisualReferenceSourceContext(lastUserMessage)
      : null

    let activeSession: ACPSession
    let activePrompt: ACPActivePrompt
    for (;;) {
      if (this.activePrompt) await waitWithAbort(this.activePrompt.done, abortSignal)
      if (abortSignal?.aborted) throw abortError()
      activeSession = await this.ensureSession()
      if (abortSignal?.aborted) throw abortError()
      if (this.activePrompt) continue
      if (imageContent.length > 0 && !activeSession.supportsImagePrompts) {
        throw new Error(
          `The ACP agent "${this.agentDef.name}" does not support image prompts. Remove the image attachment or choose an ACP agent that advertises image support.`
        )
      }
      activePrompt = this.reservePrompt(activeSession)
      break
    }

    const consumedSystemContext = !this.sentContext
    const consumedRuntimeContext = this.runtimeContextDirty
    const runtimeContext = formatAcpRuntimeContext(getAcpDiagnostics())
    const promptText = [
      ...(consumedSystemContext ? [SYSTEM_PROMPT] : []),
      ...(consumedRuntimeContext ? [runtimeContext] : []),
      text,
      visualReferenceSourceContext
    ]
      .filter(Boolean)
      .join('\n\n')
    this.sentContext = true
    this.runtimeContextDirty = false

    const { connection, sessionId } = activeSession
    const session = activeSession
    this.cancellingSessionIds.delete(sessionId)

    return new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        const updateMapper = createACPUpdateMapper(`acp-${Date.now()}`)
        let closed = false
        let promptStarted = false
        let contextRestored = false
        let cleanupAbort: () => void = () => undefined

        const restoreContext = () => {
          if (contextRestored) return
          contextRestored = true
          if (consumedSystemContext) this.sentContext = false
          if (consumedRuntimeContext) this.runtimeContextDirty = true
        }

        const finish = (
          reason: 'stop' | 'other' | 'error',
          errorText?: string,
          pendingToolError?: string
        ) => {
          if (closed) return
          closed = true
          cleanupAbort()
          clearTimeout(activePrompt.cancelTimer)
          session.updates.setHandler(null)
          try {
            const toolError = pendingToolError ?? (reason === 'error' ? errorText : undefined)
            if (toolError) {
              for (const chunk of updateMapper.interrupt(toolError)) controller.enqueue(chunk)
            }
            for (const chunk of updateMapper.finish()) controller.enqueue(chunk)
            // AI SDK treats an error chunk as terminal, so every pending part must
            // be finalized before this chunk is emitted.
            if (errorText) controller.enqueue({ type: 'error', errorText })
            controller.enqueue({ type: 'finish-step' })
            controller.enqueue({ type: 'finish', finishReason: reason })
            controller.close()
          } finally {
            this.releasePrompt(activePrompt)
          }
        }

        const onAbort = () => {
          if (closed || activePrompt.cancelRequested) return
          if (!promptStarted) {
            restoreContext()
            finish('stop', undefined, INTERRUPTED_TOOL_ERROR)
            return
          }
          activePrompt.cancelRequested = true
          this.cancellingSessionIds.add(sessionId)
          cancelPermissionsForSession(sessionId)
          void connection.cancel({ sessionId }).catch(() => undefined)
          activePrompt.cancelTimer = setTimeout(() => {
            if (closed || this.activePrompt !== activePrompt) return
            restoreContext()
            this.invalidateSession(
              session,
              new Error(`ACP cancellation did not settle within ${this.cancelDrainTimeoutMs}ms.`)
            )
            finish('stop', undefined, INTERRUPTED_TOOL_ERROR)
          }, this.cancelDrainTimeoutMs)
        }
        if (abortSignal) {
          abortSignal.addEventListener('abort', onAbort, { once: true })
          cleanupAbort = () => abortSignal.removeEventListener('abort', onAbort)
        }

        session.updates.setHandler((params) => {
          if (closed) return
          for (const chunk of updateMapper.map(params.update)) controller.enqueue(chunk)
        })

        controller.enqueue({ type: 'start' })
        controller.enqueue({ type: 'start-step' })
        if (abortSignal?.aborted) {
          onAbort()
          return
        }
        session.updates.flush()

        promptStarted = true
        requestWithLifecycle(session.lifecycle, () =>
          connection.prompt({
            sessionId,
            prompt: [{ type: 'text', text: promptText }, ...imageContent]
          })
        )
          .then((result) => {
            if (closed) return undefined
            if (session.diagnosticsEnabled) {
              appendAcpDebugEntry('prompt_response', result)
              recordAcpPrompt(result)
            }
            if (activePrompt.cancelRequested) {
              restoreContext()
              if (result.stopReason !== 'cancelled') {
                this.invalidateSession(
                  session,
                  new Error(
                    `ACP agent returned "${result.stopReason}" after cancellation instead of "cancelled".`
                  )
                )
              }
              finish('stop', undefined, INTERRUPTED_TOOL_ERROR)
            } else {
              finish(result.stopReason === 'end_turn' ? 'stop' : 'other')
            }
            return undefined
          })
          .catch((e) => {
            if (closed) return
            restoreContext()
            if (activePrompt.cancelRequested) {
              this.invalidateSession(session, requestError(e))
              finish('stop', undefined, INTERRUPTED_TOOL_ERROR)
            } else {
              finish('error', formatConnectionError(e, this.agentDef))
            }
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
      cancelPermissionsForSession(session.sessionId)
      session.dead = true
      session.diagnosticsEnabled = false
      session.updates.setHandler(null)
      session.updates.clear()
      this.session = null
      kills.push(session.child.kill())
    }
    this.cancellingSessionIds.clear()
    await Promise.all(kills)
  }

  private isDestroying(): boolean {
    return this.destroying
  }

  private publishConfigOptions(options: readonly SessionConfigOption[]): void {
    this.onConfigOptionsChange([...options])
  }

  private reservePrompt(session: ACPSession): ACPActivePrompt {
    let resolveDone: () => void = () => undefined
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve
    })
    const activePrompt: ACPActivePrompt = {
      session,
      done,
      resolveDone,
      cancelRequested: false
    }
    this.activePrompt = activePrompt
    return activePrompt
  }

  private releasePrompt(activePrompt: ACPActivePrompt): void {
    clearTimeout(activePrompt.cancelTimer)
    if (this.activePrompt === activePrompt) this.activePrompt = null
    activePrompt.resolveDone()
  }

  private invalidateSession(session: ACPSession, error: Error): void {
    const shouldKill = !session.dead
    session.dead = true
    session.diagnosticsEnabled = false
    session.updates.setHandler(null)
    session.updates.clear()
    cancelPermissionsForSession(session.sessionId)
    closeRequestLifecycle(session.lifecycle, error)
    if (this.requestLifecycle === session.lifecycle) this.requestLifecycle = null
    if (this.session === session) {
      this.session = null
      this.publishConfigOptions([])
    }
    if (shouldKill) void session.child.kill().catch(() => undefined)
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
          cancelPermissionsForSession(session.sessionId)
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
      requestPermission: async (
        params: RequestPermissionRequest
      ): Promise<RequestPermissionResponse> => {
        if (this.cancellingSessionIds.has(params.sessionId)) {
          return { outcome: { outcome: 'cancelled' } }
        }
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
      const { getAutomationAuthToken } = await import('@/app/automation/mcp/spawn')
      const automationAuthToken = await getAutomationAuthToken()
      if (this.isDestroying()) throw new Error(TRANSPORT_DESTROYED_MESSAGE)

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
          mcpServers: [buildOpenPencilMcpServerConfig(automationAuthToken)]
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
        supportsImagePrompts:
          initializeResult.agentCapabilities?.promptCapabilities?.image === true,
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
        await child.kill().catch(() => undefined)
      }
      throw new Error(message)
    }
  }
}
