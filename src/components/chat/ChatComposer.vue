<script setup lang="ts">
import { useTextareaAutosize } from '@vueuse/core'
import type { ChatStatus } from 'ai'
import { TooltipProvider } from 'reka-ui'
import { computed, ref } from 'vue'

import { useI18n } from '@open-pencil/vue'

import IconButton from '@/components/ui/button/IconButton.vue'
import InputGroup from '@/components/ui/input/InputGroup.vue'
const {
  status,
  disabled = false,
  stopping = false,
  stopRetryAvailable = false,
  allowEmpty = false
} = defineProps<{
  status: ChatStatus
  disabled?: boolean
  stopping?: boolean
  stopRetryAvailable?: boolean
  allowEmpty?: boolean
}>()
const emit = defineEmits<{
  submit: [text: string]
  stop: []
  settings: []
  paste: [event: ClipboardEvent]
}>()
const { ai } = useI18n()
const textarea = ref<HTMLTextAreaElement>()
const input = defineModel<string>({ default: '' })
const { triggerResize } = useTextareaAutosize({ element: textarea, input, maxHeight: 160 })
const isStreaming = computed(() => status === 'streaming' || status === 'submitted')
const inputDisabled = computed(() => disabled || isStreaming.value)
function handleInputKeydown(event: KeyboardEvent) {
  if (event.code !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  const target = event.currentTarget
  if (target instanceof HTMLElement) target.closest('form')?.requestSubmit()
}
function handleSubmit(event: Event) {
  event.preventDefault()
  if (inputDisabled.value) return
  const text = input.value.trim()
  if (!text && !allowEmpty) return
  input.value = ''
  emit('submit', text)
  triggerResize()
}
/**
 * Puts back a message that could not be sent, unless something new was typed meanwhile.
 * Returns whether it did.
 */
function restoreDraft(text: string): boolean {
  if (input.value.trim()) return false
  input.value = text
  triggerResize()
  return true
}
defineExpose({ restoreDraft })
</script>
<template>
  <TooltipProvider>
    <div class="shrink-0 border-t border-border p-2.5">
      <form class="relative" @submit="handleSubmit" @paste.stop="emit('paste', $event)">
        <InputGroup :disabled="inputDisabled">
          <template v-if="$slots.attachment" #attachment><slot name="attachment" /></template>

          <textarea
            ref="textarea"
            v-model="input"
            data-test-id="chat-input"
            :placeholder="ai.describeChange"
            :disabled="inputDisabled"
            rows="2"
            :aria-label="ai.describeChange"
            class="block min-h-12 w-full resize-none overflow-y-auto bg-transparent px-3 pt-2.5 pb-1 text-xs leading-relaxed text-surface outline-none placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-60"
            @keydown="handleInputKeydown"
            @copy.stop
            @cut.stop
          />

          <template #leading><slot name="leading" /></template>

          <template #model><slot name="model" /></template>

          <template #actions>
            <IconButton
              :label="ai.providerSettings"
              size="sm"
              data-test-id="provider-settings-trigger"
              @click="emit('settings')"
            >
              <icon-lucide-settings class="size-3.5" />
            </IconButton>
            <IconButton
              v-if="isStreaming"
              :label="
                stopRetryAvailable ? 'Force stop' : stopping ? 'Stopping…' : ai.stopGenerating
              "
              :disabled="stopping"
              :aria-busy="stopping || undefined"
              size="sm"
              data-test-id="chat-stop-button"
              class="border border-border"
              @click="emit('stop')"
            >
              <icon-lucide-loader-circle
                v-if="stopping"
                class="size-3 animate-spin motion-reduce:animate-none"
              />
              <icon-lucide-octagon-alert v-else-if="stopRetryAvailable" class="size-3" />
              <icon-lucide-square v-else class="size-3" />
            </IconButton>
            <IconButton
              v-else
              :label="ai.sendMessage"
              size="sm"
              type="submit"
              data-test-id="chat-send-button"
              class="bg-accent text-on-accent hover:bg-accent/90 hover:text-on-accent"
              :disabled="inputDisabled || (!input.trim() && !allowEmpty)"
            >
              <icon-lucide-send class="size-3.5" />
            </IconButton>
          </template>
        </InputGroup>
        <!-- Over the input while files are dragged onto the chat. -->
        <slot name="overlay" />
      </form>
    </div>
  </TooltipProvider>
</template>
