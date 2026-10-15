<script setup lang="ts">
import { computed, onScopeDispose, useTemplateRef, watch } from 'vue'

import { useI18n } from '@open-pencil/vue'

import { useACPContextUsage } from '@/app/ai/acp/context-usage'
import { MAX_VISUAL_ATTACHMENTS } from '@/app/ai/chat/attachments'
import { chatDocumentId } from '@/app/ai/chat/history/document'
import { useChatRunLocation } from '@/app/ai/chat/run-location'
import { saveChatTrace } from '@/app/ai/chat/trace/export'
import { useAIChat } from '@/app/ai/chat/use'
import { chatPanelController } from '@/app/ai/popout/chat-host-controller'
import { getActiveEditorStore } from '@/app/editor/active-store'
import { openSettingsDialog } from '@/app/settings/dialog'
import { toast } from '@/app/shell/ui'
import { activeTab } from '@/app/tabs'
import ACPContextUsage from '@/components/chat/AcpContextUsage.vue'
import ACPPermissionDialog from '@/components/chat/ACPPermissionDialog.vue'
import ACPSessionControl from '@/components/chat/AcpSessionControl.vue'
import ChatHistory from '@/components/chat/ChatHistory.vue'
import ChatInput from '@/components/chat/ChatInput.vue'
import ChatRunLocation from '@/components/chat/ChatRunLocation.vue'
import ChatTranscript from '@/components/chat/ChatTranscript.vue'
import CodePenAIReview from '@/components/chat/CodePenAIReview.vue'
import FollowAgentsToggle from '@/components/chat/FollowAgentsToggle.vue'
import { useImageDrop } from '@/components/chat/input/useImageDrop'
import ProviderSetup from '@/components/chat/ProviderSetup.vue'
import AppButton from '@/components/ui/button/AppButton.vue'

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
const { chatFailure, clearChatFailure, providerID, sessionRevision } = useAIChat()
const { ai, common, dialogs } = useI18n()
const acpUsage = useACPContextUsage(() => acpSessionStatus.value.sessionId)
const runLocation = useChatRunLocation()
const panel = useTemplateRef<HTMLElement>('panel')
const dropRefusal = computed(() => {
  if (
    submissionPending.value ||
    attachmentBusy.value ||
    history.busy.value ||
    status.value === 'submitted' ||
    status.value === 'streaming'
  )
    return ai.value.dropImagesAfterReply
  if (attachments.value.length >= MAX_VISUAL_ATTACHMENTS)
    return ai.value.dropImagesLimit({ count: MAX_VISUAL_ATTACHMENTS })
  return null
})
const { dragging } = useImageDrop(panel, {
  enabled: () => !historyReadOnly.value && isConfigured.value,
  onImages: (files) => {
    if (dropRefusal.value) {
      toast.error(dropRefusal.value)
      return
    }
    void addVisualAttachments(files)
  }
})
async function saveTrace(id: string) {
  const conversation = history.current.value
  if (!conversation || conversation.id !== id) return
  try {
    await saveChatTrace(conversation, messages.value)
  } catch {
    toast.error(ai.value.chatTraceFailed)
  }
}

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
let failureToast: number | null = null
function clearFailureToast(): void {
  if (failureToast !== null) toast.remove(failureToast)
  failureToast = null
}
onScopeDispose(clearFailureToast)
watch(
  [
    () => activeTab.value?.id,
    () => activeTab.value?.store,
    () => history.current.value?.id,
    providerID,
    sessionRevision
  ],
  clearFailureToast,
  { flush: 'sync' }
)
watch(
  chatFailure,
  (failure) => {
    clearFailureToast()
    if (!failure) return
    const reason = failure.reason
    const failedId = messages.value.at(-1)?.id
    const conversationId = history.current.value?.id
    const tabId = activeTab.value?.id
    const failedProvider = providerID.value
    const failedRevision = sessionRevision.value
    failureToast = toast.error(
      failureMessage.value ?? ai.value.chatRequestFailed,
      ['authentication', 'forbidden', 'model-not-found'].includes(reason)
        ? { label: ai.value.openProviderSettingsAction, run: () => openSettingsDialog('ai') }
        : {
            label: ai.value.retryRequest,
            run: () => {
              if (
                failedId &&
                messages.value.at(-1)?.id === failedId &&
                history.current.value?.id === conversationId &&
                activeTab.value?.id === tabId &&
                providerID.value === failedProvider &&
                sessionRevision.value === failedRevision
              )
                void chatPanelController.handleRegenerate(failedId)
            }
          }
    )
  },
  { flush: 'sync' }
)

async function handleSubmit(text: string, restoreInput: () => void = () => undefined) {
  clearChatFailure()
  return submitChatMessage(text, restoreInput)
}

async function handleClearChat(): Promise<void> {
  clearChatFailure()
  if (await chatPanelController.handleClearChat()) return
  toast.error(dialogs.value.aiSessionClearFailed)
}
</script>

<template>
  <div
    ref="panel"
    data-test-id="chat-panel"
    class="flex min-w-0 flex-1 flex-col overflow-hidden select-text"
  >
    <ChatHistory
      v-if="!isACPProvider"
      :conversations="historyOptions"
      :selected-id="history.current.value?.id"
      :saved="history.conversations.value.some((row) => row.id === history.current.value?.id)"
      :disabled="history.busy.value || acpSessionInteractionBusy"
      @select="(id) => handleHistoryAction(() => history.open(id))"
      @create="handleHistoryAction(() => history.newChat())"
      @rename="(id, title) => handleHistoryAction(() => history.rename(id, title))"
      @delete="(id) => handleHistoryAction(() => history.remove(id))"
      @save-trace="saveTrace"
    >
      <template #actions><FollowAgentsToggle /></template>
    </ChatHistory>
    <p v-if="history.storageError.value" role="alert" class="px-3 py-2 text-xs text-error">
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
        :nodes-live="!historyReadOnly"
        :interactive="!historyReadOnly && !submissionPending && !stopRequested"
        @regenerate="chatPanelController.handleRegenerate()"
        @revert="chatPanelController.handleRevert"
        @restore="chatPanelController.handleRestore"
        @edit="chatPanelController.handleEdit"
        :pending-approval-ids="pendingApprovalIds"
        :actionable-approval-message-id="actionableApprovalMessageId"
        @tool-approval="handleToolApproval"
        @continue="handleSubmit('Continue where you left off')"
      />

      <div
        v-if="messages.length > 0"
        class="flex shrink-0 items-center gap-1 border-t border-border px-3 py-1"
      >
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

      <ACPContextUsage v-if="isACPProvider" :usage="acpUsage" />

      <ChatRunLocation
        v-if="runLocation"
        :agent="runLocation.agent"
        :page="runLocation.page"
        @open="runLocation.open"
      />
      <ChatInput
        v-if="!historyReadOnly && isConfigured"
        :status="status"
        :dragging="dragging"
        :drop-refusal="dropRefusal"
        :initializing="submissionPending || history.busy.value"
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
