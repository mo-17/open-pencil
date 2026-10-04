<script setup lang="ts">
import { useCodeMessages } from '@open-pencil/vue'

import type { PreviewRefreshPolicy } from './compile-scheduler'

const policy = defineModel<PreviewRefreshPolicy>({ required: true })
const { disabled = false, id } = defineProps<{ disabled?: boolean; id?: string }>()
const messages = useCodeMessages()
</script>

<template>
  <select
    :id="id"
    v-model="policy"
    :disabled="disabled"
    :aria-label="messages.previewSyncMode"
    data-test-id="lowcode-preview-refresh-policy"
    class="h-7 rounded border border-border bg-input px-2 text-xs text-surface outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-50"
  >
    <option value="auto">{{ messages.previewSyncAuto }}</option>
    <option value="save">{{ messages.previewSyncSave }}</option>
    <option value="manual">{{ messages.previewSyncManual }}</option>
    <option value="realtime">{{ messages.previewSyncRealtime }}</option>
  </select>
</template>
