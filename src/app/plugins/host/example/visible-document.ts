import type { SceneNode } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/active-store'

export interface ExampleVisibleDocumentEditor {
  graph: Pick<EditorStore['graph'], 'getNode' | 'getPages'>
}

/**
 * Traverse only user-visible pages and stop before every internal-only subtree.
 * The example adapters share this helper so their aggregate results cannot expose
 * library-cache or other host-owned implementation nodes.
 */
export function collectExampleVisibleDocumentNodes(
  editor: ExampleVisibleDocumentEditor,
  signal?: AbortSignal
): Readonly<{ pages: readonly SceneNode[]; nodes: readonly SceneNode[] }> {
  signal?.throwIfAborted()
  const pages = editor.graph.getPages()
  const nodes: SceneNode[] = []
  const visited = new Set<string>()
  const pendingNodeIds = pages.flatMap((page) => page.childIds)

  while (pendingNodeIds.length > 0) {
    signal?.throwIfAborted()
    const nodeId = pendingNodeIds.pop()
    if (!nodeId || visited.has(nodeId)) continue
    visited.add(nodeId)

    const node = editor.graph.getNode(nodeId)
    if (!node || node.internalOnly) continue
    nodes.push(node)
    for (const childId of node.childIds) pendingNodeIds.push(childId)
  }

  signal?.throwIfAborted()
  return { pages, nodes }
}
