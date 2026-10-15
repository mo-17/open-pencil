<script setup lang="ts">
import { useDevicePixelRatio, useElementSize, useMutationObserver } from '@vueuse/core'
import { computed, onMounted, ref, useAttrs, useTemplateRef, watch } from 'vue'

import type { MotionCubicBezierEasing } from '@open-pencil/scene-graph'

import type { CubicBezierCurveUI } from './types'

const {
  modelValue: value,
  label,
  controlPointLabel,
  minY,
  maxY,
  ui = {}
} = defineProps<{
  /** Controlled easing coordinates. */
  modelValue: MotionCubicBezierEasing
  /** Accessible description of the curve. */
  label: string
  /** Accessible label prefix for the numbered control points. */
  controlPointLabel: string
  /** Allowed control-point range; the plot displays overshoot from -1 to 2. */
  minY: number
  maxY: number
  ui?: CubicBezierCurveUI
}>()
const attrs = useAttrs()
const emit = defineEmits<{
  'update:modelValue': [value: MotionCubicBezierEasing]
  dragStart: [pointerId: number]
  dragEnd: []
}>()
const root = useTemplateRef<HTMLDivElement>('root')
const canvas = useTemplateRef<HTMLCanvasElement>('canvas')
const gridColor = useTemplateRef<HTMLSpanElement>('grid-color')
const guideColor = useTemplateRef<HTMLSpanElement>('guide-color')
const curveColor = useTemplateRef<HTMLSpanElement>('curve-color')
const endpointColor = useTemplateRef<HTMLSpanElement>('endpoint-color')
const { width, height } = useElementSize(root)
const { pixelRatio } = useDevicePixelRatio()
const activePoint = ref<1 | 2 | null>(null)
let activePointerId: number | null = null

const VIEW_MIN_Y = -1
const VIEW_MAX_Y = 2
const VIEW_Y_SPAN = VIEW_MAX_Y - VIEW_MIN_Y
const plot = computed(() => {
  const size = Math.min(width.value, height.value)
  return { size, x: (width.value - size) / 2, y: (height.value - size) / 2 }
})
function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
function graphX(value: number) {
  return clamp(value, 0, 1) * 100
}
function graphY(value: number) {
  return ((VIEW_MAX_Y - clamp(value, VIEW_MIN_Y, VIEW_MAX_Y)) / VIEW_Y_SPAN) * 100
}
function controlStyle(point: 1 | 2) {
  const x = point === 1 ? value.x1 : value.x2
  const y = point === 1 ? value.y1 : value.y2
  return {
    left: `${plot.value.x + (graphX(x) / 100) * plot.value.size}px`,
    top: `${plot.value.y + (graphY(y) / 100) * plot.value.size}px`
  }
}
function paint(element: HTMLSpanElement | null) {
  return element ? getComputedStyle(element).color : 'currentColor'
}
function drawCurve() {
  const target = canvas.value
  const context = target?.getContext('2d')
  if (!target || !context || plot.value.size <= 0) return
  const ratio = pixelRatio.value
  target.width = Math.round(width.value * ratio)
  target.height = Math.round(height.value * ratio)
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, width.value, height.value)
  context.translate(plot.value.x, plot.value.y)
  context.scale(plot.value.size / 100, plot.value.size / 100)
  context.strokeStyle = paint(gridColor.value)
  context.lineWidth = 0.75
  context.beginPath()
  for (const y of [graphY(0), graphY(1)]) {
    context.moveTo(0, y)
    context.lineTo(100, y)
  }
  context.stroke()
  context.strokeStyle = paint(guideColor.value)
  context.lineWidth = 1
  context.beginPath()
  context.moveTo(0, graphY(0))
  context.lineTo(graphX(value.x1), graphY(value.y1))
  context.moveTo(100, graphY(1))
  context.lineTo(graphX(value.x2), graphY(value.y2))
  context.stroke()
  context.strokeStyle = paint(curveColor.value)
  context.lineWidth = 2
  context.beginPath()
  context.moveTo(0, graphY(0))
  context.bezierCurveTo(
    graphX(value.x1),
    graphY(value.y1),
    graphX(value.x2),
    graphY(value.y2),
    100,
    graphY(1)
  )
  context.stroke()
  context.fillStyle = paint(endpointColor.value)
  for (const [x, y] of [
    [0, graphY(0)],
    [100, graphY(1)]
  ]) {
    context.beginPath()
    context.arc(x, y, 2, 0, Math.PI * 2)
    context.fill()
  }
}
watch([() => value, width, height, pixelRatio, () => ui], drawCurve, { deep: true, flush: 'post' })
onMounted(drawCurve)
useMutationObserver(() => root.value?.ownerDocument.documentElement, drawCurve, {
  attributes: true,
  attributeFilter: ['class', 'style', 'data-theme']
})
function updatePoint(point: 1 | 2, x: number, y: number) {
  const coordinates = {
    x: Math.round(clamp(x, 0, 1) * 100) / 100,
    y: Math.round(clamp(y, minY, maxY) * 100) / 100
  }
  emit(
    'update:modelValue',
    point === 1
      ? { ...value, x1: coordinates.x, y1: coordinates.y }
      : { ...value, x2: coordinates.x, y2: coordinates.y }
  )
}
function updateFromPointer(event: PointerEvent) {
  if (
    !activePoint.value ||
    activePointerId !== event.pointerId ||
    !root.value ||
    plot.value.size <= 0
  )
    return
  const bounds = root.value.getBoundingClientRect()
  const x = (event.clientX - bounds.left - root.value.clientLeft - plot.value.x) / plot.value.size
  const y =
    VIEW_MAX_Y -
    ((event.clientY - bounds.top - root.value.clientTop - plot.value.y) / plot.value.size) *
      VIEW_Y_SPAN
  updatePoint(activePoint.value, x, y)
}
function startDrag(event: PointerEvent, point: 1 | 2) {
  if (!root.value || activePointerId !== null) return
  if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus({ preventScroll: true })
  activePoint.value = point
  activePointerId = event.pointerId
  emit('dragStart', event.pointerId)
  root.value.setPointerCapture(event.pointerId)
  updateFromPointer(event)
}
function finishDrag(event: PointerEvent) {
  if (activePointerId !== event.pointerId) return
  if (root.value?.hasPointerCapture(event.pointerId))
    root.value.releasePointerCapture(event.pointerId)
  activePoint.value = null
  activePointerId = null
  emit('dragEnd')
}
function updateFromKeyboard(event: KeyboardEvent, point: 1 | 2) {
  const x = point === 1 ? value.x1 : value.x2
  const y = point === 1 ? value.y1 : value.y2
  const step = event.shiftKey ? 0.1 : 0.01
  switch (event.code) {
    case 'ArrowLeft':
      updatePoint(point, x - step, y)
      break
    case 'ArrowRight':
      updatePoint(point, x + step, y)
      break
    case 'ArrowUp':
      updatePoint(point, x, y + step)
      break
    case 'ArrowDown':
      updatePoint(point, x, y - step)
      break
    default:
      return
  }
  event.preventDefault()
  event.stopPropagation()
}
</script>

<template>
  <div
    ref="root"
    class="relative"
    :class="ui.root"
    role="group"
    :aria-label="label"
    data-slot="cubic-bezier-curve"
    @pointermove="updateFromPointer"
    @pointerup="finishDrag"
    @pointercancel="finishDrag"
    @lostpointercapture="finishDrag"
  >
    <canvas
      ref="canvas"
      class="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    />
    <span ref="grid-color" class="hidden" :class="ui.grid" aria-hidden="true" />
    <span ref="guide-color" class="hidden" :class="ui.guide" aria-hidden="true" />
    <span ref="curve-color" class="hidden" :class="ui.curve" aria-hidden="true" />
    <span ref="endpoint-color" class="hidden" :class="ui.endpoint" aria-hidden="true" />
    <button
      v-for="point in [1, 2] as const"
      :key="point"
      type="button"
      class="absolute -translate-x-1/2 -translate-y-1/2"
      :class="ui.control"
      :style="controlStyle(point)"
      :aria-label="`${controlPointLabel} ${point}`"
      data-slot="cubic-bezier-control"
      :data-property="attrs['data-property']"
      :data-control-point="point"
      @pointerdown.stop.prevent="startDrag($event, point)"
      @keydown="updateFromKeyboard($event, point)"
    />
  </div>
</template>
