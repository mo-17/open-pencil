<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'

import { useI18n } from '@open-pencil/vue'

import type { MotionPresetLibraryItem } from '@/app/motion-presets/types'
import Tip from '@/components/ui/Tip.vue'

const {
  item,
  favorite,
  displayName,
  triggerLabel,
  selected = false,
  disabled = false,
  authoringDisabled = false,
  canUpdateCurrent = false
} = defineProps<{
  item: MotionPresetLibraryItem
  favorite: boolean
  displayName: string
  triggerLabel: string
  selected?: boolean
  disabled?: boolean
  authoringDisabled?: boolean
  canUpdateCurrent?: boolean
}>()

const { panels } = useI18n()

const emit = defineEmits<{
  apply: [item: MotionPresetLibraryItem]
  'toggle-favorite': [item: MotionPresetLibraryItem]
  'preview-start': [item: MotionPresetLibraryItem]
  'preview-stop': [item: MotionPresetLibraryItem]
  edit: [item: MotionPresetLibraryItem]
  'update-current': [item: MotionPresetLibraryItem]
  delete: [item: MotionPresetLibraryItem]
}>()

const hovered = ref(false)
const focused = ref(false)
const previewing = ref(false)

function startPreview(): void {
  if (disabled || authoringDisabled || previewing.value) return
  previewing.value = true
  emit('preview-start', item)
}

function stopPreview(): void {
  if (!previewing.value) return
  previewing.value = false
  emit('preview-stop', item)
}

function stopPreviewWhenInactive(): void {
  if (!hovered.value && !focused.value) stopPreview()
}

function onPointerEnter(): void {
  hovered.value = true
  startPreview()
}

function onPointerLeave(): void {
  hovered.value = false
  stopPreviewWhenInactive()
}

function onFocusIn(): void {
  focused.value = true
  startPreview()
}

function onFocusOut(event: FocusEvent): void {
  const current = event.currentTarget
  const related = event.relatedTarget
  if (current instanceof HTMLElement && related instanceof Node && current.contains(related)) return
  focused.value = false
  stopPreviewWhenInactive()
}

function onEscape(): void {
  hovered.value = false
  focused.value = false
  stopPreview()
}

onBeforeUnmount(stopPreview)
</script>

<template>
  <article
    :data-test-id="`motion-preset-card-${item.key}`"
    class="group relative min-w-0 rounded border p-2 transition-colors"
    :class="[
      selected
        ? 'border-accent bg-accent/10'
        : 'border-border bg-input hover:border-accent/50 hover:bg-hover',
      disabled || authoringDisabled ? 'opacity-50' : ''
    ]"
    @pointerenter="onPointerEnter"
    @pointerleave="onPointerLeave"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
    @keydown.esc.stop="onEscape"
  >
    <div class="flex min-w-0 items-start gap-1">
      <button
        type="button"
        class="min-w-0 flex-1 rounded text-left outline-none focus-visible:ring-1 focus-visible:ring-accent"
        :aria-label="panels.motionPresetApplyNamed({ name: displayName })"
        :aria-pressed="selected"
        :data-test-id="`motion-preset-apply-${item.key}`"
        :disabled="disabled || authoringDisabled"
        @click="emit('apply', item)"
        @keydown.enter.space.prevent.stop="emit('apply', item)"
      >
        <span class="block truncate text-[11px] font-medium text-surface">{{ displayName }}</span>
        <span class="mt-0.5 block truncate text-[10px] text-muted">
          {{ triggerLabel
          }}<template v-if="item.durationMs !== undefined"> · {{ item.durationMs }}ms</template>
        </span>
      </button>

      <Tip
        v-if="item.source !== 'shared'"
        :label="
          favorite
            ? panels.motionPresetRemoveFavoriteNamed({ name: displayName })
            : panels.motionPresetAddFavoriteNamed({ name: displayName })
        "
      >
        <button
          type="button"
          class="flex size-5 shrink-0 items-center justify-center rounded text-muted outline-none hover:bg-panel hover:text-surface focus-visible:ring-1 focus-visible:ring-accent"
          :class="favorite ? 'text-accent' : ''"
          :aria-label="
            favorite
              ? panels.motionPresetUnfavoriteNamed({ name: displayName })
              : panels.motionPresetFavoriteNamed({ name: displayName })
          "
          :aria-pressed="favorite"
          :data-test-id="`motion-preset-favorite-${item.key}`"
          :disabled="disabled"
          @click="emit('toggle-favorite', item)"
        >
          <icon-lucide-star class="size-3" :class="favorite ? 'fill-current' : ''" />
        </button>
      </Tip>
    </div>

    <p v-if="item.description" class="mt-1 line-clamp-2 text-[10px] leading-3.5 text-muted">
      {{ item.description }}
    </p>

    <div v-if="item.source === 'shared'" class="mt-1 space-y-0.5 text-[9px] leading-3 text-muted">
      <Tip :label="item.publisherName">
        <p class="truncate">{{ item.libraryName }} · {{ item.publisherName }}</p>
      </Tip>
      <Tip :label="item.sourceRef">
        <p class="truncate">
          {{ item.sourceKind }} · {{ item.sourceVersion }}
          <span v-if="item.updateAvailable" class="text-warning">
            → {{ item.observedVersion }}
          </span>
        </p>
      </Tip>
      <p v-if="item.readonly" class="text-muted">{{ panels.motionPresetSharedReadonly }}</p>
    </div>

    <div
      v-if="item.source === 'user'"
      class="mt-1.5 grid grid-cols-2 gap-1 border-t border-border pt-1.5"
    >
      <button
        type="button"
        class="col-span-2 rounded px-1.5 py-0.5 text-[10px] text-muted outline-none hover:bg-panel hover:text-surface focus-visible:ring-1 focus-visible:ring-accent"
        :data-test-id="`motion-preset-update-current-${item.key.slice('user:'.length)}`"
        :disabled="disabled || authoringDisabled || !canUpdateCurrent"
        @click="emit('update-current', item)"
      >
        {{ panels.motionPresetUpdateCurrent }}
      </button>
      <button
        type="button"
        class="rounded px-1.5 py-0.5 text-[10px] text-muted outline-none hover:bg-panel hover:text-surface focus-visible:ring-1 focus-visible:ring-accent"
        :data-test-id="`motion-preset-rename-${item.key.slice('user:'.length)}`"
        :disabled="disabled"
        @click="emit('edit', item)"
      >
        {{ panels.motionPresetEdit }}
      </button>
      <button
        type="button"
        class="rounded px-1.5 py-0.5 text-[10px] text-muted outline-none hover:bg-danger/10 hover:text-danger focus-visible:ring-1 focus-visible:ring-danger"
        :data-test-id="`motion-preset-delete-${item.key.slice('user:'.length)}`"
        :disabled="disabled"
        @click="emit('delete', item)"
      >
        {{ panels.motionPresetDelete }}
      </button>
    </div>
  </article>
</template>
