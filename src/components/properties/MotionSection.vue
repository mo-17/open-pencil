<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'

import {
  isMotionPresetId,
  MOTION_LIMITS,
  MOTION_PRESET_IDS,
  MOTION_PRESET_REGISTRY,
  type MotionPresetId,
  type MotionTrigger
} from '@open-pencil/scene-graph'
import { useI18n, useSceneComputed, useSelectionState } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import {
  applyMotionPreset,
  clearSelectedMotion,
  MOTION_MIXED,
  readMotionSelection,
  setMotionPresetParameter,
  setMotionReducedMotion,
  setMotionTiming,
  setMotionTrigger,
  type MotionReducedMotionChoice,
  type MotionSharedValue
} from '@/app/properties/motion'
import NumberField from '@/components/inputs/NumberField.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import PanelFieldGroup from '@/components/ui/panel/PanelFieldGroup.vue'
import PanelGrid from '@/components/ui/panel/PanelGrid.vue'
import PanelSection from '@/components/ui/panel/PanelSection.vue'

type TriggerSelectValue = MotionTrigger | 'MIXED'
type ReducedMotionSelectValue = MotionReducedMotionChoice | 'MIXED'

const store = useEditorStore()
const { selectedIds } = useSelectionState()
const { panels } = useI18n()
const previewActive = computed(() => store.isMotionPreviewActive())

const selectedIdList = computed(() => [...selectedIds.value])
const selectedKey = computed(() => selectedIdList.value.join('\0'))
const selectedNodes = useSceneComputed(() =>
  selectedIdList.value.flatMap((id) => {
    const node = store.graph.getNode(id)
    return node ? [node] : []
  })
)
const selection = computed(() => readMotionSelection(selectedNodes.value))

const presetLabels = computed<Record<MotionPresetId, string>>(() => ({
  'fade-in': panels.value.motionPresetFadeIn,
  'slide-up': panels.value.motionPresetSlideUp,
  'scale-in': panels.value.motionPresetScaleIn,
  'bounce-in': panels.value.motionPresetBounceIn,
  'hover-lift': panels.value.motionPresetHoverLift,
  press: panels.value.motionPresetPress,
  pulse: panels.value.motionPresetPulse,
  float: panels.value.motionPresetFloat
}))

const commonPresetId = computed<MotionPresetId | undefined>(() => {
  const presetId = selection.value.presetId
  return isMotionPresetId(presetId) ? presetId : undefined
})
const commonPresetDefinition = computed(() =>
  commonPresetId.value ? MOTION_PRESET_REGISTRY[commonPresetId.value] : undefined
)
const distanceRule = computed(() => commonPresetDefinition.value?.parameters.distance)
const intensityRule = computed(() => commonPresetDefinition.value?.parameters.intensity)

const statusText = computed(() => {
  if (!selection.value.hasMotion) return panels.value.motionNoneHint
  if (selection.value.mixed) return panels.value.motionMixed
  if (selection.value.presetId === MOTION_MIXED) return panels.value.motionMixed
  if (selection.value.presetId === 'custom') return panels.value.motionCustom
  return ''
})

const triggerOptions = computed<Array<{ value: TriggerSelectValue; label: string }>>(() => {
  const options: Array<{ value: MotionTrigger; label: string }> = [
    { value: 'mount', label: panels.value.motionTriggerMount },
    { value: 'hover', label: panels.value.motionTriggerHover },
    { value: 'press', label: panels.value.motionTriggerPress },
    { value: 'focus', label: panels.value.motionTriggerFocus },
    { value: 'click', label: panels.value.motionTriggerClick },
    { value: 'inView', label: panels.value.motionTriggerInView },
    { value: 'loop', label: panels.value.motionTriggerLoop }
  ]
  return selection.value.trigger === MOTION_MIXED || selection.value.trigger === undefined
    ? [{ value: 'MIXED', label: panels.value.mixed }, ...options]
    : options
})

const triggerValue = computed<TriggerSelectValue>(() => {
  const value = selection.value.trigger
  return value === MOTION_MIXED || value === undefined ? 'MIXED' : value
})

const reducedMotionOptions = computed<Array<{ value: ReducedMotionSelectValue; label: string }>>(
  () => {
    const options: Array<{ value: MotionReducedMotionChoice; label: string }> = [
      { value: 'default', label: panels.value.motionReducedDefault },
      { value: 'reduce', label: panels.value.motionReducedReduce },
      { value: 'disable', label: panels.value.motionReducedDisable },
      { value: 'allow', label: panels.value.motionReducedAllow }
    ]
    return selection.value.reducedMotion === MOTION_MIXED ||
      selection.value.reducedMotion === undefined
      ? [{ value: 'MIXED', label: panels.value.mixed }, ...options]
      : options
  }
)

const reducedMotionValue = computed<ReducedMotionSelectValue>(() => {
  const value = selection.value.reducedMotion
  return value === MOTION_MIXED || value === undefined ? 'MIXED' : value
})

const previewAvailable = computed(
  () => typeof store.previewMotion === 'function' && typeof store.stopMotionPreview === 'function'
)
const previewTrigger = computed(() => {
  const trigger = selection.value.trigger
  return trigger === MOTION_MIXED ? undefined : trigger
})
const canPreview = computed(
  () =>
    previewAvailable.value && selection.value.allHaveMotion && previewTrigger.value !== undefined
)

function numberValue(value: MotionSharedValue<number>): number | symbol {
  return typeof value === 'number' ? value : MOTION_MIXED
}

function stopPreview() {
  store.stopMotionPreview()
}

function previewSelection() {
  if (!canPreview.value || previewTrigger.value === undefined) return
  store.previewMotion(selectedIdList.value, previewTrigger.value)
}

function applyPreset(presetId: MotionPresetId) {
  stopPreview()
  applyMotionPreset(store, selectedIdList.value, presetId, panels.value.motionApplyPreset)
}

function clearMotion() {
  stopPreview()
  clearSelectedMotion(store, selectedIdList.value, panels.value.motionClear)
}

function updateTrigger(value: TriggerSelectValue) {
  if (value === 'MIXED') return
  stopPreview()
  setMotionTrigger(store, selectedIdList.value, value, panels.value.motionUpdate)
}

function updateReducedMotion(value: ReducedMotionSelectValue) {
  if (value === 'MIXED') return
  stopPreview()
  setMotionReducedMotion(store, selectedIdList.value, value, panels.value.motionUpdate)
}

function updateTiming(field: 'durationMs' | 'delayMs', value: number) {
  stopPreview()
  setMotionTiming(store, selectedIdList.value, field, value, panels.value.motionUpdate)
}

function updateParameter(name: 'distance' | 'intensity', value: number) {
  stopPreview()
  setMotionPresetParameter(store, selectedIdList.value, name, value, panels.value.motionUpdate)
}

watch(selectedKey, stopPreview)
onBeforeUnmount(stopPreview)
</script>

<template>
  <div data-test-id="motion-panel">
    <PanelSection :label="panels.motion">
      <fieldset>
        <legend class="mb-1.5 text-[11px] text-muted">{{ panels.motionPresets }}</legend>
        <div class="grid grid-cols-2 gap-1.5">
          <button
            v-for="presetId in MOTION_PRESET_IDS"
            :key="presetId"
            type="button"
            :data-test-id="`motion-preset-${presetId}`"
            :aria-pressed="selection.presetId === presetId"
            class="h-8 min-w-0 truncate rounded border px-2 text-left text-[11px] transition-colors focus-visible:outline-2 focus-visible:outline-accent"
            :class="
              selection.presetId === presetId
                ? 'border-accent bg-accent/15 text-surface'
                : 'border-border bg-input text-muted hover:bg-hover hover:text-surface'
            "
            @click="applyPreset(presetId)"
            @keydown.stop
          >
            {{ presetLabels[presetId] }}
          </button>
        </div>
      </fieldset>

      <p
        v-if="statusText"
        data-test-id="motion-status"
        class="mt-2 text-[11px] leading-4 text-muted"
      >
        {{ statusText }}
      </p>

      <div v-if="selection.hasMotion" class="mt-3 space-y-2">
        <PanelFieldGroup :label="panels.motionTrigger">
          <AppSelect
            :model-value="triggerValue"
            :label="panels.motionTrigger"
            :options="triggerOptions"
            :disabled="!selection.allHaveMotion"
            class="w-full"
            data-test-id="motion-trigger"
            @update:model-value="updateTrigger"
          />
        </PanelFieldGroup>

        <PanelGrid :columns="2">
          <PanelFieldGroup :label="panels.motionDuration">
            <NumberField
              :model-value="numberValue(selection.durationMs)"
              :placeholder="panels.mixed"
              :aria-label="panels.motionDuration"
              :min="MOTION_LIMITS.durationMs.min"
              :max="MOTION_LIMITS.durationMs.max"
              :disabled="!selection.allHaveMotion"
              data-property="motion-duration"
              @commit="(value: number) => updateTiming('durationMs', value)"
            />
          </PanelFieldGroup>
          <PanelFieldGroup :label="panels.motionDelay">
            <NumberField
              :model-value="numberValue(selection.delayMs)"
              :placeholder="panels.mixed"
              :aria-label="panels.motionDelay"
              :min="MOTION_LIMITS.delayMs.min"
              :max="MOTION_LIMITS.delayMs.max"
              :disabled="!selection.allHaveMotion"
              data-property="motion-delay"
              @commit="(value: number) => updateTiming('delayMs', value)"
            />
          </PanelFieldGroup>
        </PanelGrid>

        <PanelFieldGroup :label="panels.motionReducedMotion">
          <AppSelect
            :model-value="reducedMotionValue"
            :label="panels.motionReducedMotion"
            :options="reducedMotionOptions"
            :disabled="!selection.allHaveMotion"
            class="w-full"
            data-test-id="motion-reduced-motion"
            @update:model-value="updateReducedMotion"
          />
        </PanelFieldGroup>

        <PanelGrid v-if="distanceRule || intensityRule" :columns="2">
          <PanelFieldGroup v-if="distanceRule" :label="panels.motionDistance">
            <NumberField
              :model-value="numberValue(selection.distance)"
              :placeholder="panels.mixed"
              :aria-label="panels.motionDistance"
              :min="distanceRule.min"
              :max="distanceRule.max"
              :disabled="!selection.allHaveMotion"
              data-property="motion-distance"
              @commit="(value: number) => updateParameter('distance', value)"
            />
          </PanelFieldGroup>
          <PanelFieldGroup v-if="intensityRule" :label="panels.motionIntensity">
            <NumberField
              :model-value="numberValue(selection.intensity)"
              :placeholder="panels.mixed"
              :aria-label="panels.motionIntensity"
              :min="intensityRule.min"
              :max="intensityRule.max"
              :step="0.1"
              :disabled="!selection.allHaveMotion"
              data-property="motion-intensity"
              @commit="(value: number) => updateParameter('intensity', value)"
            />
          </PanelFieldGroup>
        </PanelGrid>

        <div class="flex gap-1.5 pt-1">
          <button
            v-if="!previewActive"
            type="button"
            data-test-id="motion-preview"
            class="h-7 flex-1 rounded border border-border bg-input px-2 text-[11px] text-surface hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="!canPreview"
            @click="previewSelection"
            @keydown.stop
          >
            {{ panels.motionPreview }}
          </button>
          <button
            v-else
            type="button"
            data-test-id="motion-stop-preview"
            class="h-7 flex-1 rounded border border-accent bg-accent/15 px-2 text-[11px] text-surface hover:bg-accent/25"
            @click="stopPreview"
            @keydown.stop
          >
            {{ panels.motionStopPreview }}
          </button>
          <button
            type="button"
            data-test-id="motion-clear"
            class="h-7 flex-1 rounded border border-border bg-input px-2 text-[11px] text-muted hover:bg-hover hover:text-surface"
            @click="clearMotion"
            @keydown.stop
          >
            {{ panels.motionClear }}
          </button>
        </div>
        <p v-if="!previewAvailable" class="text-[10px] leading-4 text-muted">
          {{ panels.motionPreviewUnavailable }}
        </p>
      </div>
    </PanelSection>
  </div>
</template>
