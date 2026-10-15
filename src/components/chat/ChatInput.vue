<script setup lang="ts">
import { compact } from 'es-toolkit/array'
import { computed, ref } from 'vue'

import { ACP_AGENTS } from '@open-pencil/core/constants'
import { useI18n } from '@open-pencil/vue'

import type { VisualChatAttachment } from '@/app/ai/chat/attachments'
import { resolveReferencedNodes, MAX_REFERENCED_NODES } from '@/app/ai/chat/context'
import { useChatDraft, useChatNodeIds } from '@/app/ai/chat/drafts'
import { useAIChat } from '@/app/ai/chat/use'
import { designModelProfile, designModelProfiles } from '@/app/ai/models'
import { openSettingsDialog } from '@/app/settings/dialog'
import { activeTab } from '@/app/tabs'
import AcpConfigSelect from '@/components/chat/AcpConfigSelect.vue'
import ChatAttachmentThumbnail from '@/components/chat/ChatAttachmentThumbnail.vue'
import ChatComposer from '@/components/chat/ChatComposer.vue'
import ChatNodePreview from '@/components/chat/ChatNodePreview.vue'
import ChatProfileSelect from '@/components/chat/ChatProfileSelect.vue'
import ChatThinkingSelect from '@/components/chat/ChatThinkingSelect.vue'
import ProviderModelSelect from '@/components/chat/ProviderModelSelect.vue'
import AppDropOverlay from '@/components/ui/feedback/AppDropOverlay.vue'
import Tip from '@/components/ui/overlay/Tip.vue'

const { providerID, providerDef, modelID, customModelID } = useAIChat()
const { ai, dialogs } = useI18n()

const {
  status,
  dragging = false,
  dropRefusal = null,
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
  dragging?: boolean
  dropRefusal?: string | null
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
const nodeIds = useChatNodeIds(() => activeTab.value?.store)
const editor = computed(() => activeTab.value?.store)
const contextNodes = computed(() =>
  editor.value ? resolveReferencedNodes(editor.value.graph, nodeIds.value) : []
)
const selectionActive = computed(() => {
  const selected = editor.value?.state.selectedIds
  return Boolean(selected?.size) && [...(selected ?? [])].every((id) => nodeIds.value.includes(id))
})
function toggleContextSelection() {
  const store = editor.value
  if (!store || attachmentActionsDisabled.value) return
  const selected = store.state.selectedIds
  nodeIds.value = selectionActive.value
    ? nodeIds.value.filter((id) => !selected.has(id))
    : resolveReferencedNodes(store.graph, [...nodeIds.value, ...selected]).map((node) => node.id)
}
const fileInput = ref<HTMLInputElement>()
const isStreaming = computed(() => status === 'streaming' || status === 'submitted')
const isBusy = computed(() => initializing || isStreaming.value)
const isACPProvider = computed(() => providerID.value.startsWith('acp:'))
const isAgentProvider = computed(
  () => providerID.value.startsWith('acp:') || providerID.value === 'harness:pi'
)
const agentName = computed(() => {
  if (providerID.value === 'harness:pi') return 'Pi'
  const agentId = providerID.value.replace('acp:', '')
  return ACP_AGENTS.find((agent) => agent.id === agentId)?.name ?? agentId
})
const isCustomProvider = computed(
  () => providerID.value === 'openai-compatible' || providerID.value === 'anthropic-compatible'
)
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
  if (isAgentProvider.value) return agentName.value
  return compact([providerDef.value.name, selectedModelName.value]).join(' · ')
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

// Switching between saved profiles only makes sense once more than one can drive the design agent.
const switchableProfiles = computed(designModelProfiles)
const canSwitchProfile = computed(() => switchableProfiles.value.length > 1)
const selectedProfileName = computed(
  () => designModelProfile.value?.name ?? selectedModelName.value
)

function handleSubmit(submittedText: string) {
  if (attachmentActionsDisabled.value) return
  const requestedInput = useChatDraft(activeTab.value?.store)
  const text = submittedText.trim()
  if (!text && attachments.length === 0 && contextNodes.value.length === 0) return
  const submissionText = text || dialogs.value.recreateVisualReference
  requestedInput.value = ''
  emit('submit', submissionText, () => {
    if (!requestedInput.value.trim()) requestedInput.value = text
  })
}
</script>

<template>
  <ChatComposer
    v-model="input"
    :status="status"
    :disabled="attachmentActionsDisabled"
    :stopping="stopping"
    :stop-retry-available="stopRetryAvailable"
    :allow-empty="attachments.length > 0 || contextNodes.length > 0"
    @submit="handleSubmit"
    @stop="emit('stop')"
    @paste="handlePaste"
    @settings="openSettingsDialog('ai')"
  >
    <template #overlay>
      <AppDropOverlay
        :visible="dragging"
        :accepts="!dropRefusal"
        :label="dropRefusal ?? ai.dropImagesToAttach"
      />
    </template>
    <template #model>
      <div class="@container flex min-w-0 items-center gap-1">
        <template v-if="isAgentProvider">
          <div
            class="flex shrink-0 items-center gap-1 px-1.5 py-0.5 text-[10px] text-muted"
            data-test-id="chat-acp-agent-label"
          >
            <icon-lucide-bot class="size-3" />
            {{ agentName }}
          </div>
          <template v-if="isACPProvider">
            <AcpConfigSelect category="model" :disabled="isBusy" />
            <AcpConfigSelect category="thought_level" :disabled="isBusy" />
          </template>
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

        <ChatThinkingSelect v-if="!isAgentProvider" />
      </div>
    </template>
    <template v-if="visualAttachmentsEnabled" #attachment>
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
          <Tip :label="ai.attachImages" side="top">
            <button
              type="button"
              data-test-id="chat-attachment-file-button"
              :aria-label="ai.attachImages"
              class="flex size-6 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-surface focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
              :disabled="attachmentActionsDisabled"
              @click="chooseFiles"
            >
              <icon-lucide-paperclip class="size-3.5" aria-hidden="true" />
            </button>
          </Tip>
          <Tip :label="ai.addSelectionContext">
            <button
              type="button"
              :aria-label="ai.addSelectionContext"
              :data-state="selectionActive ? 'on' : 'off'"
              class="flex size-6 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-surface"
              :disabled="
                attachmentActionsDisabled ||
                !editor?.state.selectedIds.size ||
                (!selectionActive && contextNodes.length >= MAX_REFERENCED_NODES)
              "
              @click="toggleContextSelection"
            >
              <icon-lucide-pin class="size-3.5" />
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

        <div v-if="contextNodes.length && editor" class="flex flex-wrap gap-1.5">
          <div
            v-for="node in contextNodes"
            :key="node.id"
            data-slot="chat-context-chip"
            class="flex items-center gap-1 rounded border border-border px-1 py-1"
          >
            <ChatNodePreview :editor="editor" :node="node" /><span class="text-[10px]">{{
              node.name
            }}</span>
            <button
              type="button"
              :aria-label="ai.removeImageAttachment({ name: node.name })"
              :disabled="attachmentActionsDisabled"
              @click="nodeIds = nodeIds.filter((id) => id !== node.id)"
            >
              <icon-lucide-x class="size-3" />
            </button>
          </div>
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
            :remove-label="ai.removeImageAttachment({ name: attachment.name })"
            @remove="emit('remove-attachment', attachment.id)"
          />
        </div>
      </div>
    </template>
  </ChatComposer>
</template>
