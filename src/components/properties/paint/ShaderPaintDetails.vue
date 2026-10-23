<script setup lang="ts">
import { computed, ref } from 'vue'

import type { ShaderFrameStatus, ShaderPaintList } from '@open-pencil/core/editor'
import {
  readShaderPaints,
  type SceneNode,
  type ShaderPaint,
  type ShaderPreset
} from '@open-pencil/scene-graph'
import {
  CONTENT_SHADER_FILTERS,
  contentShaderFilter,
  contentShaderPreset,
  setShaderEffectProp,
  useEditorEvent,
  useI18n
} from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import { shaderPresetCopy } from '@/app/editor/shaders/preset-copy'
import NumberField from '@/components/inputs/NumberField.vue'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import PanelFieldGroup from '@/components/ui/panel/PanelFieldGroup.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'

import ShaderPresetLibrary from './ShaderPresetLibrary.vue'

const {
  node,
  shader,
  list,
  index,
  selectedNodeIds = []
} = defineProps<{
  node: SceneNode | null
  shader: ShaderPaint | null
  list: ShaderPaintList
  index: number
  selectedNodeIds?: readonly string[]
}>()
const store = useEditorStore()
const { panels, locale } = useI18n()
const copy = computed(() => shaderPresetCopy(locale.value))
const targets = computed(() => {
  if (selectedNodeIds.length > 0) return selectedNodeIds
  return node ? [node.id] : []
})
const batch = computed(() => targets.value.length > 1)
const compatible = computed(() => {
  void store.state.sceneVersion
  return (
    !batch.value ||
    (store.canSetContentShader(targets.value) &&
      targets.value.every((id) => {
        const node = store.graph.getNode(id)
        return node && readShaderPaints(node).some((paint) => paint.input)
      }))
  )
})
const revision = ref(0)
useEditorEvent('shader:status-changed', (id) => {
  if (id === null || id === node?.id) revision.value++
})
const status = computed(() => {
  void revision.value
  void store.state.sceneVersion
  return node && shader ? store.getShaderFrameStatus(node.id, shader.image) : null
})
const headings = computed(() => ({
  queued: panels.value.shaderFrameQueued,
  rendering: panels.value.shaderFrameRendering,
  ready: panels.value.shaderFrameReady,
  saved: panels.value.shaderFrameSaved,
  missing: panels.value.shaderFrameMissing,
  unsupported: panels.value.shaderFrameUnsupported
}))
const reasons = computed(() => ({
  unavailable: panels.value.shaderFrameUnavailable,
  failed: panels.value.shaderFrameFailed,
  timeout: panels.value.shaderFrameTimeout,
  stale: panels.value.shaderFrameStale
}))
const playbackHeadings = computed(() => ({
  starting: panels.value.shaderPlaybackStarting,
  playing: panels.value.shaderPlaybackPlaying,
  offscreen: panels.value.shaderPlaybackOffscreen,
  limited: panels.value.shaderPlaybackLimited
}))
const heading = computed(() => {
  const state = status.value
  if (!state) return ''
  return state.playback ? playbackHeadings.value[state.playback] : headings.value[state.phase]
})
const tone = computed(() => {
  if (status.value?.playback) return status.value.playback === 'limited' ? 'warning' : 'info'
  const phase = status.value?.phase
  return phase === 'missing' || phase === 'saved' || phase === 'unsupported' ? 'warning' : 'info'
})
const filter = computed(() => shader && contentShaderFilter(shader.preset))
const options = computed(() => [
  { value: 'custom', label: panels.value.shaderCustomPreset, disabled: true },
  ...CONTENT_SHADER_FILTERS.map((item) => ({ value: item.type, label: labels.value[item.type] }))
])
const labels = computed(() => ({
  Pixelate: panels.value.shaderPixelate,
  Twirl: panels.value.shaderTwirl,
  Saturation: panels.value.shaderSaturation
}))
const parameterLabel = computed(() =>
  filter.value?.type === 'Pixelate'
    ? panels.value.shaderPixelDensity
    : labels.value[filter.value?.type ?? 'Twirl']
)
const parameter = computed(() => {
  const value = filter.value && shader?.preset.components[0]?.props?.[filter.value.prop]
  return typeof value === 'number' ? value : 0
})
function apply(preset: ShaderPreset) {
  if (!node || !compatible.value) return
  if (batch.value && shader?.input) store.setContentShader(targets.value, preset)
  else store.setShaderPaint([node.id], list, index, preset)
}
function choose(type: string) {
  const selected = CONTENT_SHADER_FILTERS.find((filter) => filter.type === type)
  if (selected) apply(contentShaderPreset(selected))
}
function setParameter(value: number) {
  if (shader && filter.value) apply(setShaderEffectProp(shader.preset, 0, filter.value.prop, value))
}
function retry() {
  if (node && status.value?.canRetry) store.retryShaderFrames([node.id])
}
function description(state: ShaderFrameStatus) {
  if (state.playback) return panels.value.shaderPlaybackStaticExport
  return state.phase === 'unsupported'
    ? panels.value.shaderContentScope
    : state.reason && reasons.value[state.reason]
}
</script>

<template>
  <div
    v-if="shader && status"
    class="col-span-full flex flex-col gap-1.5"
    data-property="shader-details"
  >
    <template v-if="shader.input && status.phase !== 'unsupported'">
      <p v-if="batch" class="text-[10px] text-muted">{{ copy.batch(targets.length) }}</p>
      <AppAlert v-if="!compatible" tone="warning" :heading="copy.unsupported" />
      <PanelFieldGroup :label="panels.shaderContentFilter">
        <AppSelect
          :model-value="filter?.type ?? 'custom'"
          :options="options"
          :label="panels.shaderContentFilter"
          :disabled="!compatible"
          data-property="shader-content-filter"
          @update:model-value="choose"
        />
      </PanelFieldGroup>
      <PanelFieldGroup v-if="filter" :label="parameterLabel">
        <NumberField
          :model-value="parameter"
          :min="filter.min"
          :max="filter.max"
          :step="filter.step"
          :aria-label="parameterLabel"
          :disabled="!compatible"
          data-property="shader-content-parameter"
          @commit="setParameter"
        />
      </PanelFieldGroup>
      <AppButton
        v-if="filter"
        size="xs"
        :disabled="!compatible"
        data-property="shader-content-reset"
        @click="apply(contentShaderPreset(filter))"
      >
        {{ panels.shaderResetFilter }}
      </AppButton>
      <ShaderPresetLibrary :preset="shader.preset" :disabled="!compatible" @apply="apply" />
    </template>
    <AppAlert
      :tone="tone"
      :heading="heading"
      :description="description(status)"
      data-property="shader-status"
      :data-phase="status.phase"
      :data-playback="status.playback"
    >
      <template v-if="status.canRetry" #actions>
        <AppButton size="xs" data-property="shader-retry" @click="retry">{{
          panels.shaderRetryFrame
        }}</AppButton>
      </template>
    </AppAlert>
  </div>
</template>
