<script setup lang="ts">
import { computed } from 'vue'

import type { LayoutMode } from '@open-pencil/scene-graph'
import { useI18n, useLayoutControlsContext } from '@open-pencil/vue'

import IconButton from '@/components/ui/button/IconButton.vue'
import SegmentedControl from '@/components/ui/select/SegmentedControl.vue'

const ctx = useLayoutControlsContext()
const { panels } = useI18n()
const flowMode = computed(() => (ctx.node.layoutMode === 'FREE' ? 'NONE' : ctx.node.layoutMode))

const layoutModes = computed<Array<{ value: LayoutMode; label: string }>>(() => [
  { value: 'NONE', label: panels.value.freeform },
  { value: 'VERTICAL', label: panels.value.layoutVertical },
  { value: 'HORIZONTAL', label: panels.value.layoutHorizontal },
  { value: 'GRID', label: panels.value.layoutGrid }
])

function toggleWrap() {
  const node = ctx.node
  const enabling = node.layoutWrap !== 'WRAP'
  ctx.editor.updateNodeWithUndo(
    node.id,
    {
      layoutWrap: enabling ? 'WRAP' : 'NO_WRAP',
      primaryAxisAlign:
        enabling && node.primaryAxisAlign === 'SPACE_BETWEEN' ? 'MIN' : node.primaryAxisAlign
    },
    'Toggle layout wrap'
  )
}

function setLayoutMode(mode: string) {
  ctx.editor.setLayoutMode(ctx.node.id, mode as LayoutMode)
}
</script>

<template>
  <div>
    <div class="mb-1 flex items-center justify-between gap-2">
      <span class="text-[11px] text-muted">{{ panels.flow }}</span>
      <IconButton
        v-if="ctx.isFlex"
        :label="panels.layoutWrap"
        size="xs"
        :active="ctx.node.layoutWrap === 'WRAP'"
        @click="toggleWrap"
      >
        <icon-lucide-wrap-text class="size-3.5" />
      </IconButton>
    </div>
    <SegmentedControl
      :model-value="flowMode"
      :options="layoutModes"
      :label="panels.flow"
      orientation="vertical"
      :ui="{
        root: 'flex w-full min-w-0 flex-col items-stretch',
        item: 'h-auto min-w-0 justify-start py-1.5'
      }"
      @change="setLayoutMode"
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
