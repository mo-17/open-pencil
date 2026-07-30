<script setup lang="ts">
import { ScrollAreaRoot, ScrollAreaScrollbar, ScrollAreaThumb, ScrollAreaViewport } from 'reka-ui'
import { refAutoReset, useClipboard } from '@vueuse/core'
import { computed, markRaw, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import { getAcpDebugText, clearAcpDebugLog, hasAcpDebugEntries } from '@/app/ai/acp/transport'
import {
  createVisualChatMessageMetadata,
  MAX_VISUAL_ATTACHMENTS,
  MAX_VISUAL_ATTACHMENT_TOTAL_BYTES,
  normalizeVisualAttachment,
  SUPPORTED_VISUAL_ATTACHMENT_TYPES,
  toFileUIPart,
  type VisualChatAttachment
} from '@/app/ai/chat/attachments'
import { useChatAttachments, useChatSubmissionPending } from '@/app/ai/chat/drafts'
import { finalizeInterruptedToolParts } from '@/app/ai/chat/interruption'
import { captureSelectionVisualAttachment } from '@/app/ai/chat/selection-attachment'
import { copyChatLog } from '@/app/ai/debug'
import { resolveAIModelRole } from '@/app/ai/models'
import { clearToolLogEntries, didHitStepLimit } from '@/app/ai/tools'
import { activeTab } from '@/app/tabs'
import AcpPermissionDialog from '@/components/chat/AcpPermissionDialog.vue'
import ChatInput from '@/components/chat/ChatInput.vue'
import ChatMessage from '@/components/chat/ChatMessage.vue'
import AppPlaceholder from '@/components/ui/AppPlaceholder.vue'
import AppTextButton from '@/components/ui/AppTextButton.vue'
import ProviderSetup from '@/components/chat/ProviderSetup.vue'
import { useAIChat } from '@/app/ai/chat/use'
import { toast } from '@/app/shell/ui'
import { useI18n } from '@open-pencil/vue'

import type { Chat } from '@ai-sdk/vue'
import type { UIMessage } from 'ai'
import type { JsonObject } from '@open-pencil/scene-graph/primitives'

const IS_DEV = import.meta.env.DEV

const { isConfigured, providerID, ensureChat, resetChat, forceStopChat } = useAIChat()
const { copy } = useClipboard()
const { dialogs } = useI18n()

const chat = ref<Chat<UIMessage> | null>(null)
const submissionPending = useChatSubmissionPending(() => activeTab.value?.store)
const attachments = useChatAttachments(() => activeTab.value?.store)
const attachmentBusy = ref(false)
const stopRequested = ref(false)
const stopRetryAvailable = ref(false)
const STOP_RETRY_DELAY_MS = 2_000
let refreshGeneration = 0
let stopRetryTimer: ReturnType<typeof setTimeout> | undefined

function resetStopState() {
  clearTimeout(stopRetryTimer)
  stopRetryTimer = undefined
  stopRequested.value = false
  stopRetryAvailable.value = false
}

async function refreshChat() {
  const generation = ++refreshGeneration
  try {
    const nextChat = await ensureChat()
    if (generation !== refreshGeneration) return
    chat.value = nextChat ? markRaw(nextChat) : null
  } catch (error) {
    if (generation !== refreshGeneration) return
    chat.value = null
    toast.error(error instanceof Error ? error.message : 'Failed to initialize chat')
  }
}

void refreshChat()
const messagesEnd = ref<HTMLDivElement>()
const debugCopied = refAutoReset(false, 1500)
const acpLogCopied = refAutoReset(false, 1500)

const messages = computed(() => chat.value?.messages ?? [])
const status = computed(() => chat.value?.status ?? 'ready')
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
  const s = status.value
  if (s !== 'submitted' && s !== 'streaming') return false
  if (messages.value.length === 0) return true
  const last = messages.value[messages.value.length - 1]
  if (last.role !== 'assistant') return true
  const parts = last.parts
  if (parts.length === 0) return true
  const lastPart = parts[parts.length - 1] as JsonObject
  if (lastPart.type === 'step-start') return true
  if ('toolCallId' in lastPart && lastPart.state === 'output-available') return true
  if ('toolCallId' in lastPart && lastPart.state === 'output-error') return true
  return s === 'submitted'
})

const showContinue = computed(() => {
  if (status.value !== 'ready') return false
  if (messages.value.length === 0) return false
  const last = messages.value[messages.value.length - 1]
  return last.role === 'assistant' && didHitStepLimit()
})

const scrollRevision = computed(() => {
  const list = messages.value
  const last = list[list.length - 1]
  const parts = last?.parts ?? []
  const tail = parts[parts.length - 1] as JsonObject | undefined
  const textLength = typeof tail?.text === 'string' ? tail.text.length : 0
  const state = typeof tail?.state === 'string' ? tail.state : ''
  return `${list.length}:${parts.length}:${textLength}:${state}:${status.value}`
})

let scrollTimer: ReturnType<typeof setTimeout> | undefined
function scheduleScrollToBottom() {
  if (scrollTimer) return
  scrollTimer = setTimeout(() => {
    scrollTimer = undefined
    void nextTick(() => {
      messagesEnd.value?.scrollIntoView({ behavior: 'auto', block: 'end' })
    })
  }, 80)
}

watch(scrollRevision, scheduleScrollToBottom)
watch(status, (nextStatus) => {
  if (nextStatus !== 'streaming' && nextStatus !== 'submitted') resetStopState()
})
watch(
  () => chat.value?.error,
  (error) => {
    if (error) toast.error(error.message)
  }
)
watch([() => activeTab.value?.id, providerID], refreshChat)
onBeforeUnmount(() => {
  clearTimeout(scrollTimer)
  clearTimeout(stopRetryTimer)
})

function restoreAttachments(
  owner: object | null | undefined,
  submitted: readonly VisualChatAttachment[]
) {
  if (!owner || submitted.length === 0) return
  const draft = useChatAttachments(owner)
  const existingIds = new Set(draft.value.map((attachment) => attachment.id))
  draft.value = [
    ...submitted.filter((attachment) => !existingIds.has(attachment.id)),
    ...draft.value
  ]
}

function rollbackFailedSubmission(
  targetChat: Chat<UIMessage>,
  previousMessages: UIMessage[],
  restoreSubmission: () => void
) {
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
) {
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
    if (targetChat.status !== 'error') return

    const message = targetChat.error?.message || 'The visual reference could not be sent.'
    rollbackFailedSubmission(targetChat, previousMessages, restoreSubmission)
    toast.error(message)
  } catch (error) {
    rollbackFailedSubmission(targetChat, previousMessages, restoreSubmission)
    console.error('Chat error:', error)
    toast.error(error instanceof Error ? error.message : String(error))
  }
}

async function handleSubmit(text: string, restoreInput: () => void = () => undefined) {
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
    attachmentBusy.value ||
    requestedSubmissionPending.value ||
    status.value === 'streaming' ||
    status.value === 'submitted'
  ) {
    restoreSubmission()
    return
  }
  requestedSubmissionPending.value = true
  const requestedTabId = requestedTab?.id
  const requestedProviderID = providerID.value
  try {
    let c: Chat<UIMessage> | null
    try {
      c = await ensureChat()
    } catch (error) {
      restoreSubmission()
      console.error('Failed to initialize chat:', error)
      toast.error(error instanceof Error ? error.message : String(error))
      return
    }
    if (activeTab.value?.id !== requestedTabId || providerID.value !== requestedProviderID) {
      restoreSubmission()
      toast.error('The chat context changed before the message was sent. Please try again.')
      return
    }
    if (!c) {
      chat.value = null
      restoreSubmission()
      return
    }
    if (c.status === 'submitted' || c.status === 'streaming') {
      restoreSubmission()
      return
    }
    chat.value = markRaw(c)
    await sendPreparedSubmission(
      c,
      text,
      submittedAttachments,
      requestedAttachmentDraft,
      restoreSubmission
    )
  } finally {
    requestedSubmissionPending.value = false
  }
}

async function addVisualAttachments(files: readonly File[], source: 'file' | 'selection' = 'file') {
  const owner = activeTab.value?.store
  if (!owner || files.length === 0 || attachmentBusy.value) return
  const draft = useChatAttachments(owner)
  const remainingSlots = MAX_VISUAL_ATTACHMENTS - draft.value.length
  if (remainingSlots <= 0) {
    toast.error(`You can attach up to ${MAX_VISUAL_ATTACHMENTS} images.`)
    return
  }

  attachmentBusy.value = true
  try {
    const next = [...draft.value]
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
    draft.value = next
    if (files.length > remainingSlots) {
      toast.error(`Only ${MAX_VISUAL_ATTACHMENTS} image references can be attached at once.`)
    }
  } finally {
    attachmentBusy.value = false
  }
}

async function handleAttachSelection() {
  const tab = activeTab.value
  const store = tab?.store
  if (!tab || !store || attachmentBusy.value) return

  attachmentBusy.value = true
  try {
    const draft = useChatAttachments(store)
    if (draft.value.length >= MAX_VISUAL_ATTACHMENTS) {
      throw new Error(`You can attach up to ${MAX_VISUAL_ATTACHMENTS} images.`)
    }
    const attachment = await captureSelectionVisualAttachment(store)
    const totalBytes = draft.value.reduce((sum, item) => sum + item.sizeBytes, 0)
    if (totalBytes + attachment.sizeBytes > MAX_VISUAL_ATTACHMENT_TOTAL_BYTES) {
      throw new Error('The combined image references exceed the 6 MB limit.')
    }
    draft.value = [...draft.value, attachment]
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  } finally {
    attachmentBusy.value = false
  }
}

function handleRemoveAttachment(id: string) {
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

async function handleStop() {
  const current = chat.value
  if (!current) return
  if (stopRetryAvailable.value) {
    stopRetryAvailable.value = false
    stopRequested.value = true
    chat.value = null
    await forceStopChat()
    resetStopState()
    await refreshChat()
    return
  }
  if (stopRequested.value) return
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
}

async function handleCopyDebug() {
  await copyChatLog(messages.value)
  debugCopied.value = true
}

async function handleCopyAcpLog() {
  const text = getAcpDebugText()
  if (!text) return
  await copy(text)
  acpLogCopied.value = true
}

async function handleClearChat() {
  chat.value = null
  resetStopState()
  await resetChat()
  clearToolLogEntries()
  clearAcpDebugLog()
  await refreshChat()
}
</script>

<template>
  <div data-test-id="chat-panel" class="flex min-w-0 flex-1 flex-col overflow-hidden select-text">
    <ProviderSetup v-if="!isConfigured" />

    <template v-else>
      <ScrollAreaRoot class="min-h-0 flex-1">
        <ScrollAreaViewport class="h-full px-3 py-3 [&>div]:h-full">
          <AppPlaceholder
            v-if="messages.length === 0"
            data-test-id="chat-empty-state"
            :label="dialogs.describeCreateOrChange"
            :ui="{ root: 'h-full' }"
          >
            <template #icon>
              <icon-lucide-message-circle class="size-5" />
            </template>
          </AppPlaceholder>

          <!-- Messages -->
          <div v-else data-test-id="chat-messages" class="flex flex-col gap-3">
            <ChatMessage v-for="msg in messages" :key="msg.id" :message="msg" />

            <!-- Thinking indicator: shown when AI is working but no visible activity -->
            <div v-if="isThinking" data-test-id="chat-typing-indicator" class="flex gap-2">
              <div
                class="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted/20 text-[10px] font-bold text-muted"
              >
                AI
              </div>
              <div class="flex items-center gap-1 py-2">
                <span
                  class="size-1.5 animate-bounce rounded-full bg-muted"
                  style="animation-delay: 0ms"
                />
                <span
                  class="size-1.5 animate-bounce rounded-full bg-muted"
                  style="animation-delay: 150ms"
                />
                <span
                  class="size-1.5 animate-bounce rounded-full bg-muted"
                  style="animation-delay: 300ms"
                />
              </div>
            </div>

            <!-- Continue button when step limit reached -->
            <div v-if="showContinue" class="flex justify-center py-2">
              <button
                class="flex items-center gap-1.5 rounded-full bg-accent/10 px-4 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
                @click="handleSubmit('Continue where you left off')"
              >
                <icon-lucide-play class="size-3" />
                Continue
              </button>
            </div>

            <div ref="messagesEnd" />
          </div>
        </ScrollAreaViewport>
        <ScrollAreaScrollbar orientation="vertical" class="flex w-1.5 touch-none p-px select-none">
          <ScrollAreaThumb class="relative flex-1 rounded-full bg-muted/30" />
        </ScrollAreaScrollbar>
      </ScrollAreaRoot>

      <!-- Chat toolbar -->
      <div
        v-if="messages.length > 0"
        class="flex shrink-0 items-center gap-1 border-t border-border px-3 py-1"
      >
        <AppTextButton
          v-if="IS_DEV"
          :ui="{ base: 'flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-hover' }"
          @click="handleCopyDebug"
        >
          <icon-lucide-clipboard-copy v-if="!debugCopied" class="size-3" />
          <icon-lucide-check v-else class="size-3 text-green-400" />
          {{ debugCopied ? 'Copied' : 'Copy log' }}
        </AppTextButton>
        <AppTextButton
          v-if="IS_DEV && hasAcpDebugEntries()"
          :ui="{ base: 'flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-hover' }"
          @click="handleCopyAcpLog"
        >
          <icon-lucide-bug v-if="!acpLogCopied" class="size-3" />
          <icon-lucide-check v-else class="size-3 text-green-400" />
          {{ acpLogCopied ? 'Copied' : 'ACP log' }}
        </AppTextButton>
        <AppTextButton
          :ui="{ base: 'flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-hover' }"
          @click="handleClearChat"
        >
          <icon-lucide-trash-2 class="size-3" />
          Clear
        </AppTextButton>
      </div>

      <ChatInput
        :status="status"
        :initializing="submissionPending"
        :stopping="stopRequested"
        :stop-retry-available="stopRetryAvailable"
        visual-attachments-enabled
        :attachments="attachments"
        :can-attach-selection="canAttachSelection"
        :attachments-disabled="attachmentBusy"
        :accepted-image-types="acceptedImageTypes"
        allow-multiple-attachments
        :attachment-target-label="attachmentTargetLabel"
        @submit="handleSubmit"
        @stop="handleStop"
        @select-files="addVisualAttachments"
        @attach-selection="handleAttachSelection"
        @remove-attachment="handleRemoveAttachment"
      />

      <AcpPermissionDialog />
    </template>
  </div>
</template>
