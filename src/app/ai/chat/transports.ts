import type { SessionConfigOption } from '@agentclientprotocol/sdk'
import { Chat } from '@ai-sdk/vue'
import { DirectChatTransport, stepCountIs, ToolLoopAgent } from 'ai'
import type { ChatTransport, LanguageModel, UIMessage } from 'ai'
import { ref, shallowRef } from 'vue'
import type { ComputedRef, Ref } from 'vue'

import { ACP_AGENTS } from '@open-pencil/core/constants'
import type { ACPAgentID, AIProviderID } from '@open-pencil/core/constants'

import { resetAcpDiagnostics } from '@/app/ai/acp/diagnostics'
import { archiveVisualChatMessages } from '@/app/ai/chat/attachments'
import {
  finalizeInterruptedToolParts,
  finalizeUnfinishedToolParts
} from '@/app/ai/chat/interruption'
import { resolveLanguageModelID } from '@/app/ai/chat/model'
import SYSTEM_PROMPT from '@/app/ai/chat/system-prompt.md?raw'
import {
  createVisionRoleAnalyzer,
  VisualReferenceChatTransport
} from '@/app/ai/chat/visual-transport'
import { createAIModelRuntime } from '@/app/ai/models'
import { MAX_AGENT_STEPS, createAITools, recordStepUsage, resetRunSteps } from '@/app/ai/tools'
import type { getActiveEditorStore } from '@/app/editor/active-store'

type EditorStore = ReturnType<typeof getActiveEditorStore>

type ChatSessionOptions = {
  isConfigured: ComputedRef<boolean>
  isACPProvider: ComputedRef<boolean>
  providerID: Ref<AIProviderID>
  credentialsReady: Promise<void>
  getActiveEditorStore: () => EditorStore
  forceCloseTimeoutMs?: number
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
}

const ANTHROPIC_CACHE_CONTROL = {
  anthropic: { cacheControl: { type: 'ephemeral' } }
} as const
const MAX_CHAT_HISTORY_MESSAGES = 40
const MAX_CHAT_HISTORY_BYTES = 2 * 1024 * 1024
const FORCE_CLOSE_TIMEOUT_MS = 1_000

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
  messages = archiveVisualChatMessages(messages)
  if (messages.length === 0) return messages
  let start = messages.length
  let bytes = 0
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages.length - index > MAX_CHAT_HISTORY_MESSAGES) break
    const remaining = MAX_CHAT_HISTORY_BYTES - bytes
    const messageBytes = estimateValueBytes(messages[index], remaining)
    if (messageBytes > remaining && start < messages.length) break
    start = index
    bytes += messageBytes
  }

  const bounded = messages.slice(start)
  const firstUser = bounded.findIndex((message) => message.role === 'user')
  if (firstUser === -1) return []
  return firstUser > 0 ? bounded.slice(firstUser) : bounded
}

function supportsAnthropicCaching(providerID: AIProviderID, modelID: string): boolean {
  return (
    providerID === 'anthropic' ||
    providerID === 'anthropic-compatible' ||
    (providerID === 'openrouter' && modelID.startsWith('anthropic/'))
  )
}

export async function createACPTransport(
  providerID: AIProviderID,
  onConfigOptionsChange?: (options: readonly SessionConfigOption[]) => void
) {
  const agentId = providerID.replace('acp:', '') as ACPAgentID
  const agentDef = ACP_AGENTS.find((a) => a.id === agentId)
  if (!agentDef) throw new Error(`Unknown ACP agent: ${agentId}`)

  const { ACPChatTransport } = await import('@/app/ai/acp/transport')
  const { homeDir } = await import('@tauri-apps/api/path')
  return new ACPChatTransport({ agentDef, cwd: await homeDir(), onConfigOptionsChange })
}

export function createToolLoopTransport({
  store,
  providerID,
  model,
  effectiveModelID,
  maxOutputTokens
}: ToolLoopTransportOptions) {
  const tools = createAITools(store)
  const cacheProviderOptions = supportsAnthropicCaching(providerID, effectiveModelID)
    ? ANTHROPIC_CACHE_CONTROL
    : undefined

  const agent = new ToolLoopAgent({
    model,
    instructions: SYSTEM_PROMPT,
    tools,
    stopWhen: stepCountIs(MAX_AGENT_STEPS),
    maxOutputTokens,
    providerOptions: cacheProviderOptions,
    prepareCall: (options) => {
      resetRunSteps(store)
      return {
        ...options,
        maxOutputTokens,
        providerOptions: cacheProviderOptions
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
  providerID,
  credentialsReady,
  getActiveEditorStore,
  forceCloseTimeoutMs = FORCE_CLOSE_TIMEOUT_MS
}: ChatSessionOptions) {
  let transportDirty = false
  let currentChatStore: EditorStore | null = null
  let currentChatMessages = new WeakMap<EditorStore, UIMessage[]>()
  let chat: Chat<UIMessage> | null = null
  type ACPTransport = Awaited<ReturnType<typeof createACPTransport>>
  let acpTransportInstance: ACPTransport | null = null
  const closingACPTransports = new Set<ACPTransport>()
  let acpTransportClosePromise: Promise<void> = Promise.resolve()
  let chatStopPromise: Promise<void> = Promise.resolve()
  let acpTransportGeneration = 0
  let chatInitializationGeneration = 0
  let pendingChatInitialization: {
    generation: number
    store: EditorStore
    promise: Promise<Chat<UIMessage> | null>
  } | null = null
  let acpConfigUpdateGeneration = 0
  const acpConfigOptions = shallowRef<SessionConfigOption[]>([])
  const acpConfigUpdating = ref(false)
  let overrideTransport: (() => ChatTransport<UIMessage>) | null = null

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

  function markTransportDirty() {
    void stopChatInstance(chat)
    transportDirty = true
    currentChatStore = null
    currentChatMessages = new WeakMap()
    chatInitializationGeneration++
    pendingChatInitialization = null
    acpTransportGeneration++
    acpConfigUpdateGeneration++
    void detachACPTransport()
    acpConfigOptions.value = []
    acpConfigUpdating.value = false
  }

  async function createActiveACPTransport() {
    const generation = ++acpTransportGeneration
    acpConfigOptions.value = []
    await detachACPTransport()
    if (generation !== acpTransportGeneration) {
      throw new Error('ACP provider changed while the previous session was closing.')
    }

    const transport = await createACPTransport(providerID.value, (options) => {
      if (generation === acpTransportGeneration) acpConfigOptions.value = [...options]
    })
    if (generation !== acpTransportGeneration) {
      await transport.destroy().catch(() => undefined)
      throw new Error('ACP provider changed while the session was starting.')
    }
    acpTransportInstance = transport
    try {
      await transport.connect()
      if (generation !== acpTransportGeneration) {
        throw new Error('ACP provider changed while the session was connecting.')
      }
      return transport as ChatTransport<UIMessage>
    } catch (error) {
      if (acpTransportInstance === transport) acpTransportInstance = null
      if (generation === acpTransportGeneration) acpConfigOptions.value = []
      await transport.destroy().catch(() => undefined)
      throw error
    }
  }

  async function createTransport(store: EditorStore) {
    resetAcpDiagnostics()
    acpConfigOptions.value = []
    if (overrideTransport) return overrideTransport()

    const runtime = await createAIModelRuntime('design')
    if (runtime?.kind !== 'direct') {
      throw new Error('The Design model is not configured for direct API access')
    }
    const transport = createToolLoopTransport({
      store,
      providerID: runtime.role.connection.providerID,
      model: runtime.model,
      effectiveModelID: resolveLanguageModelID({
        providerID: runtime.role.connection.providerID,
        modelID: runtime.role.profile.modelID,
        customModelID: runtime.role.profile.customModelID
      }),
      maxOutputTokens: runtime.role.profile.maxOutputTokens
    })
    return new VisualReferenceChatTransport({
      transport,
      designSupportsVision: runtime.role.profile.capabilities.includes('vision'),
      analyze: createVisionRoleAnalyzer()
    })
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
    resetAcpDiagnostics()

    let transport: ChatTransport<UIMessage>
    if (isACPProvider.value) {
      transport = await createActiveACPTransport()
    } else {
      await detachACPTransport()
      transport = await createTransport(store)
    }

    if (generation !== chatInitializationGeneration || store !== getActiveEditorStore()) {
      if (transport === acpTransportInstance) await detachACPTransport()
      return ensureChat()
    }

    const createdChat = new Chat<UIMessage>({
      transport,
      messages: messages ? trimChatHistory(messages) : undefined,
      onFinish: ({ messages: finishedMessages, isAbort, isError }) => {
        let settledMessages = finishedMessages
        if (isAbort) {
          settledMessages = finalizeInterruptedToolParts(finishedMessages)
        } else if (isError) {
          settledMessages = finalizeUnfinishedToolParts(
            finishedMessages,
            createdChat.error?.message || 'AI request failed'
          )
        }
        createdChat.messages = trimChatHistory(settledMessages)
      }
    })
    chat = createdChat
    currentChatStore = store
    transportDirty = false
    return chat
  }

  function ensureChat(): Promise<Chat<UIMessage> | null> {
    const store = getActiveEditorStore()
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

  async function resetChat(): Promise<void> {
    void stopChatInstance(chat)
    if (currentChatStore) currentChatMessages.delete(currentChatStore)
    chatInitializationGeneration++
    pendingChatInitialization = null
    acpTransportGeneration++
    acpConfigUpdateGeneration++
    chat = null
    currentChatStore = null
    transportDirty = false
    acpConfigOptions.value = []
    acpConfigUpdating.value = false
    await detachACPTransport()
  }

  async function forceStopChat(): Promise<void> {
    const discardedChat = chat
    if (discardedChat) {
      discardedChat.messages = finalizeInterruptedToolParts(discardedChat.messages)
    }
    if (currentChatStore && discardedChat) {
      currentChatMessages.set(currentChatStore, trimChatHistory(discardedChat.messages))
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
    chat = null
    currentChatStore = null
    transportDirty = false
    acpConfigOptions.value = []
    acpConfigUpdating.value = false
    await forceDetachACPTransport()
  }

  function setOverrideTransport(factory: (() => ChatTransport<UIMessage>) | null) {
    overrideTransport = factory
    markTransportDirty()
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
    resetChat,
    forceStopChat,
    markTransportDirty,
    setOverrideTransport,
    acpConfigOptions,
    acpConfigUpdating,
    setACPConfigOption
  }
}
