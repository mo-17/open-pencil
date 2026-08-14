import { ref, watch, type Ref } from 'vue'

import { encodeBase64Text } from '@open-pencil/core/bytes'

import { parseAIPopoutControls, type AIPopoutControls } from '@/app/ai/popout/controls'
import {
  getAIPopoutProjection,
  handleAIPopoutIntent,
  subscribeAIPopoutHost
} from '@/app/ai/popout/host'
import {
  AI_POPOUT_LIMITS,
  AI_POPOUT_PROTOCOL_VERSION,
  parseAIPopoutIntent,
  parseAIPopoutProjection,
  type AIPopoutIntent,
  type AIPopoutIntentResult,
  type AIPopoutProjection
} from '@/app/ai/popout/protocol'
import {
  invokePopoutCommand,
  listenToPopoutEvent,
  type PopoutInvoke,
  type PopoutListen
} from '@/app/popout/contracts'
import { aiPopoutControls } from '@/app/settings/ai-popout-controls'
import { isTauri } from '@/app/tauri/env'

const AI_WINDOW_LABEL = 'ai-chat-popout'
const AI_WINDOW_DESTROYED_EVENT = 'ai-window-destroyed'
const AI_WINDOW_INTENT_EVENT = 'ai-window-intent'
const MAX_NATIVE_INTENT_TEXT_BYTES = 32 * 1024
const MAX_NATIVE_INTENT_ID_BYTES = 128

type ProjectionSubscriber = (
  listener: (projection: AIPopoutProjection | null) => void
) => () => void
type ControlsSubscriber = (listener: () => void) => () => void
type PluginGateSubscriber = (listener: (enabled: boolean) => void) => () => void

type AIWindowOpenAction = 'created' | 'focused' | 'recreated'
type AIWindowUpdateAction = 'updated' | 'recreated'

interface AIWindowRequest {
  envelope: string
  controls: AIPopoutControls
}

export interface AIPopoutSessionControllerOptions {
  isDesktop?: () => boolean
  invoke?: PopoutInvoke
  listen?: PopoutListen
  getProjection?: () => AIPopoutProjection | null
  handleIntent?: (intent: unknown) => Promise<AIPopoutIntentResult>
  subscribeHost?: ProjectionSubscriber
  getControls?: () => AIPopoutControls
  subscribeControls?: ControlsSubscriber
  isPluginEnabled?: () => boolean
  subscribePluginEnabled?: PluginGateSubscriber
}

export interface AIPopoutSessionController {
  aiPopoutOpen: Ref<boolean>
  aiPopoutBusy: Ref<boolean>
  aiPopoutError: Ref<string | null>
  openActiveAIPopout(): Promise<void>
  focusActiveAIPopout(): Promise<void>
  syncActiveAIPopout(): Promise<void>
  closeActiveAIPopout(): Promise<void>
  setAIPopoutDisabled(disabled: boolean): Promise<void>
  notifyAIPopoutDestroyed(payload: unknown): void
  dispatchAIPopoutIntent(payload: unknown): Promise<void>
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function isExactObject(value: unknown, keys: readonly string[]): value is object {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Reflect.ownKeys(value)
  return (
    actual.length === keys.length &&
    actual.every((key) => typeof key === 'string' && keys.includes(key))
  )
}

function parseWindowResult(value: unknown, update: boolean): void {
  if (!isExactObject(value, ['label', 'action'])) {
    throw new Error('AI window returned an invalid result')
  }
  const actions = update
    ? new Set<unknown>(['updated', 'recreated'] satisfies AIWindowUpdateAction[])
    : new Set<unknown>(['created', 'focused', 'recreated'] satisfies AIWindowOpenAction[])
  if (
    Reflect.get(value, 'label') !== AI_WINDOW_LABEL ||
    !actions.has(Reflect.get(value, 'action'))
  ) {
    throw new Error('AI window returned an invalid result')
  }
}

function parseCloseResult(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('AI window returned an invalid close result')
  return value
}

function parseDestroyedPayload(value: unknown): boolean {
  return isExactObject(value, ['label']) && Reflect.get(value, 'label') === AI_WINDOW_LABEL
}

function parseNativeIntentId(value: unknown, path: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    new TextEncoder().encode(value).byteLength > MAX_NATIVE_INTENT_ID_BYTES ||
    !/^[A-Za-z0-9][A-Za-z0-9:._~-]*$/.test(value)
  ) {
    throw new TypeError(`${path} must be a bounded opaque identifier.`)
  }
  return value
}

function parseNativeIntentText(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError('AI window submit text is invalid.')
  }
  let containsInvalidControl = false
  for (const character of value) {
    if (
      /\p{Cc}/u.test(character) &&
      character !== '\n' &&
      character !== '\r' &&
      character !== '\t'
    ) {
      containsInvalidControl = true
      break
    }
  }
  if (
    value.length === 0 ||
    new TextEncoder().encode(value).byteLength > MAX_NATIVE_INTENT_TEXT_BYTES ||
    containsInvalidControl
  ) {
    throw new TypeError('AI window submit text is invalid.')
  }
  return value
}

/** Convert the native popup-only event into the versioned host protocol. */
function parseNativeIntent(value: unknown): AIPopoutIntent {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('AI window intent must be an object.')
  }
  const intentType = Reflect.get(value, 'type')
  const base = {
    protocolVersion: AI_POPOUT_PROTOCOL_VERSION,
    contextId: parseNativeIntentId(Reflect.get(value, 'contextId'), 'AI window intent.contextId'),
    clientActionId: parseNativeIntentId(
      Reflect.get(value, 'clientActionId'),
      'AI window intent.clientActionId'
    )
  }
  switch (intentType) {
    case 'submit':
      if (!isExactObject(value, ['type', 'text', 'clientActionId', 'contextId'])) {
        throw new TypeError('AI window submit intent has unsupported or missing fields.')
      }
      return parseAIPopoutIntent({
        ...base,
        type: 'submit',
        text: parseNativeIntentText(Reflect.get(value, 'text'))
      })
    case 'stop':
    case 'continue':
    case 'clear':
    case 'retry':
    case 'openSettings':
      if (!isExactObject(value, ['type', 'clientActionId', 'contextId'])) {
        throw new TypeError(`AI window ${intentType} intent has unsupported or missing fields.`)
      }
      return parseAIPopoutIntent({ ...base, type: intentType })
    case 'toolApproval': {
      const approved = Reflect.get(value, 'approved')
      if (
        !isExactObject(value, ['type', 'token', 'approved', 'clientActionId', 'contextId']) ||
        typeof approved !== 'boolean'
      ) {
        throw new TypeError('AI window tool approval intent has unsupported or missing fields.')
      }
      return parseAIPopoutIntent({
        ...base,
        type: 'toolApproval',
        approvalToken: parseNativeIntentId(Reflect.get(value, 'token'), 'AI window intent.token'),
        approved
      })
    }
    default:
      throw new TypeError('AI window intent type is unsupported.')
  }
}

function projectionRequest(
  projection: AIPopoutProjection,
  controls: AIPopoutControls
): AIWindowRequest {
  const validatedProjection = parseAIPopoutProjection(projection)
  return {
    envelope: encodeBase64Text(JSON.stringify(validatedProjection)),
    controls: parseAIPopoutControls(controls)
  }
}

function transientErrorProjection(
  message: string,
  source: AIPopoutProjection | null
): AIPopoutProjection | null {
  if (!source) return null
  return parseAIPopoutProjection({
    ...source,
    status: 'error',
    error: message.replaceAll('\0', ' ').slice(0, AI_POPOUT_LIMITS.errorChars)
  })
}

async function loadDefaultPluginGate(): Promise<{
  isEnabled: () => boolean
  subscribe: PluginGateSubscriber
}> {
  const [{ appPluginStore }, { AI_POPOUT_COMMAND, AI_POPOUT_PLUGIN_ID }] = await Promise.all([
    import('@/app/plugins/app'),
    import('@/app/plugins/host/ids')
  ])
  const isEnabled = (): boolean =>
    appPluginStore.command(AI_POPOUT_PLUGIN_ID, AI_POPOUT_COMMAND.commandId) !== null
  return {
    isEnabled,
    subscribe(listener) {
      return appPluginStore.subscribe(() => listener(isEnabled()))
    }
  }
}

function defaultSubscribeControls(listener: () => void): () => void {
  return watch(aiPopoutControls, listener, { deep: true })
}

export function createAIPopoutSessionController(
  options: AIPopoutSessionControllerOptions = {}
): AIPopoutSessionController {
  const aiPopoutOpen = ref(false)
  const aiPopoutBusy = ref(false)
  const aiPopoutError = ref<string | null>(null)
  const desktopAvailable = options.isDesktop ?? isTauri
  const invoke = options.invoke ?? invokePopoutCommand
  const listen = options.listen ?? listenToPopoutEvent
  const getProjection = options.getProjection ?? getAIPopoutProjection
  const dispatchIntent = options.handleIntent ?? handleAIPopoutIntent
  const subscribeHost = options.subscribeHost ?? subscribeAIPopoutHost
  const getControls = options.getControls ?? (() => aiPopoutControls.value)
  const subscribeControls = options.subscribeControls ?? defaultSubscribeControls

  let explicitlyDisabled = false
  // The built-in plugin is an authorization boundary. Stay closed until the
  // default store (or an injected test gate) proves the command is active.
  let pluginDisabled = true
  let pendingOperations = 0
  let queue: Promise<void> = Promise.resolve()
  let nativeWindowMayExist = false
  let destroyedListenerPromise: Promise<void> | null = null
  let intentListenerPromise: Promise<void> | null = null
  let pluginGatePromise: Promise<void> | null = null
  let pluginGateReader: (() => boolean) | null = null

  function isDisabled(): boolean {
    return explicitlyDisabled || pluginDisabled
  }

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    pendingOperations++
    aiPopoutBusy.value = true
    const result = queue.then(operation)
    queue = result.then(
      () => undefined,
      () => undefined
    )
    const settle = (): void => {
      pendingOperations--
      aiPopoutBusy.value = pendingOperations > 0
    }
    void result.then(settle, settle)
    return result
  }

  function requireRequest(): AIWindowRequest {
    if (!desktopAvailable()) {
      throw new Error('AI popout is only available in the desktop app')
    }
    refreshPluginGate()
    if (isDisabled()) throw new Error('AI popout is disabled')
    const projection = getProjection()
    if (!projection) throw new Error('The active AI chat is not ready')
    return projectionRequest(projection, getControls())
  }

  function notifyAIPopoutDestroyed(payload: unknown): void {
    if (!parseDestroyedPayload(payload)) return
    nativeWindowMayExist = false
    aiPopoutOpen.value = false
  }

  function ensureDestroyedListener(): Promise<void> {
    if (!desktopAvailable()) return Promise.resolve()
    if (destroyedListenerPromise) return destroyedListenerPromise
    destroyedListenerPromise = listen(AI_WINDOW_DESTROYED_EVENT, (event) => {
      notifyAIPopoutDestroyed(event.payload)
    })
      .then(() => undefined)
      .catch((cause) => {
        destroyedListenerPromise = null
        aiPopoutError.value = errorMessage(cause)
        throw cause
      })
    return destroyedListenerPromise
  }

  function ensureIntentListener(): Promise<void> {
    if (!desktopAvailable()) return Promise.resolve()
    if (intentListenerPromise) return intentListenerPromise
    intentListenerPromise = listen(AI_WINDOW_INTENT_EVENT, (event) => {
      void dispatchAIPopoutIntent(event.payload)
    })
      .then(() => undefined)
      .catch((cause) => {
        intentListenerPromise = null
        aiPopoutError.value = errorMessage(cause)
        throw cause
      })
    return intentListenerPromise
  }

  async function ensureNativeListeners(): Promise<void> {
    await Promise.all([ensureDestroyedListener(), ensureIntentListener()])
  }

  function applyPluginEnabled(enabled: boolean): void {
    const wasPluginDisabled = pluginDisabled
    pluginDisabled = !enabled
    // PropertiesPanel historically mirrors this same plugin command into the
    // explicit gate. If that component unmounts while disabled, the always-live
    // store transition must still release its stale mirror on re-enable.
    if (enabled && wasPluginDisabled) explicitlyDisabled = false
    if (!enabled && (!wasPluginDisabled || aiPopoutOpen.value || nativeWindowMayExist)) {
      void closeActiveAIPopout()
    }
  }

  function refreshPluginGate(): void {
    if (pluginGateReader) applyPluginEnabled(pluginGateReader())
  }

  function ensurePluginGate(): Promise<void> {
    if (pluginGatePromise) return pluginGatePromise
    pluginGatePromise = (async () => {
      if (options.isPluginEnabled) {
        pluginGateReader = options.isPluginEnabled
        refreshPluginGate()
        options.subscribePluginEnabled?.(applyPluginEnabled)
        return
      }
      const gate = await loadDefaultPluginGate()
      pluginGateReader = gate.isEnabled
      refreshPluginGate()
      gate.subscribe(applyPluginEnabled)
      // Close the load-to-subscribe race by reading the authoritative command
      // state once more after the listener is installed.
      refreshPluginGate()
    })().catch((cause) => {
      pluginDisabled = true
      aiPopoutError.value = errorMessage(cause)
      throw cause
    })
    return pluginGatePromise
  }

  async function openActiveAIPopout(): Promise<void> {
    return enqueue(async () => {
      aiPopoutError.value = null
      try {
        await ensurePluginGate()
        await ensureNativeListeners()
        const request = requireRequest()
        // Once native receives the request it may create the window before a
        // later show/focus step reports an error. Keep cleanup authority even
        // when the invoke promise rejects.
        nativeWindowMayExist = true
        const result = await invoke<unknown>('open_ai_window', { request })
        parseWindowResult(result, false)
        aiPopoutOpen.value = true
      } catch (cause) {
        aiPopoutError.value = errorMessage(cause)
        throw cause
      }
    })
  }

  async function focusActiveAIPopout(): Promise<void> {
    return enqueue(async () => {
      if (!aiPopoutOpen.value) throw new Error('The AI popout is not open')
      aiPopoutError.value = null
      try {
        await ensurePluginGate()
        await ensureNativeListeners()
        const request = requireRequest()
        const result = await invoke<unknown>('open_ai_window', { request })
        nativeWindowMayExist = true
        parseWindowResult(result, false)
        aiPopoutOpen.value = true
      } catch (cause) {
        aiPopoutError.value = errorMessage(cause)
        throw cause
      }
    })
  }

  async function performSync(projectionOverride?: AIPopoutProjection): Promise<void> {
    try {
      // A projection or control change observed while open is pending waits
      // behind it and is read only when this operation reaches the queue.
      if (!aiPopoutOpen.value || isDisabled()) return
      const request = projectionOverride
        ? projectionRequest(projectionOverride, getControls())
        : requireRequest()
      const result = await invoke<unknown>('update_ai_window', { request })
      if (result === null) {
        nativeWindowMayExist = false
        aiPopoutOpen.value = false
        return
      }
      nativeWindowMayExist = true
      parseWindowResult(result, true)
      aiPopoutError.value = null
    } catch (cause) {
      aiPopoutError.value = errorMessage(cause)
    }
  }

  async function syncActiveAIPopout(): Promise<void> {
    return enqueue(() => performSync())
  }

  async function dispatchAIPopoutIntent(payload: unknown): Promise<void> {
    return enqueue(async () => {
      let actionError: string | null = null
      let projectionOverride: AIPopoutProjection | null = null
      try {
        await ensurePluginGate()
        const intent = parseNativeIntent(payload)
        // The event may have waited behind an open/update. Re-check the
        // authoritative plugin gate at the host execution boundary.
        refreshPluginGate()
        if (isDisabled()) throw new Error('AI popout is disabled')
        const controls = parseAIPopoutControls(getControls())
        if (intent.type === 'clear' && (!controls.toolbar || !controls.clearChat)) {
          throw new Error('AI popout clear conversation control is disabled')
        }
        if (intent.type === 'openSettings' && (!controls.toolbar || !controls.settings)) {
          throw new Error('AI popout settings control is disabled')
        }
        const result = await dispatchIntent(intent)
        if (result.ok) {
          projectionOverride = result.projection
        } else {
          actionError = result.message
          projectionOverride = transientErrorProjection(
            result.message,
            result.projection ?? getProjection()
          )
        }
      } catch (cause) {
        actionError = errorMessage(cause)
        projectionOverride = transientErrorProjection(actionError, getProjection())
      }
      await performSync(projectionOverride ?? undefined)
      if (actionError !== null && aiPopoutError.value === null) {
        aiPopoutError.value = actionError
      }
    })
  }

  async function closeActiveAIPopout(): Promise<void> {
    return enqueue(async () => {
      if (!aiPopoutOpen.value && !nativeWindowMayExist) return
      try {
        if (desktopAvailable()) {
          parseCloseResult(await invoke<unknown>('close_ai_window'))
        }
        nativeWindowMayExist = false
        aiPopoutOpen.value = false
        aiPopoutError.value = null
      } catch (cause) {
        aiPopoutError.value = errorMessage(cause)
      }
    })
  }

  async function setAIPopoutDisabled(nextDisabled: boolean): Promise<void> {
    explicitlyDisabled = nextDisabled
    if (nextDisabled) await closeActiveAIPopout()
  }

  subscribeHost((projection) => {
    if (!aiPopoutOpen.value && !aiPopoutBusy.value) return
    if (projection === null) {
      void closeActiveAIPopout()
      return
    }
    void syncActiveAIPopout()
  })
  subscribeControls(() => {
    if (aiPopoutOpen.value || aiPopoutBusy.value) void syncActiveAIPopout()
  })
  void ensurePluginGate().catch(() => undefined)

  return {
    aiPopoutOpen,
    aiPopoutBusy,
    aiPopoutError,
    openActiveAIPopout,
    focusActiveAIPopout,
    syncActiveAIPopout,
    closeActiveAIPopout,
    setAIPopoutDisabled,
    notifyAIPopoutDestroyed,
    dispatchAIPopoutIntent
  }
}

const appController = createAIPopoutSessionController()

export const aiPopoutOpen = appController.aiPopoutOpen
export const aiPopoutBusy = appController.aiPopoutBusy
export const aiPopoutError = appController.aiPopoutError
export const openActiveAIPopout: AIPopoutSessionController['openActiveAIPopout'] = (...args) =>
  appController.openActiveAIPopout(...args)
export const focusActiveAIPopout: AIPopoutSessionController['focusActiveAIPopout'] = (...args) =>
  appController.focusActiveAIPopout(...args)
export const syncActiveAIPopout: AIPopoutSessionController['syncActiveAIPopout'] = (...args) =>
  appController.syncActiveAIPopout(...args)
export const closeActiveAIPopout: AIPopoutSessionController['closeActiveAIPopout'] = (...args) =>
  appController.closeActiveAIPopout(...args)
export const setAIPopoutDisabled: AIPopoutSessionController['setAIPopoutDisabled'] = (...args) =>
  appController.setAIPopoutDisabled(...args)
