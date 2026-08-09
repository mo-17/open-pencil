<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '@open-pencil/vue'

import type { StorageDocument } from '@/app/integrations/storage'
import type { LocalSyncStatus } from '@/app/storage/local-store'

const {
  document,
  syncStatus,
  progress = null,
  preservedCopy = false,
  busy = false,
  disabled = false
} = defineProps<{
  document: StorageDocument
  syncStatus: LocalSyncStatus
  progress?: number | null
  preservedCopy?: boolean
  busy?: boolean
  disabled?: boolean
}>()
defineEmits<{ open: []; delete: [] }>()
const { dialogs } = useI18n()
const boundedProgress = computed(() =>
  progress == null ? null : Math.min(1, Math.max(0, progress))
)
const progressPercent = computed(() =>
  boundedProgress.value == null ? null : Math.round(boundedProgress.value * 100)
)

const statusLabel = computed(() => {
  if (progressPercent.value != null) {
    return dialogs.value.storageUploadingPercent({ percent: progressPercent.value })
  }
  if (syncStatus === 'pending') return dialogs.value.storageStatusPending
  if (syncStatus === 'error') return dialogs.value.storageStatusError
  if (syncStatus === 'conflict') return dialogs.value.storageStatusConflict
  return dialogs.value.storageStatusSynced
})
const accessibleLabel = computed(() =>
  [document.name, preservedCopy ? dialogs.value.storageStatusConflict : null, statusLabel.value]
    .filter(Boolean)
    .join('. ')
)
const deleteLabel = computed(() =>
  dialogs.value.storageDeleteDocumentButton({ name: document.name })
)
</script>

<template>
  <article
    class="group relative overflow-hidden rounded-xl border border-border bg-panel transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-panel-focus hover:bg-hover data-[status=conflict]:border-warning/50 data-[status=error]:border-danger/40"
    :data-status="syncStatus"
    :data-preserved-copy="preservedCopy || undefined"
    :aria-busy="busy"
    :aria-disabled="disabled"
  >
    <button
      type="button"
      class="block w-full text-left disabled:cursor-not-allowed disabled:opacity-60"
      :data-document-id="document.id"
      :aria-label="accessibleLabel"
      :disabled="busy || disabled"
      @click="$emit('open')"
    >
      <div
        class="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-panel-field"
      >
        <div class="absolute inset-0 bg-gradient-to-br from-accent/5 via-transparent to-hover/70" />
        <span
          v-if="preservedCopy"
          class="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full border border-warning/30 bg-app/85 px-1.5 py-0.5 text-[8px] font-medium text-warning backdrop-blur"
        >
          <icon-lucide-copy-check class="size-2.5" />
          {{ dialogs.storageStatusConflict }}
        </span>
        <div
          class="relative flex size-11 items-center justify-center rounded-xl border border-border/70 bg-panel/90 text-muted shadow-sm transition-colors group-hover:text-surface"
        >
          <icon-lucide-file-pen-line class="size-5" />
        </div>
        <span
          class="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full border border-border/60 bg-app/85 px-1.5 py-0.5 text-[8px] font-medium text-muted backdrop-blur data-[status=synced]:text-success data-[status=conflict]:text-warning data-[status=error]:text-danger"
          :data-status="syncStatus"
        >
          <icon-lucide-loader-circle v-if="boundedProgress != null" class="size-2.5 animate-spin" />
          <icon-lucide-circle-check v-else-if="syncStatus === 'synced'" class="size-2.5" />
          <icon-lucide-triangle-alert
            v-else-if="syncStatus === 'conflict' || syncStatus === 'error'"
            class="size-2.5"
          />
          <icon-lucide-clock-3 v-else class="size-2.5" />
          {{ statusLabel }}
        </span>
        <div
          v-if="boundedProgress != null"
          class="absolute inset-x-0 bottom-0 h-0.5 bg-border/50"
          aria-hidden="true"
        >
          <div
            class="h-full bg-accent transition-[width] duration-150"
            :style="{ width: `${progressPercent}%` }"
          />
        </div>
      </div>
      <div class="border-t border-border p-3 pr-10">
        <p class="truncate text-xs font-medium text-surface">{{ document.name }}</p>
        <p class="mt-1 text-[9px] text-muted">
          {{ new Date(document.updatedAt).toLocaleString() }}
        </p>
      </div>
    </button>
    <button
      type="button"
      class="absolute bottom-2 right-2 flex size-7 items-center justify-center rounded-md text-muted opacity-70 transition-colors hover:bg-danger/10 hover:text-danger focus-visible:bg-danger/10 focus-visible:text-danger focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-danger disabled:cursor-wait disabled:opacity-40"
      :aria-label="deleteLabel"
      :disabled="busy || disabled"
      data-test-id="storage-delete-document"
      @click="$emit('delete')"
    >
      <icon-lucide-trash-2 class="size-3.5" />
    </button>
  </article>
</template>
