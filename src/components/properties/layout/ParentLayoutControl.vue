<script setup lang="ts">
import { isAutoLayoutMode } from '@open-pencil/scene-graph'
import { useLayoutControlsContext, usePanelMessages, useSceneComputed } from '@open-pencil/vue'

import AppButton from '@/components/ui/button/AppButton.vue'

const ctx = useLayoutControlsContext()
const panels = usePanelMessages()
const parent = useSceneComputed(() => {
  const parentId = ctx.node?.parentId
  const node = parentId ? ctx.editor.getNode(parentId) : null
  return node && isAutoLayoutMode(node.layoutMode) ? node : null
})

function selectParent() {
  if (parent.value) ctx.editor.select([parent.value.id])
}
</script>

<template>
  <div v-if="parent" class="mt-2 rounded bg-panel-field p-2 text-[11px]">
    <p class="text-muted">{{ panels.parentAutoLayoutHint }}</p>
    <AppButton size="xs" class="mt-1" @click="selectParent">
      <template #leading><icon-lucide-corner-left-up class="size-3.5" /></template>
      {{ panels.selectLayoutParent }}
    </AppButton>
  </div>
</template>
