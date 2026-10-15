import {
  collectSceneMutation,
  isAutoLayoutMode,
  mutationLayoutScopeIds,
  type SceneGraph,
  type SceneMutationImpact
} from '@open-pencil/scene-graph'

import { computeAllLayouts, computeLayout } from '#core/layout'
import { resolveModalContent } from '#core/plugins/content/modal'
import { resolveTabsContent } from '#core/plugins/content/tabs'

export function createLayoutRunner(getGraph: () => SceneGraph) {
  function runLayoutForNode(id: string) {
    const graph = getGraph()
    let node = graph.getNode(id)
    if (!node) return

    // A slot owns its descendants' geometry. Start there before an ordinary
    // imported layout pass can reapply stale size hints to the edited child.
    let descendant = node
    let ancestor = node.parentId ? graph.getNode(node.parentId) : undefined
    while (ancestor) {
      const content = resolveTabsContent(graph, ancestor)
      const descendantId = descendant.id
      if (
        content?.panels.some((panel) => panel.id === descendantId) ||
        resolveModalContent(graph, ancestor)?.id === descendantId
      ) {
        node = ancestor
        break
      }
      descendant = ancestor
      ancestor = ancestor.parentId ? graph.getNode(ancestor.parentId) : undefined
    }
    const layoutRoot = node
    graph.preserveSourceMetadataDuring(() => {
      computeAllLayouts(graph, layoutRoot.id)

      let parent = layoutRoot.parentId ? graph.getNode(layoutRoot.parentId) : undefined
      while (parent) {
        if (
          isAutoLayoutMode(parent.layoutMode) ||
          resolveTabsContent(graph, parent) ||
          resolveModalContent(graph, parent)
        ) {
          computeLayout(graph, parent.id)
        }
        parent = parent.parentId ? graph.getNode(parent.parentId) : undefined
      }
    })
  }

  function compactLayoutScope(impact: SceneMutationImpact): string[] {
    const graph = getGraph()
    const candidates = new Set(mutationLayoutScopeIds(impact).filter((id) => graph.getNode(id)))
    return [...candidates].filter((id) => {
      let parentId = graph.getNode(id)?.parentId ?? null
      while (parentId) {
        if (candidates.has(parentId)) return false
        parentId = graph.getNode(parentId)?.parentId ?? null
      }
      return true
    })
  }

  async function runMutationWithLayout<T>(
    operation: () => T | Promise<T>,
    fallbackId?: string,
    beforeLayout?: (result: T) => Promise<void> | void
  ): Promise<T> {
    const graph = getGraph()
    const { result, impact } = await collectSceneMutation(graph, operation)
    await beforeLayout?.(result)
    if (!runLayoutForImpact(impact) && fallbackId) {
      graph.preserveSourceMetadataDuring(() => computeAllLayouts(graph, fallbackId))
    }
    return result
  }

  /** Lays out what an edit touched; returns whether there was anything to lay out. */
  function runLayoutForImpact(impact: SceneMutationImpact): boolean {
    const scopeIds = compactLayoutScope(impact)
    for (const id of scopeIds) runLayoutForNode(id)
    return scopeIds.length > 0
  }

  return { runLayoutForNode, runLayoutForImpact, runMutationWithLayout }
}
