import { computeAllLayouts, computeLayout } from '#core/layout'
import { isAutoLayoutMode, type SceneGraph } from '#core/scene-graph'

export function createLayoutRunner(getGraph: () => SceneGraph) {
  function runLayoutForNode(id: string) {
    const graph = getGraph()
    const node = graph.getNode(id)
    if (!node) return

    computeAllLayouts(graph, id)

    let parent = node.parentId ? graph.getNode(node.parentId) : undefined
    while (parent) {
      if (isAutoLayoutMode(parent.layoutMode)) {
        computeLayout(graph, parent.id)
      }
      parent = parent.parentId ? graph.getNode(parent.parentId) : undefined
    }
  }

  return { runLayoutForNode }
}
