<script setup lang="ts">
import { useClipboard } from '@vueuse/core'
import { useI18n } from '@open-pencil/vue'
import { computed, ref } from 'vue'

import { backendPreviewCopy } from './copy'

const {
  label,
  value,
  multiline = false
} = defineProps<{
  label: string
  value: string
  multiline?: boolean
}>()
const { locale } = useI18n()
const copyText = computed(() => backendPreviewCopy(locale.value))
const { copy, copied } = useClipboard({ legacy: true })
const failed = ref(false)
async function copyValue() {
  failed.value = false
  try {
    await copy(value)
  } catch {
    failed.value = true
  }
}
</script>

<template>
  <div class="min-w-0 text-xs">
    <div class="mb-1 flex items-center justify-between gap-3">
      <span class="text-muted">{{ label }}</span>
      <button
        type="button"
        :aria-label="`${copyText.copy} ${label}`"
        class="flex min-h-8 shrink-0 items-center gap-1.5 rounded px-2 text-surface hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent"
        @click="copyValue"
      >
        <icon-lucide-check v-if="copied" class="size-3.5" />
        <icon-lucide-copy v-else class="size-3.5" />
        {{ copied ? copyText.copied : copyText.copy }}
      </button>
    </div>
    <pre
      v-if="multiline"
      class="max-h-48 select-text overflow-auto rounded border border-border bg-input p-3 text-xs text-surface"
      >{{ value }}</pre
    >
    <code
      v-else
      class="block select-text break-all rounded border border-border bg-input px-3 py-2 leading-relaxed text-surface"
      >{{ value }}</code
    >
    <p v-if="failed" role="status" class="mt-1 text-muted">{{ copyText.copyFailed }}</p>
  </div>
</template>
