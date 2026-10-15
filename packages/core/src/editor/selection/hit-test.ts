import type { SceneNode } from '@open-pencil/scene-graph'
import { hitTestFrame } from '@open-pencil/scene-graph/hit-test'

import { LAYER_HIT_PAD } from '#core/constants'
import type { EditorContext } from '#core/editor/types'
import { createSceneGeometry } from '#core/geometry/scene'

import { createSelectionPresentation, isPresentedNode } from './presentation'

export function createSelectionHitTestActions(
  ctx: EditorContext,
  select: (ids: string[], additive?: boolean) => void,
  clearSelection: () => void
) {
  function queryAtPoint(
    cx: number,
    cy: number,
    deep: boolean,
    scopeId: string,
    presentation = createSelectionPresentation(
      ctx.graph,
      ctx.state.contentEdit?.rootId,
      ctx.state.tabsPreview
    )
  ): SceneNode | null {
    const pad = LAYER_HIT_PAD / ctx.state.zoom
    const hit = deep
      ? ctx.graph.hitTestDeep(cx, cy, scopeId, pad, presentation)
      : ctx.graph.hitTestSelectable(cx, cy, scopeId, ctx.state.selectedIds, pad, presentation)
    if (hit || scopeId !== ctx.state.contentEdit?.rootId) return hit
    const root = ctx.graph.getNode(scopeId)
    if (!root || !isPresentedNode(ctx.graph, root, presentation)) return null
    const local = createSceneGeometry(ctx.graph).toLocal(root, {
      x: cx,
      y: cy
    })
    return local && local.x >= 0 && local.y >= 0 && local.x <= root.width && local.y <= root.height
      ? root
      : null
  }

  function hitTestPageAtPoint(cx: number, cy: number, deep = true): SceneNode | null {
    return queryAtPoint(cx, cy, deep, ctx.state.contentEdit?.rootId ?? ctx.state.currentPageId)
  }

  function hitTestAtPoint(
    cx: number,
    cy: number,
    deep = false,
    explicitScopeId?: string
  ): SceneNode | null {
    const renderer = ctx.getRenderer()
    if (!renderer) return null
    const presentation = createSelectionPresentation(
      ctx.graph,
      ctx.state.contentEdit?.rootId,
      ctx.state.tabsPreview
    )
    const scopeId = explicitScopeId ?? ctx.state.enteredContainerId ?? ctx.state.contentEdit?.rootId
    if (scopeId) {
      const scopeNode = ctx.graph.getNode(scopeId)
      if (!scopeNode || !isPresentedNode(ctx.graph, scopeNode, presentation)) {
        if (explicitScopeId) return null
        ctx.state.enteredContainerId = ctx.state.contentEdit?.rootId ?? null
      } else {
        return queryAtPoint(cx, cy, deep, scopeId, presentation)
      }
    }
    return queryAtPoint(
      cx,
      cy,
      deep,
      ctx.state.contentEdit?.rootId ?? ctx.state.currentPageId,
      presentation
    )
  }

  function hitTestFrameAtPoint(cx: number, cy: number, excludeIds = ctx.state.selectedIds) {
    return hitTestFrame(
      ctx.graph,
      cx,
      cy,
      excludeIds,
      ctx.state.contentEdit?.rootId ?? ctx.state.currentPageId,
      createSelectionPresentation(ctx.graph, ctx.state.contentEdit?.rootId, ctx.state.tabsPreview)
    )
  }

  function getCanvasSelectionChildren(parentId: string): SceneNode[] {
    const presentation = createSelectionPresentation(
      ctx.graph,
      ctx.state.contentEdit?.rootId,
      ctx.state.tabsPreview
    )
    const parent = ctx.graph.getNode(parentId)
    if (!parent || !isPresentedNode(ctx.graph, parent, presentation)) return []
    return ctx.graph
      .getChildren(parentId)
      .filter((child) => isPresentedNode(ctx.graph, child, presentation))
  }

  /**
   * Selects what a right-click is over, as Figma does: the layer a click would select, or else the
   * frame or section whose empty area is under the point, which a click leaves for a marquee.
   */
  function selectAtPoint(cx: number, cy: number) {
    const scopeId = ctx.state.enteredContainerId ?? ctx.state.currentPageId
    const hit = hitTestAtPoint(cx, cy) ?? ctx.graph.hitTestOpenContainer(cx, cy, scopeId)
    if (hit) {
      if (!ctx.state.selectedIds.has(hit.id)) select([hit.id])
    } else {
      clearSelection()
    }
  }

  return {
    hitTestAtPoint,
    hitTestPageAtPoint,
    hitTestFrameAtPoint,
    getCanvasSelectionChildren,
    selectAtPoint
  }
}
