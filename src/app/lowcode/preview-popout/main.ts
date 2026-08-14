import { invoke } from '@tauri-apps/api/core'

import type { CompilerPreviewPopoutControls } from '../preview-pane/popout/controls'
import {
  parseCompilerPreviewPopoutIntent,
  type CompilerPreviewPopoutIntentType
} from '../preview-pane/popout/intent'
import { createCompilerPreviewPopoutShellController } from './controller'
import {
  installCompilerPreviewPopoutReceiver,
  requestCompilerPreviewPopoutLatestPayload,
  type CompilerPreviewPopoutGlobalTarget
} from './globals'

const PREVIEW_BRIDGE_SOURCE = 'op-lowcode-editor'

function requireElement<T extends Element>(selector: string, type: new () => T): T {
  const element = document.querySelector(selector)
  if (!(element instanceof type)) throw new Error(`Missing preview shell element: ${selector}`)
  return element
}

const iframe = requireElement('#compiler-preview', HTMLIFrameElement)
const shell = requireElement('#compiler-preview-shell', HTMLElement)
const status = requireElement('#compiler-preview-status', HTMLElement)
const toolbar = requireElement('#compiler-preview-toolbar', HTMLElement)
const reloadButton = requireElement('#compiler-preview-reload', HTMLButtonElement)
const focusEditorButton = requireElement('#compiler-preview-focus-editor', HTMLButtonElement)
const alwaysOnTopButton = requireElement('#compiler-preview-always-on-top', HTMLButtonElement)
const moreMenu = requireElement('#compiler-preview-more-menu', HTMLDetailsElement)
const moreMenuSummary = requireElement('#compiler-preview-more-menu-summary', HTMLElement)
const diagnosticsButton = requireElement('#compiler-preview-diagnostics', HTMLButtonElement)
const exportMicrofrontendButton = requireElement(
  '#compiler-preview-export-microfrontend',
  HTMLButtonElement
)
const deployButton = requireElement('#compiler-preview-deploy', HTMLButtonElement)
const toolbarStatus = requireElement('#compiler-preview-toolbar-status', HTMLElement)
let frameLoaded = false
let pendingNavigation: Readonly<{ origin: string; path: string }> | null = null
let requestedAlwaysOnTop = false
let appliedAlwaysOnTop = false
let pinOperations = 0
let pinRevision = 0
let pinQueue: Promise<void> = Promise.resolve()

function showStatus(message: string, error = false): void {
  status.textContent = message
  status.dataset.kind = error ? 'error' : 'connecting'
  status.hidden = false
}

function revealPreview(): void {
  status.hidden = true
  iframe.hidden = false
}

function announceToolbarError(message: string, cause: unknown): void {
  console.error(`[compiler preview popout] ${message}`, cause)
  toolbarStatus.textContent = message
}

function firstVisibleToolbarButton(): HTMLElement | null {
  return (
    [reloadButton, focusEditorButton, alwaysOnTopButton].find((button) => !button.hidden) ??
    (!moreMenu.hidden ? moreMenuSummary : null)
  )
}

function moveFocusAfterHidingControl(previousFocus: Element | null): void {
  if (
    !(previousFocus instanceof HTMLElement) ||
    !toolbar.contains(previousFocus) ||
    (!toolbar.hidden && !previousFocus.hidden && !previousFocus.closest('[hidden]'))
  ) {
    return
  }
  const next = firstVisibleToolbarButton()
  if (next) next.focus({ preventScroll: true })
  else shell.focus({ preventScroll: true })
}

function hasVisibleToolbarControl(next: CompilerPreviewPopoutControls): boolean {
  return (
    next.reload ||
    next.focusEditor ||
    next.alwaysOnTop ||
    next.diagnostics ||
    next.exportMicrofrontend ||
    next.deploy
  )
}

function hasVisibleMoreAction(next: CompilerPreviewPopoutControls): boolean {
  return next.diagnostics || next.exportMicrofrontend || next.deploy
}

function resetPinIfHidden(): void {
  if (!alwaysOnTopButton.hidden || (!requestedAlwaysOnTop && !appliedAlwaysOnTop)) return
  // The main-window update applies the same exact controls before this payload
  // reaches the wrapper and has already removed native pinning.
  pinRevision++
  requestedAlwaysOnTop = false
  appliedAlwaysOnTop = false
  updateAlwaysOnTopButton()
}

function updateAlwaysOnTopButton(): void {
  alwaysOnTopButton.setAttribute('aria-pressed', String(requestedAlwaysOnTop))
  alwaysOnTopButton.disabled = pinOperations > 0
}

function setAlwaysOnTop(enabled: boolean, reportFailure: boolean): void {
  requestedAlwaysOnTop = enabled
  const revision = ++pinRevision
  pinOperations++
  updateAlwaysOnTopButton()

  const operation = pinQueue.then(() => invoke('set_preview_window_always_on_top', { enabled }))
  pinQueue = operation.then(
    () => {
      pinOperations--
      if (revision === pinRevision) {
        appliedAlwaysOnTop = enabled
        toolbarStatus.textContent = ''
      }
      updateAlwaysOnTopButton()
      return undefined
    },
    (cause: unknown) => {
      pinOperations--
      if (revision === pinRevision) {
        requestedAlwaysOnTop = appliedAlwaysOnTop
        if (reportFailure) {
          announceToolbarError('Always-on-top could not be changed.', cause)
        }
      }
      updateAlwaysOnTopButton()
      return undefined
    }
  )
}

function applyControls(next: CompilerPreviewPopoutControls): void {
  const previousFocus = document.activeElement
  reloadButton.hidden = !next.toolbar || !next.reload
  focusEditorButton.hidden = !next.toolbar || !next.focusEditor
  alwaysOnTopButton.hidden = !next.toolbar || !next.alwaysOnTop
  diagnosticsButton.hidden = !next.toolbar || !next.diagnostics
  exportMicrofrontendButton.hidden = !next.toolbar || !next.exportMicrofrontend
  deployButton.hidden = !next.toolbar || !next.deploy
  moreMenu.hidden = !next.toolbar || !hasVisibleMoreAction(next)
  const focusedMoreActionWasHidden =
    previousFocus instanceof HTMLElement &&
    moreMenu.contains(previousFocus) &&
    previousFocus.closest('[hidden]') !== null
  if (moreMenu.hidden || focusedMoreActionWasHidden) moreMenu.open = false
  toolbar.hidden = !next.toolbar || !hasVisibleToolbarControl(next)
  resetPinIfHidden()
  moveFocusAfterHidingControl(previousFocus)
}

function postNavigation(origin: string, path: string): boolean {
  if (!frameLoaded || !iframe.contentWindow) return false
  iframe.contentWindow.postMessage(
    { source: PREVIEW_BRIDGE_SOURCE, type: 'navigate', route: path },
    origin
  )
  return true
}

const controller = createCompilerPreviewPopoutShellController({
  loadSource(destination) {
    frameLoaded = false
    pendingNavigation = null
    iframe.hidden = true
    showStatus('Connecting…')
    iframe.src = destination
  },
  navigate(origin, path) {
    pendingNavigation = { origin, path }
    if (postNavigation(origin, path)) pendingNavigation = null
  },
  applyControls,
  reload(destination) {
    frameLoaded = false
    pendingNavigation = null
    iframe.hidden = true
    showStatus('Connecting…')
    iframe.src = destination
  }
})

reloadButton.addEventListener('click', () => {
  toolbarStatus.textContent = ''
  controller.reload()
})

async function focusEditor(): Promise<void> {
  toolbarStatus.textContent = ''
  focusEditorButton.disabled = true
  try {
    await invoke('focus_preview_editor_window')
  } catch (cause) {
    announceToolbarError('The OpenPencil editor could not be focused.', cause)
  } finally {
    focusEditorButton.disabled = false
  }
}

focusEditorButton.addEventListener('click', () => {
  void focusEditor()
})

alwaysOnTopButton.addEventListener('click', () => {
  toolbarStatus.textContent = ''
  setAlwaysOnTop(!requestedAlwaysOnTop, true)
})

async function sendIntent(type: CompilerPreviewPopoutIntentType): Promise<void> {
  toolbarStatus.textContent = ''
  moreMenu.open = false
  const intent = parseCompilerPreviewPopoutIntent({ type })
  try {
    await invoke('send_preview_window_intent', { intent })
  } catch (cause) {
    announceToolbarError('The preview action could not be opened in the editor.', cause)
  }
}

diagnosticsButton.addEventListener('click', () => {
  void sendIntent('diagnostics')
})

exportMicrofrontendButton.addEventListener('click', () => {
  void sendIntent('exportMicrofrontend')
})

deployButton.addEventListener('click', () => {
  void sendIntent('deploy')
})

iframe.addEventListener('load', () => {
  frameLoaded = true
  revealPreview()
  const pending = pendingNavigation
  if (pending && postNavigation(pending.origin, pending.path)) pendingNavigation = null
})

iframe.addEventListener('error', () => {
  frameLoaded = false
  showStatus('Compiler preview could not be loaded.', true)
})

function receiveNativePayload(payload: unknown): void {
  try {
    controller.update(payload)
  } catch (cause) {
    console.error('[compiler preview popout] Rejected native payload:', cause)
    showStatus('Compiler preview update was rejected.', true)
  }
}

// Install synchronously before asking native state for its latest exact
// payload. Initialization-script and eval delivery remain fast paths; this
// popup-only handshake closes their page-load timing gap. The controller's
// revision gate safely ignores a duplicated or stale response.
installCompilerPreviewPopoutReceiver(
  window as CompilerPreviewPopoutGlobalTarget,
  receiveNativePayload
)

async function requestStartupPayload(): Promise<void> {
  try {
    await requestCompilerPreviewPopoutLatestPayload(
      () => invoke<unknown>('get_preview_window_latest_payload'),
      receiveNativePayload
    )
  } catch (cause) {
    console.error('[compiler preview popout] Native startup handshake failed:', cause)
    if (controller.snapshot() === null) {
      showStatus('Compiler preview connection could not be initialized.', true)
    }
  }
}

void requestStartupPayload()

// The HTML keeps the toolbar inaccessible until the first exact native payload
// applies host-owned controls. Generated iframe content has no path to it.
