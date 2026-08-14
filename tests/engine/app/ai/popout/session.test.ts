import { describe, expect, test } from 'bun:test'

import { decodeBase64Text } from '@open-pencil/core/bytes'

import { DEFAULT_AI_POPOUT_CONTROLS, type AIPopoutControls } from '@/app/ai/popout/controls'
import {
  AI_POPOUT_PROTOCOL_VERSION,
  type AIPopoutIntentResult,
  type AIPopoutProjection
} from '@/app/ai/popout/protocol'
import {
  createAIPopoutSessionController,
  type AIPopoutSessionControllerOptions
} from '@/app/ai/popout/session'

type InvokeCall = Readonly<{
  command: string
  args?: Record<string, unknown>
}>

function projection(
  contextId = 'context-1',
  draft = '',
  documentName = 'Untitled'
): AIPopoutProjection {
  return {
    protocolVersion: AI_POPOUT_PROTOCOL_VERSION,
    contextId,
    documentName,
    providerLabel: 'OpenAI',
    configured: true,
    status: 'ready',
    error: null,
    draft,
    canSubmit: true,
    canStop: false,
    canContinue: false,
    canRetry: false,
    canClear: false,
    messages: []
  }
}

function openResult(action: 'created' | 'focused' | 'recreated' = 'created') {
  return { label: 'ai-chat-popout', action }
}

function updateResult(action: 'updated' | 'recreated' = 'updated') {
  return { label: 'ai-chat-popout', action }
}

function requestFromCall(call: InvokeCall): {
  envelope: string
  controls: AIPopoutControls
} {
  const request = call.args?.request
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new Error('native AI request is missing')
  }
  return request as { envelope: string; controls: AIPopoutControls }
}

function decodedProjection(call: InvokeCall): AIPopoutProjection {
  return JSON.parse(decodeBase64Text(requestFromCall(call).envelope)) as AIPopoutProjection
}

function lastCall(calls: readonly InvokeCall[]): InvokeCall {
  const call = calls.at(-1)
  if (!call) throw new Error('native AI call is missing')
  return call
}

function controllerHarness(
  resolve: (call: InvokeCall) => unknown = ({ command }) => {
    if (command === 'close_ai_window') return true
    return command === 'update_ai_window' ? updateResult() : openResult()
  }
) {
  const calls: InvokeCall[] = []
  const listeners = new Map<string, (event: { payload: unknown }) => void>()
  const intents: unknown[] = []
  let currentProjection: AIPopoutProjection | null = projection()
  let currentControls: AIPopoutControls = DEFAULT_AI_POPOUT_CONTROLS
  let pluginEnabled = true
  let nextIntentResult: AIPopoutIntentResult | null = null
  let hostListener: (projection: AIPopoutProjection | null) => void = () => undefined
  let controlsListener = (): void => undefined
  let pluginListener = (_enabled: boolean): void => undefined

  const invoke: NonNullable<AIPopoutSessionControllerOptions['invoke']> = async <T>(
    command: string,
    args?: Record<string, unknown>
  ) => {
    const call = { command, ...(args ? { args } : {}) }
    calls.push(call)
    return (await resolve(call)) as T
  }
  const listen: NonNullable<AIPopoutSessionControllerOptions['listen']> = async (
    event,
    handler
  ) => {
    listeners.set(event, handler)
    return () => listeners.delete(event)
  }
  const controller = createAIPopoutSessionController({
    isDesktop: () => true,
    invoke,
    listen,
    getProjection: () => currentProjection,
    handleIntent: async (intent) => {
      intents.push(intent)
      if (nextIntentResult) return nextIntentResult
      if (!currentProjection) {
        return {
          ok: false,
          code: 'unavailable',
          message: 'AI unavailable',
          projection: null
        }
      }
      return { ok: true, duplicate: false, projection: currentProjection }
    },
    subscribeHost: (listener) => {
      hostListener = listener
      return () => undefined
    },
    getControls: () => currentControls,
    subscribeControls: (listener) => {
      controlsListener = listener
      return () => undefined
    },
    isPluginEnabled: () => pluginEnabled,
    subscribePluginEnabled: (listener) => {
      pluginListener = listener
      return () => undefined
    }
  })

  return {
    calls,
    controller,
    intents,
    listeners,
    setProjection(next: AIPopoutProjection | null, notify = false) {
      currentProjection = next
      if (notify) hostListener(next)
    },
    setControls(next: AIPopoutControls, notify = false) {
      currentControls = next
      if (notify) controlsListener()
    },
    setIntentResult(next: AIPopoutIntentResult) {
      nextIntentResult = next
    },
    setPluginEnabled(enabled: boolean, notify = false) {
      pluginEnabled = enabled
      if (notify) pluginListener(enabled)
    },
    emit(event: string, payload: unknown) {
      const listener = listeners.get(event)
      if (!listener) throw new Error(`${event} listener was not installed`)
      listener({ payload })
    }
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (predicate()) return
    await flushMicrotasks()
  }
  throw new Error('condition did not settle')
}

describe('AI popout main-window session bridge', () => {
  test('fails closed in the browser without importing or invoking Tauri', async () => {
    let invokeCount = 0
    let listenCount = 0
    const controller = createAIPopoutSessionController({
      isDesktop: () => false,
      invoke: async <T>() => {
        invokeCount++
        return undefined as T
      },
      listen: async () => {
        listenCount++
        return () => undefined
      },
      getProjection: () => projection(),
      subscribeHost: () => () => undefined,
      getControls: () => DEFAULT_AI_POPOUT_CONTROLS,
      subscribeControls: () => () => undefined,
      isPluginEnabled: () => true
    })

    await expect(controller.openActiveAIPopout()).rejects.toThrow(
      'only available in the desktop app'
    )
    expect(invokeCount).toBe(0)
    expect(listenCount).toBe(0)
    expect(controller.aiPopoutOpen.value).toBe(false)
    expect(controller.aiPopoutBusy.value).toBe(false)
  })

  test('opens with a bounded projection envelope and exact host-owned controls', async () => {
    const harness = controllerHarness()
    await harness.controller.openActiveAIPopout()

    expect([...harness.listeners.keys()].sort()).toEqual([
      'ai-window-destroyed',
      'ai-window-intent'
    ])
    expect(harness.calls).toHaveLength(1)
    expect(harness.calls[0].command).toBe('open_ai_window')
    expect(Reflect.ownKeys(harness.calls[0].args ?? {})).toEqual(['request'])
    expect(Reflect.ownKeys(requestFromCall(harness.calls[0])).sort()).toEqual([
      'controls',
      'envelope'
    ])
    expect(decodedProjection(harness.calls[0])).toEqual(projection())
    expect(requestFromCall(harness.calls[0]).controls).toEqual(DEFAULT_AI_POPOUT_CONTROLS)
    expect(harness.controller.aiPopoutOpen.value).toBe(true)
    expect(harness.controller.aiPopoutBusy.value).toBe(false)
  })

  test('queues mid-open projection and control changes and re-reads both after open', async () => {
    let releaseOpen!: (value: unknown) => void
    const harness = controllerHarness(({ command }) => {
      if (command === 'open_ai_window') {
        return new Promise<unknown>((resolve) => {
          releaseOpen = resolve
        })
      }
      if (command === 'update_ai_window') return updateResult()
      return true
    })

    const opening = harness.controller.openActiveAIPopout()
    await waitFor(() => harness.calls.length === 1)
    const latestProjection = projection('context-2', 'new draft', 'New document')
    const latestControls = {
      toolbar: true,
      focusEditor: false,
      alwaysOnTop: true,
      clearChat: false,
      settings: true
    }
    harness.setProjection(latestProjection)
    harness.setControls(latestControls, true)

    expect(harness.calls.map(({ command }) => command)).toEqual(['open_ai_window'])
    releaseOpen(openResult())
    await opening
    while (harness.controller.aiPopoutBusy.value) await flushMicrotasks()

    expect(harness.calls.map(({ command }) => command)).toEqual([
      'open_ai_window',
      'update_ai_window'
    ])
    expect(decodedProjection(harness.calls[0])).toEqual(projection())
    expect(decodedProjection(harness.calls[1])).toEqual(latestProjection)
    expect(requestFromCall(harness.calls[1]).controls).toEqual(latestControls)
  })

  test('does not recreate a missing native window during background sync', async () => {
    const harness = controllerHarness(({ command }) => {
      if (command === 'open_ai_window') return openResult()
      if (command === 'update_ai_window') return null
      return true
    })
    await harness.controller.openActiveAIPopout()
    await harness.controller.syncActiveAIPopout()

    expect(harness.calls.map(({ command }) => command)).toEqual([
      'open_ai_window',
      'update_ai_window'
    ])
    expect(harness.controller.aiPopoutOpen.value).toBe(false)
  })

  test('rejects inexact native open results and retains cleanup authority', async () => {
    const harness = controllerHarness(({ command }) => {
      if (command === 'open_ai_window') {
        return { label: 'ai-chat-popout', action: 'created', revision: 1 }
      }
      return true
    })

    await expect(harness.controller.openActiveAIPopout()).rejects.toThrow('invalid result')
    expect(harness.controller.aiPopoutOpen.value).toBe(false)
    await harness.controller.closeActiveAIPopout()
    expect(harness.calls.map(({ command }) => command)).toEqual([
      'open_ai_window',
      'close_ai_window'
    ])
  })

  test('retains cleanup authority when native open rejects after receiving the request', async () => {
    const harness = controllerHarness(({ command }) => {
      if (command === 'open_ai_window') throw new Error('native focus failed')
      return true
    })

    await expect(harness.controller.openActiveAIPopout()).rejects.toThrow('native focus failed')
    await harness.controller.closeActiveAIPopout()

    expect(harness.calls.map(({ command }) => command)).toEqual([
      'open_ai_window',
      'close_ai_window'
    ])
  })

  test('disabling during an in-flight open closes after native settles and blocks future opens', async () => {
    let releaseOpen!: (value: unknown) => void
    const harness = controllerHarness(({ command }) => {
      if (command === 'open_ai_window') {
        return new Promise<unknown>((resolve) => {
          releaseOpen = resolve
        })
      }
      return true
    })

    const opening = harness.controller.openActiveAIPopout()
    await waitFor(() => harness.calls.length === 1)
    const disabling = harness.controller.setAIPopoutDisabled(true)
    expect(harness.calls.map(({ command }) => command)).toEqual(['open_ai_window'])

    releaseOpen(openResult())
    await Promise.all([opening, disabling])

    expect(harness.calls.map(({ command }) => command)).toEqual([
      'open_ai_window',
      'close_ai_window'
    ])
    expect(harness.controller.aiPopoutOpen.value).toBe(false)
    expect(harness.controller.aiPopoutBusy.value).toBe(false)
    await expect(harness.controller.openActiveAIPopout()).rejects.toThrow('disabled')
  })

  test('tracks only an exact native destruction event', async () => {
    const harness = controllerHarness()
    await harness.controller.openActiveAIPopout()

    harness.emit('ai-window-destroyed', { label: 'another-window' })
    harness.emit('ai-window-destroyed', { label: 'ai-chat-popout', extra: true })
    expect(harness.controller.aiPopoutOpen.value).toBe(true)

    harness.emit('ai-window-destroyed', { label: 'ai-chat-popout' })
    expect(harness.controller.aiPopoutOpen.value).toBe(false)
  })

  test('maps the popup-only tool approval event into the versioned host protocol then syncs', async () => {
    const harness = controllerHarness()
    await harness.controller.openActiveAIPopout()

    await harness.controller.dispatchAIPopoutIntent({
      type: 'toolApproval',
      token: 'approval-1',
      approved: true,
      clientActionId: 'action-1',
      contextId: 'context-1'
    })

    expect(harness.intents).toEqual([
      {
        protocolVersion: AI_POPOUT_PROTOCOL_VERSION,
        type: 'toolApproval',
        approvalToken: 'approval-1',
        approved: true,
        clientActionId: 'action-1',
        contextId: 'context-1'
      }
    ])
    expect(harness.calls.map(({ command }) => command)).toEqual([
      'open_ai_window',
      'update_ai_window'
    ])
  })

  test('rejects intent extras before host dispatch and keeps the failure observable', async () => {
    const harness = controllerHarness()
    await harness.controller.openActiveAIPopout()

    await harness.controller.dispatchAIPopoutIntent({
      type: 'stop',
      clientActionId: 'action-1',
      contextId: 'context-1',
      unexpected: true
    })

    expect(harness.intents).toEqual([])
    expect(harness.controller.aiPopoutError.value).toContain('unsupported or missing fields')
    expect(harness.calls.map(({ command }) => command)).toEqual([
      'open_ai_window',
      'update_ai_window'
    ])
    expect(decodedProjection(lastCall(harness.calls))).toMatchObject({
      status: 'error',
      error: expect.stringContaining('unsupported or missing fields')
    })
  })

  test('projects a stale-context host failure back into the popup envelope', async () => {
    const harness = controllerHarness()
    await harness.controller.openActiveAIPopout()
    harness.setIntentResult({
      ok: false,
      code: 'stale-context',
      message: 'The active document or AI configuration changed.',
      projection: projection()
    })

    await harness.controller.dispatchAIPopoutIntent({
      type: 'stop',
      clientActionId: 'action-stale',
      contextId: 'context-old'
    })

    expect(decodedProjection(lastCall(harness.calls))).toMatchObject({
      status: 'error',
      error: 'The active document or AI configuration changed.'
    })
    expect(harness.controller.aiPopoutError.value).toBe(
      'The active document or AI configuration changed.'
    )
  })

  test('closes a visible popup when its owning AI host disappears', async () => {
    const harness = controllerHarness()
    await harness.controller.openActiveAIPopout()

    harness.setProjection(null, true)
    while (harness.controller.aiPopoutBusy.value) await flushMicrotasks()

    expect(harness.calls.map(({ command }) => command)).toEqual([
      'open_ai_window',
      'close_ai_window'
    ])
    expect(harness.controller.aiPopoutOpen.value).toBe(false)
  })

  test('enforces the plugin gate without a mounted PropertiesPanel', async () => {
    const harness = controllerHarness()
    await harness.controller.openActiveAIPopout()

    // This represents the always-live plugin store subscription. No component
    // watcher or explicit setAIPopoutDisabled call participates in the gate.
    harness.setPluginEnabled(false, true)
    await waitFor(() => !harness.controller.aiPopoutBusy.value)

    expect(harness.calls.map(({ command }) => command)).toEqual([
      'open_ai_window',
      'close_ai_window'
    ])
    expect(harness.controller.aiPopoutOpen.value).toBe(false)
    await expect(harness.controller.openActiveAIPopout()).rejects.toThrow('disabled')

    // Simulate the last legacy UI mirror firing before a small-screen unmount.
    await harness.controller.setAIPopoutDisabled(true)
    harness.setPluginEnabled(true, true)
    await harness.controller.openActiveAIPopout()
    expect(harness.controller.aiPopoutOpen.value).toBe(true)
  })

  test('re-checks the plugin gate before a queued native intent reaches the host', async () => {
    let openCalls = 0
    let releaseFocus!: (value: unknown) => void
    const harness = controllerHarness(({ command }) => {
      if (command === 'open_ai_window' && openCalls++ > 0) {
        return new Promise<unknown>((resolve) => {
          releaseFocus = resolve
        })
      }
      if (command === 'close_ai_window') return true
      return openResult()
    })
    await harness.controller.openActiveAIPopout()

    const focusing = harness.controller.focusActiveAIPopout()
    await waitFor(() => harness.calls.length === 2)
    const intent = harness.controller.dispatchAIPopoutIntent({
      type: 'stop',
      clientActionId: 'queued-action',
      contextId: 'context-1'
    })
    // Deliberately skip the subscription notification: the execution boundary
    // must re-read the authoritative command state after waiting in the queue.
    harness.setPluginEnabled(false)

    releaseFocus(openResult('focused'))
    await Promise.all([focusing, intent])
    await waitFor(() => !harness.controller.aiPopoutBusy.value)

    expect(harness.intents).toEqual([])
    expect(harness.calls.map(({ command }) => command)).toEqual([
      'open_ai_window',
      'open_ai_window',
      'close_ai_window'
    ])
    expect(harness.controller.aiPopoutOpen.value).toBe(false)
  })

  for (const scenario of [
    {
      label: 'clearChat child',
      action: 'clear' as const,
      controls: {
        ...DEFAULT_AI_POPOUT_CONTROLS,
        clearChat: false
      },
      error: 'clear conversation control is disabled'
    },
    {
      label: 'clear toolbar parent',
      action: 'clear' as const,
      controls: {
        ...DEFAULT_AI_POPOUT_CONTROLS,
        toolbar: false
      },
      error: 'clear conversation control is disabled'
    },
    {
      label: 'settings child',
      action: 'openSettings' as const,
      controls: {
        ...DEFAULT_AI_POPOUT_CONTROLS,
        settings: false
      },
      error: 'settings control is disabled'
    },
    {
      label: 'settings toolbar parent',
      action: 'openSettings' as const,
      controls: {
        ...DEFAULT_AI_POPOUT_CONTROLS,
        toolbar: false
      },
      error: 'settings control is disabled'
    }
  ]) {
    test(`re-checks the ${scenario.label} control before a queued native intent reaches the host`, async () => {
      let openCalls = 0
      let releaseFocus!: (value: unknown) => void
      const harness = controllerHarness(({ command }) => {
        if (command === 'open_ai_window' && openCalls++ > 0) {
          return new Promise<unknown>((resolve) => {
            releaseFocus = resolve
          })
        }
        if (command === 'update_ai_window') return updateResult()
        return openResult()
      })
      await harness.controller.openActiveAIPopout()

      const focusing = harness.controller.focusActiveAIPopout()
      await waitFor(() => harness.calls.length === 2)
      const intent = harness.controller.dispatchAIPopoutIntent({
        type: scenario.action,
        clientActionId: `queued-${scenario.action}`,
        contextId: 'context-1'
      })
      // Deliberately skip the control subscription notification. The queued
      // intent must re-read settings at the final host execution boundary.
      harness.setControls(scenario.controls)

      releaseFocus(openResult('focused'))
      await Promise.all([focusing, intent])

      expect(harness.intents).toEqual([])
      expect(harness.calls.map(({ command }) => command)).toEqual([
        'open_ai_window',
        'open_ai_window',
        'update_ai_window'
      ])
      expect(requestFromCall(lastCall(harness.calls)).controls).toEqual(scenario.controls)
      expect(harness.controller.aiPopoutError.value).toContain(scenario.error)
    })
  }
})
