<script setup lang="ts">
import { computed, ref } from 'vue'

import type { ShaderFrameStatus } from '@open-pencil/core/editor'
import { readShaderPaints } from '@open-pencil/scene-graph'
import { useEditorEvent, useI18n } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import AppBadge from '@/components/ui/feedback/AppBadge.vue'

type PreviewPhase =
  | 'starting'
  | 'playing'
  | 'offscreen'
  | 'limited'
  | 'saved'
  | 'missing'
  | 'unsupported'

const store = useEditorStore()
const { panels } = useI18n()
const revision = ref(0)
useEditorEvent('shader:status-changed', () => revision.value++)
const labels = computed(() => ({
  starting: panels.value.shaderPlaybackStarting,
  playing: panels.value.shaderPlaybackPlaying,
  offscreen: panels.value.shaderPlaybackOffscreen,
  limited: panels.value.shaderPlaybackLimited,
  saved: panels.value.shaderFrameSaved,
  missing: panels.value.shaderFrameMissing,
  unsupported: panels.value.shaderFrameUnsupported
}))
function previewPhase(status: ShaderFrameStatus): PreviewPhase {
  if (status.playback) return status.playback
  if (status.phase === 'unsupported') return 'unsupported'
  return status.hasSavedFrame ? 'saved' : 'missing'
}
const counts = computed(() => {
  void revision.value
  void store.state.sceneVersion
  const totals = new Map<PreviewPhase, number>()
  for (const node of store.graph.getAllNodes()) {
    if (!store.graph.isDescendant(node.id, store.state.currentPageId)) continue
    for (const shader of readShaderPaints(node)) {
      const status = store.getShaderFrameStatus(node.id, shader.image)
      if (!status) continue
      const phase = previewPhase(status)
      totals.set(phase, (totals.get(phase) ?? 0) + 1)
    }
  }
  return [...totals].map(([phase, count]) => ({ phase, count, label: labels.value[phase] }))
})
</script>

<template>
  <div
    v-if="counts.length"
    role="status"
    class="pointer-events-none absolute bottom-7 left-7 z-10 flex max-w-[min(32rem,80%)] flex-wrap gap-1"
    data-property="shader-preview-status"
  >
    <AppBadge
      v-for="item in counts"
      :key="item.phase"
      :data-playback="item.phase"
      :tone="['limited', 'missing', 'unsupported'].includes(item.phase) ? 'warning' : 'neutral'"
      :ui="{ base: 'px-2 py-1 text-[10px] leading-normal' }"
    >
      {{ panels.shader }} · {{ item.label }} · {{ item.count }}
    </AppBadge>
  </div>
</template>
