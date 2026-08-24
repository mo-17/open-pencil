import type { SessionConfigOption } from '@agentclientprotocol/sdk'
import { Chat } from '@ai-sdk/vue'
import {
  DirectChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  stepCountIs,
  ToolLoopAgent
} from 'ai'
import type {
  ChatTransport,
  FinishReason,
  LanguageModel,
  ToolLoopAgentSettings,
  ToolSet,
  UIMessage
} from 'ai'
import { readonly, ref, shallowRef } from 'vue'
import type { ComputedRef, Ref } from 'vue'

import { ACP_AGENTS } from '@open-pencil/core/constants'
import type { ACPAgentID, AIProviderID } from '@open-pencil/core/constants'

import { resetACPDiagnostics } from '@/app/ai/acp/diagnostics'
import type {
  ACPChatTransportOptions,
  ACPSessionCapabilities,
  ACPSessionListItem,
  ACPSessionOpenedEvent,
  ACPSessionSetupEvent
} from '@/app/ai/acp/transport'
import {
  createACPSessionPersistence,
  type ActiveACPSessionBinding
} from '@/app/ai/chat/acp-session-persistence'
import { hasPendingToolApproval } from '@/app/ai/chat/approval'
import { archiveVisualChatMessages } from '@/app/ai/chat/attachments'
import {
  classifyAIChatError,
  classifyAIChatFinish,
  type AIChatFailure
} from '@/app/ai/chat/failure'
import {
  finalizeInterruptedToolParts,
  finalizeUnfinishedToolParts
} from '@/app/ai/chat/interruption'
import { resolveLanguageModelID } from '@/app/ai/chat/model'
import { designSystemPromptFor } from '@/app/ai/chat/prompt-policy'
import { buildReasoningProviderOptions, type AIProviderOptions } from '@/app/ai/chat/reasoning'
import { archiveAssistantFileMessages } from '@/app/ai/chat/sources'
import {
  createVisionRoleAnalyzer,
  VisualReferenceChatTransport
} from '@/app/ai/chat/visual-transport'
import { buildRemoteMCPACPServerConfigs } from '@/app/ai/mcp/acp'
import {
  createAIModelRuntime,
  designModelProfile,
  resolveModelConnectionAPIKey
} from '@/app/ai/models'
import type { ResolvedAIModelRole } from '@/app/ai/models'
import type { AISessionStore } from '@/app/ai/sessions'
import { MAX_AGENT_STEPS, createAITools, recordStepUsage, resetRunSteps } from '@/app/ai/tools'
import type { getActiveEditorStore } from '@/app/editor/active-store'

type EditorStore = ReturnType<typeof getActiveEditorStore>
type SourceChangeObservable = {
  onSourceChanged(listener: () => void): () => void
}

function isSourceChangeObservable(value: object): value is SourceChangeObservable {
  return 'onSourceChanged' in value && typeof value.onSourceChanged === 'function'
}

export type CreateACPTransportOptions = Pick<
  ACPChatTransportOptions,
  | 'initialSessionId'
  | 'resumeFallback'
  | 'onSessionSetup'
  | 'onSessionOpened'
  | 'onConfigOptionsChange'
>

export type ManagedACPTransport = ChatTransport<UIMessage> & {
  connect(): Promise<void>
  destroy(): Promise<void>
  setSessionConfigOption(configId: string, value: string): Promise<void>
  listSessions?(): Promise<ACPSessionListItem[]>
}

export type CreateACPTransportFactory = (
  providerID: AIProviderID,
  optionsOrConfigCallback?:
    | CreateACPTransportOptions
    | ((options: readonly SessionConfigOption[]) => void)
) => Promise<ManagedACPTransport>

type ChatSessionOptions = {
  isConfigured: ComputedRef<boolean>
  isACPProvider: ComputedRef<boolean>
  isHarnessProvider?: ComputedRef<boolean>
  providerID: Ref<AIProviderID>
  credentialsReady: Promise<void>
  getActiveEditorStore: () => EditorStore
  forceCloseTimeoutMs?: number
  createModelRuntime?: typeof createAIModelRuntime
  createACPTransportFactory?: CreateACPTransportFactory
  acpSessionStore?: AISessionStore
  resolveACPModelRole?: () => ResolvedAIModelRole | null
  resolveACPConfigurationContext?: (role: ResolvedAIModelRole) => unknown
  /** @deprecated Direct providers are resolved through the Design model profile. */
  resolveAPIKey?: (providerID: AIProviderID) => Promise<string | null>
  /** @deprecated Direct providers are resolved through the Design model profile. */
  modelID?: Ref<string>
  /** @deprecated Direct providers are resolved through the Design model profile. */
  customModelID?: Ref<string>
  /** @deprecated Direct providers are resolved through the Design model profile. */
  customBaseURL?: Ref<string>
  /** @deprecated Direct providers are resolved through the Design model profile. */
  customAPIType?: Ref<'completions' | 'responses'>
  /** @deprecated Direct providers are resolved through the Design model profile. */
  maxOutputTokens?: Ref<number>
}

type ToolLoopTransportOptions = {
  store: EditorStore
  providerID: AIProviderID
  model: LanguageModel
  effectiveModelID: string
  maxOutputTokens: number
  providerTools?: ToolSet
  providerOptions?: ToolLoopAgentSettings['providerOptions']
  reasoningEffort: string
}

export interface ACPSessionStatus {
  state: 'idle' | 'connecting' | 'resumed' | 'new' | 'fallback' | 'failed'
  sessionId: string | null
  requestedSessionId: string | null
  source: 'automatic' | 'manual'
  error: string | null
  persistenceError: string | null
  capabilities: ACPSessionCapabilities
}

export type ACPSessionHistoryMatch = 'exact' | 'same-document' | 'unverified'

export type ACPSessionHistoryItem = ACPSessionListItem & {
  /**
   * `exact` means the remote session ID matches OpenPencil's local binding for
   * this document and the complete active ACP configuration. Agent-provided
   * titles, timestamps, and working directories are never treated as identity.
   */
  match: ACPSessionHistoryMatch
}

export interface ACPSessionHistoryState {
  state: 'idle' | 'loading' | 'ready' | 'unsupported' | 'error'
  sessions: ACPSessionHistoryItem[]
  error: string | null
}

const ANTHROPIC_CACHE_CONTROL = {
  anthropic: { cacheControl: { type: 'ephemeral' } }
} as const
const MAX_CHAT_HISTORY_MESSAGES = 40
const MAX_CHAT_HISTORY_BYTES = 2 * 1024 * 1024
const FORCE_CLOSE_TIMEOUT_MS = 1_000
const RESERVED_DIRECT_AI_TOOL_NAMES = new Set(['create_module'])

function emptyACPSessionCapabilities(): ACPSessionCapabilities {
  return { list: false, resume: false, load: false }
}

function idleACPSessionStatus(): ACPSessionStatus {
  return {
    state: 'idle',
    sessionId: null,
    requestedSessionId: null,
    source: 'automatic',
    error: null,
    persistenceError: null,
    capabilities: emptyACPSessionCapabilities()
  }
}

function idleACPSessionHistory(): ACPSessionHistoryState {
  return { state: 'idle', sessions: [], error: null }
}

function acpSessionHistoryMatch(
  sessionId: string,
  exactSessionId: string | null,
  sameDocumentSessionIds: ReadonlySet<string>
): ACPSessionHistoryMatch {
  if (sessionId === exactSessionId) return 'exact'
  if (sameDocumentSessionIds.has(sessionId)) return 'same-document'
  return 'unverified'
}

async function identifyACPSessionHistory(
  sessions: readonly ACPSessionListItem[],
  binding: ActiveACPSessionBinding | null,
  store: EditorStore,
  expectedProviderID: AIProviderID,
  sessionStore: AISessionStore | undefined
): Promise<ACPSessionHistoryItem[]> {
  const currentBinding =
    binding?.store === store && binding.scope.providerId === expectedProviderID ? binding : null
  const sameDocumentSessionIds = new Set<string>()
  if (currentBinding && sessionStore) {
    try {
      const records = await sessionStore.listACPSessionsForDocument(
        currentBinding.scope.documentScopeId
      )
      for (const record of records) {
        if (record.providerId === expectedProviderID) {
          sameDocumentSessionIds.add(record.sessionId)
        }
      }
    } catch (error) {
      console.warn('[AI sessions] Failed to identify local ACP session history:', error)
    }
  }
  // `remember()` mutates the live binding after the first successful prompt.
  // Read the ID after the async catalog lookup so a concurrent first prompt
  // cannot leave an older binding marked as the exact match.
  const exactSessionId = currentBinding?.sessionId ?? null
  return sessions.map((session) => ({
    ...session,
    match: acpSessionHistoryMatch(session.sessionId, exactSessionId, sameDocumentSessionIds)
  }))
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    const message = error.message
    if (typeof message === 'string') return message
  }
  return String(error)
}

export { ACP_CHAT_CONTEXT_VERSION } from '@/app/ai/chat/acp-session-persistence'

async function settleWithin(promise: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs)
  })
  await Promise.race([promise.catch(() => undefined), timeout])
  clearTimeout(timer)
}

function estimateValueBytes(value: unknown, limit: number, seen = new WeakSet<object>()): number {
  if (limit < 0) return limit + 1
  if (typeof value === 'string') return Math.min(limit + 1, value.length * 2)
  if (value === null || value === undefined) return 4
  if (typeof value !== 'object') return 8
  if (seen.has(value)) return 0
  seen.add(value)

  let bytes = 0
  const entries: Array<[string, unknown]> = Array.isArray(value)
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value)
  for (const [key, item] of entries) {
    bytes += key.length * 2
    if (bytes > limit) return limit + 1
    bytes += estimateValueBytes(item, limit - bytes, seen)
    if (bytes > limit) return limit + 1
  }
  return bytes
}

export function trimChatHistory(messages: UIMessage[]): UIMessage[] {
  messages = archiveAssistantFileMessages(archiveVisualChatMessages(messages))
  if (messages.length === 0) return messages

  // Prefer the newest complete suffix, but never force an oversized newest
  // assistant into the window and then erase the conversation for lacking a
  // user start. If necessary, drop that suffix and find the newest user-led
  // window that actually fits.
  for (let end = messages.length; end > 0; end--) {
    let start = end
    let bytes = 0
    for (let index = end - 1; index >= 0; index--) {
      if (end - index > MAX_CHAT_HISTORY_MESSAGES) break
      const remaining = MAX_CHAT_HISTORY_BYTES - bytes
      const messageBytes = estimateValueBytes(messages[index], remaining)
      if (messageBytes > remaining) break
      start = index
      bytes += messageBytes
    }

    const bounded = messages.slice(start, end)
    const firstUser = bounded.findIndex((message) => message.role === 'user')
    if (firstUser !== -1) return firstUser > 0 ? bounded.slice(firstUser) : bounded
  }
  return []
}

function supportsAnthropicCaching(providerID: AIProviderID, modelID: string): boolean {
  return (
    providerID === 'anthropic' ||
    providerID === 'anthropic-compatible' ||
    (providerID === 'openrouter' && modelID.startsWith('anthropic/'))
  )
}

export function mergeAIToolSets(applicationTools: ToolSet, providerTools: ToolSet = {}): ToolSet {
  const conflicts = Object.keys(providerTools).filter(
    (name) => name in applicationTools || RESERVED_DIRECT_AI_TOOL_NAMES.has(name)
  )
  if (conflicts.length > 0) {
    throw new Error(
      `Provider tool name conflicts with an application tool: ${conflicts.join(', ')}`
    )
  }
  return { ...applicationTools, ...providerTools }
}

function mergeProviderOptions(
  runtimeOptions: ToolLoopAgentSettings['providerOptions'] | undefined,
  cacheOptions: typeof ANTHROPIC_CACHE_CONTROL | undefined,
  reasoningOptions: AIProviderOptions | undefined
): ToolLoopAgentSettings['providerOptions'] | undefined {
  if (!runtimeOptions && !cacheOptions && !reasoningOptions) return undefined
  return { ...runtimeOptions, ...cacheOptions, ...reasoningOptions }
}

export async function createACPTransport(
  providerID: AIProviderID,
  optionsOrConfigCallback?:
    | CreateACPTransportOptions
    | ((options: readonly SessionConfigOption[]) => void)
) {
  const agentId = providerID.replace('acp:', '') as ACPAgentID
  const agentDef = ACP_AGENTS.find((a) => a.id === agentId)
  if (!agentDef) throw new Error(`Unknown ACP agent: ${agentId}`)

  const { ACPChatTransport } = await import('@/app/ai/acp/transport')
  const { homeDir } = await import('@tauri-apps/api/path')
  const mcpServers = await buildRemoteMCPACPServerConfigs(
    designModelProfile.value?.featurePolicy.mcpServerIds ?? []
  )
  const options =
    typeof optionsOrConfigCallback === 'function'
      ? { onConfigOptionsChange: optionsOrConfigCallback }
      : (optionsOrConfigCallback ?? {})
  return new ACPChatTransport({
    agentDef,
    cwd: await homeDir(),
    mcpServers,
    ...options
  })
}

export function createToolLoopTransport({
  store,
  providerID,
  model,
  effectiveModelID,
  maxOutputTokens,
  providerTools,
  providerOptions: runtimeProviderOptions,
  reasoningEffort
}: ToolLoopTransportOptions) {
  const tools = mergeAIToolSets(createAITools(store), providerTools)
  const cacheProviderOptions = supportsAnthropicCaching(providerID, effectiveModelID)
    ? ANTHROPIC_CACHE_CONTROL
    : undefined
  const providerOptions = mergeProviderOptions(
    runtimeProviderOptions,
    cacheProviderOptions,
    buildReasoningProviderOptions(providerID, reasoningEffort)
  )

  const agent = new ToolLoopAgent({
    model,
    instructions: designSystemPromptFor('direct'),
    tools,
    stopWhen: stepCountIs(MAX_AGENT_STEPS),
    maxOutputTokens,
    providerOptions,
    prepareCall: (options) => {
      resetRunSteps(store)
      return {
        ...options,
        maxOutputTokens,
        providerOptions
      }
    },
    onStepFinish: ({ usage }) => {
      recordStepUsage(
        {
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          cacheReadTokens: usage.inputTokenDetails.cacheReadTokens ?? 0,
          cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens ?? 0,
          timestamp: Date.now()
        },
        store
      )
    }
  })

  return new DirectChatTransport({ agent }) as ChatTransport<UIMessage>
}

export function createChatSessionManager({
  isConfigured,
  isACPProvider,
  isHarnessProvider,
  providerID,
  credentialsReady,
  getActiveEditorStore,
  forceCloseTimeoutMs = FORCE_CLOSE_TIMEOUT_MS,
  createModelRuntime = createAIModelRuntime,
  createACPTransportFactory = createACPTransport,
  acpSessionStore,
  resolveACPModelRole,
  resolveACPConfigurationContext
}: ChatSessionOptions) {
  const failure = ref<AIChatFailure | null>(null)
  let transportDirty = false
  let currentChatStore: EditorStore | null = null
  let currentChatMessages = new WeakMap<EditorStore, UIMessage[]>()
  let chat: Chat<UIMessage> | null = null
  type ACPTransport = Awaited<ReturnType<CreateACPTransportFactory>>
  let acpTransportInstance: ACPTransport | null = null
  const closingACPTransports = new Set<ACPTransport>()
  let acpTransportClosePromise: Promise<void> = Promise.resolve()
  type ModelRuntimeHandle = { dispose: () => Promise<void> }
  let modelRuntimeHandle: ModelRuntimeHandle | null = null
  const closingModelRuntimes = new Set<ModelRuntimeHandle>()
  let modelRuntimeClosePromise: Promise<void> = Promise.resolve()
  let chatStopPromise: Promise<void> = Promise.resolve()
  let acpTransportGeneration = 0
  let chatInitializationGeneration = 0
  const sessionRevision = ref(0)
  let pendingChatInitialization: {
    generation: number
    store: EditorStore
    promise: Promise<Chat<UIMessage> | null>
  } | null = null
  let acpConfigUpdateGeneration = 0
  const acpConfigOptions = shallowRef<SessionConfigOption[]>([])
  const acpConfigUpdating = ref(false)
  const acpSessionStatus = shallowRef<ACPSessionStatus>(idleACPSessionStatus())
  const acpSessionHistory = shallowRef<ACPSessionHistoryState>(idleACPSessionHistory())
  let acpSessionHistoryGeneration = 0
  let manualRestoreGeneration = 0
  let manualRestoreInProgress = false
  let readyACPSessionHistory:
    | {
        transport: ACPTransport
        transportGeneration: number
        store: EditorStore
        providerID: AIProviderID
      }
    | undefined
  const acpSessionRestoreNotice = shallowRef<{ id: number } | null>(null)
  let acpSessionRestoreNoticeId = 0
  const acpSessionPersistence =
    acpSessionStore && resolveACPModelRole
      ? createACPSessionPersistence({
          sessionStore: acpSessionStore,
          resolveModelRole: resolveACPModelRole,
          resolveConfigurationContext: resolveACPConfigurationContext
        })
      : null
  let activeACPSessionBinding: ActiveACPSessionBinding | null = null
  let observedSourceStore: EditorStore | null = null
  let unbindSourceChanged: (() => void) | null = null
  let overrideTransport: (() => ChatTransport<UIMessage>) | null = null

  function resetACPSessionHistory() {
    acpSessionHistoryGeneration++
    readyACPSessionHistory = undefined
    acpSessionHistory.value = idleACPSessionHistory()
  }

  function handleChatFinish({
    finishReason,
    isAbort,
    isError
  }: {
    finishReason?: FinishReason
    isAbort: boolean
    isError: boolean
  }): void {
    if (!isAbort && !isError) failure.value = classifyAIChatFinish(finishReason)
  }

  function clearFailure(): void {
    failure.value = null
  }

  function resetACPSessionState() {
    manualRestoreGeneration++
    manualRestoreInProgress = false
    acpSessionStatus.value = idleACPSessionStatus()
    resetACPSessionHistory()
  }

  function sessionStatusFromSetup(
    event: ACPSessionSetupEvent,
    requestedSessionId: string | null,
    source: ACPSessionStatus['source']
  ): ACPSessionStatus {
    let state: ACPSessionStatus['state'] = event.method === 'resume' ? 'resumed' : 'new'
    if (event.restoreError || (requestedSessionId && event.method === 'new')) state = 'fallback'
    return {
      state,
      sessionId: event.sessionId,
      requestedSessionId,
      source,
      error: event.restoreError ?? null,
      persistenceError: null,
      capabilities: { ...event.capabilities }
    }
  }

  function observeACPSessionDurability(
    durability: Promise<void>,
    sessionId: string,
    isCurrent: () => boolean
  ): void {
    void durability.catch((error) => {
      if (!isCurrent() || acpSessionStatus.value.sessionId !== sessionId) return
      acpSessionStatus.value = {
        ...acpSessionStatus.value,
        persistenceError: errorMessage(error)
      }
    })
  }

  async function stopAndFinalizeChat(target: Chat<UIMessage>): Promise<void> {
    try {
      await target.stop()
    } finally {
      target.messages = finalizeInterruptedToolParts(target.messages)
    }
  }

  function stopChatInstance(target: Chat<UIMessage> | null): Promise<void> {
    if (!target) return chatStopPromise
    chatStopPromise = chatStopPromise.then(() => stopAndFinalizeChat(target)).catch(() => undefined)
    return chatStopPromise
  }

  function detachACPTransport(): Promise<void> {
    const transport = acpTransportInstance
    acpTransportInstance = null
    if (!transport) {
      return Promise.all([chatStopPromise, acpTransportClosePromise]).then(() => undefined)
    }

    closingACPTransports.add(transport)
    const close = chatStopPromise
      .then(() => transport.destroy())
      .catch(() => undefined)
      .finally(() => closingACPTransports.delete(transport))
    acpTransportClosePromise = Promise.all([acpTransportClosePromise, close]).then(() => undefined)
    return acpTransportClosePromise
  }

  function closeModelRuntime(handle: ModelRuntimeHandle): Promise<void> {
    if (modelRuntimeHandle === handle) modelRuntimeHandle = null
    closingModelRuntimes.add(handle)
    const close = chatStopPromise
      .then(() => handle.dispose())
      .catch(() => undefined)
      .finally(() => closingModelRuntimes.delete(handle))
    modelRuntimeClosePromise = Promise.all([modelRuntimeClosePromise, close]).then(() => undefined)
    return modelRuntimeClosePromise
  }

  function detachModelRuntime(): Promise<void> {
    const handle = modelRuntimeHandle
    return handle
      ? closeModelRuntime(handle)
      : Promise.all([chatStopPromise, modelRuntimeClosePromise]).then(() => undefined)
  }

  function forceDetachACPTransport(): Promise<void> {
    const transports = new Set(closingACPTransports)
    if (acpTransportInstance) transports.add(acpTransportInstance)
    acpTransportInstance = null

    const destroy = Promise.all(
      [...transports].map((transport) =>
        transport
          .destroy()
          .catch(() => undefined)
          .finally(() => closingACPTransports.delete(transport))
      )
    ).then(() => undefined)
    const close = settleWithin(destroy, forceCloseTimeoutMs)
    // A graceful close can be permanently blocked behind Chat.stop(). Force stop
    // deliberately abandons that barrier so a replacement session can start.
    acpTransportClosePromise = close
    return close
  }

  function forceDetachModelRuntime(): Promise<void> {
    const runtimes = new Set(closingModelRuntimes)
    if (modelRuntimeHandle) runtimes.add(modelRuntimeHandle)
    modelRuntimeHandle = null
    closingModelRuntimes.clear()

    const destroy = Promise.all(
      [...runtimes].map((handle) =>
        Promise.resolve()
          .then(() => handle.dispose())
          .catch(() => undefined)
      )
    ).then(() => undefined)
    const close = settleWithin(destroy, forceCloseTimeoutMs)
    // As with ACP, force stop deliberately abandons any graceful close that is
    // still queued behind a provider's hung Chat.stop(). The runtime disposer
    // is idempotent, so a released graceful chain can safely converge later.
    modelRuntimeClosePromise = close
    return close
  }

  function invalidateTransport(clearMessagesFor: EditorStore | 'all') {
    transportDirty = true
    const discardedChat = chat
    void stopChatInstance(discardedChat)
    chat = null
    currentChatStore = null
    if (clearMessagesFor === 'all') currentChatMessages = new WeakMap()
    else currentChatMessages.delete(clearMessagesFor)
    chatInitializationGeneration++
    pendingChatInitialization = null
    acpTransportGeneration++
    acpConfigUpdateGeneration++
    activeACPSessionBinding = null
    acpSessionRestoreNotice.value = null
    resetACPSessionState()
    void detachACPTransport()
    void detachModelRuntime()
    acpConfigOptions.value = []
    acpConfigUpdating.value = false
    sessionRevision.value++
  }

  function markTransportDirty() {
    invalidateTransport('all')
  }

  function observeDocumentSource(store: EditorStore) {
    if (observedSourceStore === store) return
    unbindSourceChanged?.()
    observedSourceStore = store
    const observable: object = store
    unbindSourceChanged = isSourceChangeObservable(observable)
      ? observable.onSourceChanged(() => {
          if (store !== getActiveEditorStore() || !isACPProvider.value || !acpSessionPersistence) {
            return
          }
          const binding = activeACPSessionBinding
          if (!binding || binding.store !== store) {
            invalidateTransport(store)
            return
          }
          const transition = acpSessionPersistence.reconcileDocumentIdentity(binding)
          if (transition === 'new-document') invalidateTransport(store)
        })
      : null
  }

  async function createActiveACPTransport(store: EditorStore) {
    const generation = ++acpTransportGeneration
    const expectedProviderID = providerID.value
    acpConfigOptions.value = []
    resetACPSessionHistory()
    await detachACPTransport()
    if (generation !== acpTransportGeneration) {
      throw new Error('ACP provider changed while the previous session was closing.')
    }

    const sessionBinding = (await acpSessionPersistence?.resolve(store, expectedProviderID)) ?? null
    if (generation !== acpTransportGeneration || store !== getActiveEditorStore()) {
      throw new Error('ACP provider changed while the session binding was loading.')
    }
    activeACPSessionBinding = sessionBinding

    const requestedSessionId = sessionBinding?.sessionId ?? null
    acpSessionStatus.value = {
      state: 'connecting',
      sessionId: null,
      requestedSessionId,
      source: 'automatic',
      error: null,
      persistenceError: null,
      capabilities: emptyACPSessionCapabilities()
    }

    let transport: ACPTransport | null = null
    try {
      transport = await createACPTransportFactory(expectedProviderID, {
        initialSessionId: requestedSessionId ?? undefined,
        onConfigOptionsChange: (options) => {
          if (generation === acpTransportGeneration) acpConfigOptions.value = [...options]
        },
        onSessionSetup: (event) => {
          if (
            generation === acpTransportGeneration &&
            store === getActiveEditorStore() &&
            expectedProviderID === providerID.value &&
            isACPProvider.value
          ) {
            acpSessionStatus.value = sessionStatusFromSetup(event, requestedSessionId, 'automatic')
          }
        },
        onSessionOpened: (event) => {
          if (
            generation !== acpTransportGeneration ||
            !acpSessionPersistence ||
            !sessionBinding ||
            activeACPSessionBinding !== sessionBinding ||
            store !== getActiveEditorStore() ||
            expectedProviderID !== providerID.value ||
            !isACPProvider.value
          ) {
            return
          }
          const remembered = acpSessionPersistence.remember(sessionBinding, event)
          observeACPSessionDurability(remembered.durability, event.sessionId, () =>
            Boolean(
              generation === acpTransportGeneration &&
              activeACPSessionBinding === sessionBinding &&
              store === getActiveEditorStore() &&
              expectedProviderID === providerID.value &&
              isACPProvider.value
            )
          )
          if (remembered.documentChanged) {
            invalidateTransport(store)
          } else if (remembered.restoreFailed) {
            acpSessionRestoreNotice.value = { id: ++acpSessionRestoreNoticeId }
          }
        }
      })
      if (generation !== acpTransportGeneration) {
        throw new Error('ACP provider changed while the session was starting.')
      }
      acpTransportInstance = transport
      await transport.connect()
      if (generation !== acpTransportGeneration) {
        throw new Error('ACP provider changed while the session was connecting.')
      }
      return transport as ChatTransport<UIMessage>
    } catch (error) {
      if (transport && acpTransportInstance === transport) acpTransportInstance = null
      if (generation === acpTransportGeneration) {
        acpConfigOptions.value = []
        acpSessionStatus.value = {
          state: 'failed',
          sessionId: null,
          requestedSessionId,
          source: 'automatic',
          error: errorMessage(error),
          persistenceError: null,
          capabilities: { ...acpSessionStatus.value.capabilities }
        }
      }
      await transport?.destroy().catch(() => undefined)
      throw error
    }
  }

  async function createTransport(store: EditorStore) {
    resetACPDiagnostics()
    acpConfigOptions.value = []
    if (overrideTransport) return { transport: overrideTransport(), dispose: undefined }

    const runtime = await createModelRuntime('design')
    const harnessProviderActive = isHarnessProvider?.value ?? providerID.value === 'harness:pi'
    if (harnessProviderActive) {
      if (runtime?.kind !== 'harness') {
        throw new Error('The Design agent is not configured for Pi')
      }
      const [{ HarnessChatTransport }, { buildPiMCPServers }, { getActiveTabId }] =
        await Promise.all([
          import('@/app/ai/harness/transport'),
          import('@/app/integrations/mcp'),
          import('@/app/tabs')
        ])
      const apiKey = await resolveModelConnectionAPIKey(runtime.role.connection.id)
      if (!apiKey) throw new Error('Credential is unavailable for the Pi agent')
      const model = runtime.role.profile.customModelID || runtime.role.profile.modelID
      const harnessTransport = new HarnessChatTransport(
        `tab-${getActiveTabId()}-${runtime.role.profile.id}`,
        {
          adapter: 'pi',
          sandbox: 'just-bash',
          model,
          settings: {
            thinkingLevel: runtime.role.profile.harnessThinkingLevel ?? 'medium',
            permissionMode: runtime.role.profile.harnessPermissionMode ?? 'allow-edits'
          },
          instructions: designSystemPromptFor('delegated'),
          mcpServers: await buildPiMCPServers()
        },
        { OPENPENCIL_HARNESS_API_KEY: apiKey }
      )
      return {
        transport: new VisualReferenceChatTransport({
          transport: harnessTransport,
          // The Harness protocol currently forwards text only. Route images
          // through the configured direct Vision role instead of dropping them.
          designSupportsVision: false,
          analyze: createVisionRoleAnalyzer()
        }) as ChatTransport<UIMessage>,
        dispose: () => harnessTransport.destroy()
      }
    }
    if (runtime?.kind !== 'direct') {
      throw new Error('The Design model is not configured for direct API access')
    }
    try {
      const transport = createToolLoopTransport({
        store,
        providerID: runtime.role.connection.providerID,
        model: runtime.model,
        effectiveModelID: resolveLanguageModelID({
          providerID: runtime.role.connection.providerID,
          modelID: runtime.role.profile.modelID,
          customModelID: runtime.role.profile.customModelID
        }),
        maxOutputTokens: runtime.role.profile.maxOutputTokens,
        providerTools: runtime.providerTools,
        providerOptions: runtime.providerOptions,
        reasoningEffort: runtime.role.profile.reasoningEffort ?? ''
      })
      return {
        transport: new VisualReferenceChatTransport({
          transport,
          designSupportsVision: runtime.role.profile.capabilities.includes('vision'),
          analyze: createVisionRoleAnalyzer()
        }) as ChatTransport<UIMessage>,
        dispose: runtime.dispose
      }
    } catch (error) {
      await runtime.dispose?.().catch(() => undefined)
      throw error
    }
  }

  function createManagedChat(
    transport: ChatTransport<UIMessage>,
    store: EditorStore,
    generation: number,
    messages?: UIMessage[]
  ): Chat<UIMessage> {
    const createdChat = new Chat<UIMessage>({
      transport,
      messages: messages ? trimChatHistory(messages) : undefined,
      sendAutomaticallyWhen: (options) =>
        generation === chatInitializationGeneration &&
        !transportDirty &&
        currentChatStore === store &&
        getActiveEditorStore() === store &&
        lastAssistantMessageIsCompleteWithApprovalResponses(options),
      onError: (error) => {
        failure.value = classifyAIChatError(error)
        // Preserve the original detail in the bounded/redacted debug failure,
        // but never expose provider text through Chat.error consumers.
        try {
          error.message = 'AI request failed'
        } catch (redactionError) {
          // Some provider error objects expose a read-only message.
          void redactionError
        }
      },
      onFinish: ({ messages: finishedMessages, finishReason, isAbort, isError }) => {
        handleChatFinish({ finishReason, isAbort, isError })
        let settledMessages = finishedMessages
        if (isAbort) {
          settledMessages = finalizeInterruptedToolParts(finishedMessages)
        } else if (isError) {
          settledMessages = finalizeUnfinishedToolParts(
            finishedMessages,
            failure.value?.detail || createdChat.error?.message || 'AI request failed'
          )
        }
        createdChat.messages = trimChatHistory(settledMessages)
      }
    })
    return createdChat
  }

  async function initializeChat(
    store: EditorStore,
    generation: number
  ): Promise<Chat<UIMessage> | null> {
    await chatStopPromise
    await credentialsReady
    if (generation !== chatInitializationGeneration || store !== getActiveEditorStore()) {
      return ensureChat()
    }
    if (!isConfigured.value) return null

    const messages = currentChatMessages.get(store)
    resetACPDiagnostics()

    let transport: ChatTransport<UIMessage>
    let pendingModelRuntime: Awaited<ReturnType<typeof createTransport>> | null = null
    if (isACPProvider.value) {
      await detachModelRuntime()
      transport = await createActiveACPTransport(store)
    } else {
      await detachACPTransport()
      await detachModelRuntime()
      pendingModelRuntime = await createTransport(store)
      transport = pendingModelRuntime.transport
    }

    if (generation !== chatInitializationGeneration || store !== getActiveEditorStore()) {
      if (transport === acpTransportInstance) await detachACPTransport()
      if (pendingModelRuntime?.dispose) await pendingModelRuntime.dispose().catch(() => undefined)
      return ensureChat()
    }
    if (pendingModelRuntime?.dispose) {
      let disposePromise: Promise<void> | null = null
      modelRuntimeHandle = {
        dispose: () => {
          disposePromise ??= pendingModelRuntime.dispose?.() ?? Promise.resolve()
          return disposePromise
        }
      }
    }

    const createdChat = createManagedChat(transport, store, generation, messages)
    chat = createdChat
    currentChatStore = store
    transportDirty = false
    return chat
  }

  function ensureChat(): Promise<Chat<UIMessage> | null> {
    const store = getActiveEditorStore()
    observeDocumentSource(store)
    if (currentChatStore === store && chat && !transportDirty) return Promise.resolve(chat)

    const pending = pendingChatInitialization
    if (pending && pending.generation === chatInitializationGeneration && pending.store === store) {
      return pending.promise
    }

    if (currentChatStore && chat) {
      chat.messages = finalizeInterruptedToolParts(chat.messages)
      currentChatMessages.set(currentChatStore, trimChatHistory(chat.messages))
    }
    void stopChatInstance(chat)
    chat = null
    currentChatStore = null

    const generation = ++chatInitializationGeneration
    const promise = initializeChat(store, generation)
      .catch((error: unknown) => {
        if (generation !== chatInitializationGeneration) return ensureChat()
        throw error
      })
      .finally(() => {
        if (pendingChatInitialization?.promise === promise) pendingChatInitialization = null
      })
    pendingChatInitialization = { generation, store, promise }
    return promise
  }

  async function respondToToolApproval(
    target: Chat<UIMessage>,
    messageId: string,
    approvalId: string,
    approved: boolean
  ): Promise<boolean> {
    const activeStore = getActiveEditorStore()
    if (
      target !== chat ||
      transportDirty ||
      currentChatStore !== activeStore ||
      !hasPendingToolApproval(target.messages, messageId, approvalId)
    ) {
      return false
    }

    await target.addToolApprovalResponse({ id: approvalId, approved })
    return true
  }

  async function resetChat(): Promise<void> {
    failure.value = null
    const resetStore = getActiveEditorStore()
    const expectedProviderID = providerID.value
    const knownBinding =
      activeACPSessionBinding?.store === resetStore &&
      activeACPSessionBinding.scope.providerId === expectedProviderID
        ? activeACPSessionBinding
        : null
    if (chat && currentChatStore && currentChatStore !== resetStore) {
      chat.messages = finalizeInterruptedToolParts(chat.messages)
      currentChatMessages.set(currentChatStore, trimChatHistory(chat.messages))
    }
    void stopChatInstance(chat)
    currentChatMessages.delete(resetStore)
    chatInitializationGeneration++
    pendingChatInitialization = null
    acpTransportGeneration++
    acpConfigUpdateGeneration++
    activeACPSessionBinding = null
    acpSessionRestoreNotice.value = null
    resetACPSessionState()
    chat = null
    currentChatStore = null
    transportDirty = false
    acpConfigOptions.value = []
    acpConfigUpdating.value = false
    const bindingPromise =
      !knownBinding && isACPProvider.value && acpSessionPersistence
        ? acpSessionPersistence.resolve(resetStore, expectedProviderID)
        : Promise.resolve(knownBinding)
    const [discardedACPSessionBinding] = await Promise.all([
      bindingPromise,
      detachACPTransport(),
      detachModelRuntime()
    ] as const)
    await (acpSessionPersistence?.forget(discardedACPSessionBinding) ?? Promise.resolve())
    sessionRevision.value++
  }

  async function forceStopChat(): Promise<void> {
    failure.value = null
    const resumableACPSessionBinding = activeACPSessionBinding
    const discardedChat = chat
    if (discardedChat) {
      discardedChat.messages = finalizeInterruptedToolParts(discardedChat.messages)
    }
    const canPreserveMessages =
      !isACPProvider.value || Boolean(resumableACPSessionBinding?.sessionId)
    if (currentChatStore && discardedChat && canPreserveMessages) {
      currentChatMessages.set(currentChatStore, trimChatHistory(discardedChat.messages))
    } else if (currentChatStore) {
      currentChatMessages.delete(currentChatStore)
    }
    // Keep aborting the SDK chat as a best effort, but never let a provider's
    // hung stop promise poison future chat initialization.
    chatStopPromise = Promise.resolve()
    if (discardedChat) {
      void Promise.resolve()
        .then(() => discardedChat.stop())
        .catch(() => undefined)
    }
    chatInitializationGeneration++
    pendingChatInitialization = null
    acpTransportGeneration++
    acpConfigUpdateGeneration++
    activeACPSessionBinding = null
    acpSessionRestoreNotice.value = null
    resetACPSessionState()
    chat = null
    currentChatStore = null
    transportDirty = false
    acpConfigOptions.value = []
    acpConfigUpdating.value = false
    await Promise.all([forceDetachACPTransport(), forceDetachModelRuntime()])
    sessionRevision.value++
  }

  function setOverrideTransport(factory: (() => ChatTransport<UIMessage>) | null) {
    overrideTransport = factory
    markTransportDirty()
  }

  function isChatBusy(target: Chat<UIMessage>): boolean {
    return target.status === 'submitted' || target.status === 'streaming'
  }

  function historyRequestIsCurrent(
    requestGeneration: number,
    transportGeneration: number,
    transport: ACPTransport,
    store: EditorStore,
    expectedProviderID: AIProviderID
  ): boolean {
    return (
      requestGeneration === acpSessionHistoryGeneration &&
      transportGeneration === acpTransportGeneration &&
      transport === acpTransportInstance &&
      currentChatStore === store &&
      store === getActiveEditorStore() &&
      expectedProviderID === providerID.value &&
      isACPProvider.value &&
      !transportDirty
    )
  }

  function activeACPContextMatches(store: EditorStore, expectedProviderID: AIProviderID): boolean {
    return (
      isACPProvider.value &&
      store === getActiveEditorStore() &&
      expectedProviderID === providerID.value
    )
  }

  async function refreshACPSessionHistory(): Promise<void> {
    const store = getActiveEditorStore()
    const expectedProviderID = providerID.value
    if (!isACPProvider.value) {
      resetACPSessionHistory()
      acpSessionHistory.value = { state: 'unsupported', sessions: [], error: null }
      return
    }

    if (
      !acpTransportInstance ||
      currentChatStore !== store ||
      transportDirty ||
      pendingChatInitialization
    ) {
      try {
        await ensureChat()
      } catch (error) {
        if (activeACPContextMatches(store, expectedProviderID)) {
          resetACPSessionHistory()
          acpSessionHistory.value = {
            state: 'error',
            sessions: [],
            error: errorMessage(error)
          }
        }
        return
      }
    }

    const transport = acpTransportInstance
    if (
      !transport ||
      currentChatStore !== store ||
      !activeACPContextMatches(store, expectedProviderID)
    ) {
      return
    }

    const capabilities = acpSessionStatus.value.capabilities
    if (!capabilities.list || !transport.listSessions) {
      resetACPSessionHistory()
      acpSessionHistory.value = { state: 'unsupported', sessions: [], error: null }
      return
    }

    const requestGeneration = ++acpSessionHistoryGeneration
    const transportGeneration = acpTransportGeneration
    readyACPSessionHistory = undefined
    acpSessionHistory.value = { state: 'loading', sessions: [], error: null }
    try {
      const sessions = await transport.listSessions()
      if (
        !historyRequestIsCurrent(
          requestGeneration,
          transportGeneration,
          transport,
          store,
          expectedProviderID
        )
      ) {
        return
      }
      const identifiedSessions = await identifyACPSessionHistory(
        sessions,
        activeACPSessionBinding,
        store,
        expectedProviderID,
        acpSessionStore
      )
      if (
        !historyRequestIsCurrent(
          requestGeneration,
          transportGeneration,
          transport,
          store,
          expectedProviderID
        )
      ) {
        return
      }
      acpSessionHistory.value = { state: 'ready', sessions: identifiedSessions, error: null }
      readyACPSessionHistory = {
        transport,
        transportGeneration,
        store,
        providerID: expectedProviderID
      }
    } catch (error) {
      if (
        !historyRequestIsCurrent(
          requestGeneration,
          transportGeneration,
          transport,
          store,
          expectedProviderID
        )
      ) {
        return
      }
      readyACPSessionHistory = undefined
      acpSessionHistory.value = {
        state: 'error',
        sessions: [],
        error: errorMessage(error)
      }
    }
  }

  function closeReplacedACPTransport(
    replacedChat: Chat<UIMessage>,
    replacedTransport: ACPTransport
  ): void {
    const stopped = stopChatInstance(replacedChat)
    closingACPTransports.add(replacedTransport)
    const close = stopped
      .then(() => replacedTransport.destroy())
      .catch(() => undefined)
      .finally(() => closingACPTransports.delete(replacedTransport))
    acpTransportClosePromise = Promise.all([acpTransportClosePromise, close]).then(() => undefined)
  }

  type ManualRestoreTarget = {
    historyContext: NonNullable<typeof readyACPSessionHistory>
    store: EditorStore
    expectedProviderID: AIProviderID
    replacedTransport: ACPTransport
    replacedChat: Chat<UIMessage>
    previousStatus: ACPSessionStatus
  }

  function manualRestoreHistoryIsCurrent(
    historyContext: NonNullable<typeof readyACPSessionHistory>,
    store: EditorStore,
    expectedProviderID: AIProviderID,
    transport: ACPTransport
  ): boolean {
    return (
      isACPProvider.value &&
      currentChatStore === store &&
      !transportDirty &&
      historyContext.transport === transport &&
      historyContext.transportGeneration === acpTransportGeneration &&
      historyContext.store === store &&
      historyContext.providerID === expectedProviderID
    )
  }

  function requireManualRestoreTarget(sessionId: string): ManualRestoreTarget {
    const history = acpSessionHistory.value
    const historyContext = readyACPSessionHistory
    if (history.state !== 'ready' || !historyContext) {
      throw new Error('Choose a session from the latest loaded ACP session history.')
    }
    if (!history.sessions.some((session) => session.sessionId === sessionId)) {
      throw new Error('Choose a session from the latest loaded ACP session history.')
    }
    if (sessionId === acpSessionStatus.value.sessionId) {
      throw new Error('The requested ACP session is already active.')
    }
    if (manualRestoreInProgress) {
      throw new Error('Another ACP session is still being restored.')
    }

    const store = getActiveEditorStore()
    const expectedProviderID = providerID.value
    const replacedTransport = acpTransportInstance
    const replacedChat = chat
    if (!replacedTransport || !replacedChat) {
      throw new Error('The ACP session history is stale. Reload it and try again.')
    }
    if (
      !manualRestoreHistoryIsCurrent(historyContext, store, expectedProviderID, replacedTransport)
    ) {
      throw new Error('The ACP session history is stale. Reload it and try again.')
    }
    if (!acpSessionStatus.value.capabilities.resume) {
      throw new Error('The active ACP agent does not support session resume.')
    }
    if (isChatBusy(replacedChat)) {
      throw new Error('Wait for the current AI response to finish before restoring a session.')
    }
    return {
      historyContext,
      store,
      expectedProviderID,
      replacedTransport,
      replacedChat,
      previousStatus: acpSessionStatus.value
    }
  }

  async function restoreACPSession(sessionId: string): Promise<void> {
    const { store, expectedProviderID, replacedTransport, replacedChat, previousStatus } =
      requireManualRestoreTarget(sessionId)

    const restoreGeneration = ++manualRestoreGeneration
    manualRestoreInProgress = true
    acpSessionStatus.value = {
      state: 'connecting',
      sessionId: previousStatus.sessionId,
      requestedSessionId: sessionId,
      source: 'manual',
      error: null,
      persistenceError: previousStatus.persistenceError,
      capabilities: { ...previousStatus.capabilities }
    }

    let candidateTransport: ACPTransport | null = null
    let candidateBinding: ActiveACPSessionBinding | null = null
    let candidateSetup: ACPSessionSetupEvent | null = null
    let candidateConfigOptions: SessionConfigOption[] = []
    let candidateActive = false
    const contextIsCurrent = () =>
      restoreGeneration === manualRestoreGeneration &&
      replacedTransport === acpTransportInstance &&
      replacedChat === chat &&
      currentChatStore === store &&
      store === getActiveEditorStore() &&
      expectedProviderID === providerID.value &&
      isACPProvider.value &&
      !transportDirty

    try {
      const resolvedBinding =
        (await acpSessionPersistence?.resolve(store, expectedProviderID)) ?? null
      if (!contextIsCurrent()) {
        throw new Error('The active document or ACP provider changed while restoring the session.')
      }
      // Keep the previous persisted/live ID until the resumed session proves it
      // can complete a prompt. This also prevents a first Save of an unsaved
      // document from durably binding an unverified manual candidate.
      candidateBinding = resolvedBinding ? { ...resolvedBinding } : null

      candidateTransport = await createACPTransportFactory(expectedProviderID, {
        initialSessionId: sessionId,
        resumeFallback: 'error',
        onConfigOptionsChange: (options) => {
          candidateConfigOptions = [...options]
          if (candidateActive && candidateTransport === acpTransportInstance) {
            acpConfigOptions.value = [...options]
          }
        },
        onSessionSetup: (event) => {
          candidateSetup = event
        },
        onSessionOpened: (event: ACPSessionOpenedEvent) => {
          if (
            !candidateActive ||
            candidateTransport !== acpTransportInstance ||
            !acpSessionPersistence ||
            !candidateBinding ||
            activeACPSessionBinding !== candidateBinding ||
            store !== getActiveEditorStore() ||
            expectedProviderID !== providerID.value ||
            !isACPProvider.value
          ) {
            return
          }
          if (event.method !== 'resume' || event.sessionId !== sessionId) {
            acpSessionStatus.value = {
              state: 'failed',
              sessionId,
              requestedSessionId: sessionId,
              source: 'manual',
              error: 'The ACP agent opened a different session than the one requested.',
              persistenceError: null,
              capabilities: { ...acpSessionStatus.value.capabilities }
            }
            return
          }
          const remembered = acpSessionPersistence.remember(candidateBinding, event)
          observeACPSessionDurability(remembered.durability, event.sessionId, () =>
            Boolean(
              candidateActive &&
              candidateTransport === acpTransportInstance &&
              activeACPSessionBinding === candidateBinding &&
              store === getActiveEditorStore() &&
              expectedProviderID === providerID.value &&
              isACPProvider.value
            )
          )
          if (remembered.documentChanged) invalidateTransport(store)
        }
      })
      if (!contextIsCurrent()) {
        throw new Error('The active document or ACP provider changed while restoring the session.')
      }
      await candidateTransport.connect()
      if (!contextIsCurrent()) {
        throw new Error('The active document or ACP provider changed while restoring the session.')
      }
      if (isChatBusy(replacedChat)) {
        throw new Error('The current AI response started while the session was being restored.')
      }
      const setup = candidateSetup as ACPSessionSetupEvent | null
      if (setup?.method !== 'resume' || setup.sessionId !== sessionId || setup.restoreError) {
        throw new Error('The ACP agent did not resume the requested session.')
      }

      const replacementGeneration = ++chatInitializationGeneration
      pendingChatInitialization = null
      acpTransportGeneration++
      acpConfigUpdateGeneration++
      const replacementChat = createManagedChat(candidateTransport, store, replacementGeneration)

      candidateActive = true
      acpTransportInstance = candidateTransport
      activeACPSessionBinding = candidateBinding
      chat = replacementChat
      currentChatStore = store
      currentChatMessages.delete(store)
      transportDirty = false
      acpConfigOptions.value = [...candidateConfigOptions]
      acpConfigUpdating.value = false
      acpSessionRestoreNotice.value = null
      acpSessionStatus.value = sessionStatusFromSetup(setup, sessionId, 'manual')
      resetACPSessionHistory()
      manualRestoreInProgress = false
      sessionRevision.value++
      closeReplacedACPTransport(replacedChat, replacedTransport)
    } catch (error) {
      if (!candidateActive) await candidateTransport?.destroy().catch(() => undefined)
      if (restoreGeneration === manualRestoreGeneration) {
        manualRestoreInProgress = false
        acpSessionStatus.value = {
          ...previousStatus,
          requestedSessionId: sessionId,
          source: 'manual',
          error: errorMessage(error)
        }
      }
      throw error
    }
  }

  async function setACPConfigOption(configId: string, value: string): Promise<void> {
    const transport = acpTransportInstance
    if (!transport) throw new Error('ACP session is not ready yet.')
    if (acpConfigUpdating.value) throw new Error('Another ACP setting is still updating.')

    const updateGeneration = ++acpConfigUpdateGeneration
    acpConfigUpdating.value = true
    try {
      await transport.setSessionConfigOption(configId, value)
    } finally {
      if (updateGeneration === acpConfigUpdateGeneration) acpConfigUpdating.value = false
    }
  }

  return {
    ensureChat,
    respondToToolApproval,
    resetChat,
    forceStopChat,
    markTransportDirty,
    sessionRevision: readonly(sessionRevision),
    setOverrideTransport,
    acpConfigOptions,
    acpConfigUpdating,
    acpSessionStatus,
    acpSessionHistory,
    acpSessionRestoreNotice,
    refreshACPSessionHistory,
    restoreACPSession,
    setACPConfigOption,
    failure,
    clearFailure
  }
}
