import type { SceneNode } from '@open-pencil/scene-graph'
import { CONTAINER_TYPES } from '@open-pencil/scene-graph/node-defaults'

import { createSceneGeometry } from '#core/geometry/scene'
import { resolveModalContent } from '#core/plugins/content/modal'
import { resolveTabsContent } from '#core/plugins/content/tabs'

import type { EditorContext } from './types'

/** Content editing is a view over the original graph, never a temporary document. */
export function isInContentEditScope(ctx: EditorContext, id: string): boolean {
  const scope = ctx.state.contentEdit
  if (!scope) return true
  let node = ctx.graph.getNode(id)
  while (node) {
    if (node.id === scope.rootId) return true
    node = node.parentId ? ctx.graph.getNode(node.parentId) : undefined
  }
  return false
}

export function contentEditInsertionParent(ctx: EditorContext): string | null {
  if (!ctx.state.contentEdit) return ctx.state.currentPageId
  const root = ctx.graph.getNode(ctx.state.contentEdit.rootId)
  if (!root || !CONTAINER_TYPES.has(root.type)) return null
  const entered = ctx.state.enteredContainerId
  const target = entered && isInContentEditScope(ctx, entered) ? ctx.graph.getNode(entered) : root
  return target && CONTAINER_TYPES.has(target.type) ? target.id : root.id
}

/** Capture before an asynchronous import; a later view must never receive its result. */
export function captureContentEditInsertion(ctx: EditorContext): () => boolean {
  const graph = ctx.graph
  const pageId = ctx.state.currentPageId
  const scope = ctx.state.contentEdit
  return () =>
    ctx.graph === graph &&
    ctx.state.currentPageId === pageId &&
    ctx.state.contentEdit === scope &&
    contentEditInsertionParent(ctx) !== null
}

export function createContentEditActions(
  ctx: EditorContext,
  finishEditing: (preserveDrafts: boolean) => void
) {
  let contentGraph: EditorContext['graph'] | null = null
  let exiting = false
  function safeContentNode(nodeId: string): SceneNode | undefined {
    const node = ctx.graph.getNode(nodeId)
    let ancestor = node
    while (ancestor) {
      if (
        !ancestor.visible ||
        ancestor.locked ||
        ancestor.internalOnly ||
        ancestor.type === 'INSTANCE' ||
        ancestor.type === 'COMPONENT' ||
        ancestor.type === 'COMPONENT_SET'
      )
        return undefined
      if (ancestor.id === ctx.state.currentPageId) return node
      ancestor = ancestor.parentId ? ctx.graph.getNode(ancestor.parentId) : undefined
    }
    return undefined
  }

  function editableRoot(rootId: string): SceneNode | undefined {
    const root = safeContentNode(rootId)
    const host = root?.parentId ? ctx.graph.getNode(root.parentId) : undefined
    if (!root || !host) return undefined
    const mapped =
      resolveModalContent(ctx.graph, host)?.id === rootId ||
      resolveTabsContent(ctx.graph, host)?.panels.some((panel) => panel.id === rootId)
    return mapped ? root : undefined
  }

  function canPreserveDrafts(rootId: string, hostId: string): boolean {
    if (contentGraph !== ctx.graph) return false
    const root = safeContentNode(rootId)
    if (!root || root.parentId !== hostId) return false
    // A broken name mapping ends the view, not the still-valid edit to its body.
    // Actual draft targets must remain writable descendants of that original body.
    return [ctx.state.editingTextId, ctx.state.penState?.resumingNodeId].every(
      (id) => !id || (!!safeContentNode(id) && isInContentEditScope(ctx, id))
    )
  }

  function exitContentEdit(restore = true, restoreSelection = true) {
    const scope = ctx.state.contentEdit
    if (!scope || exiting) return
    // Commit while the insertion target is still the body. Graph changes during
    // that commit can invalidate the mapping, so prevent recursive exit callbacks.
    const selectedIds = new Set(ctx.state.selectedIds)
    exiting = true
    try {
      finishEditing(canPreserveDrafts(scope.rootId, scope.hostId))
    } finally {
      exiting = false
    }
    ctx.state.contentEdit = null
    contentGraph = null
    ctx.state.enteredContainerId = null
    ctx.state.hoveredNodeId = null
    ctx.state.marquee = null
    ctx.state.snapGuides = []
    ctx.state.dropTargetId = null
    ctx.state.layoutInsertIndicator = null
    if (restore) {
      const previous = { panX: ctx.state.panX, panY: ctx.state.panY, zoom: ctx.state.zoom }
      Object.assign(ctx.state, scope.previousViewport)
      ctx.emitEditorEvent('viewport:changed', scope.previousViewport, previous)
      if (restoreSelection)
        ctx.setSelectedIds(new Set(ctx.graph.getNode(scope.hostId) ? [scope.hostId] : []))
    }
    if (!restore || !restoreSelection) ctx.setSelectedIds(selectedIds)
    ctx.requestRender()
  }

  function enterContentEdit(rootId: string): boolean {
    const root = editableRoot(rootId)
    if (!root?.parentId) return false
    if (ctx.state.contentEdit?.rootId === rootId) return true
    if (ctx.state.contentEdit) exitContentEdit()
    else finishEditing(true)
    ctx.runLayoutForNode(rootId)
    contentGraph = ctx.graph
    ctx.state.contentEdit = {
      rootId,
      hostId: root.parentId,
      previousViewport: { panX: ctx.state.panX, panY: ctx.state.panY, zoom: ctx.state.zoom }
    }
    ctx.state.enteredContainerId = rootId
    ctx.state.hoveredNodeId = null
    ctx.state.marquee = null
    ctx.state.snapGuides = []
    ctx.setSelectedIds(new Set())
    ctx.setActiveTool('SELECT')
    const bounds = createSceneGeometry(ctx.graph).bounds(root)
    const { width, height } = ctx.getViewportSize()
    const previous = { panX: ctx.state.panX, panY: ctx.state.panY, zoom: ctx.state.zoom }
    const zoom = Math.min(width / (bounds.width + 160), height / (bounds.height + 160), 1)
    ctx.state.zoom = zoom
    ctx.state.panX = (width - bounds.width * zoom) / 2 - bounds.x * zoom
    ctx.state.panY = (height - bounds.height * zoom) / 2 - bounds.y * zoom
    ctx.emitEditorEvent(
      'viewport:changed',
      { panX: ctx.state.panX, panY: ctx.state.panY, zoom },
      previous
    )
    ctx.requestRender()
    return true
  }

  function validateContentEdit() {
    const scope = ctx.state.contentEdit
    if (scope && !editableRoot(scope.rootId)) exitContentEdit()
  }
  ctx.onEditorEvent('selection:changed', (ids) => {
    if (ctx.state.contentEdit && ids.some((id) => !isInContentEditScope(ctx, id)))
      exitContentEdit(true, false)
  })
  ctx.onEditorEvent('node:created', validateContentEdit)
  ctx.onEditorEvent('node:deleted', validateContentEdit)
  ctx.onEditorEvent('node:updated', validateContentEdit)
  ctx.onEditorEvent('node:reparented', validateContentEdit)
  ctx.onEditorEvent('page:changed', () => exitContentEdit(false))
  ctx.onEditorEvent('graph:replaced', () => exitContentEdit(false))

  return {
    canEnterContentEdit: (rootId: string) => editableRoot(rootId) !== undefined,
    enterContentEdit,
    getContentEditInsertionParent: () => contentEditInsertionParent(ctx),
    exitContentEdit,
    isInContentEditScope: (id: string) => isInContentEditScope(ctx, id)
  }
}
