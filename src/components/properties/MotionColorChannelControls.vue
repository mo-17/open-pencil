<script setup lang="ts">
import { MOTION_LIMITS, type MotionColor } from '@open-pencil/scene-graph'
import { useI18n } from '@open-pencil/vue'

import type { MotionColorComponent } from '@/app/properties/motion/v2'
import NumberField from '@/components/inputs/NumberField.vue'
import Tip from '@/components/ui/Tip.vue'

const { label, color, propertyPrefix, disabled, disabledReason } = defineProps<{
  label: string
  color: MotionColor | undefined
  propertyPrefix: string
  disabled?: boolean
  disabledReason?: string
}>()

const emit = defineEmits<{
  toggle: [enabled: boolean]
  update: [component: MotionColorComponent, value: number]
}>()

const { panels } = useI18n()
const components: readonly MotionColorComponent[] = ['r', 'g', 'b', 'a']

function componentLabel(component: MotionColorComponent): string {
  if (component === 'r') return panels.value.motionColorRed
  if (component === 'g') return panels.value.motionColorGreen
  if (component === 'b') return panels.value.motionColorBlue
  return panels.value.motionColorAlpha
}

function onToggle(event: Event): void {
  emit('toggle', (event.target as HTMLInputElement).checked)
}
</script>

<template>
  <Tip :label="disabledReason">
    <div
      class="space-y-1.5"
      :class="{ 'cursor-not-allowed opacity-50': disabled }"
      :data-test-id="propertyPrefix"
      :data-capability-disabled="disabled || undefined"
    >
      <label class="flex h-6 items-center gap-1.5 text-[10px] text-surface">
        <input
          type="checkbox"
          class="size-3 accent-accent"
          :checked="color !== undefined"
          :disabled="disabled && color === undefined"
          :aria-label="label"
          :aria-description="disabledReason || undefined"
          @change="onToggle"
          @keydown.stop
        />
        {{ label }}
      </label>
      <div v-if="color" class="grid grid-cols-2 gap-1.5 pl-[18px]">
        <NumberField
          v-for="component in components"
          :key="component"
          :model-value="color[component]"
          :label="componentLabel(component)"
          :min="MOTION_LIMITS.normalized.min"
          :max="MOTION_LIMITS.normalized.max"
          :step="0.01"
          :disabled="disabled"
          :data-property="`${propertyPrefix}-${component}`"
          @commit="emit('update', component, $event)"
        />
      </div>
    </div>
  </Tip>
</template>
