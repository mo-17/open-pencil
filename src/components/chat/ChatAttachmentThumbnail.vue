<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from '@open-pencil/vue'

import Tip from '@/components/ui/Tip.vue'

const { dialogs } = useI18n()

const {
  url,
  name,
  mediaType,
  sizeBytes,
  width,
  height,
  removable = false,
  compact = false,
  removeLabel
} = defineProps<{
  url: string
  name: string
  mediaType: string
  sizeBytes?: number
  width?: number
  height?: number
  removable?: boolean
  compact?: boolean
  removeLabel?: string
}>()

const emit = defineEmits<{ remove: [] }>()
const imageFailed = ref(false)

watch(
  () => url,
  () => {
    imageFailed.value = false
  }
)

const canPreview = computed(() => mediaType.startsWith('image/') && !imageFailed.value)
const detail = computed(() => {
  const parts: string[] = []
  if (width && height) parts.push(`${width}×${height}`)
  if (sizeBytes !== undefined) parts.push(formatBytes(sizeBytes))
  return parts.join(' · ')
})
const accessibleName = computed(() => name || dialogs.value.imageAttachment)

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
</script>

<template>
  <div
    data-test-id="chat-visual-attachment"
    role="group"
    :aria-label="accessibleName"
    class="relative overflow-hidden rounded-lg border border-border bg-panel-field"
    :class="compact ? 'w-44' : 'flex min-w-0 items-center gap-2 p-1.5 pr-8'"
  >
    <div
      class="flex shrink-0 items-center justify-center overflow-hidden rounded bg-canvas text-muted"
      :class="compact ? 'h-28 w-full rounded-b-none' : 'size-10'"
    >
      <img
        v-if="canPreview"
        :src="url"
        :alt="accessibleName"
        class="size-full object-contain"
        loading="lazy"
        referrerpolicy="no-referrer"
        @error="imageFailed = true"
      />
      <icon-lucide-file-image v-else class="size-4" aria-hidden="true" />
    </div>

    <div class="min-w-0" :class="compact ? 'border-t border-border px-2 py-1.5' : 'flex-1'">
      <Tip :label="accessibleName" side="top">
        <p class="truncate text-[10px] font-medium text-surface">
          {{ accessibleName }}
        </p>
      </Tip>
      <p v-if="detail" class="truncate text-[9px] text-muted">{{ detail }}</p>
    </div>

    <button
      v-if="removable"
      type="button"
      data-test-id="chat-attachment-remove"
      :aria-label="removeLabel || dialogs.removeImageReference({ name: accessibleName })"
      class="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded text-muted hover:bg-hover hover:text-surface focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none"
      @click="emit('remove')"
    >
      <icon-lucide-x class="size-3" aria-hidden="true" />
    </button>
  </div>
</template>
