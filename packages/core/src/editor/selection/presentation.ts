import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import type { HitTestOptions } from '@open-pencil/scene-graph/hit-test'

import { modalHidesContent } from '#core/plugins/content/modal'
import { resolveTabsContent, type TabsContentProjection } from '#core/plugins/content/tabs'
import { tabsPreviewNode, type TabsTabPreview } from '#core/plugins/content/tabs-preview'
import { resolveEffectPickModule } from '#core/plugins/effect-pick'

export interface SelectionPresentation extends HitTestOptions {
  contentRootId?: string
}

/** Keep presentation choices local to this input query; config edits invalidate them immediately. */
export function createSelectionPresentation(
  graph: SceneGraph,
  contentRootId?: string,
  tabsPreview?: TabsTabPreview | null
): SelectionPresentation {
  const projections = new Map<string, TabsContentProjection | null>()
  function projection(parent: SceneNode) {
    if (!projections.has(parent.id))
      projections.set(parent.id, resolveTabsContent(graph, tabsPreviewNode(parent, tabsPreview)))
    return projections.get(parent.id)
  }
  return {
    contentRootId,
    rootId: contentRootId,
    hasOwnContent(node) {
      return (
        node.type === 'FRAME' && resolveEffectPickModule(node.interactiveProps?.module)?.ok === true
      )
    },
    includeChild(parent, child) {
      if (modalHidesContent(parent)) return false
      const content = projection(parent)
      return !content || content.activeChildId === child.id
    },
    childClip(parent) {
      return projection(parent)?.body ?? null
    }
  }
}

export function isPresentedNode(
  graph: SceneGraph,
  node: SceneNode,
  presentation: SelectionPresentation
): boolean {
  let current: SceneNode | undefined = node
  while (current) {
    if (!current.visible || current.internalOnly) return false
    if (current.id === presentation.contentRootId) return true
    const parent: SceneNode | undefined = current.parentId
      ? graph.getNode(current.parentId)
      : undefined
    if (parent && presentation.includeChild?.(parent, current) === false) return false
    current = parent
  }
  return presentation.contentRootId === undefined
}
