import { tryOnScopeDispose, useEventListener } from '@vueuse/core'
import { ref, type Ref } from 'vue'

import type { Editor } from '@open-pencil/core/editor'
import type { SceneNode } from '@open-pencil/scene-graph'

import { createGuideInput, selectedTopLevelGuideFrameId } from '#vue/canvas/guides/input'
import { handlePenDragMove, updatePenHover } from '#vue/canvas/pen/input'
import { createCanvasPointer } from '#vue/canvas/pointer/use'
import { createTextEditInput } from '#vue/canvas/text-edit/input'
import { handleToolMouseDown } from '#vue/canvas/tools/input'
import { createCanvasTransformInput } from '#vue/canvas/transform/input'
import {
  handleBendHandleMove,
  handleNodeEditPointerUp,
  updateNodeEditHover
} from '#vue/canvas/vector-input/input'
import { resolveAutoLayoutHover } from '#vue/shared/input/auto-layout-hover'
import { createClickCounter } from '#vue/shared/input/click-count'
import { handleDrawMove, handleDrawUp } from '#vue/shared/input/draw'
import { handleMoveMove, handleMoveUp } from '#vue/shared/input/move'
import { setupPanZoom } from '#vue/shared/input/pan-zoom'
import { applyResize, commitResizePreview } from '#vue/shared/input/resize'
import { updateHoverCursor } from '#vue/shared/input/select'
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
  const cursorOverride = ref<string | null>(null)
  const autoLayoutPaddingEdit = ref<{
    nodeId: string
    side: 'top' | 'right' | 'bottom' | 'left'
    value: number
    previous: number
  } | null>(null)
  const selectedIdsBeforeClickSequence = ref<ReadonlySet<string>>(new Set())
  const lastPointer = ref<{ sx: number; sy: number; cx: number; cy: number } | null>(null)
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

  function refreshMeasurement() {
    const mode = altHeld && canMeasure() ? (metaHeld || controlHeld ? 'deep' : 'shallow') : 'off'
    editor.setMeasurementMode(mode)
    const pointer = lastPointer.value
    if (!pointer || drag.value || editor.state.activeTool !== 'SELECT' || !pointerInside.value)
      return
    const guideCursor = guideInput.updateHover(pointer.sx, pointer.sy)
    cursorOverride.value =
      guideCursor ?? updateHoverCursor(pointer.cx, pointer.cy, editor, hitFns, mode === 'deep')
    editor.setAutoLayoutHover(
      mode === 'off' ? resolveAutoLayoutHover(pointer.cx, pointer.cy, editor) : null
    )
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
    getClickCount,
    wasSelectedBeforeClickSequence: (id) => selectedIdsBeforeClickSequence.value.has(id),
    setDrag
  })

  const {
    tryStartRotation,
    handlePanMove,
    handleRotateMove,
    handleTextSelectMove,
    handleMarqueeMove
  } = createCanvasTransformInput(editor, canvasToLocal, setDrag)

  function paddingValue(node: SceneNode, side: 'top' | 'right' | 'bottom' | 'left') {
    if (side === 'top') return node.paddingTop
    if (side === 'right') return node.paddingRight
    if (side === 'bottom') return node.paddingBottom
    return node.paddingLeft
  }

  function paddingKey(side: 'top' | 'right' | 'bottom' | 'left') {
    if (side === 'top') return 'paddingTop' as const
    if (side === 'right') return 'paddingRight' as const
    if (side === 'bottom') return 'paddingBottom' as const
    return 'paddingLeft' as const
  }

  function startAutoLayoutPaddingEdit(e: MouseEvent): boolean {
    const { cx, cy } = getCoords(e)
    const hover = resolveAutoLayoutHover(cx, cy, editor)
    if (hover?.kind !== 'padding' && hover?.kind !== 'padding-value') return false
    if (!hover.side) return false
    const node = editor.graph.getNode(hover.nodeId)
    if (!node) return false
    const value = paddingValue(node, hover.side)
    autoLayoutPaddingEdit.value = {
      nodeId: node.id,
      side: hover.side,
      value,
      previous: value
    }
    e.preventDefault()
    e.stopPropagation()
    return true
  }

  function updateAutoLayoutPaddingEdit(value: number) {
    const edit = autoLayoutPaddingEdit.value
    if (!edit || !Number.isFinite(value)) return
    const next = Math.max(0, value)
    autoLayoutPaddingEdit.value = { ...edit, value: next }
    editor.updateNode(edit.nodeId, { [paddingKey(edit.side)]: next })
  }

  function commitAutoLayoutPaddingEdit(value: number) {
    const edit = autoLayoutPaddingEdit.value
    if (!edit || !Number.isFinite(value)) {
      autoLayoutPaddingEdit.value = null
      return
    }
    const next = Math.max(0, value)
    editor.updateNode(edit.nodeId, { [paddingKey(edit.side)]: edit.previous })
    editor.updateNodeWithUndo(edit.nodeId, { [paddingKey(edit.side)]: next }, 'Update padding')
    autoLayoutPaddingEdit.value = null
  }

  function cancelAutoLayoutPaddingEdit() {
    const edit = autoLayoutPaddingEdit.value
    if (edit) editor.updateNode(edit.nodeId, { [paddingKey(edit.side)]: edit.previous })
    autoLayoutPaddingEdit.value = null
  }

  function onDblClick(e: MouseEvent) {
    if (startAutoLayoutPaddingEdit(e)) return
    onTextDblClick(e)
  }

  function onMouseDown(e: MouseEvent) {
    onActivate?.()
    if (!isEnabled()) return
    cancelPassiveHover()
    editor.setMeasurementMode('off')
    const paddingEdit = autoLayoutPaddingEdit.value
    if (paddingEdit) {
      commitAutoLayoutPaddingEdit(paddingEdit.value)
    }
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
    const { sx, sy, cx, cy } = getCoords(e)
    lastPointer.value = { sx, sy, cx, cy }
    onCursorMove?.(cx, cy)

    if (!drag.value) {
      updatePenHover(cx, cy, editor)
    }

    if (!drag.value) {
      updateNodeEditHover(editor, cx, cy)
    }

    if (!drag.value && editor.state.activeTool === 'SELECT') {
      schedulePassiveHover(sx, sy, cx, cy)
    }

    if (!drag.value) return
    const d = drag.value

    if (d.type === 'pan') {
      handlePanMove(d, e)
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
      handleMoveMove(d, cx, cy, sx, sy, editor, e.ctrlKey)
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

    if (d.type === 'edit-node' || d.type === 'edit-handle') {
      handleNodeEditMove(d, cx, cy, editor, e.altKey, e.metaKey || e.ctrlKey, e.shiftKey, e.ctrlKey)
      return
    }

    if (d.type === 'bend-handle') {
      handleBendHandleMove(d, cx, cy, e, editor)
      return
    }

    if (d.type === 'draw') {
      handleDrawMove(d, cx, cy, e.shiftKey, editor)
      return
    }

    handleMarqueeMove(d, cx, cy)
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
    } else if (d.type === 'rotate') {
      const preview = editor.state.rotationPreview
      if (preview) {
        editor.updateNode(d.nodeId, { rotation: preview.angle })
        editor.commitRotation(d.nodeId, d.origRotation)
      }
      editor.setRotationPreview(null)
    } else if (d.type === 'draw') handleDrawUp(d, editor)
    else if (d.type === 'marquee') editor.setMarquee(null)

    drag.value = null
    cursorOverride.value = null
    refreshMeasurement()
  }

  function clearTransientInteractionFeedback() {
    editor.setSnapGuides([])
    editor.setLayoutInsertIndicator(null)
    editor.setDropTarget(null)
    guideInput.clearHoverAndPreview()
  }

  function cancelPointerInteraction() {
    cancelPassiveHover()
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

  useEventListener(canvasRef, 'pointerdown', onPointerDown)
  useEventListener(canvasRef, 'pointerup', onPointerUp)
  useEventListener(canvasRef, 'pointercancel', onPointerCancel)
  useEventListener(canvasRef, 'dblclick', onDblClick)
  useEventListener(canvasRef, 'mousedown', onMouseDown)
  useEventListener(canvasRef, 'mousemove', onMouseMove)
  useEventListener(canvasRef, 'mouseup', onMouseUp)
  useEventListener(window, 'keydown', (event) => {
    if (!isEnabled()) return
    if (!guideInput.deleteSelected(event)) updateModifier(event.code, true)
  })
  useEventListener(window, 'keyup', (event) => updateModifier(event.code, false))
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

  const stopToolListener = editor.onEditorEvent('tool:changed', () => {
    if (!isEnabled()) return
    editor.setMeasurementMode('off')
    cancelPointerInteraction()
  })
  tryOnScopeDispose(stopToolListener)

  setupPanZoom(canvasRef, editor, drag, onMouseDown, onMouseMove, onMouseUp)
  tryOnScopeDispose(cancelPassiveHover)
  return {
    drag,
    cursorOverride,
    autoLayoutPaddingEdit,
    updateAutoLayoutPaddingEdit,
    commitAutoLayoutPaddingEdit,
    cancelAutoLayoutPaddingEdit,
    cleanupInteractions() {
      cancelPointerInteraction()
      cancelAutoLayoutPaddingEdit()
      pointerInside.value = false
      resetMeasurementModifiers()
    }
  }
}
