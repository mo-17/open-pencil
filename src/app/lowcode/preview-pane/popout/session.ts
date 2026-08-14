import { ref, type Ref } from 'vue'

import {
  invokePopoutCommand,
  listenToPopoutEvent,
  type PopoutInvoke,
  type PopoutListen
} from '@/app/popout/contracts'
import { isTauri } from '@/app/tauri/env'

import { parseCompilerPreviewPopoutIntent, type CompilerPreviewPopoutIntent } from './intent'
import { parseCompilerPreviewPopoutRequest, type CompilerPreviewPopoutRequest } from './url'

const PREVIEW_WINDOW_LABEL = 'lowcode-preview-popout'
const PREVIEW_WINDOW_DESTROYED_EVENT = 'preview-window-destroyed'
const PREVIEW_WINDOW_INTENT_EVENT = 'preview-window-intent'

type PreviewWindowAction = 'created' | 'focused' | 'navigated' | 'recreated'
type PreviewWindowUpdateAction = 'unchanged' | 'navigated' | 'recreated'

interface PreviewWindowResult {
  label: typeof PREVIEW_WINDOW_LABEL
  url: string
  action: PreviewWindowAction | PreviewWindowUpdateAction
}

interface PreviewWindowResultSource {
  label?: unknown
  url?: unknown
  action?: unknown
}

interface PreviewWindowDestroyedSource {
  label?: unknown
}

export interface CompilerPreviewPopoutSession {
  getRequest: () => CompilerPreviewPopoutRequest | null
  handleIntent: (intent: CompilerPreviewPopoutIntent) => Promise<void>
}

export interface CompilerPreviewPopoutControllerOptions {
  isDesktop?: () => boolean
  invoke?: PopoutInvoke
  listen?: PopoutListen
}

export interface CompilerPreviewPopoutController {
  compilerPreviewPopoutOpen: Ref<boolean>
  compilerPreviewPopoutBusy: Ref<boolean>
  compilerPreviewPopoutError: Ref<string | null>
  registerCompilerPreviewPopoutSession(session: CompilerPreviewPopoutSession): () => void
  openActiveCompilerPreviewPopout(): Promise<void>
  syncActiveCompilerPreviewPopout(): Promise<void>
  closeActiveCompilerPreviewPopout(): Promise<void>
  setCompilerPreviewPopoutDisabled(disabled: boolean): Promise<void>
  notifyCompilerPreviewPopoutDestroyed(payload: unknown): void
  dispatchCompilerPreviewPopoutIntent(payload: unknown): Promise<void>
}

interface RegisteredSession extends CompilerPreviewPopoutSession {
  token: symbol
}

function controlsAllowIntent(
  controls: CompilerPreviewPopoutRequest['controls'],
  intent: CompilerPreviewPopoutIntent
): boolean {
  if (!controls.toolbar) return false
  switch (intent.type) {
    case 'diagnostics':
      return controls.diagnostics
    case 'exportMicrofrontend':
      return controls.exportMicrofrontend
    case 'deploy':
      return controls.deploy
  }
  return false
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function parseWindowResult(
  value: unknown,
  update: boolean,
  expectedURL: string
): PreviewWindowResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Compiler preview window returned an invalid result')
  }
  const source: PreviewWindowResultSource = value
  const actions = update
    ? new Set<unknown>(['unchanged', 'navigated', 'recreated'])
    : new Set<unknown>(['created', 'focused', 'navigated', 'recreated'])
  if (
    Reflect.ownKeys(source).some(
      (key) => typeof key !== 'string' || !['label', 'url', 'action'].includes(key)
    ) ||
    source.label !== PREVIEW_WINDOW_LABEL ||
    source.url !== expectedURL ||
    !actions.has(source.action)
  ) {
    throw new Error('Compiler preview window returned an invalid result')
  }
  return {
    label: PREVIEW_WINDOW_LABEL,
    url: expectedURL,
    action: source.action as PreviewWindowResult['action']
  }
}

export function createCompilerPreviewPopoutController(
  options: CompilerPreviewPopoutControllerOptions = {}
): CompilerPreviewPopoutController {
  const compilerPreviewPopoutOpen = ref(false)
  const compilerPreviewPopoutBusy = ref(false)
  const compilerPreviewPopoutError = ref<string | null>(null)
  const desktopAvailable = options.isDesktop ?? isTauri
  const invoke = options.invoke ?? invokePopoutCommand
  const listen = options.listen ?? listenToPopoutEvent

  let activeSession: RegisteredSession | null = null
  let windowOwner: symbol | null = null
  let disabled = false
  let pendingOperations = 0
  let queue: Promise<void> = Promise.resolve()
  let destroyedListenerPromise: Promise<void> | null = null
  let intentListenerPromise: Promise<void> | null = null

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    pendingOperations++
    compilerPreviewPopoutBusy.value = true
    const result = queue.then(operation)
    queue = result.then(
      () => undefined,
      () => undefined
    )
    const settle = (): void => {
      pendingOperations--
      compilerPreviewPopoutBusy.value = pendingOperations > 0
    }
    void result.then(settle, settle)
    return result
  }

  function notifyCompilerPreviewPopoutDestroyed(payload: unknown): void {
    if (
      payload !== null &&
      typeof payload === 'object' &&
      !Array.isArray(payload) &&
      (payload as PreviewWindowDestroyedSource).label === PREVIEW_WINDOW_LABEL
    ) {
      compilerPreviewPopoutOpen.value = false
      windowOwner = null
    }
  }

  function ensureDestroyedListener(): Promise<void> {
    if (!desktopAvailable()) return Promise.resolve()
    if (destroyedListenerPromise) return destroyedListenerPromise
    destroyedListenerPromise = listen(PREVIEW_WINDOW_DESTROYED_EVENT, (event) => {
      notifyCompilerPreviewPopoutDestroyed(event.payload)
    })
      .then(() => undefined)
      .catch((cause) => {
        destroyedListenerPromise = null
        compilerPreviewPopoutError.value = errorMessage(cause)
        throw cause
      })
    return destroyedListenerPromise
  }

  function ensureIntentListener(): Promise<void> {
    if (!desktopAvailable()) return Promise.resolve()
    if (intentListenerPromise) return intentListenerPromise
    intentListenerPromise = listen(PREVIEW_WINDOW_INTENT_EVENT, (event) => {
      void dispatchCompilerPreviewPopoutIntent(event.payload)
    })
      .then(() => undefined)
      .catch((cause) => {
        intentListenerPromise = null
        compilerPreviewPopoutError.value = errorMessage(cause)
        throw cause
      })
    return intentListenerPromise
  }

  async function dispatchCompilerPreviewPopoutIntent(payload: unknown): Promise<void> {
    let intent: CompilerPreviewPopoutIntent
    try {
      intent = parseCompilerPreviewPopoutIntent(payload)
    } catch (cause) {
      compilerPreviewPopoutError.value = errorMessage(cause)
      return
    }
    const owner = activeSession
    if (disabled || !owner || windowOwner !== owner.token || !compilerPreviewPopoutOpen.value) {
      compilerPreviewPopoutError.value = 'No active compiler preview window session'
      return
    }
    const request = owner.getRequest()
    if (!request) {
      compilerPreviewPopoutError.value = 'The compiler preview is not ready'
      return
    }
    let controls: CompilerPreviewPopoutRequest['controls']
    try {
      controls = parseCompilerPreviewPopoutRequest(request).controls
    } catch (cause) {
      compilerPreviewPopoutError.value = errorMessage(cause)
      return
    }
    if (!controlsAllowIntent(controls, intent)) {
      compilerPreviewPopoutError.value = 'The compiler preview window action is disabled'
      return
    }
    try {
      await owner.handleIntent(intent)
      compilerPreviewPopoutError.value = null
    } catch (cause) {
      compilerPreviewPopoutError.value = errorMessage(cause)
    }
  }

  function requireActiveRequest(): {
    owner: RegisteredSession
    request: CompilerPreviewPopoutRequest
  } {
    if (!desktopAvailable()) {
      throw new Error('Compiler preview popout is only available in the desktop app')
    }
    if (disabled) throw new Error('Compiler preview popout is disabled')
    const owner = activeSession
    if (!owner) throw new Error('No active compiler preview session')
    const request = owner.getRequest()
    if (!request) throw new Error('The compiler preview is not ready')
    return { owner, request: parseCompilerPreviewPopoutRequest(request) }
  }

  function registerCompilerPreviewPopoutSession(session: CompilerPreviewPopoutSession): () => void {
    const registered: RegisteredSession = { ...session, token: Symbol('compiler-preview-popout') }
    activeSession = registered
    void ensureDestroyedListener().catch(() => undefined)
    void ensureIntentListener().catch(() => undefined)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      if (activeSession?.token === registered.token) activeSession = null
      void enqueue(async () => {
        if (windowOwner !== registered.token) return
        try {
          await invoke<boolean>('close_preview_window')
        } catch (cause) {
          compilerPreviewPopoutError.value = errorMessage(cause)
          return
        }
        if (windowOwner === registered.token) {
          windowOwner = null
          compilerPreviewPopoutOpen.value = false
        }
      })
    }
  }

  async function openActiveCompilerPreviewPopout(): Promise<void> {
    return enqueue(async () => {
      compilerPreviewPopoutError.value = null
      try {
        // Both listeners must be installed before native can expose the
        // window. Otherwise an immediate toolbar action can be delivered
        // before the main webview is ready to receive it.
        await Promise.all([ensureDestroyedListener(), ensureIntentListener()])
        const { owner, request } = requireActiveRequest()
        const result = await invoke<unknown>('open_preview_window', { request })
        parseWindowResult(result, false, new URL(request.path, request.url).href)
        windowOwner = owner.token
        compilerPreviewPopoutOpen.value = true
      } catch (cause) {
        compilerPreviewPopoutError.value = errorMessage(cause)
        throw cause
      }
    })
  }

  async function syncActiveCompilerPreviewPopout(): Promise<void> {
    return enqueue(async () => {
      try {
        // A sync requested while native open is in flight must wait behind it,
        // then re-read the active session instead of dropping the newer page
        // or controls captured by the caller's watcher.
        if (!compilerPreviewPopoutOpen.value || disabled || activeSession === null) return
        const { owner, request } = requireActiveRequest()
        const result = await invoke<unknown>('update_preview_window', { request })
        if (result === null) {
          windowOwner = null
          compilerPreviewPopoutOpen.value = false
          return
        }
        parseWindowResult(result, true, new URL(request.path, request.url).href)
        windowOwner = owner.token
        compilerPreviewPopoutError.value = null
      } catch (cause) {
        compilerPreviewPopoutError.value = errorMessage(cause)
      }
    })
  }

  async function closeActiveCompilerPreviewPopout(): Promise<void> {
    return enqueue(async () => {
      if (!compilerPreviewPopoutOpen.value && windowOwner === null) return
      try {
        if (desktopAvailable()) await invoke<boolean>('close_preview_window')
        windowOwner = null
        compilerPreviewPopoutOpen.value = false
        compilerPreviewPopoutError.value = null
      } catch (cause) {
        compilerPreviewPopoutError.value = errorMessage(cause)
      }
    })
  }

  async function setCompilerPreviewPopoutDisabled(nextDisabled: boolean): Promise<void> {
    disabled = nextDisabled
    if (nextDisabled) await closeActiveCompilerPreviewPopout()
  }

  return {
    compilerPreviewPopoutOpen,
    compilerPreviewPopoutBusy,
    compilerPreviewPopoutError,
    registerCompilerPreviewPopoutSession,
    openActiveCompilerPreviewPopout,
    syncActiveCompilerPreviewPopout,
    closeActiveCompilerPreviewPopout,
    setCompilerPreviewPopoutDisabled,
    notifyCompilerPreviewPopoutDestroyed,
    dispatchCompilerPreviewPopoutIntent
  }
}

const appController = createCompilerPreviewPopoutController()

export const compilerPreviewPopoutOpen = appController.compilerPreviewPopoutOpen
export const compilerPreviewPopoutBusy = appController.compilerPreviewPopoutBusy
export const compilerPreviewPopoutError = appController.compilerPreviewPopoutError
export const registerCompilerPreviewPopoutSession: CompilerPreviewPopoutController['registerCompilerPreviewPopoutSession'] =
  (...args) => appController.registerCompilerPreviewPopoutSession(...args)
export const openActiveCompilerPreviewPopout: CompilerPreviewPopoutController['openActiveCompilerPreviewPopout'] =
  (...args) => appController.openActiveCompilerPreviewPopout(...args)
export const syncActiveCompilerPreviewPopout: CompilerPreviewPopoutController['syncActiveCompilerPreviewPopout'] =
  (...args) => appController.syncActiveCompilerPreviewPopout(...args)
export const closeActiveCompilerPreviewPopout: CompilerPreviewPopoutController['closeActiveCompilerPreviewPopout'] =
  (...args) => appController.closeActiveCompilerPreviewPopout(...args)
export const setCompilerPreviewPopoutDisabled: CompilerPreviewPopoutController['setCompilerPreviewPopoutDisabled'] =
  (...args) => appController.setCompilerPreviewPopoutDisabled(...args)
export const dispatchCompilerPreviewPopoutIntent: CompilerPreviewPopoutController['dispatchCompilerPreviewPopoutIntent'] =
  (...args) => appController.dispatchCompilerPreviewPopoutIntent(...args)
