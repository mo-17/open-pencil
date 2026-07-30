import { afterEach, beforeEach, describe, expect, test, vi } from 'bun:test'

import type { SessionConfigOption } from '@agentclientprotocol/sdk'
import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'
import { computed, ref } from 'vue'

import type { AIProviderID } from '@open-pencil/core/constants'

import { createChatSessionManager, trimChatHistory } from '@/app/ai/chat/transports'
import * as automationMcp from '@/app/automation/mcp/spawn'
import type { getActiveEditorStore } from '@/app/editor/active-store'

import { clearTauriMocks, mockTauriIPC } from '#tests/helpers/tauri/mocks'

type EditorStore = ReturnType<typeof getActiveEditorStore>

beforeEach(() => {
  vi.spyOn(automationMcp, 'getAutomationAuthToken').mockResolvedValue('test-automation-token')
})

afterEach(async () => {
  await clearTauriMocks()
  vi.restoreAllMocks()
  Reflect.deleteProperty(globalThis, 'window')
})

async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (check()) return
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })
  }
  throw new Error('Timed out waiting for the ACP request')
}

function neverSettles(): Promise<void> {
  return new Promise<void>(() => {
    // Simulate a provider implementation whose stop hook never returns.
  })
}

describe('chat history bounds', () => {
  test('keeps only recent complete turns and drops oversized older context', () => {
    const messages = Array.from({ length: 60 }, (_, index) => ({
      id: `message-${index}`,
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      parts: [{ type: 'text' as const, text: `message ${index}` }]
    })) satisfies UIMessage[]

    const bounded = trimChatHistory(messages)
    expect(bounded.length).toBeLessThanOrEqual(40)
    expect(bounded[0]?.role).toBe('user')
    expect(bounded.at(-1)?.id).toBe('message-59')

    const withOversizedHistory = [
      {
        id: 'large-old-user',
        role: 'user' as const,
        parts: [{ type: 'text' as const, text: 'x'.repeat(1_100_000) }]
      },
      {
        id: 'old-assistant',
        role: 'assistant' as const,
        parts: [{ type: 'text' as const, text: 'old reply' }]
      },
      {
        id: 'latest-user',
        role: 'user' as const,
        parts: [{ type: 'text' as const, text: 'latest prompt' }]
      },
      {
        id: 'latest-assistant',
        role: 'assistant' as const,
        parts: [{ type: 'text' as const, text: 'latest reply' }]
      }
    ] satisfies UIMessage[]
    expect(trimChatHistory(withOversizedHistory).map((message) => message.id)).toEqual([
      'latest-user',
      'latest-assistant'
    ])
  })
})

describe('ACP chat session manager', () => {
  test('stops the active chat before switching tabs and safely force-discards a hung chat', async () => {
    const storeA = {} as EditorStore
    const storeB = {} as EditorStore
    let activeStore = storeA
    const events: string[] = []
    let transportCount = 0
    let runCount = 0
    const manager = createChatSessionManager({
      isConfigured: computed(() => true),
      isACPProvider: computed(() => false),
      providerID: ref<AIProviderID>('openai'),
      credentialsReady: Promise.resolve(),
      resolveAPIKey: async () => 'test-key',
      modelID: ref('gpt-test'),
      customModelID: ref(''),
      customBaseURL: ref(''),
      customAPIType: ref<'completions' | 'responses'>('completions'),
      maxOutputTokens: ref(16_384),
      getActiveEditorStore: () => activeStore
    })
    manager.setOverrideTransport(() => {
      transportCount += 1
      events.push(`transport-${transportCount}`)
      return {
        async sendMessages({ abortSignal }) {
          runCount += 1
          const run = runCount
          if (!abortSignal) throw new Error('Expected Chat to provide an abort signal')
          return new ReadableStream<UIMessageChunk>({
            start(controller) {
              controller.enqueue({ type: 'start' })
              controller.enqueue({ type: 'start-step' })
              abortSignal.addEventListener(
                'abort',
                () => {
                  events.push(`abort-${run}`)
                  controller.enqueue({ type: 'finish-step' })
                  controller.enqueue({ type: 'finish', finishReason: 'stop' })
                  controller.close()
                },
                { once: true }
              )
            }
          })
        },
        async reconnectToStream() {
          return null
        }
      } satisfies ChatTransport<UIMessage>
    })

    const first = await manager.ensureChat()
    if (!first) throw new Error('Missing first chat')
    void first.sendMessage({ text: 'first' }).catch(() => undefined)
    await waitFor(() => runCount === 1)

    activeStore = storeB
    const second = await manager.ensureChat()
    expect(second).not.toBe(first)
    expect(events.indexOf('abort-1')).toBeLessThan(events.indexOf('transport-2'))

    if (!second) throw new Error('Missing second chat')
    void second.sendMessage({ text: 'second' }).catch(() => undefined)
    await waitFor(() => runCount === 2)
    manager.markTransportDirty()
    const third = await manager.ensureChat()
    expect(third).not.toBe(second)
    expect(events.indexOf('abort-2')).toBeLessThan(events.indexOf('transport-3'))

    if (!third) throw new Error('Missing third chat')
    void third.sendMessage({ text: 'third' }).catch(() => undefined)
    await waitFor(() => runCount === 3)
    await manager.resetChat()
    const fourth = await manager.ensureChat()
    expect(fourth).not.toBe(third)
    expect(events.indexOf('abort-3')).toBeLessThan(events.indexOf('transport-4'))

    if (!fourth) throw new Error('Missing fourth chat')
    fourth.stop = neverSettles
    let forceStopSettled = false
    void manager.forceStopChat().then(() => {
      forceStopSettled = true
      return undefined
    })
    await waitFor(() => forceStopSettled)

    const fifth = await manager.ensureChat()
    expect(fifth).not.toBe(fourth)
    expect(events).toContain('transport-5')
    await manager.resetChat()
  })

  test('stores interrupted tool state before switching away and back', async () => {
    const storeA = {} as EditorStore
    const storeB = {} as EditorStore
    let activeStore = storeA
    const manager = createChatSessionManager({
      isConfigured: computed(() => true),
      isACPProvider: computed(() => false),
      providerID: ref<AIProviderID>('openai'),
      credentialsReady: Promise.resolve(),
      resolveAPIKey: async () => 'test-key',
      modelID: ref('gpt-test'),
      customModelID: ref(''),
      customBaseURL: ref(''),
      customAPIType: ref<'completions' | 'responses'>('completions'),
      maxOutputTokens: ref(16_384),
      getActiveEditorStore: () => activeStore
    })
    manager.setOverrideTransport(() => ({
      async sendMessages({ abortSignal }) {
        if (!abortSignal) throw new Error('Expected Chat to provide an abort signal')
        return new ReadableStream<UIMessageChunk>({
          start(controller) {
            controller.enqueue({ type: 'start' })
            controller.enqueue({ type: 'start-step' })
            controller.enqueue({
              type: 'tool-input-start',
              toolCallId: 'render-running',
              toolName: 'Render',
              providerExecuted: true,
              title: 'Render'
            })
            controller.enqueue({
              type: 'tool-input-available',
              toolCallId: 'render-running',
              toolName: 'Render',
              input: { jsx: '<Frame />' },
              providerExecuted: true,
              title: 'Render'
            })
            abortSignal.addEventListener(
              'abort',
              () => {
                controller.enqueue({ type: 'finish-step' })
                controller.enqueue({ type: 'finish', finishReason: 'stop' })
                controller.close()
              },
              { once: true }
            )
          }
        })
      },
      async reconnectToStream() {
        return null
      }
    }))

    const first = await manager.ensureChat()
    if (!first) throw new Error('Missing first chat')
    void first.sendMessage({ text: 'draw' }).catch(() => undefined)
    await waitFor(() =>
      first.messages.some((message) =>
        message.parts.some((part) => 'state' in part && part.state === 'input-available')
      )
    )

    activeStore = storeB
    await manager.ensureChat()
    activeStore = storeA
    const restored = await manager.ensureChat()
    if (!restored) throw new Error('Missing restored chat')

    expect(
      restored.messages.some((message) =>
        message.parts.some(
          (part) =>
            'state' in part &&
            part.state === 'output-error' &&
            'errorText' in part &&
            part.errorText === 'Conversation interrupted'
        )
      )
    ).toBeTrue()
    await manager.resetChat()
  })

  test('finalizes a pending direct-provider tool when its stream errors', async () => {
    const store = {} as EditorStore
    const manager = createChatSessionManager({
      isConfigured: computed(() => true),
      isACPProvider: computed(() => false),
      providerID: ref<AIProviderID>('openai'),
      credentialsReady: Promise.resolve(),
      resolveAPIKey: async () => 'test-key',
      modelID: ref('gpt-test'),
      customModelID: ref(''),
      customBaseURL: ref(''),
      customAPIType: ref<'completions' | 'responses'>('completions'),
      maxOutputTokens: ref(16_384),
      getActiveEditorStore: () => store
    })
    manager.setOverrideTransport(() => ({
      async sendMessages() {
        return new ReadableStream<UIMessageChunk>({
          start(controller) {
            controller.enqueue({ type: 'start' })
            controller.enqueue({ type: 'start-step' })
            controller.enqueue({
              type: 'tool-input-start',
              toolCallId: 'direct-render',
              toolName: 'Render',
              providerExecuted: true,
              title: 'Render'
            })
            controller.enqueue({
              type: 'tool-input-available',
              toolCallId: 'direct-render',
              toolName: 'Render',
              input: { jsx: '<Frame />' },
              providerExecuted: true,
              title: 'Render'
            })
            controller.enqueue({ type: 'error', errorText: 'Direct provider failed' })
            controller.close()
          }
        })
      },
      async reconnectToStream() {
        return null
      }
    }))

    const chat = await manager.ensureChat()
    if (!chat) throw new Error('Missing chat')
    await chat.sendMessage({ text: 'draw' }).catch(() => undefined)

    expect(chat.status).toBe('error')
    expect(
      chat.messages.some((message) =>
        message.parts.some(
          (part) =>
            'toolCallId' in part &&
            part.toolCallId === 'direct-render' &&
            part.state === 'output-error' &&
            part.errorText === 'Direct provider failed'
        )
      )
    ).toBeTrue()
    await manager.resetChat()
  })

  test('shares one prewarm and force-destroys ACP when stop and child kill hang', async () => {
    const initialOptions: SessionConfigOption[] = [
      {
        type: 'select',
        id: 'model',
        name: 'Model',
        category: 'model',
        currentValue: 'gpt-5.6-sol',
        options: [{ value: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' }]
      }
    ]
    const methods: string[] = []
    let spawnCount = 0
    let killCount = 0
    let newSessionRequestId: number | null = null
    let onEvent: ((event: unknown) => void) | null = null
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()

    function respond(id: number, result: unknown) {
      onEvent?.({
        event: 'Stdout',
        payload: [...encoder.encode(`${JSON.stringify({ id, result })}\n`)]
      })
    }

    await mockTauriIPC((cmd, args) => {
      if (cmd === 'plugin:path|resolve_directory') return '/Users/tester'
      if (cmd === 'plugin:shell|spawn') {
        spawnCount++
        onEvent = (args as { onEvent: { onmessage: (event: unknown) => void } }).onEvent.onmessage
        return 77
      }
      if (cmd === 'plugin:shell|kill') {
        killCount++
        if (killCount === 1) return neverSettles()
        return null
      }
      if (cmd === 'plugin:shell|stdin_write') {
        const raw = decoder.decode(new Uint8Array((args as { buffer: number[] }).buffer))
        for (const line of raw.trim().split('\n')) {
          const request = JSON.parse(line) as {
            id: number
            method: string
            params: Record<string, unknown>
          }
          methods.push(request.method)
          if (request.method === 'initialize') {
            respond(request.id, { protocolVersion: 1 })
          } else if (request.method === 'session/new') {
            newSessionRequestId = request.id
          }
        }
      }
      return null
    })

    const store = {} as EditorStore
    const manager = createChatSessionManager({
      isConfigured: computed(() => true),
      isACPProvider: computed(() => true),
      providerID: ref<AIProviderID>('acp:codex'),
      credentialsReady: Promise.resolve(),
      resolveAPIKey: async () => null,
      modelID: ref(''),
      customModelID: ref(''),
      customBaseURL: ref(''),
      customAPIType: ref<'completions' | 'responses'>('completions'),
      maxOutputTokens: ref(16_384),
      getActiveEditorStore: () => store,
      forceCloseTimeoutMs: 5
    })

    const first = manager.ensureChat()
    const second = manager.ensureChat()
    expect(second).toBe(first)

    await waitFor(() => newSessionRequestId !== null)
    if (newSessionRequestId === null) throw new Error('Missing session/new request ID')
    respond(newSessionRequestId, { sessionId: 'session-1', configOptions: initialOptions })

    const [firstChat, secondChat] = await Promise.all([first, second])
    expect(firstChat).toBe(secondChat)
    expect(spawnCount).toBe(1)
    expect(automationMcp.getAutomationAuthToken).toHaveBeenCalledTimes(1)
    expect(methods).toEqual(['initialize', 'session/new'])
    expect(manager.acpConfigOptions.value).toEqual(initialOptions)

    if (!firstChat) throw new Error('Missing first chat')
    firstChat.stop = neverSettles
    let forceStopSettled = false
    void manager.forceStopChat().then(() => {
      forceStopSettled = true
      return undefined
    })
    await waitFor(() => killCount === 1)
    await waitFor(() => forceStopSettled)
    expect(manager.acpConfigOptions.value).toEqual([])

    newSessionRequestId = null
    const replacementPromise = manager.ensureChat()
    await waitFor(() => spawnCount === 2 && newSessionRequestId !== null)
    if (newSessionRequestId === null) throw new Error('Missing replacement session/new request ID')
    respond(newSessionRequestId, { sessionId: 'session-2', configOptions: initialOptions })
    const replacement = await replacementPromise
    expect(replacement).not.toBe(firstChat)
    await manager.resetChat()
  })

  test('does not reuse a destroyed chat when switching stores during prewarm', async () => {
    const initialOptions: SessionConfigOption[] = [
      {
        type: 'select',
        id: 'model',
        name: 'Model',
        category: 'model',
        currentValue: 'gpt-5.6-sol',
        options: [{ value: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' }]
      }
    ]
    const requests: Array<{ pid: number; method: string }> = []
    const processEvents = new Map<number, (event: unknown) => void>()
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    let nextPid = 80

    function respond(pid: number, id: number, result: unknown) {
      processEvents.get(pid)?.({
        event: 'Stdout',
        payload: [...encoder.encode(`${JSON.stringify({ id, result })}\n`)]
      })
    }

    await mockTauriIPC((cmd, args) => {
      if (cmd === 'plugin:path|resolve_directory') return '/Users/tester'
      if (cmd === 'plugin:shell|spawn') {
        const pid = nextPid++
        processEvents.set(
          pid,
          (args as { onEvent: { onmessage: (event: unknown) => void } }).onEvent.onmessage
        )
        return pid
      }
      if (cmd === 'plugin:shell|stdin_write') {
        const { pid, buffer } = args as { pid: number; buffer: number[] }
        const raw = decoder.decode(new Uint8Array(buffer))
        for (const line of raw.trim().split('\n')) {
          const request = JSON.parse(line) as { id: number; method: string }
          requests.push({ pid, method: request.method })
          if (request.method === 'initialize') {
            respond(pid, request.id, { protocolVersion: 1 })
          } else if (request.method === 'session/new' && pid !== 81) {
            respond(pid, request.id, { sessionId: `session-${pid}`, configOptions: initialOptions })
          }
        }
      }
      if (cmd === 'plugin:shell|kill') {
        const { pid } = args as { pid: number }
        processEvents.get(pid)?.({ event: 'Terminated', payload: { code: 0, signal: null } })
      }
      return null
    })

    const storeA = {} as EditorStore
    const storeB = {} as EditorStore
    let activeStore = storeA
    const manager = createChatSessionManager({
      isConfigured: computed(() => true),
      isACPProvider: computed(() => true),
      providerID: ref<AIProviderID>('acp:codex'),
      credentialsReady: Promise.resolve(),
      resolveAPIKey: async () => null,
      modelID: ref(''),
      customModelID: ref(''),
      customBaseURL: ref(''),
      customAPIType: ref<'completions' | 'responses'>('completions'),
      maxOutputTokens: ref(16_384),
      getActiveEditorStore: () => activeStore
    })

    const originalChat = await manager.ensureChat()
    activeStore = storeB
    const pendingStoreB = manager.ensureChat()
    await waitFor(() =>
      requests.some((request) => request.pid === 81 && request.method === 'session/new')
    )

    activeStore = storeA
    const returnedToStoreA = manager.ensureChat()
    const [storeBResult, storeAResult] = await Promise.all([pendingStoreB, returnedToStoreA])

    expect(storeAResult).not.toBe(originalChat)
    expect(storeBResult).toBe(storeAResult)
    expect(nextPid).toBe(83)
    expect(manager.acpConfigOptions.value).toEqual(initialOptions)

    await manager.resetChat()
  })
})
