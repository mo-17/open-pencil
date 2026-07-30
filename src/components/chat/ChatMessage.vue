<script setup lang="ts">
import { computed } from 'vue'
import { getToolName, isFileUIPart, isTextUIPart, isToolUIPart } from 'ai'
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from 'reka-ui'
import { Markdown } from 'vue-stream-markdown'
import { useI18n, vTestId } from '@open-pencil/vue'
import 'vue-stream-markdown/index.css'

import type { FileUIPart, UIDataTypes, UIMessage, UIMessagePart, UITools } from 'ai'

import { hasErrorOutput, toolErrorText, toolState } from '@/app/ai/chat/tool-presentation'
import ChatAttachmentThumbnail from '@/components/chat/ChatAttachmentThumbnail.vue'

const { message } = defineProps<{ message: UIMessage }>()
const { dialogs } = useI18n()

type ToolPart = Extract<UIMessagePart<UIDataTypes, UITools>, { toolCallId: string }>

const userText = computed(() =>
  message.parts
    .filter(isTextUIPart)
    .map((part) => part.text)
    .join('')
)
const userFiles = computed(() => message.parts.filter(isFileUIPart))

function toolDisplayName(part: ToolPart): string {
  return getToolName(part)
    .replace(/^mcp__[^_]+__/, '')
    .replace(/^mcp\.[^.]+\./, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function partKey(part: UIMessagePart<UIDataTypes, UITools>, index: number): string {
  if ('toolCallId' in part) return part.toolCallId
  return `part-${index}`
}

function fileName(part: FileUIPart, index: number): string {
  return part.filename?.trim() || `${dialogs.value.imageAttachment} ${index + 1}`
}

function filePreviewUrl(part: FileUIPart, index: number): string {
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
                    'bg-green-500/20 text-green-400': toolState(part) === 'done',
                    'bg-muted/20 text-muted': toolState(part) === 'cancelled',
                    'bg-amber-500/20 text-amber-400': toolState(part) === 'denied',
                    'bg-red-500/20 text-red-400': toolState(part) === 'error'
                  }"
                >
                  <icon-lucide-loader-circle
                    v-if="toolState(part) === 'pending'"
                    class="size-3 animate-spin"
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
                      ? 'Running…'
                      : toolState(part) === 'done'
                        ? 'Done'
                        : toolState(part) === 'cancelled'
                          ? 'Cancelled'
                          : toolState(part) === 'denied'
                            ? 'Denied'
                            : 'Error'
                  }}
                </span>
                <icon-lucide-chevron-down
                  v-if="toolState(part) !== 'pending'"
                  class="ml-auto size-3 text-muted transition-transform [[data-state=open]>&]:rotate-180"
                />
              </CollapsibleTrigger>
              <CollapsibleContent
                v-if="toolState(part) !== 'pending'"
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
            :url="filePreviewUrl(part, index)"
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
