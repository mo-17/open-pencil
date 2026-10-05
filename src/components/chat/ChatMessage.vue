<script setup lang="ts">
import { refAutoReset, useClipboard } from '@vueuse/core'
import { isReasoningUIPart, isFileUIPart, isTextUIPart } from 'ai'
import type { FileUIPart, UIMessage } from 'ai'
import { computed } from 'vue'

import { useI18n, vTestId } from '@open-pencil/vue'

import { attachmentsForMessage } from '@/app/ai/attachment/presentation/store'
import type { AttachmentPresentation } from '@/app/ai/attachment/presentation/types'
import { reasoningDisplay } from '@/app/ai/chat/preferences'
import { visibleUserMessageText } from '@/app/ai/chat/presentation'
import {
  collectAssistantFiles,
  collectChatSources,
  type AssistantFilePresentation
} from '@/app/ai/chat/sources'
import { groupMessageParts, type MessagePartGroup } from '@/app/ai/chat/tool-calls/display'
import { openExternalLink } from '@/app/shell/ui'
import AttachmentList from '@/components/chat/attachment/AttachmentList.vue'
import ChatAttachmentThumbnail from '@/components/chat/ChatAttachmentThumbnail.vue'
import ChatMarkdown from '@/components/chat/ChatMarkdown.vue'
import ReasoningBlock from '@/components/chat/ReasoningBlock.vue'
import ToolCallGroup from '@/components/chat/tool/ToolCallGroup.vue'
import IconButton from '@/components/ui/button/IconButton.vue'

const {
  message,
  pendingApprovalIds = [],
  approvalEnabled = false,
  presentation,
  streaming = false
} = defineProps<{
  message: UIMessage
  pendingApprovalIds?: readonly string[]
  approvalEnabled?: boolean
  presentation?: { text?: string; attachments?: AttachmentPresentation[] }
  streaming?: boolean
}>()
const emit = defineEmits<{
  toolApproval: [messageId: string, id: string, approved: boolean]
}>()
const { ai, dialogs } = useI18n()
const markdownMode = computed(() => (streaming ? 'streaming' : 'static'))

const userText = computed(
  () =>
    presentation?.text ??
    visibleUserMessageText(
      message.id,
      message.parts
        .filter(isTextUIPart)
        .map((part) => part.text)
        .join('')
    )
)
const storedAttachments = attachmentsForMessage(message.id)
const attachments = computed(() => presentation?.attachments ?? storedAttachments.value)
const assistantText = computed(() =>
  message.parts
    .filter(isTextUIPart)
    .map((part) => part.text)
    .join('')
)
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
      class="min-w-0 select-text"
      :class="
        message.role === 'user' ? 'flex max-w-[85%] flex-col items-end gap-1.5' : 'space-y-1.5'
      "
    >
      <template v-if="message.role === 'assistant'">
        <template v-for="group in groups" :key="groupKey(group)">
          <ToolCallGroup
            v-if="group.kind === 'tools'"
            :parts="group.parts.map(({ part }) => part)"
            :pending-approval-ids="pendingApprovalIds"
            :approval-enabled="approvalEnabled"
            @tool-approval="(id, approved) => emit('toolApproval', message.id, id, approved)"
          />
          <ReasoningBlock
            v-else-if="isReasoningUIPart(group.part) && group.part.text"
            :text="group.part.text"
            :display="reasoningDisplay"
            :streaming="group.part.state === 'streaming'"
            :thinking-label="ai.thinking"
            :reasoning-label="ai.reasoning"
            :duration-label="(seconds) => ai.thoughtFor({ seconds })"
          />

          <!-- Text -->
          <div
            v-else-if="isTextUIPart(group.part) && group.part.text"
            data-test-id="chat-text-bubble"
            class="rounded-xl rounded-tl-md bg-hover px-3 py-2 text-xs leading-relaxed text-surface"
          >
            <ChatMarkdown :content="group.part.text" :mode="markdownMode" />
            <IconButton
              v-if="
                group.index === firstAssistantTextPartIndex && assistantText && clipboardSupported
              "
              :label="copied ? ai.responseCopied : ai.copyResponse"
              size="xs"
              data-slot="chat-copy-response"
              @click="copyResponse"
            >
              <icon-lucide-check v-if="copied" class="size-3" />
              <icon-lucide-copy v-else class="size-3" />
            </IconButton>
          </div>
        </template>

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
                    source.secure
                      ? 'bg-green-500/10 text-green-400'
                      : 'bg-amber-500/10 text-amber-400'
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
        <div
          v-if="userText"
          data-test-id="chat-text-bubble"
          class="rounded-xl rounded-br-md bg-accent px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap text-white"
        >
          {{ userText }}
        </div>
      </template>
    </div>
  </div>
</template>
