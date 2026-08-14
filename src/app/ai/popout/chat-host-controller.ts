import type { Chat } from '@ai-sdk/vue'
import { getToolName, isTextUIPart, isToolUIPart } from 'ai'
import type { UIMessage } from 'ai'
/* oxlint-disable eslint/max-lines -- The singleton chat lifecycle and its popout projection must share one race-safe owner. */
import { computed, markRaw, ref, shallowRef, watch } from 'vue'

import { randomHex } from '@open-pencil/core/random'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import { currentPermission, permissionQueue } from '@/app/ai/acp/permission'
import { clearACPDebugLog } from '@/app/ai/acp/transport'
import {
  finalizePendingToolApprovals,
  hasPendingToolApproval,
  isCurrentToolApprovalContext,
  type ToolApprovalContext
} from '@/app/ai/chat/approval'
import {
  createVisualChatMessageMetadata,
  MAX_VISUAL_ATTACHMENTS,
  MAX_VISUAL_ATTACHMENT_TOTAL_BYTES,
  normalizeVisualAttachment,
  SUPPORTED_VISUAL_ATTACHMENT_TYPES,
  toFileUIPart,
  type VisualChatAttachment
} from '@/app/ai/chat/attachments'
import { useChatAttachments, useChatDraft, useChatSubmissionPending } from '@/app/ai/chat/drafts'
import { finalizeInterruptedToolParts } from '@/app/ai/chat/interruption'
import { captureSelectionVisualAttachment } from '@/app/ai/chat/selection-attachment'
import { toolState, type ToolPresentationState } from '@/app/ai/chat/tool-presentation'
import { useAIChat } from '@/app/ai/chat/use'
import { resolveAIModelRole } from '@/app/ai/models'
import {
  AIPopoutHostIntentError,
  registerAIPopoutHost,
  type AIPopoutHost
} from '@/app/ai/popout/host'
import {
  AI_POPOUT_LIMITS,
  AI_POPOUT_PROTOCOL_VERSION,
  parseAIPopoutProjection,
  type AIPopoutIntent,
  type AIPopoutMessage,
  type AIPopoutMessagePart,
  type AIPopoutProjection,
  type AIPopoutToolState
} from '@/app/ai/popout/protocol'
import { clearToolLogEntries, didHitStepLimit } from '@/app/ai/tools'
import { openSettingsDialog } from '@/app/settings/dialog'
import { toast } from '@/app/shell/ui'
import { activeTab } from '@/app/tabs'

const STOP_RETRY_DELAY_MS = 2_000
const CONTINUE_PROMPT = 'Continue where you left off'

const {
  isConfigured,
  providerID,
  providerDef,
  ensureChat,
  respondToToolApproval,
  sessionRevision,
  acpSessionStatus,
  acpSessionHistory,
  acpSessionRestoreNotice,
  refreshACPSessionHistory,
  restoreACPSession,
  resetChat,
  forceStopChat
} = useAIChat()

const chat = shallowRef<Chat<UIMessage> | null>(null)
const submissionPending = useChatSubmissionPending(() => activeTab.value?.store)
const attachments = useChatAttachments(() => activeTab.value?.store)
const draft = useChatDraft(() => activeTab.value?.store)
const attachmentBusy = ref(false)
const stopRequested = ref(false)
const stopRetryAvailable = ref(false)
const pendingApprovalIds = ref<string[]>([])
const initializationFailed = ref(false)
const projectionListeners = new Set<() => void>()

let refreshGeneration = 0
let stopRetryTimer: ReturnType<typeof setTimeout> | undefined
let publishedChatContext: ToolApprovalContext<Chat<UIMessage>> | null = null
let contextKey = ''
let contextId = `ai-context-${randomHex(16)}`
let projectionNotificationQueued = false

function unpublishChat(): void {
  chat.value = null
  publishedChatContext = null
  pendingApprovalIds.value = []
}

function resetStopState(): void {
  clearTimeout(stopRetryTimer)
  stopRetryTimer = undefined
  stopRequested.value = false
  stopRetryAvailable.value = false
}

function currentContextId(): string {
  const nextKey = `${activeTab.value?.id ?? 'none'}\0${providerID.value}\0${sessionRevision.value}`
  if (nextKey === contextKey) return contextId
  contextKey = nextKey
  contextId = `ai-context-${randomHex(16)}`
  return contextId
}

function scheduleProjectionNotification(): void {
  if (projectionNotificationQueued) return
  projectionNotificationQueued = true
  queueMicrotask(() => {
    projectionNotificationQueued = false
    for (const listener of projectionListeners) {
      try {
        listener()
      } catch (error) {
        console.warn('[AI popout] Host projection listener failed:', error)
      }
    }
  })
}

async function refreshChat(): Promise<void> {
  const generation = ++refreshGeneration
  const expectedSessionRevision = sessionRevision.value
  const tabId = activeTab.value?.id ?? null
  const expectedProviderID = providerID.value
  initializationFailed.value = false
  unpublishChat()
  if (!tabId) {
    scheduleProjectionNotification()
    return
  }
  try {
    const nextChat = await ensureChat()
    if (
      generation !== refreshGeneration ||
      expectedSessionRevision !== sessionRevision.value ||
      tabId !== (activeTab.value?.id ?? null) ||
      expectedProviderID !== providerID.value
    ) {
      return
    }
    if (!nextChat) return
    const published = markRaw(nextChat)
    chat.value = published
    publishedChatContext = {
      chat: published,
      generation,
      sessionRevision: expectedSessionRevision,
      tabId,
      providerID: expectedProviderID
    }
  } catch (error) {
    if (generation !== refreshGeneration) return
    initializationFailed.value = true
    unpublishChat()
    toast.error(error instanceof Error ? error.message : 'Failed to initialize chat')
  } finally {
    scheduleProjectionNotification()
  }
}

const messages = computed(() => chat.value?.messages ?? [])
const actionableApprovalMessageId = computed(() => {
  const last = messages.value.at(-1)
  return last?.role === 'assistant' ? last.id : null
})
const status = computed(() => chat.value?.status ?? 'ready')
const isACPProvider = computed(() => providerID.value.startsWith('acp:'))
const activeDocumentName = computed(
  () => activeTab.value?.store.state.documentName?.trim() || undefined
)
const acpSessionInteractionBusy = computed(
  () =>
    submissionPending.value ||
    status.value === 'streaming' ||
    status.value === 'submitted' ||
    acpSessionStatus.value.state === 'connecting'
)
const canAttachSelection = computed(() =>
  Boolean(activeTab.value?.store.renderer && activeTab.value.store.state.selectedIds.size > 0)
)
const acceptedImageTypes = SUPPORTED_VISUAL_ATTACHMENT_TYPES.join(',')
const attachmentTargetLabel = computed(() => {
  const design = resolveAIModelRole('design')
  if (!design) return 'AI model setup required'
  const designLabel = `${design.connection.providerID} · ${design.profile.name}`
  if (design.connection.providerID.startsWith('acp:')) return designLabel
  if (design.profile.capabilities.includes('vision')) return designLabel
  const vision = resolveAIModelRole('vision')
  return vision
    ? `${vision.connection.providerID} · ${vision.profile.name} (pixels) → ${designLabel} (brief)`
    : `${designLabel} · Vision setup required`
})
const isThinking = computed(() => {
  const currentStatus = status.value
  if (currentStatus !== 'submitted' && currentStatus !== 'streaming') return false
  if (messages.value.length === 0) return true
  const last = messages.value[messages.value.length - 1]
  if (last.role !== 'assistant') return true
  const parts = last.parts
  if (parts.length === 0) return true
  const lastPart = parts[parts.length - 1] as JSONObject
  if (lastPart.type === 'step-start') return true
  if ('toolCallId' in lastPart && lastPart.state === 'output-available') return true
  if ('toolCallId' in lastPart && lastPart.state === 'output-error') return true
  return currentStatus === 'submitted'
})
const showContinue = computed(() => {
  if (status.value !== 'ready' || messages.value.length === 0) return false
  const last = messages.value[messages.value.length - 1]
  return (
    last.role === 'assistant' &&
    Boolean(activeTab.value?.store && didHitStepLimit(activeTab.value.store))
  )
})

watch(status, (nextStatus) => {
  if (nextStatus !== 'streaming' && nextStatus !== 'submitted') resetStopState()
})
watch(
  () => chat.value?.error,
  (error) => {
    if (error) toast.error(error.message)
  }
)
watch([() => activeTab.value?.id, providerID], () => void refreshChat(), { immediate: true })
watch(sessionRevision, () => void refreshChat(), { flush: 'sync' })
watch(
  [
    messages,
    status,
    draft,
    submissionPending,
    attachmentBusy,
    currentPermission,
    isConfigured,
    () => activeTab.value?.store.state.documentName,
    () => chat.value?.error,
    () => providerDef.value.name
  ],
  scheduleProjectionNotification,
  { deep: true }
)

function restoreAttachments(
  owner: object | null | undefined,
  submitted: readonly VisualChatAttachment[]
): void {
  if (!owner || submitted.length === 0) return
  const attachmentDraft = useChatAttachments(owner)
  const existingIds = new Set(attachmentDraft.value.map((attachment) => attachment.id))
  attachmentDraft.value = [
    ...submitted.filter((attachment) => !existingIds.has(attachment.id)),
    ...attachmentDraft.value
  ]
}

function rollbackFailedSubmission(
  targetChat: Chat<UIMessage>,
  previousMessages: UIMessage[],
  restoreSubmission: () => void
): void {
  targetChat.messages = previousMessages
  targetChat.clearError()
  restoreSubmission()
}

async function sendPreparedSubmission(
  targetChat: Chat<UIMessage>,
  text: string,
  submittedAttachments: readonly VisualChatAttachment[],
  attachmentDraft: ReturnType<typeof useChatAttachments>,
  restoreSubmission: () => void
): Promise<boolean> {
  targetChat.messages = finalizePendingToolApprovals(targetChat.messages)
  const previousMessages = [...targetChat.messages]
  attachmentDraft.value = []
  try {
    await targetChat.sendMessage(
      submittedAttachments.length > 0
        ? {
            text,
            files: submittedAttachments.map(toFileUIPart),
            metadata: createVisualChatMessageMetadata(submittedAttachments)
          }
        : { text }
    )
    if (targetChat.status !== 'error') return true

    const message = targetChat.error?.message || 'The visual reference could not be sent.'
    rollbackFailedSubmission(targetChat, previousMessages, restoreSubmission)
    toast.error(message)
    return false
  } catch (error) {
    rollbackFailedSubmission(targetChat, previousMessages, restoreSubmission)
    console.error('Chat error:', error)
    toast.error(error instanceof Error ? error.message : String(error))
    return false
  }
}

async function handleSubmit(
  text: string,
  restoreInput: () => void = () => undefined
): Promise<boolean> {
  resetStopState()
  const requestedTab = activeTab.value
  const requestedAttachmentDraft = useChatAttachments(requestedTab?.store)
  const submittedAttachments = [...requestedAttachmentDraft.value]
  const restoreSubmission = () => {
    restoreInput()
    restoreAttachments(requestedTab?.store, submittedAttachments)
  }
  const requestedSubmissionPending = useChatSubmissionPending(requestedTab?.store)
  if (
    !requestedTab ||
    attachmentBusy.value ||
    requestedSubmissionPending.value ||
    status.value === 'streaming' ||
    status.value === 'submitted'
  ) {
    restoreSubmission()
    return false
  }
  requestedSubmissionPending.value = true
  const requestedTabId = requestedTab.id
  const requestedProviderID = providerID.value
  const requestedSessionRevision = sessionRevision.value
  try {
    let currentChat: Chat<UIMessage> | null
    try {
      currentChat = await ensureChat()
    } catch (error) {
      restoreSubmission()
      console.error('Failed to initialize chat:', error)
      toast.error(error instanceof Error ? error.message : String(error))
      return false
    }
    if (
      activeTab.value?.id !== requestedTabId ||
      providerID.value !== requestedProviderID ||
      sessionRevision.value !== requestedSessionRevision
    ) {
      restoreSubmission()
      toast.error('The chat context changed before the message was sent. Please try again.')
      return false
    }
    if (!currentChat) {
      chat.value = null
      restoreSubmission()
      return false
    }
    if (currentChat.status === 'submitted' || currentChat.status === 'streaming') {
      restoreSubmission()
      return false
    }
    const published = markRaw(currentChat)
    chat.value = published
    publishedChatContext = {
      chat: published,
      generation: refreshGeneration,
      sessionRevision: requestedSessionRevision,
      tabId: requestedTabId,
      providerID: requestedProviderID
    }
    return await sendPreparedSubmission(
      currentChat,
      text,
      submittedAttachments,
      requestedAttachmentDraft,
      restoreSubmission
    )
  } finally {
    requestedSubmissionPending.value = false
    scheduleProjectionNotification()
  }
}

async function addVisualAttachments(
  files: readonly File[],
  source: 'file' | 'selection' = 'file'
): Promise<void> {
  const owner = activeTab.value?.store
  if (!owner || files.length === 0 || attachmentBusy.value) return
  const attachmentDraft = useChatAttachments(owner)
  const remainingSlots = MAX_VISUAL_ATTACHMENTS - attachmentDraft.value.length
  if (remainingSlots <= 0) {
    toast.error(`You can attach up to ${MAX_VISUAL_ATTACHMENTS} images.`)
    return
  }

  attachmentBusy.value = true
  try {
    const next = [...attachmentDraft.value]
    let totalBytes = next.reduce((sum, attachment) => sum + attachment.sizeBytes, 0)
    for (const file of files.slice(0, remainingSlots)) {
      try {
        const attachment = await normalizeVisualAttachment(file, { source })
        if (totalBytes + attachment.sizeBytes > MAX_VISUAL_ATTACHMENT_TOTAL_BYTES) {
          throw new Error('The combined image references exceed the 6 MB limit.')
        }
        next.push(attachment)
        totalBytes += attachment.sizeBytes
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error))
      }
    }
    attachmentDraft.value = next
    if (files.length > remainingSlots) {
      toast.error(`Only ${MAX_VISUAL_ATTACHMENTS} image references can be attached at once.`)
    }
  } finally {
    attachmentBusy.value = false
  }
}

async function handleAttachSelection(): Promise<void> {
  const tab = activeTab.value
  const store = tab?.store
  if (!tab || !store || attachmentBusy.value) return

  attachmentBusy.value = true
  try {
    const attachmentDraft = useChatAttachments(store)
    if (attachmentDraft.value.length >= MAX_VISUAL_ATTACHMENTS) {
      throw new Error(`You can attach up to ${MAX_VISUAL_ATTACHMENTS} images.`)
    }
    const attachment = await captureSelectionVisualAttachment(store)
    if (activeTab.value?.id !== tab.id) {
      throw new Error('The active document changed while capturing the selection.')
    }
    const totalBytes = attachmentDraft.value.reduce((sum, item) => sum + item.sizeBytes, 0)
    if (totalBytes + attachment.sizeBytes > MAX_VISUAL_ATTACHMENT_TOTAL_BYTES) {
      throw new Error('The combined image references exceed the 6 MB limit.')
    }
    attachmentDraft.value = [...attachmentDraft.value, attachment]
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  } finally {
    attachmentBusy.value = false
  }
}

function handleRemoveAttachment(id: string): void {
  if (
    attachmentBusy.value ||
    submissionPending.value ||
    status.value === 'streaming' ||
    status.value === 'submitted'
  ) {
    return
  }
  attachments.value = attachments.value.filter((attachment) => attachment.id !== id)
}

async function handleStop(): Promise<boolean> {
  const current = chat.value
  if (!current) return false
  if (stopRetryAvailable.value) {
    stopRetryAvailable.value = false
    stopRequested.value = true
    chat.value = null
    await forceStopChat()
    resetStopState()
    await refreshChat()
    return true
  }
  if (stopRequested.value) return false
  stopRequested.value = true
  void current.stop().then(
    () => {
      current.messages = finalizeInterruptedToolParts(current.messages)
      return undefined
    },
    () => {
      current.messages = finalizeInterruptedToolParts(current.messages)
      return undefined
    }
  )
  clearTimeout(stopRetryTimer)
  stopRetryTimer = setTimeout(() => {
    stopRetryTimer = undefined
    if (
      chat.value === current &&
      (current.status === 'streaming' || current.status === 'submitted')
    ) {
      stopRequested.value = false
      stopRetryAvailable.value = true
    }
  }, STOP_RETRY_DELAY_MS)
  return true
}

async function handleClearChat(): Promise<boolean> {
  const targetStore = activeTab.value?.store
  unpublishChat()
  resetStopState()
  try {
    await resetChat()
    if (targetStore) clearToolLogEntries(targetStore)
    clearACPDebugLog()
    return true
  } catch {
    return false
  } finally {
    await refreshChat()
  }
}

async function handleRestoreACPSession(sessionId: string): Promise<void> {
  try {
    await restoreACPSession(sessionId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    toast.error(`Failed to restore the ACP session: ${message}`)
  }
}

async function handleToolApproval(
  messageId: string,
  id: string,
  approved: boolean
): Promise<boolean> {
  const context = publishedChatContext
  const current = chat.value
  if (
    !current ||
    !isCurrentToolApprovalContext(
      context,
      current,
      refreshGeneration,
      sessionRevision.value,
      activeTab.value?.id ?? null,
      providerID.value
    ) ||
    pendingApprovalIds.value.includes(id) ||
    !hasPendingToolApproval(current.messages, messageId, id)
  ) {
    return false
  }
  pendingApprovalIds.value = [...pendingApprovalIds.value, id]
  try {
    const accepted = await respondToToolApproval(current, messageId, id, approved)
    if (!accepted) {
      unpublishChat()
      void refreshChat()
    }
    return accepted
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
    return false
  } finally {
    pendingApprovalIds.value = pendingApprovalIds.value.filter((candidate) => candidate !== id)
  }
}

async function handleRetry(): Promise<boolean> {
  const current = chat.value
  const tab = activeTab.value
  if (!current || !tab || current.status !== 'error' || submissionPending.value) return false
  const expectedContext = currentContextId()
  submissionPending.value = true
  try {
    current.clearError()
    await current.regenerate()
    return expectedContext === currentContextId()
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
    return false
  } finally {
    submissionPending.value = false
  }
}

function boundedLabel(value: string, fallback: string): string {
  const normalized = value
    .split('')
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint <= 0x1f || codePoint === 0x7f ? ' ' : character
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  return (normalized || fallback).slice(0, AI_POPOUT_LIMITS.labelChars)
}

function projectionToolState(value: ToolPresentationState): AIPopoutToolState {
  if (value === 'pending') return 'running'
  return value
}

function toolSummary(state: AIPopoutToolState): string {
  switch (state) {
    case 'running':
      return 'Tool is running.'
    case 'approval':
      return 'Approval is required in the editor.'
    case 'done':
      return 'Tool finished.'
    case 'denied':
      return 'Tool request was denied.'
    case 'cancelled':
      return 'Tool request was cancelled.'
    case 'error':
      return 'Tool request failed.'
    default:
      return 'Tool status is unavailable.'
  }
}

function projectedPart(
  part: UIMessage['parts'][number],
  messageIndex: number,
  partIndex: number
): AIPopoutMessagePart | null {
  if (isTextUIPart(part)) {
    return { type: 'text', text: part.text.slice(0, AI_POPOUT_LIMITS.textChars) }
  }
  if (!isToolUIPart(part)) return null
  const state = projectionToolState(toolState(part))
  const rawName = getToolName(part)
    .replace(/^mcp__[^_]+__/, '')
    .replace(/^mcp\.[^.]+\./, '')
    .replace(/_/g, ' ')
  return {
    type: 'tool',
    name: boundedLabel(rawName, `Tool ${messageIndex + 1}.${partIndex + 1}`),
    state,
    summary: toolSummary(state),
    approvalToken: null
  }
}

function projectedMessages(): AIPopoutMessage[] {
  const visible = messages.value.slice(-AI_POPOUT_LIMITS.messages)
  const projected: AIPopoutMessage[] = []
  const permission = permissionQueue.value.at(0) ?? null
  let remainingParts = AI_POPOUT_LIMITS.totalParts - (permission ? 1 : 0)
  const indexed = visible.map((message, index) => ({ message, index })).reverse()
  for (const { message, index: messageIndex } of indexed) {
    if (message.role !== 'user' && message.role !== 'assistant') continue
    const parts = message.parts
      .slice(0, AI_POPOUT_LIMITS.partsPerMessage)
      .map((part, partIndex) => projectedPart(part, messageIndex, partIndex))
      .filter((part): part is AIPopoutMessagePart => part !== null)
      .slice(0, remainingParts)
    remainingParts -= parts.length
    projected.unshift({ id: `message-${messageIndex + 1}`, role: message.role, parts })
    if (remainingParts === 0) break
  }

  if (permission) {
    projected.push({
      id: 'permission-request',
      role: 'assistant',
      parts: [
        {
          type: 'tool',
          name: 'ACP permission',
          state: 'approval',
          summary: 'Approval is required in the editor.',
          approvalToken: null
        }
      ]
    })
  }
  return projected.slice(-AI_POPOUT_LIMITS.messages)
}

function projectionBytes(value: AIPopoutProjection): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function fitProjection(value: AIPopoutProjection): AIPopoutProjection {
  const messages = value.messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) => ({ ...part }))
  }))
  let candidate: AIPopoutProjection = { ...value, messages }
  while (projectionBytes(candidate) > AI_POPOUT_LIMITS.projectionBytes && messages.length > 0) {
    if (messages.length > 1) {
      messages.shift()
      continue
    }
    const only = messages[0]
    const longest = only.parts
      .map((part, index) => ({ index, length: part.type === 'text' ? part.text.length : 0 }))
      .sort((left, right) => right.length - left.length)
      .at(0)
    if (longest && longest.length > 128) {
      const part = only.parts[longest.index]
      if (part.type === 'text') {
        only.parts[longest.index] = {
          type: 'text',
          text: part.text.slice(0, Math.floor(part.text.length / 2))
        }
      }
      continue
    }
    if (only.parts.length > 0) {
      only.parts.shift()
      continue
    }
    messages.shift()
  }
  candidate = { ...candidate, messages }
  return parseAIPopoutProjection(candidate)
}

function projectionStatus(hasActiveTab: boolean): AIPopoutProjection['status'] {
  if (!hasActiveTab) return 'unavailable'
  if (initializationFailed.value) return 'error'
  return status.value
}

function projectionError(): string | null {
  return initializationFailed.value || chat.value?.error
    ? 'The AI request failed. Return to the editor for details.'
    : null
}

function projectionCapabilities(hasActiveTab: boolean, busy: boolean) {
  return {
    canSubmit: hasActiveTab && isConfigured.value && !busy && !attachmentBusy.value,
    canStop: hasActiveTab && (busy || stopRetryAvailable.value),
    canContinue: hasActiveTab && showContinue.value,
    canRetry: hasActiveTab && chat.value?.status === 'error' && !submissionPending.value,
    canClear: hasActiveTab && messages.value.length > 0 && !busy
  }
}

function getProjection(): AIPopoutProjection {
  const activeContextId = currentContextId()
  const busy =
    submissionPending.value || status.value === 'submitted' || status.value === 'streaming'
  const hasActiveTab = Boolean(activeTab.value)
  const value: AIPopoutProjection = {
    protocolVersion: AI_POPOUT_PROTOCOL_VERSION,
    contextId: activeContextId,
    documentName: boundedLabel(activeDocumentName.value ?? 'Untitled', 'Untitled'),
    providerLabel: boundedLabel(providerDef.value.name || providerID.value, 'AI'),
    configured: isConfigured.value,
    status: projectionStatus(hasActiveTab),
    error: projectionError(),
    draft: draft.value.slice(0, AI_POPOUT_LIMITS.draftChars),
    ...projectionCapabilities(hasActiveTab, busy),
    messages: projectedMessages()
  }
  return fitProjection(value)
}

async function handleIntent(intent: AIPopoutIntent): Promise<void> {
  if (intent.contextId !== currentContextId()) {
    throw new AIPopoutHostIntentError(
      'stale-context',
      'The active document or AI configuration changed.'
    )
  }

  let accepted = false
  switch (intent.type) {
    case 'submit':
      if (!getProjection().canSubmit) break
      accepted = await handleSubmit(intent.text)
      break
    case 'stop':
      if (!getProjection().canStop) break
      accepted = await handleStop()
      break
    case 'continue':
      if (!showContinue.value) break
      accepted = await handleSubmit(CONTINUE_PROMPT)
      break
    case 'clear':
      if (!getProjection().canClear) break
      accepted = await handleClearChat()
      break
    case 'retry':
      accepted = await handleRetry()
      break
    case 'openSettings':
      openSettingsDialog('ai')
      accepted = true
      break
    case 'toolApproval':
      throw new AIPopoutHostIntentError(
        'unsupported',
        'Tool approvals must be reviewed in the editor.'
      )
  }
  if (!accepted) {
    throw new AIPopoutHostIntentError(
      'unsupported',
      'This AI action is no longer available in the active context.'
    )
  }
}

const popoutHost: AIPopoutHost = {
  getProjection,
  handleIntent,
  subscribe(listener) {
    projectionListeners.add(listener)
    return () => projectionListeners.delete(listener)
  }
}

registerAIPopoutHost(popoutHost)

export const chatPanelController = {
  isConfigured,
  messages,
  actionableApprovalMessageId,
  pendingApprovalIds,
  status,
  isACPProvider,
  activeDocumentName,
  acpSessionInteractionBusy,
  acpSessionStatus,
  acpSessionHistory,
  acpSessionRestoreNotice,
  refreshACPSessionHistory,
  canAttachSelection,
  acceptedImageTypes,
  attachmentTargetLabel,
  isThinking,
  showContinue,
  submissionPending,
  attachments,
  attachmentBusy,
  stopRequested,
  stopRetryAvailable,
  handleSubmit,
  addVisualAttachments,
  handleAttachSelection,
  handleRemoveAttachment,
  handleStop,
  handleClearChat,
  handleRestoreACPSession,
  handleToolApproval
}
