import { invoke } from '@tauri-apps/api/core'

import {
  AI_POPOUT_PROTOCOL_VERSION,
  type AIPopoutMessage,
  type AIPopoutProjection,
  type AIPopoutToolPart
} from '@/app/ai/popout/protocol'

import { createAIPopoutController } from './controller'
import {
  installAIPopoutReceiver,
  requestAIPopoutLatestPayload,
  type AIPopoutGlobalTarget
} from './globals'
import type { AIPopoutPayload } from './payload'

interface NativeIntentBase {
  readonly clientActionId: string
  readonly contextId: string
}

type NativeIntent =
  | (NativeIntentBase & { readonly type: 'submit'; readonly text: string })
  | (NativeIntentBase & {
      readonly type: 'stop' | 'continue' | 'clear' | 'retry' | 'openSettings'
    })
  | (NativeIntentBase & {
      readonly type: 'toolApproval'
      readonly token: string
      readonly approved: boolean
    })

function requireElement<T extends Element>(selector: string, type: new () => T): T {
  const element = document.querySelector(selector)
  if (!(element instanceof type)) throw new Error(`Missing AI window element: ${selector}`)
  return element
}

const shell = requireElement('#ai-popout-shell', HTMLElement)
const toolbar = requireElement('#ai-popout-toolbar', HTMLElement)
const documentLabel = requireElement('#ai-popout-document', HTMLElement)
const clearButton = requireElement('#ai-popout-clear', HTMLButtonElement)
const settingsButton = requireElement('#ai-popout-settings', HTMLButtonElement)
const focusEditorButton = requireElement('#ai-popout-focus-editor', HTMLButtonElement)
const alwaysOnTopButton = requireElement('#ai-popout-always-on-top', HTMLButtonElement)
const moreRoot = requireElement('#ai-popout-more-root', HTMLElement)
const moreButton = requireElement('#ai-popout-more', HTMLButtonElement)
const moreMenu = requireElement('#ai-popout-more-menu', HTMLElement)
const toolbarStatus = requireElement('#ai-popout-toolbar-status', HTMLElement)
const connection = requireElement('#ai-popout-connection', HTMLElement)
const messages = requireElement('#ai-popout-messages', HTMLElement)
const empty = requireElement('#ai-popout-empty', HTMLElement)
const emptyCopy = requireElement('#ai-popout-empty-copy', HTMLElement)
const messageList = requireElement('#ai-popout-message-list', HTMLOListElement)
const jumpButton = requireElement('#ai-popout-jump', HTMLButtonElement)
const form = requireElement('#ai-popout-form', HTMLFormElement)
const input = requireElement('#ai-popout-input', HTMLTextAreaElement)
const errorBox = requireElement('#ai-popout-error', HTMLElement)
const provider = requireElement('#ai-popout-provider', HTMLElement)
const status = requireElement('#ai-popout-status', HTMLElement)
const continueButton = requireElement('#ai-popout-continue', HTMLButtonElement)
const retryButton = requireElement('#ai-popout-retry', HTMLButtonElement)
const stopButton = requireElement('#ai-popout-stop', HTMLButtonElement)
const sendButton = requireElement('#ai-popout-send', HTMLButtonElement)

let current: AIPopoutPayload | null = null
let draftDirty = false
let intentOperations = 0
let requestedAlwaysOnTop = false
let appliedAlwaysOnTop = false
let pinOperations = 0
let pinRevision = 0
let pinQueue: Promise<void> = Promise.resolve()
let localError = ''
let stayAtLatest = true
let moreMenuOpen = false

function actionId(): string {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  const random = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `ai-${Date.now().toString(36)}-${random}`
}

function statusText(projection: AIPopoutProjection): string {
  if (!projection.configured) return 'Setup required'
  switch (projection.status) {
    case 'submitted':
      return 'Sending'
    case 'streaming':
      return 'Responding'
    case 'error':
      return 'Needs attention'
    case 'unavailable':
      return 'Unavailable'
    case 'ready':
      return 'Ready'
  }
  return 'Unavailable'
}

function announceError(message: string, cause?: unknown): void {
  if (cause !== undefined) console.error(`[AI popout] ${message}`, cause)
  localError = message
  errorBox.textContent = message
  errorBox.hidden = false
}

function clearLocalError(): void {
  localError = ''
  errorBox.hidden = true
  errorBox.textContent = ''
}

function isNearLatest(): boolean {
  return messages.scrollHeight - messages.scrollTop - messages.clientHeight < 96
}

function scrollToLatest(): void {
  messages.scrollTop = messages.scrollHeight
  stayAtLatest = true
  jumpButton.hidden = true
}

function updateJumpButton(): void {
  stayAtLatest = isNearLatest()
  jumpButton.hidden = stayAtLatest
}

function createTextPart(text: string): HTMLElement {
  const part = document.createElement('div')
  part.className = 'message-part'
  part.textContent = text
  return part
}

function intentBase(projection: AIPopoutProjection): NativeIntentBase {
  return { contextId: projection.contextId, clientActionId: actionId() }
}

async function sendIntent(intent: NativeIntent, clearDraft = false): Promise<boolean> {
  intentOperations++
  updateActions()
  clearLocalError()
  try {
    await invoke('send_ai_window_intent', { intent })
    if (clearDraft) {
      input.value = ''
      draftDirty = false
    }
    return true
  } catch (cause) {
    announceError('The AI action could not be sent to the editor.', cause)
    return false
  } finally {
    intentOperations--
    updateActions()
  }
}

function availableMoreItems(): HTMLButtonElement[] {
  return [clearButton, settingsButton].filter((button) => !button.hidden)
}

function focusableMoreItems(): HTMLButtonElement[] {
  return availableMoreItems().filter((button) => !button.disabled)
}

function setActiveMoreItem(item: HTMLButtonElement | undefined): void {
  for (const candidate of [clearButton, settingsButton]) {
    candidate.tabIndex = moreMenuOpen && candidate === item ? 0 : -1
  }
}

function focusMoreItem(item: HTMLButtonElement | undefined): void {
  setActiveMoreItem(item)
  item?.focus({ preventScroll: true })
}

function focusToolbarFallback(): void {
  if (toolbar.hidden) {
    shell.focus({ preventScroll: true })
    return
  }
  const next = [focusEditorButton, alwaysOnTopButton, moreButton].find(
    (button) => !button.hidden && !button.disabled && (button !== moreButton || !moreRoot.hidden)
  )
  if (next) next.focus({ preventScroll: true })
  else shell.focus({ preventScroll: true })
}

function setMoreMenuOpen(open: boolean, focus: 'first' | 'last' | 'trigger' | false = false): void {
  const items = focusableMoreItems()
  moreMenuOpen = open && !toolbar.hidden && !moreRoot.hidden && items.length > 0
  moreMenu.hidden = !moreMenuOpen
  moreButton.setAttribute('aria-expanded', String(moreMenuOpen))
  if (moreMenuOpen) {
    const current = document.activeElement
    let item: HTMLButtonElement | undefined = items[0]
    if (focus === 'last') item = items.at(-1)
    else if (focus === false && current instanceof HTMLButtonElement && items.includes(current)) {
      item = current
    }
    setActiveMoreItem(item)
    if (focus === 'first' || focus === 'last') item?.focus({ preventScroll: true })
    return
  }
  setActiveMoreItem(undefined)
  if (focus === 'trigger') {
    if (!toolbar.hidden && !moreRoot.hidden && !moreButton.disabled) {
      moreButton.focus({ preventScroll: true })
    } else {
      focusToolbarFallback()
    }
  }
}

function updateMoreMenuAvailability(hadFocusBeforeVisibilityUpdate = false): void {
  const items = availableMoreItems()
  const hadFocus = hadFocusBeforeVisibilityUpdate || moreRoot.contains(document.activeElement)
  moreRoot.hidden = items.length === 0
  if (moreRoot.hidden) {
    setMoreMenuOpen(false)
    if (hadFocus) focusToolbarFallback()
    return
  }
  if (!moreMenuOpen) {
    setActiveMoreItem(undefined)
    return
  }
  const focusableItems = focusableMoreItems()
  if (focusableItems.length === 0) {
    setMoreMenuOpen(false, hadFocus ? 'trigger' : false)
    return
  }
  const active = document.activeElement
  if (!(active instanceof HTMLButtonElement) || !focusableItems.includes(active)) {
    focusMoreItem(focusableItems[0])
  } else {
    setActiveMoreItem(active)
  }
}

function createApprovalActions(
  part: AIPopoutToolPart,
  projection: AIPopoutProjection
): HTMLElement {
  const actions = document.createElement('div')
  actions.className = 'approval-actions'
  const approve = document.createElement('button')
  approve.type = 'button'
  approve.textContent = 'Allow'
  const deny = document.createElement('button')
  deny.type = 'button'
  deny.textContent = 'Deny'

  const decide = (approved: boolean) => {
    if (!part.approvalToken) return
    approve.disabled = true
    deny.disabled = true
    void sendIntent({
      ...intentBase(projection),
      type: 'toolApproval',
      token: part.approvalToken,
      approved
    })
  }
  approve.addEventListener('click', () => decide(true))
  deny.addEventListener('click', () => decide(false))
  actions.append(approve, deny)
  return actions
}

function createToolPart(part: AIPopoutToolPart, projection: AIPopoutProjection): HTMLElement {
  const item = document.createElement('div')
  item.className = 'tool-part'
  const title = document.createElement('div')
  title.className = 'tool-title'
  const name = document.createElement('span')
  name.textContent = part.name
  const toolState = document.createElement('span')
  toolState.className = 'tool-state'
  toolState.textContent = part.state
  title.append(name, toolState)
  item.append(title)
  if (part.summary) {
    const summary = document.createElement('div')
    summary.className = 'tool-summary'
    summary.textContent = part.summary
    item.append(summary)
  }
  if (part.state === 'approval' && part.approvalToken) {
    item.append(createApprovalActions(part, projection))
  }
  return item
}

function createMessage(message: AIPopoutMessage, projection: AIPopoutProjection): HTMLLIElement {
  const item = document.createElement('li')
  item.className = 'message'
  item.dataset.role = message.role
  const label = document.createElement('span')
  label.className = 'message-label'
  label.textContent = message.role === 'user' ? 'You' : 'OpenPencil AI'
  item.append(label)
  for (const part of message.parts) {
    item.append(part.type === 'text' ? createTextPart(part.text) : createToolPart(part, projection))
  }
  return item
}

function renderMessages(projection: AIPopoutProjection): void {
  const shouldFollow = stayAtLatest || isNearLatest()
  messageList.replaceChildren(
    ...projection.messages.map((message) => createMessage(message, projection))
  )
  empty.hidden = projection.messages.length > 0
  if (!projection.configured) {
    emptyCopy.textContent = 'Configure an AI provider in the editor to start a conversation.'
  } else if (projection.status === 'unavailable') {
    emptyCopy.textContent = 'The editor AI session is not available yet.'
  } else {
    emptyCopy.textContent = 'Work with the active design without covering the canvas.'
  }
  requestAnimationFrame(() => {
    if (shouldFollow) scrollToLatest()
    else updateJumpButton()
  })
}

function updateActions(moreHadFocus = moreRoot.contains(document.activeElement)): void {
  const projection = current?.projection
  const busy = intentOperations > 0
  const text = input.value.trim()
  input.disabled = !projection?.configured || projection.status === 'unavailable'
  sendButton.disabled = !projection?.canSubmit || !text || busy
  stopButton.hidden = !projection?.canStop
  stopButton.disabled = busy
  clearButton.hidden =
    !current?.controls.toolbar || !current.controls.clearChat || !projection?.canClear
  clearButton.disabled = busy
  settingsButton.hidden = !current?.controls.toolbar || !current.controls.settings
  settingsButton.disabled = busy
  continueButton.hidden = !projection?.canContinue
  continueButton.disabled = busy
  retryButton.hidden = !projection?.canRetry
  retryButton.disabled = busy
  updateMoreMenuAvailability(moreHadFocus)
}

function updatePinButton(): void {
  alwaysOnTopButton.setAttribute('aria-pressed', String(requestedAlwaysOnTop))
  alwaysOnTopButton.disabled = pinOperations > 0
}

function setAlwaysOnTop(enabled: boolean, reportFailure: boolean): void {
  requestedAlwaysOnTop = enabled
  const revision = ++pinRevision
  pinOperations++
  updatePinButton()
  const operation = pinQueue.then(() => invoke('set_ai_window_always_on_top', { enabled }))
  pinQueue = operation.then(
    () => {
      pinOperations--
      if (revision === pinRevision) {
        appliedAlwaysOnTop = enabled
        toolbarStatus.textContent = ''
      }
      updatePinButton()
      return undefined
    },
    (cause: unknown) => {
      pinOperations--
      if (revision === pinRevision) {
        requestedAlwaysOnTop = appliedAlwaysOnTop
        if (reportFailure) {
          toolbarStatus.textContent = 'Always-on-top could not be changed.'
          console.error('[AI popout] Always-on-top could not be changed.', cause)
        }
      }
      updatePinButton()
      return undefined
    }
  )
}

function applyControls(payload: AIPopoutPayload): void {
  const { controls } = payload
  const previousFocus = document.activeElement
  focusEditorButton.hidden = !controls.toolbar || !controls.focusEditor
  alwaysOnTopButton.hidden = !controls.toolbar || !controls.alwaysOnTop
  toolbar.hidden = !controls.toolbar
  if (toolbar.hidden) setMoreMenuOpen(false)
  if (alwaysOnTopButton.hidden && (requestedAlwaysOnTop || appliedAlwaysOnTop)) {
    pinRevision++
    requestedAlwaysOnTop = false
    appliedAlwaysOnTop = false
    updatePinButton()
  }
  if (
    previousFocus instanceof HTMLElement &&
    previousFocus.closest('#ai-popout-toolbar') &&
    (toolbar.hidden || previousFocus.hidden)
  ) {
    focusToolbarFallback()
  }
}

function applyPayload(payload: AIPopoutPayload): void {
  const previousContext = current?.projection.contextId
  const moreHadFocus = moreRoot.contains(document.activeElement)
  const projection = payload.projection
  current = payload
  connection.hidden = true
  messages.setAttribute(
    'aria-busy',
    String(projection.status === 'submitted' || projection.status === 'streaming')
  )
  documentLabel.textContent = projection.documentName || 'Untitled document'
  document.title = projection.documentName
    ? `${projection.documentName} — OpenPencil AI`
    : 'OpenPencil AI'
  provider.textContent = projection.providerLabel || 'AI'
  status.textContent = statusText(projection)
  if (projection.error) {
    errorBox.textContent = projection.error
    errorBox.hidden = false
    localError = ''
  } else if (!localError) {
    errorBox.hidden = true
    errorBox.textContent = ''
  }
  if (previousContext !== projection.contextId || !draftDirty) {
    input.value = projection.draft
    draftDirty = false
  }
  applyControls(payload)
  renderMessages(projection)
  updateActions(moreHadFocus)
}

const controller = createAIPopoutController({ apply: applyPayload })

function receiveNativePayload(payload: unknown): void {
  try {
    controller.update(payload)
  } catch (cause) {
    console.error('[AI popout] Rejected native payload:', cause)
    connection.textContent = 'The AI window update was rejected.'
    connection.dataset.kind = 'error'
    connection.hidden = false
  }
}

installAIPopoutReceiver(window as AIPopoutGlobalTarget, receiveNativePayload)

async function requestStartupPayload(): Promise<void> {
  try {
    await requestAIPopoutLatestPayload(
      () => invoke<unknown>('get_ai_window_latest_payload'),
      receiveNativePayload
    )
  } catch (cause) {
    console.error('[AI popout] Native startup handshake failed:', cause)
    if (!controller.snapshot()) {
      connection.textContent = 'The editor AI connection could not be initialized.'
      connection.dataset.kind = 'error'
    }
  }
}

void requestStartupPayload()

messages.addEventListener('scroll', updateJumpButton, { passive: true })
jumpButton.addEventListener('click', scrollToLatest)

input.addEventListener('input', () => {
  draftDirty = input.value !== current?.projection.draft
  updateActions()
})

input.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  if (!sendButton.disabled) form.requestSubmit()
})

form.addEventListener('submit', (event) => {
  event.preventDefault()
  const projection = current?.projection
  const text = input.value.trim()
  if (!projection || !projection.canSubmit || !text) return
  if (new TextEncoder().encode(text).byteLength > 32 * 1024) {
    announceError('The message is too large for the AI window.')
    return
  }
  void sendIntent({ ...intentBase(projection), type: 'submit', text }, true)
})

stopButton.addEventListener('click', () => {
  const projection = current?.projection
  if (projection?.canStop) void sendIntent({ ...intentBase(projection), type: 'stop' })
})

clearButton.addEventListener('click', () => {
  setMoreMenuOpen(false, 'trigger')
  const projection = current?.projection
  if (projection?.canClear) void sendIntent({ ...intentBase(projection), type: 'clear' })
})

settingsButton.addEventListener('click', () => {
  setMoreMenuOpen(false, 'trigger')
  const projection = current?.projection
  if (!projection || !current?.controls.settings) return
  void sendIntent({ ...intentBase(projection), type: 'openSettings' })
})

continueButton.addEventListener('click', () => {
  const projection = current?.projection
  if (projection?.canContinue) void sendIntent({ ...intentBase(projection), type: 'continue' })
})

retryButton.addEventListener('click', () => {
  const projection = current?.projection
  if (projection?.canRetry) void sendIntent({ ...intentBase(projection), type: 'retry' })
})

async function focusEditorWindow(): Promise<void> {
  toolbarStatus.textContent = ''
  focusEditorButton.disabled = true
  try {
    await invoke('focus_ai_editor_window')
  } catch (cause) {
    toolbarStatus.textContent = 'The OpenPencil editor could not be focused.'
    console.error('[AI popout] The editor could not be focused.', cause)
  } finally {
    focusEditorButton.disabled = false
  }
}

focusEditorButton.addEventListener('click', () => {
  void focusEditorWindow()
})

alwaysOnTopButton.addEventListener('click', () => {
  toolbarStatus.textContent = ''
  setAlwaysOnTop(!requestedAlwaysOnTop, true)
})

moreButton.addEventListener('click', () => {
  setMoreMenuOpen(!moreMenuOpen, moreMenuOpen ? 'trigger' : 'first')
})

moreButton.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    setMoreMenuOpen(true, event.key === 'ArrowDown' ? 'first' : 'last')
  } else if (event.key === 'Escape' && moreMenuOpen) {
    event.preventDefault()
    setMoreMenuOpen(false, 'trigger')
  }
})

moreMenu.addEventListener('keydown', (event) => {
  const items = focusableMoreItems()
  const index = items.indexOf(document.activeElement as HTMLButtonElement)
  if (event.key === 'Escape') {
    event.preventDefault()
    setMoreMenuOpen(false, 'trigger')
    return
  }
  if (event.key === 'Tab') {
    event.preventDefault()
    setMoreMenuOpen(false)
    if (event.shiftKey) moreButton.focus({ preventScroll: true })
    else messages.focus({ preventScroll: true })
    return
  }
  let nextIndex: number | null = null
  if (event.key === 'ArrowDown') nextIndex = index < items.length - 1 ? index + 1 : 0
  else if (event.key === 'ArrowUp') nextIndex = index > 0 ? index - 1 : items.length - 1
  else if (event.key === 'Home') nextIndex = 0
  else if (event.key === 'End') nextIndex = items.length - 1
  if (nextIndex === null) return
  event.preventDefault()
  focusMoreItem(items[nextIndex])
})

moreRoot.addEventListener('focusout', () => {
  queueMicrotask(() => {
    if (!moreRoot.contains(document.activeElement)) setMoreMenuOpen(false)
  })
})

document.addEventListener('pointerdown', (event) => {
  if (moreMenuOpen && !moreRoot.contains(event.target as Node)) setMoreMenuOpen(false)
})

void AI_POPOUT_PROTOCOL_VERSION
