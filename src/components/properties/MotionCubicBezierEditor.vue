<script setup lang="ts">
import { MOTION_LIMITS, type MotionCubicBezierEasing } from '@open-pencil/scene-graph'
import { CubicBezierCurve, useI18n } from '@open-pencil/vue'

import NumberField from '@/components/inputs/NumberField.vue'
import { motionBezierCurveUI } from '@/theme/motion/cubic-bezier'

const { value, propertyPrefix } = defineProps<{
  value: MotionCubicBezierEasing
  propertyPrefix: string
}>()
const emit = defineEmits<{
  update: [value: MotionCubicBezierEasing, coalesceKey?: string]
}>()
const { panels } = useI18n()
let activeDragKey: string | undefined
let dragSequence = 0
function startDrag(pointerId: number) {
  activeDragKey = `${propertyPrefix}:${pointerId}:${++dragSequence}`
}
function finishDrag() {
  activeDragKey = undefined
}
function updateField(field: 'x1' | 'y1' | 'x2' | 'y2', next: number) {
  emit('update', { ...value, [field]: next })
}
</script>

<template>
  <div class="space-y-2" data-slot="motion-easing-editor" :data-property="propertyPrefix">
    <CubicBezierCurve
      data-slot="motion-easing-curve"
      :model-value="value"
      :label="panels.motionBezierCurve"
      :control-point-label="panels.motionBezierControlPoint"
      :min-y="MOTION_LIMITS.cubicBezierY.min"
      :max-y="MOTION_LIMITS.cubicBezierY.max"
      :ui="motionBezierCurveUI"
      :data-property="propertyPrefix"
      @drag-start="startDrag"
      @drag-end="finishDrag"
      @update:model-value="$emit('update', $event, activeDragKey)"
    />
    <div class="grid grid-cols-2 gap-1.5">
      <NumberField
        v-for="field in ['x1', 'y1', 'x2', 'y2'] as const"
        :key="field"
        :model-value="value[field]"
        :label="field"
        :min="field === 'x1' || field === 'x2' ? 0 : MOTION_LIMITS.cubicBezierY.min"
        :max="field === 'x1' || field === 'x2' ? 1 : MOTION_LIMITS.cubicBezierY.max"
        :step="0.01"
        :data-property="`${propertyPrefix}-${field}`"
        @commit="updateField(field, $event)"
      />
    </div>
  </div>
</template>
