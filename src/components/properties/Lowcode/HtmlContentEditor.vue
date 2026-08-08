<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { HTML_MODULE_LIMITS, buildHtmlSandboxDocument } from '@open-pencil/core/plugins'
import { useI18n } from '@open-pencil/vue'

const { modelValue, label, error } = defineProps<{
  modelValue: string
  label: string
  error?: string
}>()

const emit = defineEmits<{
  commit: [value: string]
}>()

const { panels } = useI18n()
const source = ref(modelValue)
const maximumLength = HTML_MODULE_LIMITS.html
const overLimit = computed(() => source.value.length > maximumLength)
const previewDocument = computed(() =>
  buildHtmlSandboxDocument(overLimit.value ? '' : source.value)
)
const limitError = computed(() =>
  overLimit.value ? panels.value.lowcodeHtmlTooLong({ max: maximumLength }) : ''
)
const errorMessage = computed(() => limitError.value || error || '')

watch(
  () => modelValue,
  (value) => {
    source.value = value
  }
)

function updateSource(event: Event): void {
  source.value = (event.target as HTMLTextAreaElement).value
}

function commit(): void {
  if (overLimit.value || source.value === modelValue) return
  emit('commit', source.value)
}

function commitShortcut(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return
  event.preventDefault()
  commit()
}
</script>

<template>
  <div data-test-id="html-content-editor" class="flex flex-col gap-1.5">
    <textarea
      :value="source"
      :aria-label="label"
      :maxlength="maximumLength"
      data-test-id="html-content-source"
      rows="10"
      wrap="off"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      class="w-full resize-y rounded border border-border bg-input px-2 py-1.5 font-mono text-[10px] leading-relaxed text-surface outline-none focus:border-accent"
      @input="updateSource"
      @blur="commit"
      @keydown="commitShortcut"
    />

    <div class="flex items-center justify-between gap-2 text-[9px] text-muted">
      <span>{{ panels.lowcodeHtmlPreview }}</span>
      <span data-test-id="html-content-length">
        {{ panels.lowcodeHtmlLength({ count: source.length, max: maximumLength }) }}
      </span>
    </div>

    <iframe
      :srcdoc="previewDocument"
      :aria-label="panels.lowcodeHtmlPreview"
      data-test-id="html-content-preview"
      sandbox=""
      referrerpolicy="no-referrer"
      tabindex="-1"
      class="pointer-events-none h-32 w-full rounded border border-border bg-white"
    />

    <p v-if="errorMessage" data-test-id="html-content-error" class="text-[10px] text-red-400">
      {{ errorMessage }}
    </p>
  </div>
</template>
