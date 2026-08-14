import type { SceneGraph } from '@open-pencil/scene-graph'

import type { ResolvedPenParseLimits } from './limits'

export function assertExpandedNodeCapacity(
  graph: SceneGraph,
  additionalNodes: number,
  limits?: ResolvedPenParseLimits
): void {
  if (!limits || graph.getNodeCount() + additionalNodes <= limits.maxExpandedNodes) return
  throw new RangeError(
    `Untrusted .pen document exceeds the expanded SceneGraph nodes limit (${limits.maxExpandedNodes})`
  )
}

export function assertInstanceExpansionCapacity(
  graph: SceneGraph,
  instanceId: string,
  componentId: string,
  limits?: ResolvedPenParseLimits
): void {
  if (!limits) return
  const component = graph.getNode(componentId)
  if (!component) return

  let additionalNodes = 0
  let relativeDepth = 0
  const visited = new Set([component.id])
  const pending = component.childIds.map((id) => ({ id, depth: 1 }))
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) break
    if (visited.has(current.id)) {
      throw new TypeError('Untrusted .pen document produced a cyclic component subtree')
    }
    const node = graph.getNode(current.id)
    if (!node) throw new TypeError('Untrusted .pen document produced a dangling component node')
    visited.add(current.id)
    additionalNodes += 1
    relativeDepth = Math.max(relativeDepth, current.depth)
    for (const childId of node.childIds) {
      pending.push({ id: childId, depth: current.depth + 1 })
    }
  }
  assertExpandedNodeCapacity(graph, additionalNodes, limits)

  const instanceDepth = depthFromGraphRoot(graph, instanceId, limits)
  if (instanceDepth + relativeDepth > limits.maxExpandedDepth) {
    throw new RangeError(
      `Untrusted .pen document exceeds the expanded SceneGraph depth limit (${limits.maxExpandedDepth})`
    )
  }
}

function depthFromGraphRoot(
  graph: SceneGraph,
  nodeId: string,
  limits: ResolvedPenParseLimits
): number {
  let node = graph.getNode(nodeId)
  let depth = 0
  const visited = new Set<string>()
  while (node?.parentId !== null) {
    if (!node || visited.has(node.id)) {
      throw new TypeError('Untrusted .pen document produced an invalid instance hierarchy')
    }
    visited.add(node.id)
    node = graph.getNode(node.parentId)
    depth += 1
    if (depth > limits.maxExpandedDepth) {
      throw new RangeError(
        `Untrusted .pen document exceeds the expanded SceneGraph depth limit (${limits.maxExpandedDepth})`
      )
    }
  }
  if (node.id !== graph.rootId) {
    throw new TypeError('Untrusted .pen document produced a disconnected instance hierarchy')
  }
  return depth
}

export function assertExpandedGraphShape(graph: SceneGraph, limits?: ResolvedPenParseLimits): void {
  if (!limits) return
  assertExpandedNodeCapacity(graph, 0, limits)

  const root = graph.getNode(graph.rootId)
  if (root?.parentId !== null) {
    throw new TypeError('Untrusted .pen document produced an invalid SceneGraph root')
  }

  const visited = new Set<string>()
  const visiting = new Set<string>()
  const incoming = new Set<string>()
  const pending: Array<{ id: string; depth: number; exit: boolean }> = [
    { id: root.id, depth: 0, exit: false }
  ]
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) break
    if (current.exit) {
      visiting.delete(current.id)
      visited.add(current.id)
      continue
    }
    if (visiting.has(current.id)) {
      throw new TypeError('Untrusted .pen document produced a cyclic SceneGraph')
    }
    if (visited.has(current.id)) continue
    if (current.depth > limits.maxExpandedDepth) {
      throw new RangeError(
        `Untrusted .pen document exceeds the expanded SceneGraph depth limit (${limits.maxExpandedDepth})`
      )
    }

    const node = graph.getNode(current.id)
    if (!node) throw new TypeError('Untrusted .pen document produced a dangling SceneGraph node')
    visiting.add(current.id)
    pending.push({ ...current, exit: true })
    for (let index = node.childIds.length - 1; index >= 0; index -= 1) {
      const childId = node.childIds[index]
      const child = graph.getNode(childId)
      if (!child || child.parentId !== node.id || incoming.has(childId)) {
        throw new TypeError('Untrusted .pen document produced an invalid SceneGraph hierarchy')
      }
      incoming.add(childId)
      pending.push({ id: childId, depth: current.depth + 1, exit: false })
    }
  }
  if (visited.size !== graph.getNodeCount()) {
    throw new TypeError('Untrusted .pen document produced a disconnected SceneGraph')
  }
}
