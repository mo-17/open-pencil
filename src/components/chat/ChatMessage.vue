<script setup lang="ts">
import { refAutoReset, useClipboard } from '@vueuse/core'
import { isReasoningUIPart, isFileUIPart, isTextUIPart } from 'ai'
import type { FileUIPart, UIMessage } from 'ai'
import { computed, ref } from 'vue'

import { useI18n, vTestId } from '@open-pencil/vue'

import { attachmentsForMessage } from '@/app/ai/attachment/presentation/store'
import type { AttachmentPresentation } from '@/app/ai/attachment/presentation/types'
import { undoOf, wasStopped } from '@/app/ai/chat/metadata'
import { reasoningDisplay as preferredReasoningDisplay } from '@/app/ai/chat/preferences'
import { visibleUserMessageText } from '@/app/ai/chat/presentation'
import {
  collectAssistantFiles,
  collectChatSources,
  type AssistantFilePresentation
} from '@/app/ai/chat/sources'
import { groupMessageParts, type MessagePartGroup } from '@/app/ai/chat/tool-calls/display'
import type { ReasoningDisplay } from '@/app/settings/preferences/store'
import { openExternalLink } from '@/app/shell/ui'
import AttachmentList from '@/components/chat/attachment/AttachmentList.vue'
import ChatAttachmentThumbnail from '@/components/chat/ChatAttachmentThumbnail.vue'
import ChatMarkdown from '@/components/chat/ChatMarkdown.vue'
import ReasoningBlock from '@/components/chat/ReasoningBlock.vue'
import ToolCallGroup from '@/components/chat/tool/ToolCallGroup.vue'
import ChatMessageEditor from '@/components/chat/turn/ChatMessageEditor.vue'
import ChatTurnActions from '@/components/chat/turn/ChatTurnActions.vue'
import AppButton from '@/components/ui/button/AppButton.vue'
import IconButton from '@/components/ui/button/IconButton.vue'

const {
  message,
  pendingApprovalIds = [],
  approvalEnabled = false,
  streaming = false,
  presentation,
  turnActionsDisabled = false,
  canRegenerate = false,
  canRetry = false,
  canEdit = false,
  reasoningDisplay
} = defineProps<{
  message: UIMessage
  pendingApprovalIds?: readonly string[]
  approvalEnabled?: boolean
  streaming?: boolean
  presentation?: { text?: string; attachments?: AttachmentPresentation[] }
  /** The transcript owner has not released its interaction lock yet. */
  turnActionsDisabled?: boolean
  /** The last reply, when the chat is idle. */
  canRegenerate?: boolean
  /** The last message, a request that got no reply, when the chat is idle. */
  canRetry?: boolean
  /** The last user message without attachments, when the chat is idle. */
  canEdit?: boolean
  /** Overrides the reasoning display preference, for a surface that always shows it. */
  reasoningDisplay?: ReasoningDisplay
}>()
const emit = defineEmits<{
  toolApproval: [messageId: string, id: string, approved: boolean]
  regenerate: []
  revert: []
  restore: []
  edit: [text: string]
}>()
const editing = ref(false)
const { ai, dialogs } = useI18n()
const markdownMode = computed(() => (streaming ? 'streaming' : 'static'))
const storedAttachments = attachmentsForMessage(message.id)
const attachments = computed(() => presentation?.attachments ?? storedAttachments.value)
const assistantText = computed(() =>
  message.parts
    .filter(isTextUIPart)
    .map((part) => part.text)
    .join('')
)
const userText = computed(
  () =>
    presentation?.text ??
    visibleUserMessageText(
      message.id,
      message.parts
        .filter(isTextUIPart)
        .map((p) => p.text)
        .join('')
    )
)

function saveEdit(text: string): void {
  editing.value = false
  emit('edit', text)
}

const firstAssistantTextPartIndex = computed(() =>
  message.parts.findIndex((part) => isTextUIPart(part) && part.text.length > 0)
)
const copied = refAutoReset(false, 1500)
const { copy, isSupported: clipboardSupported } = useClipboard()

async function copyResponse(): Promise<void> {
  if (!assistantText.value || !clipboardSupported.value) return
  await copy(assistantText.value)
  copied.value = true
}

const userFiles = computed(() => message.parts.filter(isFileUIPart))
const assistantPresentationLabels = computed(() => ({
  document: dialogs.value.chatDocument,
  generatedImage: dialogs.value.chatGeneratedImage,
  file: dialogs.value.chatFile
}))
const assistantSources = computed(() =>
  collectChatSources(message.parts, assistantPresentationLabels.value)
)
const assistantFiles = computed(() =>
  collectAssistantFiles(message.parts, message.metadata, assistantPresentationLabels.value)
)

// The AI SDK updates parts in place and replaces only the message, so copy each part for
// the cards' computed state to see the new values.
const undo = computed(() => undoOf(message))
const undoneCalls = computed(() => new Set(undo.value?.undone))
const reverted = computed(
  () =>
    !!undo.value &&
    undo.value.edits.length > 0 &&
    undoneCalls.value.size === undo.value.edits.length
)
const stopped = computed(() => wasStopped(message))
// A request that failed once its reply had started leaves the reply without content.
const empty = computed(() => message.parts.every((part) => part.type === 'step-start'))
const groups = computed(() => groupMessageParts(message.parts.map((part) => ({ ...part }))))

function groupKey(group: MessagePartGroup): string {
  return group.kind === 'tools' ? `tools-${group.parts[0]?.index}` : `part-${group.index}`
}
function fileName(part: FileUIPart, index: number): string {
  return part.filename?.trim() || `${dialogs.value.imageAttachment} ${index + 1}`
}

function filePreviewURL(part: FileUIPart, index: number): string {
  const metadata = message.metadata
  if (!metadata || typeof metadata !== 'object' || !('visualAttachments' in metadata)) {
    return part.url
  }

  const attachments = (metadata as { visualAttachments?: unknown }).visualAttachments
  if (!Array.isArray(attachments)) return part.url
  const attachment = attachments[index]
  if (!attachment || typeof attachment !== 'object' || !('thumbnail' in attachment)) {
    return part.url
  }

  const thumbnail = (attachment as { thumbnail?: unknown }).thumbnail
  if (!thumbnail || typeof thumbnail !== 'object' || !('url' in thumbnail)) return part.url
  return typeof thumbnail.url === 'string' && thumbnail.url ? thumbnail.url : part.url
}

function openSafeExternalURL(url: string): void {
  void openExternalLink(url)
}

function assistantFileDetail(file: AssistantFilePresentation): string {
  return file.blocked ? `${file.mediaType} · ${dialogs.value.chatUnavailableURL}` : file.mediaType
}
</script>

<template>
  <div
    v-test-id="`chat-message-${message.role}`"
    :class="message.role === 'user' ? 'flex justify-end' : ''"
  >
    <div
      class="min-w-0 space-y-2 select-text"
      :class="message.role === 'user' ? 'max-w-[85%]' : ''"
    >
      <template v-if="message.role === 'assistant'">
        <!-- A reverted reply's edits are gone; its content stays, dimmed, under its actions. Text
             dims to the muted color rather than through opacity, so it still reads at 4.5:1. -->
        <div
          class="space-y-2 data-[reverted=true]:**:text-muted data-[reverted=true]:[&_img]:opacity-50"
          data-slot="chat-reply-content"
          :data-reverted="reverted"
        >
          <template v-for="group in groups" :key="groupKey(group)">
            <ToolCallGroup
              v-if="group.kind === 'tools'"
              :parts="group.parts.map(({ part }) => part)"
              :undone="undoneCalls"
              :pending-approval-ids="pendingApprovalIds"
              :approval-enabled="approvalEnabled"
              @tool-approval="(id, approved) => emit('toolApproval', message.id, id, approved)"
            />

            <!-- Reasoning -->
            <ReasoningBlock
              v-else-if="isReasoningUIPart(group.part) && group.part.text"
              :text="group.part.text"
              :display="reasoningDisplay ?? preferredReasoningDisplay"
              :streaming="streaming && group.part.state === 'streaming'"
              :thinking-label="ai.thinking"
              :reasoning-label="ai.reasoning"
              :duration-label="(seconds) => ai.thoughtFor({ seconds })"
            />

            <!-- Text -->
            <div
              v-else-if="isTextUIPart(group.part) && group.part.text"
              data-test-id="chat-text-bubble"
              class="group/response relative rounded-xl rounded-tl-md bg-hover px-3 py-2 text-xs leading-relaxed text-surface"
            >
              <ChatMarkdown :content="group.part.text" :mode="markdownMode" />
              <IconButton
                v-if="
                  group.index === firstAssistantTextPartIndex && assistantText && clipboardSupported
                "
                :label="copied ? ai.responseCopied : ai.copyResponse"
                size="xs"
                data-slot="chat-copy-response"
                class="absolute right-1 bottom-1 opacity-0 focus-visible:opacity-100 group-hover/response:opacity-100"
                @click="copyResponse"
              >
                <icon-lucide-check v-if="copied" class="size-3 text-success" />
                <icon-lucide-copy v-else class="size-3" />
              </IconButton>
            </div>
          </template>
        </div>
        <div
          v-if="assistantFiles.length"
          data-test-id="chat-assistant-files"
          class="flex max-w-full flex-wrap gap-1.5"
          :aria-label="dialogs.chatAssistantFiles"
        >
          <div v-for="file in assistantFiles" :key="file.key" class="w-44 max-w-full">
            <ChatAttachmentThumbnail
              v-if="file.previewUrl"
              compact
              :url="file.previewUrl"
              :name="file.name"
              :media-type="file.mediaType"
            />
            <button
              v-else-if="file.openUrl"
              type="button"
              data-test-id="chat-assistant-file-link"
              class="flex w-full items-center gap-2 rounded-lg border border-border bg-panel-field px-2 py-2 text-left hover:bg-hover focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none"
              @click="openSafeExternalURL(file.openUrl)"
            >
              <icon-lucide-file class="size-4 shrink-0 text-muted" aria-hidden="true" />
              <span class="min-w-0">
                <span class="block truncate text-[10px] font-medium text-surface">{{
                  file.name
                }}</span>
                <span class="block truncate text-[9px] text-muted">{{ file.mediaType }}</span>
              </span>
              <icon-lucide-external-link
                class="ml-auto size-3 shrink-0 text-muted"
                aria-hidden="true"
              />
            </button>
            <div
              v-else
              data-test-id="chat-assistant-file-unavailable"
              class="flex items-center gap-2 rounded-lg border border-border bg-panel-field px-2 py-2"
            >
              <icon-lucide-file-warning class="size-4 shrink-0 text-muted" aria-hidden="true" />
              <span class="min-w-0">
                <span class="block truncate text-[10px] font-medium text-surface">{{
                  file.name
                }}</span>
                <span class="block truncate text-[9px] text-muted">{{
                  assistantFileDetail(file)
                }}</span>
              </span>
            </div>
            <button
              v-if="file.previewUrl && file.openUrl"
              type="button"
              data-test-id="chat-assistant-file-link"
              class="mt-1 flex w-full items-center justify-center gap-1 rounded px-1.5 py-1 text-[9px] text-muted hover:bg-hover hover:text-surface focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none"
              @click="openSafeExternalURL(file.openUrl)"
            >
              <icon-lucide-external-link class="size-3" aria-hidden="true" />
              {{ dialogs.chatOpenFile }}
            </button>
          </div>
        </div>

        <section
          v-if="assistantSources.length"
          data-test-id="chat-assistant-sources"
          class="rounded-lg border border-border bg-canvas p-2"
          :aria-label="dialogs.chatSources"
        >
          <div class="mb-1.5 flex items-center gap-1 text-[10px] font-medium text-muted">
            <icon-lucide-book-open class="size-3" aria-hidden="true" />
            {{ dialogs.chatSources }}
          </div>
          <div class="space-y-1">
            <template v-for="(source, index) in assistantSources" :key="source.key">
              <button
                v-if="source.kind === 'url'"
                type="button"
                data-test-id="chat-source-link"
                class="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-hover focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none"
                @click="openSafeExternalURL(source.url)"
              >
                <span
                  class="flex size-4 shrink-0 items-center justify-center rounded bg-hover text-[8px] text-muted"
                >
                  {{ index + 1 }}
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-[10px] text-surface">{{ source.title }}</span>
                  <span class="block truncate text-[9px] text-muted">{{ source.hostname }}</span>
                </span>
                <span
                  class="rounded px-1 py-0.5 text-[8px]"
                  :class="
                    source.secure ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'
                  "
                >
                  {{ source.secure ? 'HTTPS' : 'HTTP' }}
                </span>
                <icon-lucide-external-link class="size-3 shrink-0 text-muted" aria-hidden="true" />
              </button>
              <div
                v-else
                data-test-id="chat-source-document"
                class="flex items-center gap-2 rounded px-1.5 py-1"
              >
                <span
                  class="flex size-4 shrink-0 items-center justify-center rounded bg-hover text-[8px] text-muted"
                >
                  {{ index + 1 }}
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-[10px] text-surface">{{ source.title }}</span>
                  <span class="block truncate text-[9px] text-muted">{{
                    source.filename || source.mediaType
                  }}</span>
                </span>
                <icon-lucide-file-text class="size-3 shrink-0 text-muted" aria-hidden="true" />
              </div>
            </template>
          </div>
        </section>
        <ChatTurnActions
          v-if="!streaming"
          :message-id="message.id"
          :disabled="turnActionsDisabled"
          :can-regenerate="canRegenerate"
          :empty="empty"
          :reverted="reverted"
          :stopped="stopped"
          :undone="undoneCalls.size"
          :edits="undo?.edits.length ?? 0"
          @regenerate="emit('regenerate')"
          @revert="emit('revert')"
          @restore="emit('restore')"
        />
      </template>

      <!-- User message -->
      <template v-else-if="message.role === 'user'">
        <AttachmentList v-if="attachments.length" :attachments="attachments" />
        <div
          v-if="userFiles.length && attachments.length === 0"
          data-test-id="chat-message-attachments"
          class="flex max-w-full flex-wrap justify-end gap-1.5"
          :aria-label="dialogs.imageReferences"
        >
          <ChatAttachmentThumbnail
            v-for="(part, index) in userFiles"
            :key="`${index}:${part.url}`"
            compact
            :url="filePreviewURL(part, index)"
            :name="fileName(part, index)"
            :media-type="part.mediaType"
          />
        </div>

        <ChatMessageEditor
          v-if="editing"
          :text="userText"
          @save="saveEdit"
          @cancel="editing = false"
        />
        <div v-else class="group/request relative">
          <div
            data-test-id="chat-text-bubble"
            class="rounded-xl rounded-br-md bg-accent px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap text-on-accent"
          >
            {{ userText }}
          </div>
          <IconButton
            v-if="canEdit"
            :label="ai.editMessage"
            size="xs"
            data-slot="chat-edit-message"
            class="absolute top-1/2 -left-7 -translate-y-1/2 opacity-0 focus-visible:opacity-100 group-hover/request:opacity-100"
            @click="editing = true"
          >
            <icon-lucide-pencil class="size-3" />
          </IconButton>
        </div>
        <div v-if="canRetry && !editing" class="flex justify-end">
          <AppButton
            size="xs"
            variant="ghost"
            data-test-id="chat-retry"
            @click="emit('regenerate')"
          >
            <template #leading><icon-lucide-refresh-cw aria-hidden="true" /></template>
            {{ ai.retryRequest }}
          </AppButton>
        </div>
      </template>
    </div>
  </div>
</template>
