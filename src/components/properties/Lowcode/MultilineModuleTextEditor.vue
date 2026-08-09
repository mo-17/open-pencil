<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const {
  modelValue,
  label,
  maxLength,
  countLabel,
  rows = 10,
  wrap = 'off',
  monospace = true,
  error = ''
} = defineProps<{
  modelValue: string
  label: string
  maxLength: number
  countLabel?: (count: number, maximum: number) => string
  rows?: number
  wrap?: 'soft' | 'off'
  monospace?: boolean
  error?: string
}>()

const emit = defineEmits<{
  commit: [value: string]
}>()

const draft = ref(modelValue)
const lastCommitted = ref(modelValue)
const overLimit = computed(() => draft.value.length > maxLength)
const countText = computed(() =>
  countLabel ? countLabel(draft.value.length, maxLength) : `${draft.value.length}/${maxLength}`
)

watch(
  () => modelValue,
  (value) => {
    draft.value = value
    lastCommitted.value = value
  }
)

function updateDraft(event: Event): void {
  draft.value = (event.target as HTMLTextAreaElement).value
}

function commit(): void {
  if (overLimit.value || draft.value === lastCommitted.value) return
  lastCommitted.value = draft.value
  emit('commit', draft.value)
}
</script>

<template>
  <div data-test-id="multiline-module-text-editor" class="flex flex-col gap-1.5">
    <textarea
      :value="draft"
      :aria-label="label"
      :maxlength="maxLength"
      :rows="rows"
      :wrap="wrap"
      data-test-id="multiline-module-text-source"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      :class="[
        'w-full resize-y rounded border border-border bg-input px-2 py-1.5 text-[10px] leading-relaxed text-surface outline-none focus:border-accent',
        monospace ? 'font-mono' : ''
      ]"
      @input="updateDraft"
      @change="commit"
      @blur="commit"
    />

    <div class="flex items-center justify-end gap-2 text-[9px] text-muted">
      <span data-test-id="multiline-module-text-length" aria-live="polite">
        {{ countText }}
      </span>
    </div>

    <p
      v-if="overLimit || error"
      data-test-id="multiline-module-text-error"
      class="text-[10px] text-red-400"
    >
      {{ error }}
    </p>
  </div>
</template>
