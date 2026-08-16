<script setup lang="ts">
import { templateRef, useResizeObserver } from '@vueuse/core'
import { computed, onBeforeUnmount, watch, watchEffect } from 'vue'

import type { MotionPathPoint } from '@open-pencil/scene-graph'
import { useI18n } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import { MOTION_PATH_OVERLAY } from '@/app/motion-path/constants'
import {
  focusMotionPathHandle,
  resolveMotionPathEdit,
  stopMotionPathEditing,
  updateMotionPathHandleWithUndo
} from '@/app/motion-path/editing'
import {
  motionPathControlLines,
  motionPathCoordinateTransform,
  motionPathMarkerPoint,
  motionPathScreenHandles,
  pathPointToScreen,
  screenPointToPath
} from '@/app/motion-path/geometry'
import { MotionPathPointerSession } from '@/app/motion-path/pointer-session'
import { motionPathHandleKey, motionPathPointForHandle } from '@/app/motion-path/spec'
import type { MotionPathHandle } from '@/app/motion-path/types'

interface ScreenMotionPathHandle {
  handle: MotionPathHandle
  point: MotionPathPoint
  key: string
}

const store = useEditorStore()
const { panels } = useI18n()
const overlayRef = templateRef<HTMLCanvasElement>('overlayRef')
let drawFrame: number | null = null
let dragBatchOpen = false

const activeEdit = computed(() => {
  void store.state.sceneVersion
  void store.state.currentPageId
  void store.state.motionPathEdit
  return resolveMotionPathEdit(store)
})

const coordinateTransform = computed(() => {
  const active = activeEdit.value
  if (!active) return undefined
  return motionPathCoordinateTransform(store.graph, active.node, {
    panX: store.state.panX,
    panY: store.state.panY,
    zoom: store.state.zoom
  })
})

const screenHandles = computed<ScreenMotionPathHandle[]>(() => {
  const active = activeEdit.value
  const transform = coordinateTransform.value
  if (!active || !transform) return []
  return motionPathScreenHandles(active.path, transform).map(({ handle, point }) => ({
    handle,
    point,
    key: motionPathHandleKey(handle)
  }))
})

function pointerToPathPoint(clientX: number, clientY: number): MotionPathPoint | undefined {
  const canvas = overlayRef.value
  const transform = coordinateTransform.value
  if (!canvas || !transform) return undefined
  const rect = canvas.getBoundingClientRect()
  return screenPointToPath(transform, { x: clientX - rect.left, y: clientY - rect.top })
}

function beginDrag(handle: MotionPathHandle): void {
  if (store.undo.isBatching) throw new Error('Cannot edit a motion path during another undo batch')
  focusMotionPathHandle(store, handle)
  store.undo.beginBatch(panels.value.motionUpdate)
  dragBatchOpen = true
}

function updateDrag(handle: MotionPathHandle, clientX: number, clientY: number): void {
  const point = pointerToPathPoint(clientX, clientY)
  if (!point) return
  updateMotionPathHandleWithUndo(store, handle, point, panels.value.motionUpdate)
}

function commitDrag(): void {
  if (!dragBatchOpen) return
  dragBatchOpen = false
  store.undo.commitBatch()
}

function rollbackDrag(): void {
  if (!dragBatchOpen) return
  dragBatchOpen = false
  store.undo.rollbackBatch()
}

const pointerSession = new MotionPathPointerSession({
  begin: beginDrag,
  update: updateDrag,
  commit: commitDrag,
  rollback: rollbackDrag
})

function onPointerDown(event: PointerEvent, handle: MotionPathHandle): void {
  if (event.button !== 0) return
  const target = event.currentTarget as HTMLButtonElement
  event.preventDefault()
  event.stopPropagation()
  target.focus()
  pointerSession.start(target, event.pointerId, handle)
}

function onPointerMove(event: PointerEvent): void {
  if (!pointerSession.update(event.pointerId, event.clientX, event.clientY)) return
  event.preventDefault()
  event.stopPropagation()
}

function onPointerUp(event: PointerEvent): void {
  if (!pointerSession.finish(event.pointerId)) return
  event.preventDefault()
  event.stopPropagation()
}

function onPointerCancel(event: PointerEvent): void {
  if (!pointerSession.cancel(event.pointerId)) return
  event.preventDefault()
  event.stopPropagation()
}

function onLostPointerCapture(event: PointerEvent): void {
  pointerSession.lostPointerCapture(event.pointerId)
}

function nudgeHandle(handle: MotionPathHandle, dx: number, dy: number): void {
  const active = resolveMotionPathEdit(store)
  if (!active) return
  const point = motionPathPointForHandle(active.path, handle)
  if (!point) return
  const coalesceKey = `motion-path-nudge:${active.node.id}:${active.track.id}:${motionPathHandleKey(handle)}`
  store.undo.runBatch(
    panels.value.motionUpdate,
    () =>
      updateMotionPathHandleWithUndo(
        store,
        handle,
        { x: point.x + dx, y: point.y + dy },
        panels.value.motionUpdate
      ),
    coalesceKey
  )
}

function onHandleKeydown(event: KeyboardEvent, handle: MotionPathHandle): void {
  if (event.code === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    pointerSession.cancel()
    return
  }
  const step = event.shiftKey ? MOTION_PATH_OVERLAY.coarseNudgeStep : MOTION_PATH_OVERLAY.nudgeStep
  const deltas: Partial<Record<KeyboardEvent['code'], MotionPathPoint>> = {
    ArrowLeft: { x: -step, y: 0 },
    ArrowRight: { x: step, y: 0 },
    ArrowUp: { x: 0, y: -step },
    ArrowDown: { x: 0, y: step }
  }
  const delta = deltas[event.code]
  if (!delta) return
  event.preventDefault()
  event.stopPropagation()
  focusMotionPathHandle(store, handle)
  nudgeHandle(handle, delta.x, delta.y)
}

function handleLabel(handle: MotionPathHandle): string {
  if (handle.kind === 'start') return panels.value.motionPathStartPoint
  const segment = handle.segmentIndex + 1
  if (handle.kind === 'control1') return panels.value.motionPathFirstControlPoint({ segment })
  if (handle.kind === 'control2') return panels.value.motionPathSecondControlPoint({ segment })
  return panels.value.motionPathEndPoint({ segment })
}

function drawHandle(
  context: CanvasRenderingContext2D,
  screen: Readonly<MotionPathPoint>,
  handle: MotionPathHandle,
  focused: boolean
): void {
  const endpoint = handle.kind === 'start' || handle.kind === 'end'
  const radius = endpoint ? MOTION_PATH_OVERLAY.endpointRadius : MOTION_PATH_OVERLAY.controlRadius
  context.save()
  context.translate(screen.x, screen.y)
  context.beginPath()
  if (endpoint) context.arc(0, 0, radius, 0, Math.PI * 2)
  else {
    context.rotate(Math.PI / 4)
    context.rect(-radius, -radius, radius * 2, radius * 2)
  }
  context.fillStyle = endpoint
    ? MOTION_PATH_OVERLAY.colors.endpointFill
    : MOTION_PATH_OVERLAY.colors.controlFill
  context.strokeStyle = MOTION_PATH_OVERLAY.colors.path
  context.lineWidth = focused
    ? MOTION_PATH_OVERLAY.strokeWidth
    : MOTION_PATH_OVERLAY.controlStrokeWidth
  context.fill()
  context.stroke()
  context.restore()
}

function drawOverlay(): void {
  drawFrame = null
  const canvas = overlayRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const ratio = window.devicePixelRatio || 1
  const width = Math.max(1, Math.round(rect.width * ratio))
  const height = Math.max(1, Math.round(rect.height * ratio))
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, rect.width, rect.height)

  const active = activeEdit.value
  const transform = coordinateTransform.value
  if (!active || !transform) return

  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.strokeStyle = MOTION_PATH_OVERLAY.colors.control
  context.lineWidth = MOTION_PATH_OVERLAY.controlStrokeWidth
  for (const line of motionPathControlLines(active.path)) {
    const from = pathPointToScreen(transform, line.from)
    const to = pathPointToScreen(transform, line.to)
    context.beginPath()
    context.moveTo(from.x, from.y)
    context.lineTo(to.x, to.y)
    context.stroke()
  }

  const start = pathPointToScreen(transform, active.path.start)
  context.beginPath()
  context.moveTo(start.x, start.y)
  for (const segment of active.path.segments) {
    const control1 = pathPointToScreen(transform, segment.control1)
    const control2 = pathPointToScreen(transform, segment.control2)
    const end = pathPointToScreen(transform, segment.end)
    context.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, end.x, end.y)
  }
  context.strokeStyle = MOTION_PATH_OVERLAY.colors.path
  context.lineWidth = MOTION_PATH_OVERLAY.strokeWidth
  context.stroke()

  const marker = pathPointToScreen(transform, motionPathMarkerPoint(active.path, active.keyframe))
  context.beginPath()
  context.arc(marker.x, marker.y, MOTION_PATH_OVERLAY.markerRadius, 0, Math.PI * 2)
  context.fillStyle = MOTION_PATH_OVERLAY.colors.markerFill
  context.fill()

  const focusedKey = active.selection.focusedHandle
    ? motionPathHandleKey(active.selection.focusedHandle)
    : undefined
  for (const item of screenHandles.value) {
    drawHandle(context, item.point, item.handle, item.key === focusedKey)
  }
}

function scheduleDraw(): void {
  if (drawFrame !== null) return
  drawFrame = requestAnimationFrame(drawOverlay)
}

function validateEditingSelection(): void {
  const selection = store.state.motionPathEdit
  if (!selection) return
  const selected = store.state.selectedIds
  if (!resolveMotionPathEdit(store) || selected.size !== 1 || !selected.has(selection.nodeId)) {
    pointerSession.cancel()
    stopMotionPathEditing(store)
  }
}

watch(() => store.state.selectedIds, validateEditingSelection, { immediate: true })

watchEffect(() => {
  void activeEdit.value
  void coordinateTransform.value
  void screenHandles.value
  scheduleDraw()
})

useResizeObserver(overlayRef, scheduleDraw)

const unsubscribe = [
  store.onEditorEvent('selection:changed', validateEditingSelection),
  store.onEditorEvent('page:changed', validateEditingSelection),
  store.onEditorEvent('node:deleted', validateEditingSelection),
  store.onEditorEvent('graph:replaced', validateEditingSelection)
]

onBeforeUnmount(() => {
  pointerSession.dispose()
  for (const stop of unsubscribe) stop()
  if (drawFrame !== null) cancelAnimationFrame(drawFrame)
})
</script>

<template>
  <canvas
    ref="overlayRef"
    data-test-id="motion-path-overlay"
    aria-hidden="true"
    class="pointer-events-none absolute inset-0 z-20 size-full"
  />
  <button
    v-for="item in screenHandles"
    :key="item.key"
    type="button"
    :aria-label="handleLabel(item.handle)"
    :data-test-id="`motion-path-handle-${item.key}`"
    :data-motion-path-handle="item.key"
    class="absolute z-30 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-canvas"
    :style="{
      left: `${item.point.x}px`,
      top: `${item.point.y}px`,
      width: `${MOTION_PATH_OVERLAY.handleHitSize}px`,
      height: `${MOTION_PATH_OVERLAY.handleHitSize}px`
    }"
    @focus="focusMotionPathHandle(store, item.handle)"
    @keydown="onHandleKeydown($event, item.handle)"
    @pointerdown="onPointerDown($event, item.handle)"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @lostpointercapture="onLostPointerCapture"
  />
</template>
