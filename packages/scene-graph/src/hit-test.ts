import type { SceneGraph, SceneNode, NodeType } from './'
import { getWorldMatrix } from './coordinate'
import Matrix from './matrix'
import type { Rect } from './primitives'
import { isAutoLayoutMode } from './types'

/** Host-owned presentation supplies input boundaries without changing authored paints or visibility. */
export interface HitTestOptions {
  /** Optional view boundary: ancestors outside it do not clip or hide this scope. */
  rootId?: string
  includeChild?: (parent: SceneNode, child: SceneNode) => boolean
  childClip?: (parent: SceneNode) => Rect | null
  /** Renderer-owned content can make an unpainted container pickable within its node bounds. */
  hasOwnContent?: (node: SceneNode) => boolean
}

const CONTAINER_TYPES = new Set<NodeType>([
  'CANVAS',
  'FRAME',
  'FORM',
  'LIST',
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

function isTopLevel(graph: SceneGraph, node: SceneNode): boolean {
  const parent = node.parentId ? graph.nodes.get(node.parentId) : undefined
  return parent?.type === 'CANVAS' || parent?.type === 'SECTION'
}

/**
 * An open container whose empty area still belongs to it, as in Figma: a top-level frame with auto
 * layout is selected, hovered, and dragged by its gaps and padding, while its children stay one
 * click away, with or without a fill. A plain top-level frame's empty area is background, and a
 * nested frame's empty area belongs to it only as a click target (see `frameChildAt`).
 */
function ownsItsEmptyArea(graph: SceneGraph, node: SceneNode): boolean {
  return node.type === 'FRAME' && isAutoLayoutMode(node.layoutMode) && isTopLevel(graph, node)
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

/** Whether the point lies in the node's box, grown by `pad` canvas units on every side. */
function containsPoint(
  px: number,
  py: number,
  node: SceneNode,
  graph: SceneGraph,
  transformCache: Map<string, boolean>,
  padOrBounds: number | Rect = 0
): boolean {
  const bounds =
    typeof padOrBounds === 'number'
      ? {
          x: -padOrBounds,
          y: -padOrBounds,
          width: node.width + padOrBounds * 2,
          height: node.height + padOrBounds * 2
        }
      : padOrBounds
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

function selectedContainerChild(
  container: SceneNode,
  hit: SceneNode,
  deep: boolean,
  opaque: boolean
): SceneNode {
  if (opaque) return container
  if (container.type === 'GROUP') return deep ? hit : container
  return container.locked ? container : hit
}

function hitTestContainer(
  graph: SceneGraph,
  px: number,
  py: number,
  child: SceneNode,
  childId: string,
  deep: boolean,
  transformCache: Map<string, boolean>,
  pad: number,
  opaque: boolean,
  options?: HitTestOptions
): SceneNode | null {
  const group = !opaque && child.type === 'GROUP'
  // Groups fit their layers, so a padded edge click may lie outside their own box.
  if ((opaque || group) && !containsPoint(px, py, child, graph, transformCache, group ? pad : 0))
    return null
  const childHit = hitTestChildren(graph, px, py, childId, deep, transformCache, pad, options)
  if (childHit) return selectedContainerChild(child, childHit, deep, opaque)
  if (group) return containsPoint(px, py, child, graph, transformCache) ? child : null
  if (
    containsPoint(px, py, child, graph, transformCache) &&
    (hasVisibleFillOrStroke(child) ||
      (!opaque && ownsItsEmptyArea(graph, child)) ||
      options?.hasOwnContent?.(child))
  )
    return child
  return null
}

/**
 * The topmost layer under the point among a container's children. `pad`, in canvas units, grows
 * each leaf layer's box, as Figma takes a click a few screen pixels outside a shape.
 */
function hitTestChildren(
  graph: SceneGraph,
  px: number,
  py: number,
  parentId: string,
  deep = false,
  transformCache = new Map<string, boolean>(),
  pad = 0,
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
        const hit = hitTestContainer(
          graph,
          px,
          py,
          child,
          childId,
          deep,
          transformCache,
          pad,
          true,
          options
        )
        if (hit) return hit
        continue
      }

      const hit = hitTestContainer(
        graph,
        px,
        py,
        child,
        childId,
        deep,
        transformCache,
        pad,
        false,
        options
      )
      if (hit) return hit
      continue
    }

    if (containsPoint(px, py, child, graph, transformCache, pad)) return child
  }

  return null
}

function hitTestInScope(
  graph: SceneGraph,
  px: number,
  py: number,
  deep: boolean,
  scopeId?: string,
  options?: HitTestOptions,
  pad = 0
): SceneNode | null {
  const scope = scopeId ?? graph.rootId
  const transformCache = new Map<string, boolean>()
  if (options && !scopeIncludesPoint(graph, px, py, scope, transformCache, options)) return null
  return hitTestChildren(graph, px, py, scope, deep, transformCache, pad, options)
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
  padOrOptions: number | HitTestOptions = 0,
  options?: HitTestOptions
): SceneNode | null {
  return hitTestInScope(
    graph,
    px,
    py,
    true,
    scopeId,
    typeof padOrOptions === 'number' ? options : padOrOptions,
    typeof padOrOptions === 'number' ? padOrOptions : 0
  )
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
/**
 * A container a click looks into by itself, as in Figma: a top-level frame (on the page or in a
 * section) or a section that holds layers, and a component set.
 */
function opensByItself(graph: SceneGraph, node: SceneNode, options?: HitTestOptions): boolean {
  if (node.type === 'COMPONENT_SET') return true
  if (node.childIds.length === 0) return false
  if (node.type === 'SECTION') return true
  return (
    node.type === 'FRAME' && (isTopLevel(graph, node) || options?.hasOwnContent?.(node) === true)
  )
}

/**
 * The topmost frame among a container's children whose bounds hold the point, filled or not: in
 * Figma a click on the empty area of a frame inside an open container, or of an empty frame on the
 * page or in a section, selects that frame, while a deep (⌘) click looks through it.
 */
function frameChildAt(
  graph: SceneGraph,
  container: SceneNode,
  px: number,
  py: number,
  options?: HitTestOptions
): SceneNode | null {
  const transformCache = new Map<string, boolean>()
  for (let i = container.childIds.length - 1; i >= 0; i--) {
    const child = graph.nodes.get(container.childIds[i])
    if (!child || child.internalOnly || !child.visible || child.type !== 'FRAME') continue
    if (options?.includeChild?.(container, child) === false) continue
    // A host's authored freeform frames are transparent without painted or rendered
    // content. Frames loaded from FIG keep Figma's empty-area click target.
    if (
      options?.hasOwnContent &&
      child.source.format !== 'fig' &&
      !isAutoLayoutMode(child.layoutMode) &&
      !hasVisibleFillOrStroke(child) &&
      !options.hasOwnContent(child)
    )
      continue
    // A board, such as a top-level frame in a section, keeps its empty area as background.
    if (opensByItself(graph, child, options) && !ownsItsEmptyArea(graph, child)) continue
    if (containsPoint(px, py, child, graph, transformCache)) return child
  }
  return null
}

/**
 * The containers the selection opens: every ancestor of a selected layer inside the scope, and a
 * selected container itself, so a click inside it selects the layer under the point, as in Figma.
 * A selected group or boolean stays closed: clicking inside it keeps it selected.
 */
function openedBySelection(
  graph: SceneGraph,
  selectedIds: ReadonlySet<string>,
  scopeId: string
): Set<string> {
  const ancestors = new Set<string>()
  for (const id of selectedIds) {
    const node = graph.nodes.get(id)
    if (
      node &&
      node.childIds.length > 0 &&
      node.type !== 'GROUP' &&
      node.type !== 'BOOLEAN_OPERATION'
    )
      ancestors.add(id)
    let parentId = node?.parentId
    while (parentId && parentId !== scopeId && !ancestors.has(parentId)) {
      ancestors.add(parentId)
      parentId = graph.nodes.get(parentId)?.parentId
    }
  }
  return ancestors
}

function ownsSelectableContent(
  graph: SceneGraph,
  node: SceneNode,
  options?: HitTestOptions
): boolean {
  return ownsItsEmptyArea(graph, node) || options?.hasOwnContent?.(node) === true
}

/**
 * The layer a click selects, as in Figma. It walks from the scope down to the deepest layer under
 * the point and stops at the first layer that is not open. Top-level frames and sections with
 * layers and component sets are open, and so is every ancestor of the selection, so clicks reach
 * the siblings of selected layers. Where every layer under the point is open, a container opened
 * by the selection is selected, so is a top-level frame with auto layout, and a plain top-level
 * frame or a section is not.
 */
export function hitTestSelectable(
  graph: SceneGraph,
  px: number,
  py: number,
  scopeId: string,
  selectedIds: ReadonlySet<string>,
  pad = 0,
  options?: HitTestOptions
): SceneNode | null {
  const cache = new Map<string, boolean>()
  if (options && !scopeIncludesPoint(graph, px, py, scopeId, cache, options)) return null
  const deepest = hitTestChildren(graph, px, py, scopeId, true, cache, pad, options)
  if (!deepest) {
    const scope = graph.nodes.get(scopeId)
    return scope ? frameChildAt(graph, scope, px, py, options) : null
  }

  const chain: SceneNode[] = []
  for (let node: SceneNode | undefined = deepest; node && node.id !== scopeId;) {
    chain.unshift(node)
    node = node.parentId ? graph.nodes.get(node.parentId) : undefined
  }

  const opened = openedBySelection(graph, selectedIds, scopeId)

  for (const node of chain) {
    // A locked layer stands in for everything inside it.
    if (node.locked) return node
    if (!opened.has(node.id) && !opensByItself(graph, node, options)) return node
  }
  const last = chain.at(-1)
  if (!last) return null
  const frame = frameChildAt(graph, last, px, py, options)
  if (frame) return frame
  if (ownsSelectableContent(graph, last, options)) return last
  return opened.has(last.id) && !opensByItself(graph, last, options) ? last : null
}

/** Whether a click looks into this container rather than selecting it; see `hitTestSelectable`. */
export function isOpenContainer(graph: SceneGraph, nodeId: string): boolean {
  const node = graph.nodes.get(nodeId)
  return node !== undefined && opensByItself(graph, node)
}

/**
 * The innermost open container under the point when every layer there is open: a marquee starting
 * here selects that container's layers, as in Figma.
 */
export function hitTestOpenContainer(
  graph: SceneGraph,
  px: number,
  py: number,
  scopeId: string
): SceneNode | null {
  const deepest = hitTestChildren(graph, px, py, scopeId, true)
  for (let node: SceneNode | undefined = deepest ?? undefined; node && node.id !== scopeId;) {
    if (!opensByItself(graph, node) || ownsItsEmptyArea(graph, node)) return null
    node = node.parentId ? graph.nodes.get(node.parentId) : undefined
  }
  return deepest
}

/** Whether the point lies inside the node's rotated and flipped bounds. */
export function isPointInNode(graph: SceneGraph, nodeId: string, px: number, py: number): boolean {
  const node = graph.nodes.get(nodeId)
  return node !== undefined && containsPoint(px, py, node, graph, new Map())
}

/** Which layers take a drop, and which are only looked through, as in Figma. */
interface DropRules {
  takes: (node: SceneNode) => boolean
  passThrough: ReadonlySet<NodeType>
}

const LAYER_TARGETS = new Set<NodeType>([
  'FRAME',
  'FORM',
  'LIST',
  'SECTION',
  'COMPONENT',
  'INSTANCE'
])
const COMPONENT_TARGETS = new Set<NodeType>(['FRAME', 'SECTION', 'INSTANCE'])

function dropRules(options: DropTargetOptions): DropRules {
  const { componentSetIds } = options
  if (!componentSetIds) {
    return {
      takes: (node) => LAYER_TARGETS.has(node.type),
      passThrough: new Set(['GROUP', 'COMPONENT_SET'])
    }
  }
  // Components never go into other components, and a set only takes back its own variants.
  return {
    takes: (node) =>
      COMPONENT_TARGETS.has(node.type) ||
      (node.type === 'COMPONENT_SET' && componentSetIds.has(node.id)),
    passThrough: new Set(['GROUP'])
  }
}

function dropTargetIn(
  graph: SceneGraph,
  px: number,
  py: number,
  parent: SceneNode,
  excludeIds: ReadonlySet<string>,
  rules: DropRules,
  transformCache: Map<string, boolean>,
  options?: HitTestOptions
): SceneNode | null {
  if (!childrenContainPoint(graph, px, py, parent, transformCache, options)) return null
  // A clipped-away part of a child is not under the cursor.
  if (
    parent.type !== 'CANVAS' &&
    parent.clipsContent &&
    !containsPoint(px, py, parent, graph, transformCache)
  )
    return null

  for (let i = parent.childIds.length - 1; i >= 0; i--) {
    const childId = parent.childIds[i]
    if (excludeIds.has(childId)) continue
    const child = graph.nodes.get(childId)
    if (!child || child.internalOnly || !child.visible || child.locked) continue
    if (options?.includeChild?.(parent, child) === false) continue
    const target = rules.takes(child)
    if (!target && !rules.passThrough.has(child.type)) continue

    const deeper = dropTargetIn(graph, px, py, child, excludeIds, rules, transformCache, options)
    if (deeper) return deeper
    if (target && containsPoint(px, py, child, graph, transformCache)) return child
  }

  return null
}

export interface DropTargetOptions extends HitTestOptions {
  /**
   * Set when the dropped layers are all main components: the component sets they come from.
   * Components then go only into frames, sections, instances, and those sets.
   */
  componentSetIds?: ReadonlySet<string>
}

/**
 * The topmost unlocked frame, section, component, or instance under the point, in its rotated
 * shape and inside its clipping ancestors. Groups and component sets are looked through but never
 * returned, except that a set takes dropped components; locked layers and their contents are
 * skipped.
 */
export function hitTestDropTarget(
  graph: SceneGraph,
  px: number,
  py: number,
  excludeIds: ReadonlySet<string>,
  scopeId?: string,
  options: DropTargetOptions = {}
): SceneNode | null {
  const scope = graph.nodes.get(scopeId ?? graph.rootId)
  if (!scope) return null
  return dropTargetIn(graph, px, py, scope, excludeIds, dropRules(options), new Map(), options)
}
