<script setup lang="ts">
import { TooltipProvider } from 'reka-ui'
import { computed, ref } from 'vue'

import { ACP_AGENTS } from '@open-pencil/core/constants'
import { useI18n } from '@open-pencil/vue'

import type { VisualChatAttachment } from '@/app/ai/chat/attachments'
import { useChatDraft } from '@/app/ai/chat/drafts'
import { useAIChat } from '@/app/ai/chat/use'
import { designModelProfile, designModelProfiles } from '@/app/ai/models'
import { openSettingsDialog } from '@/app/settings/dialog'
import { activeTab } from '@/app/tabs'
import AcpConfigSelect from '@/components/chat/AcpConfigSelect.vue'
import ChatAttachmentThumbnail from '@/components/chat/ChatAttachmentThumbnail.vue'
import ChatProfileSelect from '@/components/chat/ChatProfileSelect.vue'
import ProviderModelSelect from '@/components/chat/ProviderModelSelect.vue'
import Tip from '@/components/ui/Tip.vue'
import { useButtonUI } from '@/components/ui/button'

const { providerID, providerDef, modelID, customModelID } = useAIChat()
const { dialogs } = useI18n()

const {
  status,
  initializing = false,
  stopping = false,
  stopRetryAvailable = false,
  visualAttachmentsEnabled = false,
  attachments = [],
  canAttachSelection = false,
  attachmentsDisabled = false,
  acceptedImageTypes = 'image/png,image/jpeg,image/webp',
  allowMultipleAttachments = false,
  attachmentTargetLabel
} = defineProps<{
  status: 'ready' | 'submitted' | 'streaming' | 'error'
  initializing?: boolean
  stopping?: boolean
  stopRetryAvailable?: boolean
  visualAttachmentsEnabled?: boolean
  attachments?: readonly VisualChatAttachment[]
  canAttachSelection?: boolean
  attachmentsDisabled?: boolean
  acceptedImageTypes?: string
  allowMultipleAttachments?: boolean
  attachmentTargetLabel?: string
}>()

const emit = defineEmits<{
  submit: [text: string, restoreInput: () => void]
  stop: []
  'select-files': [files: File[]]
  'attach-selection': []
  'remove-attachment': [id: string]
}>()

const input = useChatDraft(() => activeTab.value?.store)
const fileInput = ref<HTMLInputElement>()

const isStreaming = computed(() => status === 'streaming' || status === 'submitted')
const isBusy = computed(() => initializing || isStreaming.value)
const isACPProvider = computed(() => providerID.value.startsWith('acp:'))
const acpAgentName = computed(() => {
  const agentId = providerID.value.replace('acp:', '')
  return ACP_AGENTS.find((agent) => agent.id === agentId)?.name ?? agentId
})
const isCustomProvider = computed(
  () => providerID.value === 'openai-compatible' || providerID.value === 'anthropic-compatible'
)
const stopButton = useButtonUI({
  tone: 'ghost',
  shape: 'rounded',
  size: 'sm',
  ui: { base: 'shrink-0 border border-border px-2 py-1.5' }
})
const sendButton = useButtonUI({
  tone: 'accent',
  shape: 'rounded',
  size: 'sm',
  ui: { base: 'shrink-0 px-2.5 py-1.5 font-medium' }
})
const customModelName = computed(() => customModelID.value.trim())
const usesCustomModel = computed(
  () => !!providerDef.value.supportsCustomModel && !!customModelName.value
)

const selectedModelName = computed(() => {
  if (usesCustomModel.value) return customModelName.value
  if (isCustomProvider.value) return 'No model'
  return providerDef.value.models.find((model) => model.id === modelID.value)?.name ?? modelID.value
})
const attachmentActionsDisabled = computed(() => isBusy.value || attachmentsDisabled)
const attachmentTarget = computed(() => {
  const override = attachmentTargetLabel?.trim()
  if (override) return override
  if (isACPProvider.value) return acpAgentName.value
  return [providerDef.value.name, selectedModelName.value].filter(Boolean).join(' · ')
})

function chooseFiles() {
  if (attachmentActionsDisabled.value) return
  fileInput.value?.click()
}

function handleFilesSelected(event: Event) {
  const target = event.currentTarget
  if (!(target instanceof HTMLInputElement)) return
  const files = Array.from(target.files ?? [])
  target.value = ''
  if (attachmentActionsDisabled.value) return
  if (files.length) emit('select-files', files)
}

function handlePaste(event: ClipboardEvent) {
  if (attachmentActionsDisabled.value || !visualAttachmentsEnabled) return
  const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
    file.type.startsWith('image/')
  )
  if (files.length === 0) return
  event.preventDefault()
  emit('select-files', allowMultipleAttachments ? files : files.slice(0, 1))
}

function handleInputKeydown(event: KeyboardEvent) {
  if (event.code !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  const target = event.currentTarget
  if (target instanceof HTMLElement) target.closest('form')?.requestSubmit()
}

// Switching between saved profiles only makes sense once more than one can drive the design agent.
const switchableProfiles = computed(designModelProfiles)
const canSwitchProfile = computed(() => switchableProfiles.value.length > 1)
const selectedProfileName = computed(
  () => designModelProfile.value?.name ?? selectedModelName.value
)

function handleSubmit(event: Event) {
  event.preventDefault()
  if (attachmentActionsDisabled.value) return
  const requestedInput = useChatDraft(activeTab.value?.store)
  const text = requestedInput.value.trim()
  if (!text && attachments.length === 0) return
  const submissionText = text || dialogs.value.recreateVisualReference
  requestedInput.value = ''
  emit('submit', submissionText, () => {
    if (!requestedInput.value.trim()) requestedInput.value = text
  })
}
</script>

<template>
  <TooltipProvider>
    <div class="shrink-0 border-t border-border px-3 py-2">
      <div class="mb-1.5 flex items-center gap-1">
        <template v-if="isACPProvider">
          <div
            class="flex shrink-0 items-center gap-1 px-1.5 py-0.5 text-[10px] text-muted"
            data-test-id="chat-acp-agent-label"
          >
            <icon-lucide-bot class="size-3" />
            {{ acpAgentName }}
          </div>
          <AcpConfigSelect category="model" :disabled="isBusy" />
          <AcpConfigSelect category="thought_level" :disabled="isBusy" />
        </template>
        <ChatProfileSelect v-else-if="canSwitchProfile && (isCustomProvider || usesCustomModel)">
          <template #value>
            <span class="min-w-0 truncate">{{ selectedProfileName }}</span>
          </template>
        </ChatProfileSelect>
        <template v-else-if="isCustomProvider || usesCustomModel">
          <div
            class="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-muted"
            data-test-id="chat-custom-model-label"
          >
            <icon-lucide-bot class="size-3" />
            {{ selectedModelName }}
          </div>
        </template>
        <ProviderModelSelect v-else>
          <template #value>{{ selectedModelName }}</template>
        </ProviderModelSelect>

        <div class="ml-auto">
          <Tip :label="dialogs.providerSettings">
            <button
              type="button"
              data-test-id="provider-settings-trigger"
              :aria-label="dialogs.providerSettings"
              class="rounded p-0.5 text-muted hover:bg-hover hover:text-surface"
              @click="openSettingsDialog('ai')"
            >
              <icon-lucide-settings class="size-3" />
            </button>
          </Tip>
        </div>
      </div>

      <div v-if="visualAttachmentsEnabled" class="mb-1.5 flex flex-col gap-1.5">
        <div class="flex min-w-0 items-center gap-1">
          <input
            ref="fileInput"
            type="file"
            tabindex="-1"
            class="sr-only"
            :accept="acceptedImageTypes"
            :multiple="allowMultipleAttachments"
            :disabled="attachmentActionsDisabled"
            data-test-id="chat-attachment-file-input"
            @change="handleFilesSelected"
          />
          <Tip :label="dialogs.chooseImageReference" side="top">
            <button
              type="button"
              data-test-id="chat-attachment-file-button"
              :aria-label="dialogs.chooseImageReference"
              class="flex size-6 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-surface focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
              :disabled="attachmentActionsDisabled"
              @click="chooseFiles"
            >
              <icon-lucide-paperclip class="size-3.5" aria-hidden="true" />
            </button>
          </Tip>
          <Tip
            :label="
              canAttachSelection ? dialogs.attachCanvasSelection : dialogs.selectVisibleLayerFirst
            "
            side="top"
          >
            <button
              type="button"
              data-test-id="chat-attachment-selection-button"
              :aria-label="dialogs.attachCanvasSelection"
              class="flex size-6 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-surface focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
              :disabled="attachmentActionsDisabled || !canAttachSelection"
              @click="emit('attach-selection')"
            >
              <icon-lucide-scan class="size-3.5" aria-hidden="true" />
            </button>
          </Tip>
          <Tip
            v-if="attachmentTarget"
            :label="dialogs.imagesSentTo({ target: attachmentTarget })"
            side="top"
          >
            <p
              data-test-id="chat-attachment-target"
              class="ml-auto min-w-0 truncate text-[9px] text-muted"
            >
              {{ dialogs.imagesSentTo({ target: attachmentTarget }) }}
            </p>
          </Tip>
        </div>

        <div
          v-if="attachments.length"
          data-test-id="chat-draft-attachments"
          class="flex flex-wrap gap-1.5"
          :aria-label="dialogs.imageReferences"
          aria-live="polite"
        >
          <ChatAttachmentThumbnail
            v-for="attachment in attachments"
            :key="attachment.id"
            :url="attachment.thumbnail.url"
            :name="attachment.name"
            :media-type="attachment.mediaType"
            :size-bytes="attachment.sizeBytes"
            :width="attachment.width"
            :height="attachment.height"
            :removable="!attachmentActionsDisabled"
            @remove="emit('remove-attachment', attachment.id)"
          />
        </div>
      </div>

      <form class="flex gap-1.5" @submit="handleSubmit">
        <textarea
          v-model="input"
          data-test-id="chat-input"
          :placeholder="dialogs.describeChange"
          :disabled="attachmentActionsDisabled"
          rows="2"
          class="min-h-8 min-w-0 flex-1 resize-none rounded border border-border bg-transparent px-2 py-1.5 text-xs leading-relaxed text-surface outline-none placeholder:text-muted focus:border-accent disabled:cursor-not-allowed disabled:opacity-60"
          @keydown="handleInputKeydown"
          @paste.stop="handlePaste"
          @copy.stop
          @cut.stop
        />
        <Tip
          v-if="isStreaming"
          :label="
            stopRetryAvailable ? 'Force stop' : stopping ? 'Stopping…' : dialogs.stopGenerating
          "
        >
          <button
            type="button"
            data-test-id="chat-stop-button"
            :class="stopButton.base"
            :disabled="stopping"
            :aria-busy="stopping || undefined"
            @click="emit('stop')"
          >
            <icon-lucide-loader-circle v-if="stopping" class="size-3 animate-spin" />
            <icon-lucide-octagon-alert v-else-if="stopRetryAvailable" class="size-3" />
            <icon-lucide-square v-else class="size-3" />
          </button>
        </Tip>
        <Tip v-else :label="dialogs.sendMessage">
          <button
            type="submit"
            data-test-id="chat-send-button"
            :class="sendButton.base"
            :disabled="attachmentActionsDisabled || (!input.trim() && attachments.length === 0)"
          >
            <icon-lucide-send class="size-3" />
          </button>
        </Tip>
      </form>
    </div>
  </TooltipProvider>
</template>
