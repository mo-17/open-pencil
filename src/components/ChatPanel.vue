<script setup lang="ts">
import { refAutoReset, useClipboard } from '@vueuse/core'
import { computed, watch } from 'vue'

import { useI18n } from '@open-pencil/vue'

import { clearACPDebugLog, getACPDebugText, hasACPDebugEntries } from '@/app/ai/acp/transport'
import { chatDocumentId } from '@/app/ai/chat/history/document'
import { useAIChat } from '@/app/ai/chat/use'
import { copyChatLog } from '@/app/ai/debug'
import { chatPanelController } from '@/app/ai/popout/chat-host-controller'
import { getActiveEditorStore } from '@/app/editor/active-store'
import { openSettingsDialog } from '@/app/settings/dialog'
import { toast } from '@/app/shell/ui'
import ACPPermissionDialog from '@/components/chat/ACPPermissionDialog.vue'
import ACPSessionControl from '@/components/chat/AcpSessionControl.vue'
import ChatHistory from '@/components/chat/ChatHistory.vue'
import ChatInput from '@/components/chat/ChatInput.vue'
import ChatTranscript from '@/components/chat/ChatTranscript.vue'
import CodePenAIReview from '@/components/chat/CodePenAIReview.vue'
import ProviderSetup from '@/components/chat/ProviderSetup.vue'
import AppButton from '@/components/ui/button/AppButton.vue'

const IS_DEV = import.meta.env.DEV
const {
  isConfigured,
  history,
  handleHistoryAction,
  historyReadOnly,
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
  showContinue,
  submissionPending,
  attachments,
  attachmentBusy,
  stopRequested,
  stopRetryAvailable,
  handleSubmit: submitChatMessage,
  addVisualAttachments,
  handleAttachSelection,
  handleRemoveAttachment,
  handleStop,
  handleRestoreACPSession,
  handleToolApproval
} = chatPanelController
const { chatFailure, clearChatFailure } = useAIChat()
const { copy } = useClipboard()
const { ai, common, dialogs } = useI18n()
const debugCopied = refAutoReset(false, 1500)
const acpLogCopied = refAutoReset(false, 1500)

const historyOptions = computed(() => {
  const current = history.current.value
  const rows = [...history.conversations.value]
  if (current && !rows.some((row) => row.id === current.id)) rows.unshift(current)
  return rows.map((conversation) => ({
    ...conversation,
    available: conversation.documentId === chatDocumentId(getActiveEditorStore())
  }))
})
const failureMessage = computed(() => {
  switch (chatFailure.value?.reason) {
    case 'insufficient-credit':
      return ai.value.chatInsufficientCredit
    case 'output-limit':
      return ai.value.chatOutputLimit
    case 'authentication':
      return ai.value.chatAuthenticationFailed
    case 'forbidden':
      return ai.value.chatForbidden
    case 'model-not-found':
      return ai.value.chatModelNotFound
    case 'network':
      return ai.value.chatNetworkFailed
    case 'rate-limit':
      return ai.value.chatRateLimited
    case 'request-failed':
      return ai.value.chatRequestFailed
    default:
      return null
  }
})
watch(acpSessionRestoreNotice, (notice) => {
  if (notice) toast.warning(dialogs.value.aiSessionRestoreFailed)
})
watch(
  () => acpSessionStatus.value.persistenceError,
  (error, previousError) => {
    if (error && error !== previousError) {
      toast.warning(dialogs.value.aiSessionPersistenceFailed({ error }))
    }
  }
)
watch(
  () => chatFailure.value?.reason,
  (reason) => {
    if (!reason) return
    toast.error(
      failureMessage.value ?? ai.value.chatRequestFailed,
      ['authentication', 'forbidden', 'model-not-found'].includes(reason)
        ? { label: ai.value.openProviderSettingsAction, run: () => openSettingsDialog('ai') }
        : undefined
    )
  }
)

async function handleSubmit(text: string, restoreInput: () => void = () => undefined) {
  clearChatFailure()
  return submitChatMessage(text, restoreInput)
}

async function handleCopyDebug(): Promise<void> {
  await copyChatLog(messages.value, chatFailure.value)
  debugCopied.value = true
}

async function handleCopyACPLog(): Promise<void> {
  const text = getACPDebugText()
  if (!text) return
  await copy(text)
  acpLogCopied.value = true
}

async function handleClearChat(): Promise<void> {
  clearChatFailure()
  if (await chatPanelController.handleClearChat()) return
  toast.error(dialogs.value.aiSessionClearFailed)
  clearACPDebugLog()
}
</script>

<template>
  <div data-test-id="chat-panel" class="flex min-w-0 flex-1 flex-col overflow-hidden select-text">
    <ChatHistory
      v-if="!isACPProvider"
      :conversations="historyOptions"
      :selected-id="history.current.value?.id"
      :saved="messages.length > 0 || history.current.value?.titleSource === 'manual'"
      :disabled="history.busy.value || acpSessionInteractionBusy"
      :debug="IS_DEV"
      :acp-debug="IS_DEV && hasACPDebugEntries()"
      @select="(id) => handleHistoryAction(() => history.open(id))"
      @create="handleHistoryAction(() => history.newChat())"
      @rename="(id, title) => handleHistoryAction(() => history.rename(id, title))"
      @delete="(id) => handleHistoryAction(() => history.remove(id))"
      @copy-debug="handleCopyDebug"
      @copy-a-c-p-debug="handleCopyACPLog"
    />
    <p v-if="history.storageError.value" role="status" class="px-3 py-2 text-xs text-danger">
      {{ ai.chatStorageFailed }}
    </p>
    <p v-if="historyReadOnly" role="status" class="px-3 py-2 text-xs text-muted">
      {{ ai.chatReadOnly }}
    </p>
    <ProviderSetup v-if="!isConfigured && !messages.length" />

    <template v-else>
      <ChatTranscript
        :messages="messages"
        :status="status"
        :show-continue="showContinue"
        :pending-approval-ids="pendingApprovalIds"
        :actionable-approval-message-id="actionableApprovalMessageId"
        @tool-approval="handleToolApproval"
        @continue="handleSubmit('Continue where you left off')"
      />

      <div
        v-if="messages.length > 0"
        class="flex shrink-0 items-center gap-1 border-t border-border px-3 py-1"
      >
        <AppButton v-if="IS_DEV" color="neutral" variant="ghost" size="xs" @click="handleCopyDebug">
          <icon-lucide-clipboard-copy v-if="!debugCopied" class="size-3" />
          <icon-lucide-check v-else class="size-3 text-green-400" />
          {{ debugCopied ? 'Copied' : 'Copy log' }}
        </AppButton>
        <AppButton
          v-if="IS_DEV && hasACPDebugEntries()"
          color="neutral"
          variant="ghost"
          size="xs"
          @click="handleCopyACPLog"
        >
          <icon-lucide-bug v-if="!acpLogCopied" class="size-3" />
          <icon-lucide-check v-else class="size-3 text-green-400" />
          {{ acpLogCopied ? 'Copied' : 'ACP log' }}
        </AppButton>
        <AppButton
          v-if="!isACPProvider"
          color="error"
          variant="ghost"
          size="xs"
          @click="handleClearChat"
        >
          <icon-lucide-trash-2 class="size-3" />
          {{ common.clear }}
        </AppButton>
      </div>

      <div
        v-if="isACPProvider"
        class="flex shrink-0 items-center gap-1 border-t border-border px-3 py-1.5"
      >
        <ACPSessionControl
          :status="acpSessionStatus"
          :history="acpSessionHistory"
          :document-name="activeDocumentName"
          :disabled="acpSessionInteractionBusy"
          @refresh="refreshACPSessionHistory"
          @resume="handleRestoreACPSession"
        />
        <AppButton
          color="error"
          variant="ghost"
          size="xs"
          :ui="{ base: 'ml-auto shrink-0' }"
          :disabled="acpSessionInteractionBusy"
          @click="handleClearChat"
        >
          <icon-lucide-trash-2 class="size-3" />
          {{ common.clear }}
        </AppButton>
      </div>

      <ChatInput
        v-if="!historyReadOnly && isConfigured"
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

      <div class="flex shrink-0 justify-end border-t border-border px-3 py-1">
        <CodePenAIReview @rebuild="handleSubmit" />
      </div>

      <ACPPermissionDialog />
    </template>
  </div>
</template>
