import type { SkiaRenderer } from '@open-pencil/core/canvas'
import type { Editor } from '@open-pencil/core/editor'

import { useViewportKind } from '#vue/editor/viewport-kind/use'

export type RulerVisibilityOptions = {
  showRulers?: boolean
}

export function createRulerVisibility(options?: RulerVisibilityOptions) {
  const { isMobile } = useViewportKind()

  return function shouldShowRulers() {
    if (options?.showRulers === false) return false
    return !isMobile.value
  }
}

export function createCanvasHitTests(editor: Editor, getRenderer: () => SkiaRenderer | null) {
  function hitTestSectionTitle(canvasX: number, canvasY: number) {
    if (editor.state.contentEdit) return null
    return (
      getRenderer()?.hitTestSectionTitle(
        editor.graph,
        canvasX,
        canvasY,
        editor.state.rotationPreview
      ) ?? null
    )
  }

  function hitTestComponentLabel(canvasX: number, canvasY: number) {
    if (editor.state.contentEdit) return null
    return (
      getRenderer()?.hitTestComponentLabel(
        editor.graph,
        canvasX,
        canvasY,
        editor.state.rotationPreview
      ) ?? null
    )
  }

  function hitTestFrameTitle(canvasX: number, canvasY: number) {
    if (editor.state.contentEdit) return null
    return (
      getRenderer()?.hitTestFrameTitle(
        editor.graph,
        canvasX,
        canvasY,
        editor.state.selectedIds,
        editor.state.rotationPreview
      ) ?? null
    )
  }

  return { hitTestSectionTitle, hitTestComponentLabel, hitTestFrameTitle }
}
