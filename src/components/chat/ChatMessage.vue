<script setup lang="ts">
import { computed } from 'vue'
import { getToolName, isFileUIPart, isTextUIPart, isToolUIPart } from 'ai'
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from 'reka-ui'
import { Markdown } from 'vue-stream-markdown'
import { useI18n, vTestId } from '@open-pencil/vue'
import 'vue-stream-markdown/index.css'

import type { FileUIPart, UIDataTypes, UIMessage, UIMessagePart, UITools } from 'ai'

import {
  collectAssistantFiles,
  collectChatSources,
  type AssistantFilePresentation
} from '@/app/ai/chat/sources'
import { hasErrorOutput, toolErrorText, toolState } from '@/app/ai/chat/tool-presentation'
import { remoteMCPToolServerDisplayInfo } from '@/app/ai/mcp'
import { openExternalLink } from '@/app/shell/ui'
import ChatAttachmentThumbnail from '@/components/chat/ChatAttachmentThumbnail.vue'

const {
  message,
  pendingApprovalIds = [],
  approvalEnabled
} = defineProps<{
  message: UIMessage
  pendingApprovalIds?: readonly string[]
  approvalEnabled: boolean
}>()
const emit = defineEmits<{
  toolApproval: [messageId: string, id: string, approved: boolean]
}>()
const { dialogs } = useI18n()

type ToolPart = Extract<UIMessagePart<UIDataTypes, UITools>, { toolCallId: string }>

const userText = computed(() =>
  message.parts
    .filter(isTextUIPart)
    .map((part) => part.text)
    .join('')
)
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

function toolDisplayName(part: ToolPart): string {
  return getToolName(part)
    .replace(/^mcp__[^_]+__/, '')
    .replace(/^mcp\.[^.]+\./, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function remoteToolServer(part: ToolPart) {
  return remoteMCPToolServerDisplayInfo(getToolName(part))
}

function approvalId(part: ToolPart): string | null {
  return part.state === 'approval-requested' ? part.approval.id : null
}

function respondToApproval(part: ToolPart, approved: boolean): void {
  const id = approvalId(part)
  if (approvalEnabled && id && !pendingApprovalIds.includes(id)) {
    emit('toolApproval', message.id, id, approved)
  }
}

function approvalPending(part: ToolPart): boolean {
  const id = approvalId(part)
  return id !== null && pendingApprovalIds.includes(id)
}

function partKey(part: UIMessagePart<UIDataTypes, UITools>, index: number): string {
  if ('toolCallId' in part) return part.toolCallId
  return `part-${index}`
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
      class="min-w-0"
      :class="
        message.role === 'user' ? 'flex max-w-[85%] flex-col items-end gap-1.5' : 'space-y-1.5'
      "
    >
      <template v-if="message.role === 'assistant'">
        <template v-for="(part, i) in message.parts" :key="partKey(part, i)">
          <!-- Tool call -->
          <div
            v-if="isToolUIPart(part)"
            data-test-id="chat-tool-call"
            class="rounded-lg border border-border bg-canvas p-2"
          >
            <CollapsibleRoot>
              <CollapsibleTrigger
                class="flex w-full items-center gap-2 rounded px-1 py-0.5 hover:bg-hover"
              >
                <div
                  class="flex size-4 items-center justify-center rounded-full"
                  :class="{
                    'bg-accent/20 text-accent': toolState(part) === 'pending',
                    'bg-amber-500/20 text-amber-400':
                      toolState(part) === 'approval' || toolState(part) === 'denied',
                    'bg-green-500/20 text-green-400': toolState(part) === 'done',
                    'bg-muted/20 text-muted': toolState(part) === 'cancelled',
                    'bg-red-500/20 text-red-400': toolState(part) === 'error'
                  }"
                >
                  <icon-lucide-loader-circle
                    v-if="toolState(part) === 'pending'"
                    class="size-3 animate-spin"
                  />
                  <icon-lucide-shield-alert
                    v-else-if="toolState(part) === 'approval'"
                    class="size-3"
                  />
                  <icon-lucide-check v-else-if="toolState(part) === 'done'" class="size-3" />
                  <icon-lucide-circle-slash
                    v-else-if="toolState(part) === 'cancelled'"
                    class="size-3"
                  />
                  <icon-lucide-shield-x v-else-if="toolState(part) === 'denied'" class="size-3" />
                  <icon-lucide-triangle-alert v-else class="size-3" />
                </div>
                <span class="text-[11px] text-surface">
                  {{ toolDisplayName(part) }}
                </span>
                <span class="text-[10px] text-muted">
                  {{
                    toolState(part) === 'pending'
                      ? dialogs.toolRunning
                      : toolState(part) === 'approval'
                        ? dialogs.toolApprovalRequired
                        : toolState(part) === 'done'
                          ? dialogs.toolFinished
                          : toolState(part) === 'cancelled'
                            ? dialogs.toolCancelled
                            : toolState(part) === 'denied'
                              ? dialogs.denied
                              : dialogs.toolError
                  }}
                </span>
                <icon-lucide-chevron-down
                  v-if="toolState(part) !== 'pending' && toolState(part) !== 'approval'"
                  class="ml-auto size-3 text-muted transition-transform [[data-state=open]>&]:rotate-180"
                />
              </CollapsibleTrigger>
              <div
                v-if="toolState(part) === 'approval'"
                data-test-id="chat-tool-approval"
                class="mt-2 rounded border border-amber-500/30 bg-amber-500/5 p-2"
              >
                <p v-if="remoteToolServer(part)" class="mb-1 text-[9px] text-muted">
                  MCP · {{ remoteToolServer(part)?.name }} · {{ remoteToolServer(part)?.origin }}
                </p>
                <pre class="max-h-40 overflow-auto rounded bg-input p-2 text-[10px] text-muted">{{
                  JSON.stringify(part.input, null, 2)
                }}</pre>
                <div class="mt-2 flex justify-end gap-1.5">
                  <button
                    type="button"
                    class="rounded px-2 py-1 text-[10px] text-muted hover:bg-hover hover:text-surface disabled:cursor-wait disabled:opacity-50"
                    data-test-id="chat-tool-deny"
                    :disabled="!approvalEnabled || approvalPending(part)"
                    @click="respondToApproval(part, false)"
                  >
                    {{ dialogs.toolDeny }}
                  </button>
                  <button
                    type="button"
                    class="rounded bg-accent px-2 py-1 text-[10px] font-medium text-white hover:bg-accent/90 disabled:cursor-wait disabled:opacity-50"
                    data-test-id="chat-tool-approve"
                    :disabled="!approvalEnabled || approvalPending(part)"
                    @click="respondToApproval(part, true)"
                  >
                    {{ dialogs.toolApprove }}
                  </button>
                </div>
              </div>
              <CollapsibleContent
                v-if="toolState(part) !== 'pending' && toolState(part) !== 'approval'"
                class="data-[state=closed]:collapsible-up data-[state=open]:collapsible-down overflow-hidden text-[10px]"
              >
                <pre class="mt-1 overflow-x-auto rounded bg-input p-2 text-muted">{{
                  part.state === 'output-error'
                    ? toolErrorText(part)
                    : hasErrorOutput(part)
                      ? toolErrorText(part)
                      : JSON.stringify(part.output, null, 2)
                }}</pre>
              </CollapsibleContent>
            </CollapsibleRoot>
          </div>

          <!-- Text -->
          <div
            v-else-if="isTextUIPart(part) && part.text"
            data-test-id="chat-text-bubble"
            class="rounded-xl rounded-tl-md bg-hover px-3 py-2 text-xs leading-relaxed text-surface"
          >
            <Markdown :content="part.text" :mermaid="false" class="chat-markdown" />
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
        <div
          v-if="userFiles.length"
          data-test-id="chat-message-attachments"
          class="flex max-w-full flex-wrap justify-end gap-1.5"
          :aria-label="dialogs.imageReferences"
        >
          <ChatAttachmentThumbnail
            v-for="(part, index) in userFiles"
            :key="partKey(part, index)"
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
