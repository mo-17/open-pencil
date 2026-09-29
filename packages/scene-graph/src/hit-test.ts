import type { SceneGraph, SceneNode, NodeType } from './'
import { getWorldMatrix } from './coordinate'
import Matrix from './matrix'
import type { Rect } from './primitives'

/** Host-owned presentation can restrict input without changing authored visibility. */
export interface HitTestOptions {
  /** Optional view boundary: ancestors outside it do not clip or hide this scope. */
  rootId?: string
  includeChild?: (parent: SceneNode, child: SceneNode) => boolean
  childClip?: (parent: SceneNode) => Rect | null
}

const CONTAINER_TYPES = new Set<NodeType>([
  'CANVAS',
  'FRAME',
  'FORM',
  'GROUP',
  'SECTION',
  'COMPONENT',
  'COMPONENT_SET',
  'INSTANCE'
])
const OPAQUE_CONTAINER_TYPES = new Set<NodeType>(['COMPONENT', 'INSTANCE'])

function hasVisibleFillOrStroke(node: SceneNode): boolean {
  return node.fills.some((f) => f.visible) || node.strokes.some((s) => s.visible)
}

function hasTransformedAncestor(
  node: SceneNode,
  graph: SceneGraph,
  cache: Map<string, boolean>
): boolean {
  const cached = cache.get(node.id)
  if (cached !== undefined) return cached
  const parent = node.parentId ? graph.getNode(node.parentId) : undefined
  const transformed =
    node.rotation !== 0 ||
    node.flipX ||
    node.flipY ||
    (parent ? hasTransformedAncestor(parent, graph, cache) : false)
  cache.set(node.id, transformed)
  return transformed
}

function containsPoint(
  px: number,
  py: number,
  node: SceneNode,
  graph: SceneGraph,
  transformCache: Map<string, boolean>,
  bounds: Rect = { x: 0, y: 0, width: node.width, height: node.height }
): boolean {
  if (!hasTransformedAncestor(node, graph, transformCache)) {
    const absolute = graph.getAbsolutePosition(node.id)
    return (
      px >= absolute.x + bounds.x &&
      px <= absolute.x + bounds.x + bounds.width &&
      py >= absolute.y + bounds.y &&
      py <= absolute.y + bounds.y + bounds.height
    )
  }

  const m = getWorldMatrix(node, graph)

  const inv = Matrix.invert(m)
  if (!inv) return false

  const [localX, localY] = Matrix.mapPoints(inv, [px, py])
  return (
    localX >= bounds.x &&
    localX <= bounds.x + bounds.width &&
    localY >= bounds.y &&
    localY <= bounds.y + bounds.height
  )
}

function childrenContainPoint(
  graph: SceneGraph,
  px: number,
  py: number,
  parent: SceneNode,
  transformCache: Map<string, boolean>,
  options?: HitTestOptions
): boolean {
  if (parent.clipsContent && !containsPoint(px, py, parent, graph, transformCache)) return false
  const clip = options?.childClip?.(parent)
  return (
    !clip ||
    (clip.width > 0 &&
      clip.height > 0 &&
      containsPoint(px, py, parent, graph, transformCache, clip))
  )
}

function scopeIncludesPoint(
  graph: SceneGraph,
  px: number,
  py: number,
  scopeId: string,
  transformCache: Map<string, boolean>,
  options?: HitTestOptions
): boolean {
  let node = graph.getNode(scopeId)
  while (node) {
    if (!node.visible || node.internalOnly) return false
    if (node.id === options?.rootId) return true
    const parent = node.parentId ? graph.getNode(node.parentId) : undefined
    if (!parent) return options?.rootId === undefined
    if (
      options?.includeChild?.(parent, node) === false ||
      !childrenContainPoint(graph, px, py, parent, transformCache, options)
    )
      return false
    node = parent
  }
  return false
}

function hitTestOpaqueContainer(
  graph: SceneGraph,
  px: number,
  py: number,
  child: SceneNode,
  childId: string,
  deep: boolean,
  transformCache: Map<string, boolean>,
  options?: HitTestOptions
): SceneNode | null {
  if (!containsPoint(px, py, child, graph, transformCache)) return null
  const childHit = hitTestChildren(graph, px, py, childId, deep, transformCache, options)
  if (childHit) return child
  if (hasVisibleFillOrStroke(child)) return child
  return null
}
function hitTestTransparentContainer(
  graph: SceneGraph,
  px: number,
  py: number,
  child: SceneNode,
  childId: string,
  deep: boolean,
  transformCache: Map<string, boolean>,
  options?: HitTestOptions
): SceneNode | null {
  if (child.type === 'GROUP') {
    if (!containsPoint(px, py, child, graph, transformCache)) return null

    if (deep) return hitTestChildren(graph, px, py, childId, deep, transformCache, options) ?? child

    return child
  }

  const childHit = hitTestChildren(graph, px, py, childId, deep, transformCache, options)
  if (childHit) {
    if (child.locked) return child
    return childHit
  }

  if (containsPoint(px, py, child, graph, transformCache) && hasVisibleFillOrStroke(child))
    return child
  return null
}

function hitTestChildren(
  graph: SceneGraph,
  px: number,
  py: number,
  parentId: string,
  deep = false,
  transformCache = new Map<string, boolean>(),
  options?: HitTestOptions
): SceneNode | null {
  const parent = graph.nodes.get(parentId)
  if (!parent) return null

  if (!childrenContainPoint(graph, px, py, parent, transformCache, options)) return null

  for (let i = parent.childIds.length - 1; i >= 0; i--) {
    const childId = parent.childIds[i]
    const child = graph.nodes.get(childId)
    if (!child || child.internalOnly || !child.visible) continue
    if (options?.includeChild?.(parent, child) === false) continue
    if (CONTAINER_TYPES.has(child.type)) {
      if (OPAQUE_CONTAINER_TYPES.has(child.type) && !deep) {
        const hit = hitTestOpaqueContainer(
          graph,
          px,
          py,
          child,
          childId,
          deep,
          transformCache,
          options
        )
        if (hit) return hit
        continue
      }

      const hit = hitTestTransparentContainer(
        graph,
        px,
        py,
        child,
        childId,
        deep,
        transformCache,
        options
      )
      if (hit) return hit
      continue
    }

    if (containsPoint(px, py, child, graph, transformCache)) return child
  }

  return null
}

function hitTestInScope(
  graph: SceneGraph,
  px: number,
  py: number,
  deep: boolean,
  scopeId?: string,
  options?: HitTestOptions
): SceneNode | null {
  const scope = scopeId ?? graph.rootId
  const transformCache = new Map<string, boolean>()
  if (options && !scopeIncludesPoint(graph, px, py, scope, transformCache, options)) return null
  return hitTestChildren(graph, px, py, scope, deep, transformCache, options)
}

export function hitTest(
  graph: SceneGraph,
  px: number,
  py: number,
  scopeId?: string,
  options?: HitTestOptions
): SceneNode | null {
  return hitTestInScope(graph, px, py, false, scopeId, options)
}

export function hitTestDeep(
  graph: SceneGraph,
  px: number,
  py: number,
  scopeId?: string,
  options?: HitTestOptions
): SceneNode | null {
  return hitTestInScope(graph, px, py, true, scopeId, options)
}

function hitTestFrameChildren(
  graph: SceneGraph,
  px: number,
  py: number,
  parentId: string,
  excludeIds: Set<string>,
  transformCache: Map<string, boolean>,
  options?: HitTestOptions
): SceneNode | null {
  const parent = graph.nodes.get(parentId)
  if (!parent) return null
  if (!childrenContainPoint(graph, px, py, parent, transformCache, options)) return null

  let best: SceneNode | null = null

  for (const childId of parent.childIds) {
    if (excludeIds.has(childId)) continue
    const child = graph.nodes.get(childId)
    if (!child || child.internalOnly || !child.visible) continue
    if (options?.includeChild?.(parent, child) === false) continue

    if (!CONTAINER_TYPES.has(child.type)) continue
    if (!containsPoint(px, py, child, graph, transformCache)) continue

    best = child

    const deeper = hitTestFrameChildren(graph, px, py, childId, excludeIds, transformCache, options)
    if (deeper) best = deeper
  }

  return best
}

export function hitTestFrame(
  graph: SceneGraph,
  px: number,
  py: number,
  excludeIds: Set<string>,
  scopeId?: string,
  options?: HitTestOptions
): SceneNode | null {
  const scope = scopeId ?? graph.rootId
  const transformCache = new Map<string, boolean>()
  if (options && !scopeIncludesPoint(graph, px, py, scope, transformCache, options)) return null
  return hitTestFrameChildren(graph, px, py, scope, excludeIds, transformCache, options)
}
