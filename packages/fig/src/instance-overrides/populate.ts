import type { SceneGraph } from '@open-pencil/scene-graph'

/**
 * Populate empty INSTANCE nodes from their source components.
 *
 * Instances must be populated bottom-up: if an instance's source is
 * itself an unpopulated instance, populate the source first so cloned
 * children are complete.
 */
function collectSubtreeIds(graph: SceneGraph, rootIds: Iterable<string>): Set<string> {
  const result = new Set<string>()
  const queue = [...rootIds]
  let index = 0
  while (index < queue.length) {
    const id = queue[index]
    index++
    if (result.has(id)) continue
    result.add(id)
    const node = graph.getNode(id)
    if (node) queue.push(...node.childIds)
  }
  return result
}

export function populateInstances(
  graph: SceneGraph,
  rootIds?: Iterable<string>
): Set<string> | undefined {
  const processed = new Set<string>()

  // eslint-disable-next-line complexity -- the explicit phases keep untrusted dependency walks iterative
  function ensurePopulated(nodeId: string): void {
    const active = new Set<string>()
    const stack: Array<{ nodeId: string; phase: 'component' | 'children' | 'populate' }> = [
      { nodeId, phase: 'component' }
    ]

    while (stack.length > 0) {
      const entry = stack.pop()
      if (!entry) break
      const node = graph.getNode(entry.nodeId)

      if (entry.phase === 'component') {
        if (processed.has(entry.nodeId)) continue
        if (node?.type !== 'INSTANCE' || !node.componentId || node.childIds.length > 0) {
          processed.add(entry.nodeId)
          continue
        }
        // A cyclic component dependency cannot be populated, but it must not recurse forever.
        if (active.has(entry.nodeId)) continue
        active.add(entry.nodeId)
        stack.push({ nodeId: entry.nodeId, phase: 'children' })
        const component = graph.getNode(node.componentId)
        if (
          component?.type === 'INSTANCE' &&
          component.componentId &&
          component.childIds.length === 0
        ) {
          stack.push({ nodeId: component.id, phase: 'component' })
        }
        continue
      }

      const componentId = node?.type === 'INSTANCE' ? node.componentId : null
      const component = componentId ? graph.getNode(componentId) : undefined
      if (entry.phase === 'children') {
        stack.push({ nodeId: entry.nodeId, phase: 'populate' })
        if (!component) continue
        for (let index = component.childIds.length - 1; index >= 0; index -= 1) {
          const child = graph.getNode(component.childIds[index])
          if (child?.type === 'INSTANCE' && child.componentId && child.childIds.length === 0) {
            stack.push({ nodeId: child.id, phase: 'component' })
          }
        }
        continue
      }

      if (node?.type === 'INSTANCE' && component && node.childIds.length === 0) {
        if (component.childIds.length > 0) {
          graph.populateInstanceChildren(node.id, component.id, 'fig-import')
        }
      }
      active.delete(entry.nodeId)
      processed.add(entry.nodeId)
    }
  }

  if (!rootIds) {
    for (const node of graph.nodes.values()) {
      if (node.type === 'INSTANCE' && node.componentId && node.childIds.length === 0) {
        ensurePopulated(node.id)
      }
    }
    return undefined
  }

  const queue = [...rootIds]
  const visited = new Set<string>()
  let index = 0
  while (index < queue.length) {
    const nodeId = queue[index]
    index++
    if (!nodeId || visited.has(nodeId)) continue
    visited.add(nodeId)
    ensurePopulated(nodeId)
    const node = graph.getNode(nodeId)
    if (!node) continue
    queue.push(...node.childIds)
  }
  return collectSubtreeIds(graph, rootIds)
}
