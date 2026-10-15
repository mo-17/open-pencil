<script setup lang="ts">
import { computed, useId } from 'vue'

import { useCodeMessages } from '@open-pencil/vue'

import AppAlert from '@/components/ui/feedback/AppAlert.vue'

import {
  adaptationDiagnosticMessage,
  adaptationDiagnosticStatus,
  type AdaptationDiagnosticViewItem
} from './use'

const {
  items,
  waiting,
  truncated,
  enabled = true
} = defineProps<{
  items: readonly AdaptationDiagnosticViewItem[]
  waiting: boolean
  truncated: boolean
  enabled?: boolean
}>()
const emit = defineEmits<{ jump: [nodeId: string] }>()
const messages = useCodeMessages()
const titleId = useId()
const status = computed(() =>
  adaptationDiagnosticStatus(messages.value, {
    enabled,
    waiting,
    truncated,
    itemCount: items.length
  })
)
</script>

<template>
  <section
    :aria-labelledby="titleId"
    :aria-busy="enabled && waiting"
    class="border-t border-border bg-panel px-3 py-2 text-xs"
    data-test-id="preview-adaptation-diagnostics"
  >
    <h3 :id="titleId" class="font-medium text-surface">
      {{ messages.previewAdaptationDiagnosticsTitle }}
    </h3>
    <p
      v-if="status && !(enabled && !waiting && truncated)"
      role="status"
      aria-live="polite"
      class="mt-1 text-[11px] leading-relaxed text-muted"
      data-test-id="preview-adaptation-status"
    >
      {{ status }}
    </p>
    <AppAlert
      v-if="enabled && !waiting && truncated"
      class="mt-2"
      tone="warning"
      :heading="messages.previewAdaptationDiagnosticsTitle"
      :description="messages.previewAdaptationDiagnosticsTruncated"
      data-test-id="preview-adaptation-limit"
    />
    <ul
      v-if="enabled && !waiting && items.length"
      :aria-labelledby="titleId"
      class="mt-2 max-h-40 space-y-1 overflow-y-auto"
      data-test-id="preview-adaptation-items"
    >
      <li v-for="(item, index) in items" :key="`${item.nodeId}:${item.kind}:${index}`">
        <button
          type="button"
          class="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent"
          :aria-label="`${messages.previewAdaptationLocateNode}: ${item.nodeName}`"
          :data-node-id="item.nodeId"
          :data-diagnostic-kind="item.kind"
          data-test-id="preview-adaptation-jump"
          @click="emit('jump', item.nodeId)"
        >
          <icon-lucide-triangle-alert
            aria-hidden="true"
            class="mt-0.5 size-3 shrink-0 text-warning"
          />
          <span class="min-w-0">
            <span class="block break-words font-medium text-surface">{{ item.nodeName }}</span>
            <span class="block text-[11px] leading-relaxed text-muted">
              {{ adaptationDiagnosticMessage(messages, item.kind) }}
            </span>
          </span>
        </button>
      </li>
    </ul>
  </section>
</template>
