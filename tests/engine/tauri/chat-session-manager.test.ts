import { afterEach, beforeEach, describe, expect, test, vi } from 'bun:test'

import type { SessionConfigOption } from '@agentclientprotocol/sdk'
import { computed, ref } from 'vue'

import type { AIProviderID } from '@open-pencil/core/constants'

import { createChatSessionManager } from '@/app/ai/chat/transports'
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

describe('ACP chat session manager', () => {
  test('shares one prewarm when ensureChat is called concurrently', async () => {
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
      getActiveEditorStore: () => store
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

    manager.markTransportDirty()
    await waitFor(() => killCount === 1)
    expect(manager.acpConfigOptions.value).toEqual([])
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

    manager.resetChat()
  })
})
