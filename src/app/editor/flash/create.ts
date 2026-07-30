import type { SkiaRenderer } from '@open-pencil/core/canvas'

type FlashRenderer = Pick<
  SkiaRenderer,
  'hasActiveFlashes' | 'flashNode' | 'aiMarkActive' | 'aiMarkDone' | 'aiFlashDone' | 'aiClearAll'
>

type FlashEditor = {
  readonly renderer: FlashRenderer | null
  requestOverlayRepaint: () => void
}

const FLASH_FRAME_INTERVAL_MS = 1000 / 30

export function createFlashActions(editor: FlashEditor) {
  let flashRafId = 0
  let lastRepaintAt = Number.NEGATIVE_INFINITY

  function pumpFlashes(timestampMs: number) {
    if (!editor.renderer?.hasActiveFlashes) {
      flashRafId = 0
      return
    }
    if (timestampMs - lastRepaintAt >= FLASH_FRAME_INTERVAL_MS) {
      lastRepaintAt = timestampMs
      editor.requestOverlayRepaint()
    }
    flashRafId = requestAnimationFrame(pumpFlashes)
  }

  function startPump() {
    if (flashRafId) return
    lastRepaintAt = Number.NEGATIVE_INFINITY
    flashRafId = requestAnimationFrame(pumpFlashes)
  }

  function flashNodes(nodeIds: string[]) {
    const renderer = editor.renderer
    if (!renderer) return
    for (const id of nodeIds) renderer.flashNode(id)
    startPump()
  }

  function aiMarkActive(nodeIds: string[]) {
    if (!editor.renderer) return
    editor.renderer.aiMarkActive(nodeIds)
    startPump()
  }

  function aiMarkDone(nodeIds: string[]) {
    if (!editor.renderer) return
    editor.renderer.aiMarkDone(nodeIds)
    startPump()
  }

  function aiFlashDone(nodeIds: string[]) {
    if (!editor.renderer) return
    editor.renderer.aiFlashDone(nodeIds)
    startPump()
  }

  function aiClearAll() {
    editor.renderer?.aiClearAll()
    editor.requestOverlayRepaint()
    if (flashRafId && !editor.renderer?.hasActiveFlashes) {
      cancelAnimationFrame(flashRafId)
      flashRafId = 0
    }
  }

  function dispose() {
    if (flashRafId) cancelAnimationFrame(flashRafId)
    flashRafId = 0
    editor.renderer?.aiClearAll()
  }

  return {
    flashNodes,
    aiMarkActive,
    aiMarkDone,
    aiFlashDone,
    aiClearAll,
    dispose
  }
}
