import { isAutoLayoutMode, type SceneNode } from '@open-pencil/scene-graph'

import type { ComputeLayoutStepsFn, LayoutApplyStep } from '#core/layout/apply'
import type { LayoutGraph } from '#core/layout/graph'
import { resolveModalContent } from '#core/plugins/content/modal'
import { resolveTabsContent } from '#core/plugins/content/tabs'

const GEOMETRY_KEYS = ['x', 'y', 'width', 'height'] as const

/** Yoga sees live slot constraints; imported hints and temporary sizing stay in this local view. */
export function createContentLayoutGraph(graph: LayoutGraph) {
  const nodes = new Map<string, SceneNode>()
  const changed = new Set<string>()
  const importedSubtrees = new Map<string, boolean>()
  const preservesImportedSubtree = (node: SceneNode): boolean => {
    const cached = importedSubtrees.get(node.id)
    if (cached !== undefined) return cached
    const parent = node.parentId ? graph.getNode(node.parentId) : undefined
    const preserved =
      (node.type === 'INSTANCE' && node.source.format === 'fig') ||
      (parent !== undefined && preservesImportedSubtree(parent))
    importedSubtrees.set(node.id, preserved)
    return preserved
  }
  const getNode = (id: string): SceneNode | undefined => {
    let node = nodes.get(id)
    if (node) return node
    const original = graph.getNode(id)
    if (!original) return undefined
    node = preservesImportedSubtree(original)
      ? { ...original }
      : { ...original, derivedLayout: null, source: { ...original.source, format: null } }
    nodes.set(id, node)
    return node
  }
  const view: LayoutGraph = {
    getNode,
    getChildren: (id) =>
      (getNode(id)?.childIds ?? []).flatMap((childId) => {
        const child = getNode(childId)
        return child ? [child] : []
      }),
    updateNode: (id, updates) => {
      const node = getNode(id)
      if (!node) return
      Object.assign(node, updates)
      changed.add(id)
    }
  }
  function* publish(): Generator<LayoutApplyStep, void, void> {
    for (const id of changed) {
      const node = nodes.get(id)
      const original = graph.getNode(id)
      if (!node || !original) continue
      const geometry: Partial<SceneNode> = {}
      for (const key of GEOMETRY_KEYS) {
        if (node[key] !== original[key]) geometry[key] = node[key]
      }
      if (Object.keys(geometry).length > 0) {
        const writer = graph as LayoutGraph & {
          preserveSourceMetadataDuring?: <T>(operation: () => T) => T
        }
        const update = () =>
          graph.updateNode(id, { ...geometry, derivedLayout: original.derivedLayout })
        if (writer.preserveSourceMetadataDuring) writer.preserveSourceMetadataDuring(update)
        else update()
      }
      yield 'work'
    }
  }
  return { view, publish }
}

/** Find uncovered layout roots, while nested modules own the traversal of their own slots. */
export function* layoutContentSteps(
  graph: LayoutGraph,
  rootId: string,
  computeLayoutSteps: ComputeLayoutStepsFn
): Generator<LayoutApplyStep, void, void> {
  const pending = [{ id: rootId, covered: false }]
  const roots: string[] = []
  const visited = new Set<string>()
  while (pending.length > 0) {
    const next = pending.pop()
    if (!next || visited.has(next.id)) continue
    visited.add(next.id)
    const node = graph.getNode(next.id)
    if (!node) continue
    // Imported instances own their internal geometry even when their outer box
    // is placed in a slot. Match the ordinary Yoga layout preservation boundary.
    if (node.type === 'INSTANCE' && node.source.format === 'fig') {
      yield 'work'
      continue
    }
    const module = resolveTabsContent(graph, node) ?? resolveModalContent(graph, node)
    const participates = isAutoLayoutMode(node.layoutMode) || module !== null
    if (participates && !next.covered) roots.push(node.id)
    if (!module) {
      for (const child of graph.getChildren(node.id)) {
        pending.push({
          id: child.id,
          covered:
            participates &&
            child.visible &&
            child.layoutPositioning !== 'ABSOLUTE' &&
            (isAutoLayoutMode(child.layoutMode) ||
              resolveTabsContent(graph, child) !== null ||
              resolveModalContent(graph, child) !== null)
        })
      }
    }
    yield 'work'
  }
  for (const id of roots) yield* computeLayoutSteps(graph, id)
}
