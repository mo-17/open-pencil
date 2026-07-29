<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '@open-pencil/vue'

import type {
  MotionPresetStaggerDirection,
  MotionPresetStaggerRhythm
} from '@/app/motion-presets/types'
import NumberField from '@/components/inputs/NumberField.vue'
import AppSelect from '@/components/ui/AppSelect.vue'

const {
  selectionCount,
  enabled = false,
  stepMs = 80,
  direction = 'forward',
  rhythm = 'linear',
  disabled = false
} = defineProps<{
  selectionCount: number
  enabled?: boolean
  stepMs?: number
  direction?: MotionPresetStaggerDirection
  rhythm?: MotionPresetStaggerRhythm
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:enabled': [enabled: boolean]
  'update:step-ms': [stepMs: number]
  'update:direction': [direction: MotionPresetStaggerDirection]
  'update:rhythm': [rhythm: MotionPresetStaggerRhythm]
}>()

const { panels } = useI18n()
const directionOptions = computed<Array<{ value: MotionPresetStaggerDirection; label: string }>>(
  () => [
    { value: 'forward', label: panels.value.motionPresetStaggerDirectionForward },
    { value: 'reverse', label: panels.value.motionPresetStaggerDirectionReverse }
  ]
)
const rhythmOptions = computed<Array<{ value: MotionPresetStaggerRhythm; label: string }>>(() => [
  { value: 'linear', label: panels.value.motionPresetStaggerRhythmLinear },
  { value: 'ease-in', label: panels.value.motionPresetStaggerRhythmEaseIn },
  { value: 'ease-out', label: panels.value.motionPresetStaggerRhythmEaseOut },
  { value: 'ease-in-out', label: panels.value.motionPresetStaggerRhythmEaseInOut }
])
</script>

<template>
  <fieldset v-if="selectionCount > 1" class="mt-2 border-t border-border pt-2">
    <label class="flex items-center gap-2 text-[11px] text-surface">
      <input
        type="checkbox"
        :checked="enabled"
        :disabled="disabled"
        data-test-id="motion-stagger-enabled"
        @change="emit('update:enabled', ($event.target as HTMLInputElement).checked)"
      />
      {{ panels.motionPresetStaggerLayers({ count: String(selectionCount) }) }}
    </label>
    <div v-if="enabled" class="mt-1.5 grid grid-cols-2 gap-1.5">
      <NumberField
        :model-value="stepMs"
        :min="0"
        :max="60_000"
        :step="10"
        :disabled="disabled"
        suffix="ms"
        :aria-label="panels.motionPresetStaggerStep"
        data-test-id="motion-stagger-step"
        @commit="emit('update:step-ms', $event)"
      />
      <AppSelect
        :model-value="direction"
        :label="panels.motionPresetStaggerDirection"
        :options="directionOptions"
        :disabled="disabled"
        data-test-id="motion-stagger-direction"
        @update:model-value="emit('update:direction', $event)"
      />
      <AppSelect
        :model-value="rhythm"
        :label="panels.motionPresetStaggerRhythm"
        :options="rhythmOptions"
        :disabled="disabled"
        class="col-span-2"
        data-test-id="motion-stagger-rhythm"
        @update:model-value="emit('update:rhythm', $event)"
      />
    </div>
  </fieldset>
</template>
