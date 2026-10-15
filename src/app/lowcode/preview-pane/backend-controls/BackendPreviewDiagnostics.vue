<script setup lang="ts">
import { computed } from 'vue'

import type { ManagedPreviewDiagnostic } from '@open-pencil/compiler/managed-preview'
import { useI18n } from '@open-pencil/vue'

import BackendPreviewCopyValue from './BackendPreviewCopyValue.vue'
import { diagnosticCopy, diagnosticReport } from './diagnostics-copy'

const { items, checkedAt, busy, canCheck } = defineProps<{
  items: readonly ManagedPreviewDiagnostic[]
  checkedAt: number | null
  busy: boolean
  canCheck: boolean
}>()
const emit = defineEmits<{ check: [] }>()
const { locale } = useI18n()
const text = computed(() => diagnosticCopy(locale.value))
</script>

<template>
  <section
    class="rounded-xl border border-border p-4 text-xs"
    data-test-id="managed-backend-diagnostics"
  >
    <div class="flex items-center justify-between gap-3">
      <h3 class="font-medium">{{ text.title }}</h3>
      <button
        type="button"
        :disabled="busy || !canCheck"
        class="min-h-9 rounded border border-border px-3 hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
        @click="emit('check')"
      >
        {{ items.length ? text.retry : text.check }}
      </button>
    </div>
    <p class="mt-2 leading-relaxed text-muted">{{ text.boundary }}</p>
    <ol v-if="items.length" class="mt-3 space-y-3" aria-live="polite">
      <li v-for="item in items" :key="item.code">
        <div class="flex justify-between gap-2">
          <span>{{ text[item.code][0] }}</span
          ><span :class="item.status === 'passed' ? 'text-success' : 'text-warning'">{{
            text[item.status]
          }}</span>
        </div>
        <p v-if="item.status !== 'passed'" class="mt-1 leading-relaxed text-muted">
          {{ text[item.code][1] }}
        </p>
        <code class="text-[10px] text-muted">{{ item.code }}:{{ item.status }}</code>
      </li>
    </ol>
    <BackendPreviewCopyValue
      v-if="items.length"
      class="mt-3"
      :label="text.details"
      :value="diagnosticReport(items, checkedAt)"
      multiline
    />
  </section>
</template>
