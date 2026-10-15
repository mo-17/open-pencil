<script setup lang="ts">
import { computed } from 'vue'
import type { VNode } from 'vue'

import type { LayoutMode } from '@open-pencil/scene-graph'
import { MIXED, useI18n, useSelectionLayout } from '@open-pencil/vue'

import SegmentedControl from '@/components/ui/select/SegmentedControl.vue'

defineSlots<{ default?(): VNode[] }>()

const layout = useSelectionLayout()
const { panels } = useI18n()

const layoutModes = computed<Array<{ value: LayoutMode; label: string }>>(() => [
  { value: 'NONE', label: panels.value.freeform },
  { value: 'VERTICAL', label: panels.value.layoutVertical },
  { value: 'HORIZONTAL', label: panels.value.layoutHorizontal },
  { value: 'GRID', label: panels.value.layoutGrid }
])

// Layers with different flows leave every option off.
const mode = computed(() => {
  const value = layout.layoutMode.value
  if (value === MIXED || value === undefined) return ''
  return value === 'FREE' ? 'NONE' : value
})
</script>

<template>
  <div>
    <div class="mb-1 flex items-center justify-between gap-2">
      <span class="text-[11px] text-muted">{{ panels.flow }}</span>
      <slot />
    </div>
    <SegmentedControl
      :model-value="mode"
      :options="layoutModes"
      :label="panels.flow"
      orientation="vertical"
      :ui="{
        root: 'flex w-full min-w-0 flex-col items-stretch',
        item: 'h-auto min-w-0 justify-start py-1.5'
      }"
      @change="layout.setLayoutMode($event as LayoutMode)"
    >
      <template #option="{ option }">
        <icon-lucide-move v-if="option.value === 'NONE'" class="size-3.5 shrink-0" />
        <icon-lucide-rows-2 v-else-if="option.value === 'VERTICAL'" class="size-3.5 shrink-0" />
        <icon-lucide-columns-2
          v-else-if="option.value === 'HORIZONTAL'"
          class="size-3.5 shrink-0"
        />
        <icon-lucide-layout-grid v-else class="size-3.5 shrink-0" />
        <span class="min-w-0 text-left">{{ option.label }}</span>
      </template>
    </SegmentedControl>
  </div>
</template>
