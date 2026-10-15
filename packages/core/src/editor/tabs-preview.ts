import type { SceneNode } from '@open-pencil/scene-graph'

import { resolveTabsContent } from '#core/plugins/content/tabs'
import { tabsPreviewNode } from '#core/plugins/content/tabs-preview'
import { resolveTabsModule } from '#core/plugins/tabs'

import { createSelectionPresentation, isPresentedNode } from './selection/presentation'
import type { EditorContext } from './types'

export function createTabsPreviewActions(
  ctx: EditorContext,
  finishTextEdit: (preserveDrafts: boolean) => void
) {
  let previewGraph = ctx.graph
  let finishingText = false

  function finishPreviewTextEdit(preserveDrafts: boolean): void {
    if (finishingText) return
    finishingText = true
    try {
      finishTextEdit(preserveDrafts)
    } finally {
      finishingText = false
    }
  }

  function within(id: string, hostId: string, graph = ctx.graph): boolean {
    let node = graph.getNode(id)
    while (node) {
      if (node.id === hostId) return true
      node = node.parentId ? graph.getNode(node.parentId) : undefined
    }
    return false
  }

  function validTarget(nodeId: string, tabId: string): boolean {
    const host = ctx.graph.getNode(nodeId)
    if (host?.type !== 'FRAME') return false
    const resolved = resolveTabsModule(host.interactiveProps?.module)
    if (!resolved?.ok) return false
    const tab = resolved.config.tabs.find((item) => item.id === tabId)
    if (!tab) return false
    if (
      tab.contentChildName &&
      !resolveTabsContent(ctx.graph, tabsPreviewNode(host, { nodeId, tabId }))?.activeChildId
    )
      return false
    let ancestor: SceneNode | undefined = host
    while (ancestor) {
      if (!ancestor.visible || ancestor.internalOnly) return false
      if (ancestor.id === ctx.state.currentPageId) return true
      ancestor = ancestor.parentId ? ctx.graph.getNode(ancestor.parentId) : undefined
    }
    return false
  }

  function sanitizeSelection(hostId: string) {
    const presentation = createSelectionPresentation(
      ctx.graph,
      ctx.state.contentEdit?.rootId,
      ctx.state.tabsPreview
    )
    const presented = (id: string) => {
      const node = ctx.graph.getNode(id)
      return !!node && isPresentedNode(ctx.graph, node, presentation)
    }
    if (
      ctx.state.editingTextId &&
      within(ctx.state.editingTextId, hostId) &&
      !presented(ctx.state.editingTextId)
    )
      finishPreviewTextEdit(previewGraph === ctx.graph)
    if ([...ctx.state.selectedIds].some((id) => within(id, hostId) && !presented(id))) {
      ctx.setSelectedIds(new Set(presented(hostId) ? [hostId] : []))
    }
    if (ctx.state.enteredContainerId && !presented(ctx.state.enteredContainerId))
      ctx.state.enteredContainerId = ctx.state.contentEdit?.rootId ?? null
    if (ctx.state.hoveredNodeId && !presented(ctx.state.hoveredNodeId))
      ctx.state.hoveredNodeId = null
  }

  function clearPreview(nodeId?: string, finishEditing = true) {
    const preview = ctx.state.tabsPreview
    if (!preview || (nodeId !== undefined && preview.nodeId !== nodeId)) return
    ctx.state.tabsPreview = null
    const editingId = ctx.state.editingTextId
    if (
      editingId &&
      (within(editingId, preview.nodeId, previewGraph) || !previewGraph.getNode(editingId))
    ) {
      finishPreviewTextEdit(
        finishEditing &&
          previewGraph === ctx.graph &&
          within(preview.nodeId, ctx.state.currentPageId, previewGraph) &&
          !!previewGraph.getNode(editingId)
      )
    }
    sanitizeSelection(preview.nodeId)
    ctx.requestRepaint()
  }

  function clearTabsTabPreview(nodeId?: string) {
    clearPreview(nodeId)
  }

  function getTabsTabPreview(nodeId: string): string | undefined {
    const preview = ctx.state.tabsPreview
    return preview?.nodeId === nodeId &&
      previewGraph === ctx.graph &&
      validTarget(nodeId, preview.tabId)
      ? preview.tabId
      : undefined
  }

  function previewTabsTab(nodeId: string, tabId: string): boolean {
    if (!validTarget(nodeId, tabId)) return false
    if (getTabsTabPreview(nodeId) === tabId) return true
    finishPreviewTextEdit(true)
    previewGraph = ctx.graph
    const previous = ctx.state.tabsPreview
    ctx.state.tabsPreview = { nodeId, tabId }
    if (previous && previous.nodeId !== nodeId) sanitizeSelection(previous.nodeId)
    sanitizeSelection(nodeId)
    ctx.requestRepaint()
    return true
  }

  function validatePreview() {
    const preview = ctx.state.tabsPreview
    if (!preview) return
    if (!validTarget(preview.nodeId, preview.tabId)) clearPreview()
    else sanitizeSelection(preview.nodeId)
  }
  ctx.onEditorEvent('selection:changed', (ids) => {
    const preview = ctx.state.tabsPreview
    if (!preview) return
    const editingWithin =
      ctx.state.contentEdit && within(ctx.state.contentEdit.rootId, preview.nodeId)
    if (ids.some((id) => !within(id, preview.nodeId)) || (ids.length === 0 && !editingWithin))
      clearTabsTabPreview()
    else sanitizeSelection(preview.nodeId)
  })
  ctx.onEditorEvent('node:updated', validatePreview)
  ctx.onEditorEvent('node:deleted', validatePreview)
  ctx.onEditorEvent('node:created', validatePreview)
  ctx.onEditorEvent('node:reparented', validatePreview)
  ctx.onEditorEvent('page:changed', () => clearPreview(undefined, false))
  ctx.onEditorEvent('graph:replaced', () => clearPreview(undefined, false))

  return { previewTabsTab, clearTabsTabPreview, getTabsTabPreview }
}
