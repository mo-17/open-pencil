import type {
  PrototypeAction,
  PrototypeConnection,
  SceneGraph,
  SceneNode
} from '@open-pencil/scene-graph'

import type {
  IRPrototypeAction,
  IRPrototypeConnection,
  IRPrototypeDecoration,
  IRPrototypeTarget
} from '../prototype'
import type { IRWarning } from '../types'
import { type ComponentRegistry, instanceHasDeepOverride, isVariantChild } from './components'

export interface PrototypeCollectIndex {
  targetIds: ReadonlySet<string>
  overlayTargetIds: ReadonlySet<string>
}

export interface PrototypeCollectContext {
  graph: SceneGraph
  pageId: string
  warnings: IRWarning[]
  index: PrototypeCollectIndex
  components: ComponentRegistry
  /** Component bodies can be instantiated repeatedly, so master ids are not
   * deterministic DOM/runtime targets. Page-level component refs remain valid. */
  componentBody: boolean
  /** Plain COMPONENT id, or the active variant COMPONENT id while collecting a
   * COMPONENT_SET case. Undefined during a page walk. */
  componentRootId?: string
}

export function buildPrototypeCollectIndex(graph: SceneGraph): PrototypeCollectIndex {
  const targetIds = new Set<string>()
  const overlayTargetIds = new Set<string>()
  const add = (ids: Set<string>, nodeId: string): void => {
    const node = graph.getNode(nodeId)
    ids.add(nodeId)
    if (node?.componentId) ids.add(node.componentId)
  }
  for (const node of graph.getAllNodes()) {
    for (const connection of node.prototype?.connections ?? []) {
      if (connection.action.kind === 'navigate' || connection.action.kind === 'openOverlay') {
        add(targetIds, connection.action.targetNodeId)
      }
      if (connection.action.kind === 'openOverlay') {
        add(overlayTargetIds, connection.action.targetNodeId)
      }
    }
  }
  return { targetIds, overlayTargetIds }
}

/** Lower one node's prototype metadata and runtime DOM decorations. Invalid or
 * ambiguous connections are warned and omitted rather than guessed. */
export function collectPrototypeDecoration(
  node: SceneNode,
  ctx: PrototypeCollectContext,
  hasLowcodeClick: boolean
): IRPrototypeDecoration {
  const connections = (node.prototype?.connections ?? []).flatMap((connection) => {
    if (connection.trigger.kind === 'click' && hasLowcodeClick) {
      warn(
        ctx,
        node.id,
        'prototype-click-lowcode-conflict',
        `prototype connection ${connection.id} dropped because ${node.id} also has a lowcode onClick handler`
      )
      return []
    }
    const lowered = lowerConnection(connection, node, ctx)
    return lowered ? [lowered] : []
  })

  const decoration: IRPrototypeDecoration = {
    ...(connections.length > 0 ? { prototype: { connections } } : {}),
    ...(node.transitionKey ? { transitionKey: node.transitionKey } : {}),
    ...(ctx.index.targetIds.has(node.id) ? { prototypeTarget: true } : {}),
    ...(ctx.index.overlayTargetIds.has(node.id) ? { prototypeOverlayTarget: true } : {})
  }
  if (
    ctx.componentBody &&
    (decoration.prototype ||
      decoration.transitionKey ||
      decoration.prototypeTarget ||
      decoration.prototypeOverlayTarget)
  ) {
    decoration.prototypeScope = true
  }
  return decoration
}

function lowerConnection(
  connection: PrototypeConnection,
  source: SceneNode,
  ctx: PrototypeCollectContext
): IRPrototypeConnection | undefined {
  const action = lowerAction(connection.action, source, connection.id, ctx)
  if (!action) return undefined
  return {
    id: connection.id,
    trigger: structuredClone(connection.trigger),
    action,
    transition: structuredClone(connection.transition),
    interruption: connection.interruption ?? 'replace',
    playback: connection.playback ?? 'forward'
  }
}

function lowerAction(
  action: PrototypeAction,
  source: SceneNode,
  connectionId: string,
  ctx: PrototypeCollectContext
): IRPrototypeAction | undefined {
  if (action.kind === 'back' || action.kind === 'closeOverlay') return { kind: action.kind }

  const target = resolveTarget(action.targetNodeId, ctx)
  if (!target) {
    warn(
      ctx,
      source.id,
      'prototype-target-unresolved',
      `prototype connection ${connectionId} target ${action.targetNodeId} is missing, outside a page, or not a CANVAS/FRAME`
    )
    return undefined
  }
  if (action.kind === 'navigate') {
    if (ctx.componentBody && target.componentPath && !target.componentRootNodeId) {
      warn(
        ctx,
        source.id,
        'prototype-component-local-navigate-unsupported',
        `prototype connection ${connectionId} targets a frame inside its reusable component; navigate requires a page destination and was dropped`
      )
      return undefined
    }
    return { kind: action.kind, target }
  }

  if (target.kind !== 'frame') {
    warn(
      ctx,
      source.id,
      'prototype-overlay-target-not-frame',
      `prototype connection ${connectionId} overlay target ${action.targetNodeId} must be a FRAME`
    )
    return undefined
  }
  const componentLocal = target.componentPath !== undefined && !target.componentRootNodeId
  if (ctx.componentBody && !componentLocal) {
    warn(
      ctx,
      source.id,
      'prototype-component-overlay-cross-boundary',
      `prototype connection ${connectionId} overlay target ${action.targetNodeId} is outside its reusable component and was dropped`
    )
    return undefined
  }
  if (!componentLocal && target.pageId !== ctx.pageId) {
    warn(
      ctx,
      source.id,
      'prototype-overlay-cross-page',
      `prototype connection ${connectionId} overlay target ${action.targetNodeId} is on another page and was dropped`
    )
    return undefined
  }
  return {
    kind: action.kind,
    target,
    placement: action.placement,
    dismissOnOutside: action.dismissOnOutside === true
  }
}

function resolveTarget(
  nodeId: string,
  ctx: PrototypeCollectContext
): IRPrototypeTarget | undefined {
  const target = ctx.graph.getNode(nodeId)
  if (!target) return undefined
  if (target.type === 'CANVAS') return { nodeId, pageId: target.id, kind: 'page' }
  if (target.type !== 'FRAME') return undefined
  const pageId = owningPageId(target, ctx.graph)
  if (!pageId) return undefined
  const componentTarget = resolveComponentTarget(target, ctx)
  return { nodeId, pageId, kind: 'frame', ...componentTarget }
}

function resolveComponentTarget(
  target: SceneNode,
  ctx: PrototypeCollectContext
): Pick<IRPrototypeTarget, 'componentPath' | 'componentRootNodeId'> {
  if (ctx.componentRootId) {
    const root = ctx.graph.getNode(ctx.componentRootId)
    const path = root ? componentRuntimePath(target, root, false, ctx.graph) : undefined
    if (path) return { componentPath: path }
  }

  const anchor = emittedComponentAncestor(target, ctx)
  if (!anchor) return {}
  const root = componentSourceRoot(anchor, ctx.graph)
  if (!root) return {}
  const mappedTarget =
    anchor.type === 'INSTANCE' ? mapCloneNodeIntoComponent(target, root, ctx.graph) : target
  if (!mappedTarget) return {}
  const path = componentRuntimePath(mappedTarget, root, false, ctx.graph)
  return path ? { componentPath: path, componentRootNodeId: anchor.id } : {}
}

/** First reusable component boundary from the page toward the target. Anything
 * outside such a boundary keeps its authored SceneNode id. */
function emittedComponentAncestor(
  target: SceneNode,
  ctx: PrototypeCollectContext
): SceneNode | undefined {
  const ancestors: SceneNode[] = []
  const visited = new Set<string>()
  let current = target.parentId ? ctx.graph.getNode(target.parentId) : undefined
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    ancestors.push(current)
    current = current.parentId ? ctx.graph.getNode(current.parentId) : undefined
  }
  ancestors.reverse()
  return ancestors.find((node) => isEmittedComponentBoundary(node, ctx))
}

function isEmittedComponentBoundary(node: SceneNode, ctx: PrototypeCollectContext): boolean {
  if (node.type === 'COMPONENT')
    return ctx.components.has(node.id) && !isVariantChild(ctx.graph, node)
  if (node.type !== 'INSTANCE' || !node.componentId || instanceHasDeepOverride(ctx.graph, node)) {
    return false
  }
  if (ctx.components.has(node.componentId)) return true
  const variant = ctx.graph.getNode(node.componentId)
  return Boolean(variant?.parentId && ctx.components.has(variant.parentId))
}

function componentSourceRoot(node: SceneNode, graph: SceneGraph): SceneNode | undefined {
  if (node.type === 'COMPONENT') return node
  if (node.type !== 'INSTANCE' || !node.componentId) return undefined
  return graph.getNode(node.componentId)
}

/** Map a materialized instance clone back into the master tree emitted by the
 * shared component module. Nested-instance clones may require more than one
 * `componentId` hop, so stop at the first node actually owned by that master. */
function mapCloneNodeIntoComponent(
  node: SceneNode,
  componentRoot: SceneNode,
  graph: SceneGraph
): SceneNode | undefined {
  const visited = new Set<string>()
  let current: SceneNode | undefined = node
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    if (isDescendantOf(current, componentRoot.id, graph)) return current
    current = current.componentId ? graph.getNode(current.componentId) : undefined
  }
  return undefined
}

/** Runtime ids include only component boundaries plus the final target. Normal
 * layout ancestors do not affect identity. After crossing a nested INSTANCE,
 * descendants are clones, so their `componentId` is the id emitted by the
 * nested component module. */
function componentRuntimePath(
  target: SceneNode,
  componentRoot: SceneNode,
  rootIsClone: boolean,
  graph: SceneGraph
): string[] | undefined {
  const chain: SceneNode[] = []
  const visited = new Set<string>()
  let current: SceneNode | undefined = target
  while (current && current.id !== componentRoot.id && !visited.has(current.id)) {
    visited.add(current.id)
    chain.push(current)
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  if (!current || current.id !== componentRoot.id) return undefined
  chain.reverse()

  const path: string[] = []
  let insideClone = rootIsClone
  for (const node of chain) {
    if (node.type !== 'INSTANCE') continue
    const segment = insideClone ? node.componentId : node.id
    if (!segment) return undefined
    path.push(segment)
    insideClone = true
  }
  if (target.type !== 'INSTANCE') {
    const finalId = insideClone ? target.componentId : target.id
    if (!finalId) return undefined
    path.push(finalId)
  }
  return path.length > 0 ? path : undefined
}

function isDescendantOf(node: SceneNode, ancestorId: string, graph: SceneGraph): boolean {
  const visited = new Set<string>()
  let current: SceneNode | undefined = node
  while (current && !visited.has(current.id)) {
    if (current.id === ancestorId) return true
    visited.add(current.id)
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return false
}

function owningPageId(node: SceneNode, graph: SceneGraph): string | undefined {
  const seen = new Set<string>()
  let current: SceneNode | undefined = node
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    if (current.type === 'CANVAS') return current.id
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return undefined
}

function warn(ctx: PrototypeCollectContext, nodeId: string, code: string, message: string): void {
  ctx.warnings.push({ code, message, nodeId })
}
