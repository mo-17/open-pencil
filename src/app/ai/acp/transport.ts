/* oxlint-disable eslint/max-lines -- ACP process, session, prompt drain, and permission cancellation share one protocol lifecycle boundary. */
import {
  ClientSideConnection,
  ndJsonStream as ndJSONStream,
  PROTOCOL_VERSION
} from '@agentclientprotocol/sdk'
import type {
  Agent,
  Client,
  ContentBlock,
  McpServer as MCPServer,
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
  beginACPDiagnostics,
  formatACPRuntimeContext,
  getACPDiagnostics,
  recordACPConfigOptions,
  recordACPNewSession,
  recordACPPrompt,
  recordACPSessionUpdate,
  resetACPDiagnostics
} from './diagnostics'
import { createACPUpdateMapper } from './map-update'
import { cancelPermissionsForSession, requestPermissionFromUser } from './permission'
import { spawnACPProcess } from './process'

type TauriChild = Awaited<ReturnType<typeof spawnACPProcess>>['child']

interface ACPDebugEntry {
  ts: number
  type: string
  data: unknown
}

interface ACPSession {
  connection: ClientSideConnection
  sessionId: string
  openEvent: ACPSessionOpenedEvent
  capabilities: ACPSessionCapabilities
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

interface ACPConfigUpdateState {
  latest: { sessionId: string; configOptions: SessionConfigOption[] } | null
}

interface ACPSpawnState {
  diagnosticsEnabled: boolean
  createdSession: ACPSession | null
  configUpdateState: ACPConfigUpdateState
}

type ACPNewSessionResult = Awaited<ReturnType<ClientSideConnection['newSession']>>

interface ACPSessionSetup {
  result: ACPNewSessionResult
  openEvent: ACPSessionOpenedEvent
}

export interface ACPSessionOpenedEvent {
  sessionId: string
  method: 'new' | 'resume'
  restoreError?: string
}

export interface ACPSessionCapabilities {
  list: boolean
  resume: boolean
  load: boolean
}

export interface ACPSessionSetupEvent extends ACPSessionOpenedEvent {
  capabilities: ACPSessionCapabilities
}

export interface ACPSessionListItem {
  sessionId: string
  cwd: string
  title: string | null
  updatedAt: string | null
}

interface ACPUntrustedSessionListItem {
  sessionId?: unknown
  cwd?: unknown
  title?: unknown
  updatedAt?: unknown
}

export interface ACPChatTransportOptions {
  agentDef: ACPAgentDef
  cwd?: string
  mcpServers?: MCPServer[]
  initialSessionId?: string
  resumeFallback?: 'new' | 'error'
  onSessionSetup?: (event: ACPSessionSetupEvent) => void
  onSessionOpened?: (event: ACPSessionOpenedEvent) => void
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
const ACP_SESSION_LIST_MAX_PAGES = 5
const ACP_SESSION_LIST_MAX_ITEMS = 100
const ACP_SESSION_ID_MAX_LENGTH = 8_192
const ACP_SESSION_CWD_MAX_LENGTH = 32_768
const ACP_SESSION_TITLE_MAX_LENGTH = 512
const ACP_SESSION_TIMESTAMP_MAX_LENGTH = 128
const ACP_SESSION_CURSOR_MAX_LENGTH = 8_192
const STRICT_BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^(?:[A-Za-z]:[\\/]|\\\\)/

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

function isAbsoluteACPWorkingDirectory(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= ACP_SESSION_CWD_MAX_LENGTH &&
    !value.includes('\0') &&
    (value.startsWith('/') || WINDOWS_ABSOLUTE_PATH_PATTERN.test(value))
  )
}

function normalizeSessionListTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().replace(/\s+/g, ' ')
  return normalized ? normalized.slice(0, ACP_SESSION_TITLE_MAX_LENGTH) : null
}

function normalizeSessionListTimestamp(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > ACP_SESSION_TIMESTAMP_MAX_LENGTH
  ) {
    return null
  }
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null
}

function hasASCIIControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint <= 0x1f || codePoint === 0x7f) return true
  }
  return false
}

function normalizeSessionListItem(value: unknown, expectedCwd: string): ACPSessionListItem | null {
  if (!isUntrustedSessionListItem(value)) return null
  const candidate = value
  if (
    typeof candidate.sessionId !== 'string' ||
    !candidate.sessionId.trim() ||
    candidate.sessionId.trim() !== candidate.sessionId ||
    hasASCIIControlCharacter(candidate.sessionId) ||
    candidate.sessionId.length > ACP_SESSION_ID_MAX_LENGTH ||
    candidate.cwd !== expectedCwd ||
    !isAbsoluteACPWorkingDirectory(expectedCwd)
  ) {
    return null
  }
  return {
    sessionId: candidate.sessionId,
    cwd: expectedCwd,
    title: normalizeSessionListTitle(candidate.title),
    updatedAt: normalizeSessionListTimestamp(candidate.updatedAt)
  }
}

function isUntrustedSessionListItem(value: unknown): value is ACPUntrustedSessionListItem {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function collectSessionListItems(
  rawSessions: unknown,
  expectedCwd: string,
  seenSessionIds: Set<string>,
  sessions: ACPSessionListItem[]
): void {
  if (!Array.isArray(rawSessions)) {
    throw new TypeError('ACP agent returned an invalid session/list response.')
  }
  for (const candidate of rawSessions) {
    if (sessions.length >= ACP_SESSION_LIST_MAX_ITEMS) break
    const normalized = normalizeSessionListItem(candidate, expectedCwd)
    if (!normalized || seenSessionIds.has(normalized.sessionId)) continue
    seenSessionIds.add(normalized.sessionId)
    sessions.push(normalized)
  }
}

function normalizeSessionListCursor(value: unknown, seenCursors: Set<string>): string | null {
  if (value == null) return null
  if (typeof value !== 'string' || !value || value.length > ACP_SESSION_CURSOR_MAX_LENGTH) {
    throw new TypeError('ACP agent returned an invalid session/list cursor.')
  }
  if (seenCursors.has(value)) {
    throw new Error('ACP agent returned a repeated session/list cursor.')
  }
  seenCursors.add(value)
  return value
}

function requestACPSessionListPage(
  connection: ClientSideConnection,
  lifecycle: ACPRequestLifecycle,
  cwd: string,
  cursor?: string
) {
  return requestWithLifecycle(lifecycle, () =>
    connection.unstable_listSessions({ cwd, ...(cursor ? { cursor } : {}) })
  )
}

function sortSessionListItems(sessions: ACPSessionListItem[]): void {
  sessions.sort((left, right) => {
    if (left.updatedAt === right.updatedAt) return 0
    if (left.updatedAt === null) return 1
    if (right.updatedAt === null) return -1
    return right.updatedAt.localeCompare(left.updatedAt)
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
    discardPending(): void {
      pending.length = 0
    },
    clear(): void {
      pending.length = 0
      bufferingSetupUpdates = false
    }
  }
}

function appendACPDebugEntry(type: string, data: unknown): void {
  if (!IS_DEV) return
  acpDebugLog.push({ ts: Date.now(), type, data })
}

function pruneOldEntries() {
  const cutoff = Date.now() - MAX_LOG_AGE_MS
  while (acpDebugLog.length > 0 && acpDebugLog[0].ts < cutoff) {
    acpDebugLog.shift()
  }
}

export function getACPDebugText(): string {
  pruneOldEntries()
  return acpDebugLog
    .map((e) => `[${new Date(e.ts).toISOString()}] ${e.type}\n${JSON.stringify(e.data, null, 2)}`)
    .join('\n\n---\n\n')
}

export function clearACPDebugLog() {
  acpDebugLog.length = 0
  resetACPDiagnostics()
}

export function hasACPDebugEntries(): boolean {
  pruneOldEntries()
  return acpDebugLog.length > 0
}

export function buildOpenPencilMCPServerConfig(authToken: string | null): MCPServer {
  return {
    type: 'http',
    name: 'open-pencil',
    url: `http://127.0.0.1:${AUTOMATION_HTTP_PORT}/mcp`,
    headers: authToken ? [{ name: 'Authorization', value: `Bearer ${authToken}` }] : []
  }
}

export function buildACPMCPServerConfigs(
  authToken: string | null,
  remoteServers: readonly MCPServer[] = []
): MCPServer[] {
  return [buildOpenPencilMCPServerConfig(authToken), ...remoteServers]
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
  private mcpServers: MCPServer[]
  private resumeSessionId: string | null
  private resumeFallback: 'new' | 'error'
  private onSessionSetup: (event: ACPSessionSetupEvent) => void
  private onSessionOpened: (event: ACPSessionOpenedEvent) => void
  private onConfigOptionsChange: (options: readonly SessionConfigOption[]) => void
  private sentContext = false
  private runtimeContextDirty = true
  private destroying = false
  private requestLifecycle: ACPRequestLifecycle | null = null
  private activePrompt: ACPActivePrompt | null = null
  private cancellingSessionIds = new Set<string>()
  private cancelDrainTimeoutMs: number
  private setupSessions = new WeakSet<ACPSession>()
  private openedSessionIds = new Set<string>()

  constructor(options: ACPChatTransportOptions) {
    this.agentDef = options.agentDef
    this.cwd = options.cwd ?? '.'
    this.mcpServers = [...(options.mcpServers ?? [])]
    this.resumeSessionId = options.initialSessionId || null
    this.resumeFallback = options.resumeFallback ?? 'new'
    this.onSessionSetup = options.onSessionSetup ?? (() => undefined)
    this.onSessionOpened = options.onSessionOpened ?? (() => undefined)
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
    const runtimeContext = formatACPRuntimeContext(getACPDiagnostics())
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
              appendACPDebugEntry('prompt_response', result)
              recordACPPrompt(result)
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
              this.publishSessionOpened(session)
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
    const session = await this.ensureSession()
    this.publishSessionSetup(session)
  }

  async listSessions(): Promise<ACPSessionListItem[]> {
    const session = await this.ensureSession()
    if (!session.capabilities.list) {
      throw new Error(`The ACP agent "${this.agentDef.name}" does not support session/list.`)
    }
    if (!isAbsoluteACPWorkingDirectory(this.cwd)) {
      throw new Error('ACP session/list requires an absolute working directory.')
    }

    const sessions: ACPSessionListItem[] = []
    const seenSessionIds = new Set<string>()
    const seenCursors = new Set<string>()
    let cursor: string | undefined
    let pageCount = 0

    while (pageCount < ACP_SESSION_LIST_MAX_PAGES && sessions.length < ACP_SESSION_LIST_MAX_ITEMS) {
      const response = await requestACPSessionListPage(
        session.connection,
        session.lifecycle,
        this.cwd,
        cursor
      )
      this.assertSessionActive(session)
      pageCount += 1

      collectSessionListItems(response.sessions, this.cwd, seenSessionIds, sessions)

      if (sessions.length >= ACP_SESSION_LIST_MAX_ITEMS) break
      cursor = normalizeSessionListCursor(response.nextCursor, seenCursors) ?? undefined
      if (!cursor) break
    }

    this.assertSessionActive(session)
    sortSessionListItems(sessions)
    appendACPDebugEntry('list_sessions_response', {
      pages: pageCount,
      count: sessions.length
    })
    return sessions
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
      appendACPDebugEntry('set_config_option_response', { configId, value, configOptions })
      recordACPConfigOptions(configOptions)
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
    this.mcpServers = []
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

  private assertSessionActive(session: ACPSession): void {
    if (this.isDestroying() || this.session !== session || session.dead) {
      throw new Error(TRANSPORT_DESTROYED_MESSAGE)
    }
  }

  private publishConfigOptions(options: readonly SessionConfigOption[]): void {
    this.onConfigOptionsChange([...options])
  }

  private publishSessionSetup(session: ACPSession): void {
    if (this.setupSessions.has(session)) return
    this.setupSessions.add(session)
    try {
      this.onSessionSetup({
        ...session.openEvent,
        capabilities: { ...session.capabilities }
      })
    } catch (error) {
      appendACPDebugEntry('session_setup_callback_error', formatConnectionError(error))
    }
  }

  private publishSessionOpened(session: ACPSession): void {
    if (this.openedSessionIds.has(session.sessionId)) return
    this.openedSessionIds.add(session.sessionId)
    try {
      this.onSessionOpened({ ...session.openEvent })
    } catch (error) {
      appendACPDebugEntry('session_opened_callback_error', formatConnectionError(error))
    }
  }

  private handleUnexpectedClose(
    lifecycle: ACPRequestLifecycle,
    createdSession: ACPSession | null
  ): void {
    const wasCurrentLifecycle = this.requestLifecycle === lifecycle
    closeRequestLifecycle(lifecycle, new Error(AGENT_EXITED_MESSAGE))
    if (wasCurrentLifecycle) this.requestLifecycle = null

    let session: ACPSession | null = null
    if (this.session?.lifecycle === lifecycle) session = this.session
    else if (createdSession?.lifecycle === lifecycle) session = createdSession
    if (!session) {
      if (wasCurrentLifecycle) this.publishConfigOptions([])
      return
    }

    session.dead = true
    session.diagnosticsEnabled = false
    cancelPermissionsForSession(session.sessionId)
    session.updates.setHandler(null)
    session.updates.clear()
    if (this.session === session) {
      this.session = null
      this.publishConfigOptions([])
    }
  }

  private async openAgentSession(
    connection: ClientSideConnection,
    lifecycle: ACPRequestLifecycle,
    mcpServers: MCPServer[],
    canResume: boolean,
    updates: ReturnType<typeof createSessionUpdateBuffer>,
    configUpdateState: ACPConfigUpdateState
  ): Promise<ACPSessionSetup> {
    const initialSessionId = this.resumeSessionId
    if (!initialSessionId) {
      const result = await requestWithLifecycle(lifecycle, () =>
        connection.newSession({ cwd: this.cwd, mcpServers })
      )
      return { result, openEvent: { sessionId: result.sessionId, method: 'new' } }
    }
    if (!canResume) {
      const restoreError = `The ACP agent "${this.agentDef.name}" does not support session/resume.`
      if (this.resumeFallback === 'error') {
        throw new Error(restoreError)
      }
      const result = await requestWithLifecycle(lifecycle, () =>
        connection.newSession({ cwd: this.cwd, mcpServers })
      )
      return {
        result,
        openEvent: { sessionId: result.sessionId, method: 'new', restoreError }
      }
    }

    try {
      const resumeResult = await requestWithLifecycle(lifecycle, () =>
        connection.unstable_resumeSession({
          cwd: this.cwd,
          mcpServers,
          sessionId: initialSessionId
        })
      )
      if (this.isDestroying()) throw new Error(TRANSPORT_DESTROYED_MESSAGE)
      appendACPDebugEntry('resume_session_response', {
        sessionId: initialSessionId,
        ...resumeResult
      })
      return {
        result: { ...resumeResult, sessionId: initialSessionId },
        openEvent: { sessionId: initialSessionId, method: 'resume' }
      }
    } catch (error) {
      if (this.isDestroying() || lifecycle.closedError) throw error
      const restoreError = formatConnectionError(error, this.agentDef)
      appendACPDebugEntry('resume_session_error', {
        sessionId: initialSessionId,
        error: restoreError
      })
      if (this.resumeFallback === 'error') throw new Error(restoreError)
      updates.discardPending()
      configUpdateState.latest = null
      const result = await requestWithLifecycle(lifecycle, () =>
        connection.newSession({ cwd: this.cwd, mcpServers })
      )
      return {
        result,
        openEvent: { sessionId: result.sessionId, method: 'new', restoreError }
      }
    }
  }

  private createClient(
    lifecycle: ACPRequestLifecycle,
    updates: ReturnType<typeof createSessionUpdateBuffer>,
    state: ACPSpawnState
  ): Client {
    return {
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
        if (state.diagnosticsEnabled) {
          appendACPDebugEntry(params.update.sessionUpdate, params)
          recordACPSessionUpdate(params.update)
        }
        if (params.update.sessionUpdate === 'config_option_update') {
          const configOptions = [...params.update.configOptions]
          state.configUpdateState.latest = { sessionId: params.sessionId, configOptions }
          let session: ACPSession | null = null
          if (state.createdSession?.sessionId === params.sessionId) {
            session = state.createdSession
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
  }

  private completeSessionSetup(
    connection: ClientSideConnection,
    child: TauriChild,
    updates: ReturnType<typeof createSessionUpdateBuffer>,
    lifecycle: ACPRequestLifecycle,
    state: ACPSpawnState,
    setup: ACPSessionSetup,
    capabilities: ACPSessionCapabilities,
    supportsImagePrompts: boolean
  ): ACPSession {
    const sessionResult = setup.result
    recordACPNewSession(sessionResult)
    const latestConfigUpdate = state.configUpdateState.latest
    const configOptions =
      latestConfigUpdate?.sessionId === sessionResult.sessionId
        ? latestConfigUpdate.configOptions
        : [...(sessionResult.configOptions ?? [])]
    if (latestConfigUpdate?.sessionId === sessionResult.sessionId) {
      recordACPConfigOptions(configOptions)
    }

    const session: ACPSession = {
      connection,
      sessionId: sessionResult.sessionId,
      openEvent: setup.openEvent,
      capabilities,
      child,
      updates,
      lifecycle,
      configOptions,
      supportsImagePrompts,
      dead: false,
      get diagnosticsEnabled() {
        return state.diagnosticsEnabled
      },
      set diagnosticsEnabled(value) {
        state.diagnosticsEnabled = value
      }
    }
    state.createdSession = session
    this.sentContext = setup.openEvent.method === 'resume'
    this.runtimeContextDirty = true
    if (this.pendingChild === child) this.pendingChild = null
    return session
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
      if (this.isDestroying() || session.dead || session.lifecycle.closedError) {
        if (!session.dead) {
          session.dead = true
          session.diagnosticsEnabled = false
          session.updates.clear()
          await session.child.kill()
        }
        throw session.lifecycle.closedError ?? new Error(TRANSPORT_DESTROYED_MESSAGE)
      }

      this.session = session
      this.resumeSessionId = session.sessionId
      this.publishConfigOptions(session.configOptions)
      if (this.isDestroying()) throw new Error(TRANSPORT_DESTROYED_MESSAGE)
      return session
    } finally {
      if (this.sessionPromise === pending) this.sessionPromise = null
    }
  }

  private async spawnAgent(): Promise<ACPSession> {
    const lifecycle = createRequestLifecycle()
    this.requestLifecycle = lifecycle
    const state: ACPSpawnState = {
      diagnosticsEnabled: true,
      createdSession: null,
      configUpdateState: { latest: null }
    }
    let process: Awaited<ReturnType<typeof spawnACPProcess>>
    try {
      process = await spawnACPProcess({
        command: this.agentDef.command,
        args: this.agentDef.args,
        logId: this.agentDef.id,
        destroying: () => this.destroying,
        onUnexpectedClose: () => {
          state.diagnosticsEnabled = false
          this.handleUnexpectedClose(lifecycle, state.createdSession)
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

    const stream = ndJSONStream(input, output)
    const updates = createSessionUpdateBuffer()
    const clientImpl = this.createClient(lifecycle, updates, state)

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
      appendACPDebugEntry('initialize_response', initializeResult)

      beginACPDiagnostics(this.agentDef.name)
      const mcpServers = buildACPMCPServerConfigs(automationAuthToken, this.mcpServers)
      const capabilities: ACPSessionCapabilities = {
        list: initializeResult.agentCapabilities?.sessionCapabilities?.list != null,
        resume: initializeResult.agentCapabilities?.sessionCapabilities?.resume != null,
        load: initializeResult.agentCapabilities?.loadSession === true
      }
      const setup = await this.openAgentSession(
        connection,
        lifecycle,
        mcpServers,
        capabilities.resume,
        updates,
        state.configUpdateState
      )
      if (this.isDestroying()) throw new Error(TRANSPORT_DESTROYED_MESSAGE)
      appendACPDebugEntry('session_setup_response', {
        method: setup.openEvent.method,
        result: setup.result
      })
      return this.completeSessionSetup(
        connection,
        child,
        updates,
        lifecycle,
        state,
        setup,
        capabilities,
        initializeResult.agentCapabilities?.promptCapabilities?.image === true
      )
    } catch (e) {
      state.diagnosticsEnabled = false
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
