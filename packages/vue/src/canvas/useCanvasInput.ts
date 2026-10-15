import { tryOnScopeDispose, useEventListener } from '@vueuse/core'
import { ref, watch, type Ref } from 'vue'

import type { Editor } from '@open-pencil/core/editor'
import type { SceneNode } from '@open-pencil/scene-graph'

import { createAutoLayoutValueEdit } from '#vue/canvas/auto-layout/value-edit'
import { createGuideInput, selectedTopLevelGuideFrameId } from '#vue/canvas/guides/input'
import { createCanvasLabelEdit } from '#vue/canvas/labels/edit'
import { handlePenDragMove, updatePenHover } from '#vue/canvas/pen/input'
import { finishPencilDrag, handlePencilDragMove } from '#vue/canvas/pencil/input'
import { createCanvasPointer } from '#vue/canvas/pointer/use'
import { createTextEditInput } from '#vue/canvas/text-edit/input'
import { handleToolMouseDown } from '#vue/canvas/tools/input'
import { createCanvasTransformInput } from '#vue/canvas/transform/input'
import { finishMarquee } from '#vue/canvas/transform/marquee'
import {
  handleBendHandleMove,
  handleNodeEditPointerUp,
  updateNodeEditHover
} from '#vue/canvas/vector-input/input'
import { resolveAutoLayoutHover } from '#vue/shared/input/auto-layout-hover'
import { createClickCounter } from '#vue/shared/input/click-count'
import { handleDrawMove } from '#vue/shared/input/draw'
import { handleMoveMove, handleMoveUp } from '#vue/shared/input/move'
import { setupPanZoom } from '#vue/shared/input/pan-zoom'
import { applyResize, cancelResizePreview, commitResizePreview } from '#vue/shared/input/resize'
import { updateHoverCursor } from '#vue/shared/input/select'
import { resolveShapeHandleHover } from '#vue/shared/input/shape-handles'
import { useSpaceHeld } from '#vue/shared/input/space-key'
import type { DragState } from '#vue/shared/input/types'
import { handleNodeEditMove } from '#vue/shared/input/vector'

/**
 * Wires pointer and mouse interaction to an OpenPencil canvas.
 *
 * This composable coordinates selection, dragging, resizing, rotation,
 * panning, drawing tools, scoped hit testing, and text-edit interaction.
 * It is primarily intended for editor shell components that own the canvas.
 */
export function useCanvasInput(
  canvasRef: Ref<HTMLCanvasElement | null>,
  editor: Editor,
  hitTestSectionTitle: (cx: number, cy: number) => SceneNode | null,
  hitTestComponentLabel: (cx: number, cy: number) => SceneNode | null,
  hitTestFrameTitle: (cx: number, cy: number) => SceneNode | null,
  onCursorMove?: (cx: number, cy: number) => void,
  onCursorFlush?: () => void,
  onActivate?: () => void,
  isEnabled: () => boolean = () => true
) {
  const drag = ref<DragState | null>(null)
  // Canvas chrome that explains layout, such as auto layout child outlines, steps aside while
  // layers move, resize, or rotate.
  watch(
    () => drag.value?.type,
    (type) => editor.setTransforming(type === 'move' || type === 'resize' || type === 'rotate')
  )
  const canvasLabelEdit = createCanvasLabelEdit(editor)
  const cursorOverride = ref<string | null>(null)
  /** Whether the primary button is held on a preview control, such as a slider thumb. */
  const valueEdit = createAutoLayoutValueEdit(editor)
  const selectedIdsBeforeClickSequence = ref<ReadonlySet<string>>(new Set())
  const lastPointer = ref<{ cx: number; cy: number; sx: number; sy: number } | null>(null)
  const pointerInside = ref(false)
  let altHeld = false
  let metaHeld = false
  let controlHeld = false
  const spaceHeld = useSpaceHeld()
  const { recordClick, getClickCount } = createClickCounter()
  let passiveHoverFrame: number | null = null
  let pendingPassiveHover: { sx: number; sy: number; cx: number; cy: number } | null = null

  const { getCoords, canvasToLocal, hitTestInScope, hitFns } = createCanvasPointer(
    canvasRef,
    editor,
    hitTestSectionTitle,
    hitTestComponentLabel,
    hitTestFrameTitle
  )

  function canMeasure() {
    return (
      pointerInside.value &&
      !drag.value &&
      editor.state.activeTool === 'SELECT' &&
      editor.state.selectedIds.size > 0 &&
      !editor.state.editingTextId &&
      !editor.state.nodeEditState &&
      !editor.state.penState
    )
  }

  /** ⌘ or Ctrl held: hover reaches the deepest layer, the one a click would select, as in Figma. */
  function hoverDeep(e?: MouseEvent) {
    return e ? e.metaKey || e.ctrlKey : metaHeld || controlHeld
  }

  function refreshMeasurement() {
    const mode = altHeld && canMeasure() ? (metaHeld || controlHeld ? 'deep' : 'shallow') : 'off'
    editor.setMeasurementMode(mode)
    const pointer = lastPointer.value
    if (!pointer || drag.value || editor.state.activeTool !== 'SELECT' || !pointerInside.value)
      return
    const guideCursor = guideInput.updateHover(pointer.sx, pointer.sy)
    cursorOverride.value =
      guideCursor ??
      updateHoverCursor(pointer.cx, pointer.cy, editor, hitFns, mode === 'deep' || hoverDeep())
    editor.setAutoLayoutHover(
      mode === 'off' ? resolveAutoLayoutHover(pointer.cx, pointer.cy, editor) : null
    )
    editor.setShapeHandleHover(resolveShapeHandleHover(editor, pointer.sx, pointer.sy, altHeld))
  }

  function updateModifier(code: string, held: boolean) {
    if (!isEnabled()) return
    if (code === 'AltLeft' || code === 'AltRight') altHeld = held
    if (code === 'MetaLeft' || code === 'MetaRight') metaHeld = held
    if (code === 'ControlLeft' || code === 'ControlRight') controlHeld = held
    if (code.startsWith('Alt') || code.startsWith('Meta') || code.startsWith('Control')) {
      refreshMeasurement()
    }
  }

  function resetMeasurementModifiers() {
    altHeld = false
    metaHeld = false
    controlHeld = false
    editor.setMeasurementMode('off')
  }

  function setDrag(d: DragState) {
    cancelPassiveHover()
    editor.setMeasurementMode('off')
    drag.value = d
  }

  function cancelPassiveHover() {
    pendingPassiveHover = null
    if (passiveHoverFrame === null) return
    cancelAnimationFrame(passiveHoverFrame)
    passiveHoverFrame = null
  }

  function schedulePassiveHover(sx: number, sy: number, cx: number, cy: number) {
    pendingPassiveHover = { sx, sy, cx, cy }
    if (passiveHoverFrame !== null) return
    passiveHoverFrame = requestAnimationFrame(() => {
      passiveHoverFrame = null
      const hover = pendingPassiveHover
      pendingPassiveHover = null
      if (!hover || drag.value || editor.state.activeTool !== 'SELECT') return
      const guideCursor = guideInput.updateHover(hover.sx, hover.sy)
      cursorOverride.value =
        guideCursor ??
        updateHoverCursor(
          hover.cx,
          hover.cy,
          editor,
          hitFns,
          editor.state.measurementMode === 'deep'
        )
      editor.setAutoLayoutHover(
        editor.state.measurementMode === 'off'
          ? resolveAutoLayoutHover(hover.cx, hover.cy, editor)
          : null
      )
    })
  }

  const guideInput = createGuideInput({
    canvasRef,
    editor,
    canvasToLocal,
    setDrag,
    setCursor: (cursor) => {
      cursorOverride.value = cursor
    }
  })

  const { handleTextEditClick, onDblClick: onTextDblClick } = createTextEditInput({
    editor,
    getCoords,
    hitTestInScope,
    hitTestSectionTitle,
    hitTestComponentLabel,
    hitTestFrameTitle,
    getClickCount,
    wasSelectedBeforeClickSequence: (id) => selectedIdsBeforeClickSequence.value.has(id),
    onEditCanvasLabel: canvasLabelEdit.start,
    setDrag
  })

  const {
    tryStartRotation,
    handlePanMove,
    handleRotateMove,
    handleTextSelectMove,
    handleMarqueeMove
  } = createCanvasTransformInput(editor, setDrag)

  function onDblClick(e: MouseEvent) {
    if (editor.state.play) return
    const { cx, cy } = getCoords(e)
    if (valueEdit.start(cx, cy)) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    onTextDblClick(e)
  }

  function onMouseDown(e: MouseEvent) {
    onActivate?.()
    if (!isEnabled()) return
    cancelPassiveHover()
    editor.setMeasurementMode('off')
    if (editor.state.play && e.button === 0 && editor.state.activeTool !== 'HAND') {
      e.preventDefault()
      return
    }
    editor.setMeasurementMode('off')
    const openValueEdit = valueEdit.edit.value
    if (openValueEdit) valueEdit.commit(openValueEdit.value)
    if (!editor.state.editingTextId) canvasRef.value?.focus()
    editor.setHoveredNode(null)
    const { sx, sy, cx, cy } = getCoords(e)
    onCursorMove?.(cx, cy)
    onCursorFlush?.()
    if (e.button === 0 && guideInput.tryStartExisting(sx, sy, e.altKey)) {
      e.preventDefault()
      return
    }
    if (e.button === 0 && guideInput.tryStartFromRuler(sx, sy, cx, cy)) {
      e.preventDefault()
      return
    }
    editor.setSelectedGuide(null)

    const selectedIdsBeforeMouseDown = new Set(editor.state.selectedIds)
    const clickCount = recordClick(sx, sy)
    if (clickCount === 1) selectedIdsBeforeClickSequence.value = selectedIdsBeforeMouseDown
    handleToolMouseDown({
      event: e,
      cx,
      cy,
      sx,
      sy,
      editor,
      hitFns,
      cursorOverride,
      setDrag,
      tryStartRotation,
      handleTextEditClick
    })
  }

  // Dispatching the full drag union is intentionally centralized here.
  // eslint-disable-next-line complexity
  function onMouseMove(e: MouseEvent) {
    if (!isEnabled()) return
    pointerInside.value = true
    const coords = getCoords(e)
    lastPointer.value = { cx: coords.cx, cy: coords.cy, sx: coords.sx, sy: coords.sy }
    if (onCursorMove) {
      onCursorMove(coords.cx, coords.cy)
    }

    if (editor.state.play && !drag.value) return

    if (!drag.value) {
      updatePenHover(coords.cx, coords.cy, editor)
    }

    if (!drag.value) {
      const { cx, cy, sx, sy } = coords
      updateNodeEditHover(editor, cx, cy)
      editor.setShapeHandleHover(resolveShapeHandleHover(editor, sx, sy, e.altKey))
    }

    if (!drag.value && editor.state.activeTool === 'SELECT') {
      schedulePassiveHover(coords.sx, coords.sy, coords.cx, coords.cy)
    }

    if (!drag.value) return
    const d = drag.value

    if (d.type === 'pan') {
      handlePanMove(d, e)
      return
    }

    const { sx, sy, cx, cy } = getCoords(e)

    if (d.type === 'gradient' || d.type === 'shape-handle') {
      d.update(sx, sy, e.shiftKey)
      return
    }
    if (d.type === 'guide') {
      const frameId = e.altKey && !d.guideId ? selectedTopLevelGuideFrameId(editor) : null
      guideInput.handleMove(
        d,
        sx,
        sy,
        cx,
        cy,
        frameId ? { frameId, deep: e.metaKey || e.ctrlKey } : undefined
      )
      return
    }
    if (d.type === 'rotate') {
      handleRotateMove(d, cx, cy, e.shiftKey)
      return
    }
    if (d.type === 'move') {
      handleMoveMove(d, cx, cy, sx, sy, editor, { ctrlKey: e.ctrlKey, shiftKey: e.shiftKey })
      return
    }
    if (d.type === 'text-select') {
      handleTextSelectMove(cx, cy)
      return
    }
    if (d.type === 'resize') {
      applyResize(d, cx, cy, e.shiftKey, editor, e.ctrlKey)
      return
    }

    if (d.type === 'pen-drag') {
      handlePenDragMove(d, cx, cy, spaceHeld.value, e, editor)
      return
    }

    if (d.type === 'pencil-drag') {
      handlePencilDragMove(cx, cy, e.shiftKey, editor)
      return
    }

    if (d.type === 'edit-node' || d.type === 'edit-handle') {
      handleNodeEditMove(d, cx, cy, editor, e.altKey, e.metaKey || e.ctrlKey, e.shiftKey, e.ctrlKey)
      return
    }

    if (d.type === 'bend-handle') {
      handleBendHandleMove(d, cx, cy, e, editor)
      return
    }

    if (d.type === 'draw') {
      handleDrawMove(d, cx, cy, e.shiftKey)
      return
    }

    handleMarqueeMove(d, cx, cy)
  }

  function commitRotationDrag(d: Extract<DragState, { type: 'rotate' }>) {
    const preview = editor.state.rotationPreview
    if (preview?.nodeId === d.nodeId && preview.angle !== d.origRotation) {
      editor.updateNode(d.nodeId, { rotation: preview.angle })
      editor.commitRotation(d.nodeId, d.origRotation)
    }
    if (editor.state.rotationPreview === preview) editor.setRotationPreview(null)
  }

  function onMouseUp(e?: MouseEvent) {
    if (!isEnabled()) return
    if (e) {
      const { cx, cy } = getCoords(e)
      onCursorMove?.(cx, cy)
    }
    onCursorFlush?.()
    if (!drag.value) return
    const d = drag.value

    if (handleNodeEditPointerUp(drag, editor)) return

    if (d.type === 'guide') {
      guideInput.finish(d)
    } else if (d.type === 'move') handleMoveUp(d, editor)
    else if (d.type === 'text-select') {
      drag.value = null
      return
    } else if (d.type === 'resize') commitResizePreview(d, editor)
    else if (d.type === 'pen-drag') {
      const penState = editor.state.penState as
        | (typeof editor.state.penState & {
            pendingClose?: boolean
          })
        | null
      if (penState?.pendingClose) {
        editor.penCommit(true)
      }
      drag.value = null
      return
    } else if (d.type === 'pencil-drag') finishPencilDrag(editor)
    else if (d.type === 'rotate') {
      commitRotationDrag(d)
    } else if (d.type === 'draw' || d.type === 'gradient' || d.type === 'shape-handle') d.commit()
    else if (d.type === 'marquee') finishMarquee(editor, d)

    drag.value = null
    cursorOverride.value = null
    refreshMeasurement()
  }

  function clearTransientInteractionFeedback() {
    editor.setSnapGuides([])
    editor.setLayoutInsertIndicator(null)
    editor.setDropTarget(null)
    editor.setShapeHandleHover(null)
    guideInput.clearHoverAndPreview()
  }

  /** Drops what a resize or pencil stroke showed without changing the document. */
  function discardDrawnPreview(d: DragState) {
    if (d.type === 'resize') cancelResizePreview(d)
    else if (d.type === 'pencil-drag') editor.pencilCancel()
  }

  function cancelPointerInteraction() {
    cancelPassiveHover()
    if (drag.value) discardDrawnPreview(drag.value)
    if (drag.value?.type === 'rotate') {
      const rotation = drag.value
      drag.value = null
      if (editor.state.rotationPreview?.nodeId === rotation.nodeId) editor.setRotationPreview(null)
    }
    if (
      drag.value?.type === 'draw' ||
      drag.value?.type === 'gradient' ||
      drag.value?.type === 'shape-handle'
    ) {
      const drawing = drag.value
      drag.value = null
      drawing.cancel()
    }
    if (
      drag.value?.type === 'edit-node' ||
      drag.value?.type === 'edit-handle' ||
      drag.value?.type === 'bend-handle'
    ) {
      const methods = editor as Editor & {
        nodeEditCancelDrag?: () => void
      }
      methods.nodeEditCancelDrag?.()
    }
    drag.value = null
    cursorOverride.value = null
    clearTransientInteractionFeedback()
  }

  function onPointerDown(e: PointerEvent) {
    if (e.pointerType !== 'mouse' || e.button !== 0) return
    canvasRef.value?.setPointerCapture(e.pointerId)
  }

  function onPointerUp(e: PointerEvent) {
    if (e.pointerType !== 'mouse') return
    onMouseUp()
    if (canvasRef.value?.hasPointerCapture(e.pointerId)) {
      canvasRef.value.releasePointerCapture(e.pointerId)
    }
  }

  function onPointerCancel(e: PointerEvent) {
    if (e.pointerType !== 'mouse') return
    cancelPointerInteraction()
    if (canvasRef.value?.hasPointerCapture(e.pointerId)) {
      canvasRef.value.releasePointerCapture(e.pointerId)
    }
  }

  function onLostPointerCapture(e: PointerEvent) {
    // A completed pointerup releases capture too; only an interrupted gesture is cancelled.
    if (drag.value) onPointerCancel(e)
  }

  useEventListener(canvasRef, 'pointerdown', onPointerDown)
  useEventListener(canvasRef, 'pointerup', onPointerUp)
  useEventListener(canvasRef, 'pointercancel', onPointerCancel)
  useEventListener(canvasRef, 'lostpointercapture', onLostPointerCapture)
  useEventListener(canvasRef, 'dblclick', onDblClick)
  useEventListener(canvasRef, 'mousedown', onMouseDown)
  useEventListener(canvasRef, 'mousemove', onMouseMove)
  useEventListener(canvasRef, 'mouseup', onMouseUp)
  useEventListener(window, 'keydown', (event) => {
    if (!isEnabled()) return
    if (!guideInput.deleteSelected(event)) updateModifier(event.code, true)
  })
  useEventListener(window, 'keyup', (event) => updateModifier(event.code, false))
  useEventListener(
    window,
    'keydown',
    (event) => {
      if (event.code !== 'Escape' || event.isComposing || !isEnabled()) return
      const type = drag.value?.type
      if (type !== 'draw' && type !== 'gradient' && type !== 'rotate' && type !== 'resize') return
      event.preventDefault()
      event.stopImmediatePropagation()
      cancelPointerInteraction()
    },
    { capture: true }
  )
  // Space during a move keeps layers in their parents, as in Figma, instead of switching to the hand.
  function holdParentsDuringMove(event: KeyboardEvent, held: boolean) {
    if (event.code !== 'Space' || drag.value?.type !== 'move' || !isEnabled()) return
    event.preventDefault()
    event.stopImmediatePropagation()
    drag.value.keepParents = held
    if (held) editor.setDropTarget(null)
  }
  useEventListener(window, 'keydown', (event) => holdParentsDuringMove(event, true), {
    capture: true
  })
  useEventListener(window, 'keyup', (event) => holdParentsDuringMove(event, false), {
    capture: true
  })
  useEventListener(window, 'blur', () => {
    resetMeasurementModifiers()
    cancelPointerInteraction()
  })
  useEventListener(canvasRef, 'mouseleave', (event) => {
    pointerInside.value = false
    const { cx, cy } = getCoords(event)
    onCursorMove?.(cx, cy)
    onCursorFlush?.()
    cancelPassiveHover()
    if (!isEnabled()) return
    editor.setMeasurementMode('off')
    if (!drag.value) {
      editor.setHoveredNode(null)
      editor.setAutoLayoutHover(null)
      editor.setHoveredGuide(null)
      editor.setShapeHandleHover(null)
    }
  })
  useEventListener(
    window,
    'mouseup',
    (event) => {
      if (drag.value) onMouseUp(event)
    },
    { capture: true }
  )

  const stopRotationListener = editor.onEditorEvent('rotation:preview-changed', (preview) => {
    if (drag.value?.type === 'rotate' && preview?.nodeId !== drag.value.nodeId)
      cancelPointerInteraction()
  })
  const stopToolListener = editor.onEditorEvent('tool:changed', () => {
    if (!isEnabled()) return
    editor.setMeasurementMode('off')
    cancelPointerInteraction()
  })
  const stopPlayListeners = (['selection:changed', 'page:changed', 'graph:replaced'] as const).map(
    (event) =>
      editor.onEditorEvent(event, () => {
        const type = drag.value?.type
        if (type === 'draw' || type === 'rotate' || type === 'shape-handle' || type === 'resize')
          cancelPointerInteraction()
      })
  )
  tryOnScopeDispose(() => {
    stopRotationListener()
    stopToolListener()
    for (const stop of stopPlayListeners) stop()
    cancelPointerInteraction()
  })
  watch(
    isEnabled,
    (enabled) => {
      if (!enabled) cancelPointerInteraction()
    },
    { flush: 'sync' }
  )

  setupPanZoom(canvasRef, editor, drag, onMouseDown, onMouseMove, onMouseUp)
  tryOnScopeDispose(cancelPassiveHover)
  return {
    drag,
    cursorOverride,
    canvasLabelEdit: canvasLabelEdit.edit,
    updateCanvasLabelEdit: canvasLabelEdit.update,
    commitCanvasLabelEdit: canvasLabelEdit.commit,
    cancelCanvasLabelEdit: canvasLabelEdit.cancel,
    autoLayoutValueEdit: valueEdit.edit,
    updateAutoLayoutValueEdit: valueEdit.update,
    commitAutoLayoutValueEdit: valueEdit.commit,
    cancelAutoLayoutValueEdit: valueEdit.cancel,
    cleanupInteractions() {
      valueEdit.cancel()
      cancelPointerInteraction()
      pointerInside.value = false
      resetMeasurementModifiers()
    }
  }
}
