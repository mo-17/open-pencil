<script setup lang="ts">
import { computed, ref } from 'vue'

import { MOTION_LIMITS, type MotionCubicBezierEasing } from '@open-pencil/scene-graph'
import { useI18n } from '@open-pencil/vue'

import NumberField from '@/components/inputs/NumberField.vue'

const { value, propertyPrefix } = defineProps<{
  value: MotionCubicBezierEasing
  propertyPrefix: string
}>()

const emit = defineEmits<{
  update: [value: MotionCubicBezierEasing, coalesceKey?: string]
}>()

const { panels } = useI18n()
const activePoint = ref<1 | 2 | null>(null)
let activeDragKey: string | undefined
let dragSequence = 0

const VIEW_MIN_Y = -1
const VIEW_MAX_Y = 2
const VIEW_Y_SPAN = VIEW_MAX_Y - VIEW_MIN_Y

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function graphX(value: number): number {
  return clamp(value, 0, 1) * 100
}

function graphY(value: number): number {
  return ((VIEW_MAX_Y - clamp(value, VIEW_MIN_Y, VIEW_MAX_Y)) / VIEW_Y_SPAN) * 100
}

const curvePath = computed(
  () =>
    `M 0 ${graphY(0)} C ${graphX(value.x1)} ${graphY(value.y1)}, ${graphX(value.x2)} ${graphY(value.y2)}, 100 ${graphY(1)}`
)

function updateField(field: 'x1' | 'y1' | 'x2' | 'y2', next: number): void {
  emit('update', { ...value, [field]: next })
}

function updateFromCoordinates(svg: SVGSVGElement, event: PointerEvent): void {
  if (!activePoint.value) return
  const rect = svg.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  const matrix = svg.getScreenCTM()
  const point = svg.createSVGPoint()
  point.x = event.clientX
  point.y = event.clientY
  const local = matrix ? point.matrixTransform(matrix.inverse()) : undefined
  const localX = local?.x ?? ((event.clientX - rect.left) / rect.width) * 100
  const localY = local?.y ?? ((event.clientY - rect.top) / rect.height) * 100
  const x = Math.round(clamp(localX / 100, 0, 1) * 100) / 100
  const normalizedY = 1 - localY / 100
  const y =
    Math.round(
      clamp(
        VIEW_MIN_Y + normalizedY * VIEW_Y_SPAN,
        MOTION_LIMITS.cubicBezierY.min,
        MOTION_LIMITS.cubicBezierY.max
      ) * 100
    ) / 100
  emit(
    'update',
    activePoint.value === 1 ? { ...value, x1: x, y1: y } : { ...value, x2: x, y2: y },
    activeDragKey
  )
}

function updateFromPointer(event: PointerEvent): void {
  updateFromCoordinates(event.currentTarget as SVGSVGElement, event)
}

function startDrag(event: PointerEvent, point: 1 | 2): void {
  const circle = event.currentTarget as SVGCircleElement
  const svg = circle.ownerSVGElement
  if (!svg) return
  activePoint.value = point
  activeDragKey = `${propertyPrefix}:${event.pointerId}:${++dragSequence}`
  svg.setPointerCapture(event.pointerId)
  updateFromCoordinates(svg, event)
}

function finishDrag(event: PointerEvent): void {
  const svg = event.currentTarget as SVGSVGElement
  if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId)
  activePoint.value = null
  activeDragKey = undefined
}
</script>

<template>
  <div class="space-y-2" :data-test-id="`${propertyPrefix}-editor`">
    <svg
      viewBox="0 0 100 100"
      class="h-24 w-full touch-none rounded border border-border bg-input/70"
      role="img"
      :aria-label="panels.motionBezierCurve"
      :data-test-id="`${propertyPrefix}-curve`"
      @pointermove="updateFromPointer"
      @pointerup="finishDrag"
      @pointercancel="finishDrag"
    >
      <path d="M 0 66.6667 H 100 M 0 33.3333 H 100" class="stroke-border" stroke-width="0.75" />
      <path
        :d="`M 0 ${graphY(0)} L ${graphX(value.x1)} ${graphY(value.y1)} M 100 ${graphY(1)} L ${graphX(value.x2)} ${graphY(value.y2)}`"
        class="stroke-muted"
        stroke-width="1"
      />
      <path :d="curvePath" fill="none" class="stroke-accent" stroke-width="2" />
      <circle cx="0" :cy="graphY(0)" r="2" class="fill-surface" />
      <circle cx="100" :cy="graphY(1)" r="2" class="fill-surface" />
      <circle
        :cx="graphX(value.x1)"
        :cy="graphY(value.y1)"
        r="4"
        class="cursor-grab fill-panel stroke-accent active:cursor-grabbing"
        stroke-width="2"
        :aria-label="`${panels.motionBezierControlPoint} 1`"
        :data-test-id="`${propertyPrefix}-control-1`"
        @pointerdown.stop.prevent="startDrag($event, 1)"
      />
      <circle
        :cx="graphX(value.x2)"
        :cy="graphY(value.y2)"
        r="4"
        class="cursor-grab fill-panel stroke-accent active:cursor-grabbing"
        stroke-width="2"
        :aria-label="`${panels.motionBezierControlPoint} 2`"
        :data-test-id="`${propertyPrefix}-control-2`"
        @pointerdown.stop.prevent="startDrag($event, 2)"
      />
    </svg>
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
