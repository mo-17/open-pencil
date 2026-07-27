import type { SessionConfigOption } from '@agentclientprotocol/sdk'
import { Chat } from '@ai-sdk/vue'
import { DirectChatTransport, stepCountIs, ToolLoopAgent } from 'ai'
import type { ChatTransport, UIMessage } from 'ai'
import { ref, shallowRef } from 'vue'
import type { ComputedRef, Ref } from 'vue'

import { ACP_AGENTS } from '@open-pencil/core/constants'
import type { ACPAgentID, AIProviderID } from '@open-pencil/core/constants'

import { resetAcpDiagnostics } from '@/app/ai/acp/diagnostics'
import { createLanguageModel, resolveLanguageModelID } from '@/app/ai/chat/model'
import SYSTEM_PROMPT from '@/app/ai/chat/system-prompt.md?raw'
import { MAX_AGENT_STEPS, createAITools, recordStepUsage, resetRunSteps } from '@/app/ai/tools'
import type { getActiveEditorStore } from '@/app/editor/active-store'

type EditorStore = ReturnType<typeof getActiveEditorStore>

type ChatSessionOptions = {
  isConfigured: ComputedRef<boolean>
  isACPProvider: ComputedRef<boolean>
  providerID: Ref<AIProviderID>
  apiKey: Ref<string>
  modelID: Ref<string>
  customModelID: Ref<string>
  customBaseURL: Ref<string>
  customAPIType: Ref<'completions' | 'responses'>
  maxOutputTokens: Ref<number>
  getActiveEditorStore: () => EditorStore
}

type ToolLoopTransportOptions = {
  store: EditorStore
  providerID: AIProviderID
  apiKey: string
  modelID: string
  customModelID: string
  customBaseURL: string
  customAPIType: 'completions' | 'responses'
  maxOutputTokens: number
}

const ANTHROPIC_CACHE_CONTROL = {
  anthropic: { cacheControl: { type: 'ephemeral' } }
} as const

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
  apiKey,
  modelID,
  customModelID,
  customBaseURL,
  customAPIType,
  maxOutputTokens
}: ToolLoopTransportOptions) {
  const tools = createAITools(store)
  const effectiveModelID = resolveLanguageModelID({ providerID, modelID, customModelID })
  const cacheProviderOptions = supportsAnthropicCaching(providerID, effectiveModelID)
    ? ANTHROPIC_CACHE_CONTROL
    : undefined

  const agent = new ToolLoopAgent({
    model: createLanguageModel({
      providerID,
      apiKey,
      modelID,
      customModelID,
      customBaseURL,
      customAPIType
    }),
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
  apiKey,
  modelID,
  customModelID,
  customBaseURL,
  customAPIType,
  maxOutputTokens,
  getActiveEditorStore
}: ChatSessionOptions) {
  let transportDirty = false
  let currentChatStore: EditorStore | null = null
  let currentChatMessages = new WeakMap<EditorStore, UIMessage[]>()
  let chat: Chat<UIMessage> | null = null
  let acpTransportInstance: Awaited<ReturnType<typeof createACPTransport>> | null = null
  let acpTransportClosePromise: Promise<void> = Promise.resolve()
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

  function detachACPTransport(): Promise<void> {
    const transport = acpTransportInstance
    acpTransportInstance = null
    if (!transport) return acpTransportClosePromise

    const close = transport.destroy().catch(() => undefined)
    acpTransportClosePromise = Promise.all([acpTransportClosePromise, close]).then(() => undefined)
    return acpTransportClosePromise
  }

  function markTransportDirty() {
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

  function createTransport(store: EditorStore) {
    resetAcpDiagnostics()
    acpConfigOptions.value = []
    if (overrideTransport) return overrideTransport()

    return createToolLoopTransport({
      store,
      providerID: providerID.value,
      apiKey: apiKey.value,
      modelID: modelID.value,
      customModelID: customModelID.value,
      customBaseURL: customBaseURL.value,
      customAPIType: customAPIType.value,
      maxOutputTokens: maxOutputTokens.value
    })
  }

  async function initializeChat(
    store: EditorStore,
    generation: number
  ): Promise<Chat<UIMessage> | null> {
    const messages = currentChatMessages.get(store)
    resetAcpDiagnostics()

    let transport: ChatTransport<UIMessage>
    if (isACPProvider.value) {
      transport = await createActiveACPTransport()
    } else {
      await detachACPTransport()
      transport = createTransport(store)
    }

    if (generation !== chatInitializationGeneration || store !== getActiveEditorStore()) {
      if (transport === acpTransportInstance) await detachACPTransport()
      return ensureChat()
    }

    chat = new Chat<UIMessage>({ transport, messages })
    currentChatStore = store
    transportDirty = false
    return chat
  }

  function ensureChat(): Promise<Chat<UIMessage> | null> {
    if (!isConfigured.value) return Promise.resolve(null)

    const store = getActiveEditorStore()
    if (currentChatStore === store && chat && !transportDirty) return Promise.resolve(chat)

    const pending = pendingChatInitialization
    if (pending && pending.generation === chatInitializationGeneration && pending.store === store) {
      return pending.promise
    }

    if (currentChatStore && chat) {
      currentChatMessages.set(currentChatStore, chat.messages)
    }
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

  function resetChat() {
    if (currentChatStore) currentChatMessages.delete(currentChatStore)
    chatInitializationGeneration++
    pendingChatInitialization = null
    acpTransportGeneration++
    acpConfigUpdateGeneration++
    void detachACPTransport()
    acpConfigOptions.value = []
    acpConfigUpdating.value = false
    chat = null
    currentChatStore = null
    transportDirty = false
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
    markTransportDirty,
    setOverrideTransport,
    acpConfigOptions,
    acpConfigUpdating,
    setACPConfigOption
  }
}
