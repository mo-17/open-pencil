import type { EditorContext } from '#core/editor/types'

import { createSelectionPresentation, isPresentedNode } from './presentation'

export function createSelectionContainerActions(ctx: EditorContext) {
  function validateEnteredContainer() {
    const enteredId = ctx.state.enteredContainerId
    if (!enteredId) return
    const node = ctx.graph.getNode(enteredId)
    if (
      !node ||
      !isPresentedNode(
        ctx.graph,
        node,
        createSelectionPresentation(ctx.graph, ctx.state.contentEdit?.rootId, ctx.state.tabsPreview)
      )
    ) {
      ctx.state.enteredContainerId = ctx.state.contentEdit?.rootId ?? null
    }
  }

  function enterContainer(id: string) {
    if (!ctx.state.contentEdit && !ctx.state.tabsPreview) {
      ctx.state.enteredContainerId = id
      return
    }
    const node = ctx.graph.getNode(id)
    if (
      !node ||
      !isPresentedNode(
        ctx.graph,
        node,
        createSelectionPresentation(ctx.graph, ctx.state.contentEdit?.rootId, ctx.state.tabsPreview)
      )
    )
      return
    ctx.state.enteredContainerId = id
  }

  function exitContainer() {
    const entered = ctx.state.enteredContainerId
    if (!entered || entered === ctx.state.contentEdit?.rootId) return
    const node = ctx.graph.getNode(entered)
    const parentId = node?.parentId
    if (parentId && parentId !== ctx.state.currentPageId) {
      ctx.state.enteredContainerId = parentId
    } else {
      ctx.state.enteredContainerId = ctx.state.contentEdit?.rootId ?? null
    }
    ctx.setSelectedIds(new Set(entered ? [entered] : []))
  }

  return { validateEnteredContainer, enterContainer, exitContainer }
}
