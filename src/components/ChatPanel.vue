<script setup lang="ts">
import { ScrollAreaRoot, ScrollAreaScrollbar, ScrollAreaThumb, ScrollAreaViewport } from 'reka-ui'
import { refAutoReset, useClipboard } from '@vueuse/core'
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

import { clearACPDebugLog, getACPDebugText, hasACPDebugEntries } from '@/app/ai/acp/transport'
import { copyChatLog } from '@/app/ai/debug'
import { chatPanelController } from '@/app/ai/popout/chat-host-controller'
import { toast } from '@/app/shell/ui'
import ACPPermissionDialog from '@/components/chat/ACPPermissionDialog.vue'
import ACPSessionControl from '@/components/chat/AcpSessionControl.vue'
import ChatInput from '@/components/chat/ChatInput.vue'
import ChatMessage from '@/components/chat/ChatMessage.vue'
import CodePenAIReview from '@/components/chat/CodePenAIReview.vue'
import ProviderSetup from '@/components/chat/ProviderSetup.vue'
import AppPlaceholder from '@/components/ui/AppPlaceholder.vue'
import AppTextButton from '@/components/ui/AppTextButton.vue'
import { useI18n } from '@open-pencil/vue'

const IS_DEV = import.meta.env.DEV
const {
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
  handleRestoreACPSession,
  handleToolApproval
} = chatPanelController
const { copy } = useClipboard()
const { dialogs } = useI18n()

const messagesEnd = ref<HTMLDivElement>()
const debugCopied = refAutoReset(false, 1500)
const acpLogCopied = refAutoReset(false, 1500)
let scrollTimer: ReturnType<typeof setTimeout> | undefined

function scheduleScrollToBottom(): void {
  if (scrollTimer) return
  scrollTimer = setTimeout(() => {
    scrollTimer = undefined
    void nextTick(() => {
      messagesEnd.value?.scrollIntoView({ behavior: 'auto', block: 'end' })
    })
  }, 80)
}

watch([messages, status], scheduleScrollToBottom, { deep: true })
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
onBeforeUnmount(() => clearTimeout(scrollTimer))

async function handleCopyDebug(): Promise<void> {
  await copyChatLog(messages.value)
  debugCopied.value = true
}

async function handleCopyACPLog(): Promise<void> {
  const text = getACPDebugText()
  if (!text) return
  await copy(text)
  acpLogCopied.value = true
}

async function handleClearChat(): Promise<void> {
  if (await chatPanelController.handleClearChat()) return
  toast.error(dialogs.value.aiSessionClearFailed)
  clearACPDebugLog()
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

          <div v-else data-test-id="chat-messages" class="flex flex-col gap-3">
            <ChatMessage
              v-for="msg in messages"
              :key="msg.id"
              :message="msg"
              :pending-approval-ids="pendingApprovalIds"
              :approval-enabled="msg.id === actionableApprovalMessageId"
              @tool-approval="handleToolApproval"
            />

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
          v-if="IS_DEV && hasACPDebugEntries()"
          :ui="{ base: 'flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-hover' }"
          @click="handleCopyACPLog"
        >
          <icon-lucide-bug v-if="!acpLogCopied" class="size-3" />
          <icon-lucide-check v-else class="size-3 text-green-400" />
          {{ acpLogCopied ? 'Copied' : 'ACP log' }}
        </AppTextButton>
        <AppTextButton
          v-if="!isACPProvider"
          :ui="{ base: 'flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-hover' }"
          @click="handleClearChat"
        >
          <icon-lucide-trash-2 class="size-3" />
          Clear
        </AppTextButton>
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
        <AppTextButton
          :ui="{
            base: 'ml-auto flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 hover:bg-hover'
          }"
          :disabled="acpSessionInteractionBusy"
          @click="handleClearChat"
        >
          <icon-lucide-trash-2 class="size-3" />
          {{ dialogs.clear }}
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

      <div class="flex shrink-0 justify-end border-t border-border px-3 py-1">
        <CodePenAIReview @rebuild="handleSubmit" />
      </div>

      <ACPPermissionDialog />
    </template>
  </div>
</template>
