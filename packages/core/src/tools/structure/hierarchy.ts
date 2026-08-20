import type { SceneGraph } from '@open-pencil/scene-graph'

import type { FigmaAPI } from '#core/figma-api'
import { defineTool, nodeSummary, requireNodes, type ToolCtx } from '#core/tools/schema'

interface ReparentSnapshot {
  id: string
  parentId: string
  x: number
  y: number
}

interface ReparentNodesArgs {
  ids: string[]
  parent_id: string
  insert_index?: number
  expected_scene_version?: number
}

interface ReparentPlan {
  nodeIds: string[]
  parentId: string
  targetIndex: number
  targetOrder: string[]
  snapshots: ReparentSnapshot[]
  originalOrders: Map<string, string[]>
}

function reparentFailure(error: string) {
  return { ok: false as const, error }
}

type ReparentFailure = ReturnType<typeof reparentFailure>

/**
 * Reachability in the combined scene graph: ordinary containment edges plus
 * INSTANCE -> COMPONENT reference edges. A proposed parent edge creates a
 * recursive component definition exactly when its child can already reach the
 * prospective parent through this graph.
 */
export function hasComponentInstanceReferencePath(
  graph: SceneGraph,
  startId: string,
  targetId: string,
  detachedRootIds: ReadonlySet<string> = new Set()
): boolean {
  const pending = [startId]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const id = pending.pop()
    if (!id || visited.has(id)) continue
    if (id === targetId) return true
    visited.add(id)
    const node = graph.getNode(id)
    if (!node) continue
    for (const childId of node.childIds) {
      if (detachedRootIds.has(childId)) continue
      pending.push(childId)
    }
    if (node.type === 'INSTANCE' && node.componentId) pending.push(node.componentId)
  }
  return false
}

function reorderChildren(graph: SceneGraph, parentId: string, childIds: readonly string[]): void {
  childIds.forEach((childId, index) => graph.reorderChild(childId, parentId, index))
}

function sceneVersionFailure(
  ctx: ToolCtx | undefined,
  expected: number | undefined
): ReparentFailure | undefined {
  if (expected === undefined) return undefined
  if (!ctx?.editor) {
    return reparentFailure('expected_scene_version requires an editor-backed MCP host')
  }
  if (ctx.editor.state.sceneVersion === expected) return undefined
  return reparentFailure(
    `Scene version conflict: expected ${expected}, current ${ctx.editor.state.sceneVersion}`
  )
}

function reparentSnapshot(
  graph: SceneGraph,
  id: string,
  parentId: string
): ReparentSnapshot | ReparentFailure {
  const node = graph.getNode(id)
  if (!node) return reparentFailure(`Node "${id}" not found`)
  if (!node.parentId || node.type === 'CANVAS') {
    return reparentFailure(`Node "${id}" cannot be reparented`)
  }
  if (id === parentId || graph.isDescendant(parentId, id)) {
    return reparentFailure(`Cannot move node "${id}" into itself or its descendant`)
  }
  return { id, parentId: node.parentId, x: node.x, y: node.y }
}

function collectReparentSnapshots(
  graph: SceneGraph,
  nodeIds: readonly string[],
  parentId: string
): ReparentSnapshot[] | ReparentFailure {
  const snapshots: ReparentSnapshot[] = []
  for (const id of nodeIds) {
    const snapshot = reparentSnapshot(graph, id, parentId)
    if ('ok' in snapshot) return snapshot
    snapshots.push(snapshot)
  }
  return snapshots
}

function collectOriginalOrders(
  graph: SceneGraph,
  parentId: string,
  snapshots: readonly ReparentSnapshot[]
): Map<string, string[]> {
  const orders = new Map<string, string[]>()
  const parent = graph.getNode(parentId)
  if (parent) orders.set(parentId, [...parent.childIds])
  for (const snapshot of snapshots) {
    const sourceParent = graph.getNode(snapshot.parentId)
    if (sourceParent && !orders.has(snapshot.parentId)) {
      orders.set(snapshot.parentId, [...sourceParent.childIds])
    }
  }
  return orders
}

function prepareReparentPlan(
  figma: FigmaAPI,
  args: ReparentNodesArgs
): ReparentPlan | ReparentFailure {
  const nodeIds = [...new Set(args.ids)]
  if (nodeIds.length === 0) return reparentFailure('ids must contain at least one id')
  if (nodeIds.length > 200) return reparentFailure('ids supports at most 200 ids per call')
  const parent = figma.graph.getNode(args.parent_id)
  if (!parent) return reparentFailure(`Parent "${args.parent_id}" not found`)
  if (!figma.graph.isContainer(args.parent_id)) {
    return reparentFailure(`Parent "${args.parent_id}" (${parent.type}) cannot contain children`)
  }
  const snapshots = collectReparentSnapshots(figma.graph, nodeIds, args.parent_id)
  if (!Array.isArray(snapshots)) return snapshots

  const moving = new Set(nodeIds)
  for (const id of nodeIds) {
    if (hasComponentInstanceReferencePath(figma.graph, id, args.parent_id, moving)) {
      return reparentFailure(
        `Cannot move node "${id}" into "${args.parent_id}": component/instance reference cycle`
      )
    }
  }
  const remaining = parent.childIds.filter((id) => !moving.has(id))
  const requestedIndex = args.insert_index ?? remaining.length
  if (!Number.isInteger(requestedIndex) || requestedIndex < 0) {
    return reparentFailure('insert_index must be a non-negative integer')
  }
  const targetIndex = Math.min(requestedIndex, remaining.length)
  return {
    nodeIds,
    parentId: args.parent_id,
    targetIndex,
    targetOrder: [...remaining.slice(0, targetIndex), ...nodeIds, ...remaining.slice(targetIndex)],
    snapshots,
    originalOrders: collectOriginalOrders(figma.graph, args.parent_id, snapshots)
  }
}

function applyReparentPlan(graph: SceneGraph, plan: ReparentPlan): void {
  for (const id of plan.nodeIds) graph.reparentNode(id, plan.parentId)
  reorderChildren(graph, plan.parentId, plan.targetOrder)
}

function restoreReparentPlan(graph: SceneGraph, plan: ReparentPlan): void {
  for (const snapshot of plan.snapshots) graph.reparentNode(snapshot.id, snapshot.parentId)
  for (const [parentId, childIds] of plan.originalOrders) {
    reorderChildren(graph, parentId, childIds)
  }
  for (const snapshot of plan.snapshots) {
    graph.updateNode(snapshot.id, { x: snapshot.x, y: snapshot.y })
  }
}

function executeReparentNodes(figma: FigmaAPI, args: ReparentNodesArgs, ctx?: ToolCtx) {
  const versionFailure = sceneVersionFailure(ctx, args.expected_scene_version)
  if (versionFailure) return versionFailure
  const plan = prepareReparentPlan(figma, args)
  if ('ok' in plan) return plan
  const apply = (): void => applyReparentPlan(figma.graph, plan)
  const restore = (): void => restoreReparentPlan(figma.graph, plan)
  apply()
  ctx?.editor?.undo.push({ label: 'AI: reparent_nodes', forward: apply, inverse: restore })
  return {
    ok: true,
    data: {
      parent_id: plan.parentId,
      insert_index: plan.targetIndex,
      moved: plan.nodeIds.map((id, offset) => ({ id, index: plan.targetIndex + offset })),
      ...(ctx?.editor ? { scene_version: ctx.editor.state.sceneVersion } : {})
    }
  }
}

export const reparentNode = defineTool({
  name: 'reparent_node',
  mutates: true,
  description: 'Move a node into a different parent.',
  params: {
    id: { type: 'string', description: 'Node ID to move', required: true },
    parent_id: { type: 'string', description: 'New parent node ID', required: true }
  },
  execute: (figma, { id, parent_id }) => {
    const node = figma.getNodeById(id)
    const parent = figma.getNodeById(parent_id)
    if (!node) return { error: `Node "${id}" not found` }
    if (!parent) return { error: `Parent "${parent_id}" not found` }
    parent.appendChild(node)
    return { id, parent_id }
  }
})

export const reparentNodes = defineTool({
  name: 'reparent_nodes',
  mutates: true,
  description:
    'Atomically move multiple nodes into one parent at an exact sibling index while preserving their order and absolute canvas position. All ids and cycle constraints are validated before mutation. When expected_scene_version is supplied by an editor-backed host, stale writes are rejected. One MCP call and one undo batch replace repeated reparent_node calls.',
  params: {
    ids: {
      type: 'string[]',
      description: 'Node ids in the order they should appear under the target parent',
      required: true
    },
    parent_id: { type: 'string', description: 'New parent node id', required: true },
    insert_index: {
      type: 'number',
      description: 'Index after moved ids are removed from the target; omit to append'
    },
    expected_scene_version: {
      type: 'number',
      description: 'Optional optimistic-concurrency precondition for editor/MCP hosts'
    }
  },
  execute: executeReparentNodes
})

export const groupNodes = defineTool({
  name: 'group_nodes',
  mutates: true,
  description: 'Group selected nodes.',
  params: {
    ids: { type: 'string[]', description: 'Node IDs to group', required: true }
  },
  execute: (figma, { ids }) => {
    const nodes = requireNodes(figma, ids)
    if (!nodes || nodes.length < 2) return { error: 'Need at least 2 nodes to group' }
    const parent = nodes[0].parent ?? figma.currentPage
    const group = figma.group(nodes, parent)
    return nodeSummary(group)
  }
})

export const ungroupNode = defineTool({
  name: 'ungroup_node',
  mutates: true,
  description: 'Ungroup a group node.',
  params: {
    id: { type: 'string', description: 'Group node ID', required: true }
  },
  execute: (figma, { id }) => {
    const node = figma.getNodeById(id)
    if (!node) return { error: `Node "${id}" not found` }
    figma.ungroup(node)
    return { ungrouped: id }
  }
})

export const flattenNodes = defineTool({
  name: 'flatten_nodes',
  mutates: true,
  description: 'Flatten nodes into a single vector.',
  params: {
    ids: { type: 'string[]', description: 'Node IDs to flatten', required: true }
  },
  execute: (figma, { ids }) => {
    const result = figma.flattenNode(ids)
    return nodeSummary(result)
  }
})

export const nodeToComponent = defineTool({
  name: 'node_to_component',
  mutates: true,
  description: 'Convert one or more frames/groups into components.',
  params: {
    ids: { type: 'string[]', description: 'Node IDs to convert', required: true }
  },
  execute: (figma, { ids }) => {
    const results: { id: string; name: string; originalId: string }[] = []
    for (const id of ids) {
      const node = figma.getNodeById(id)
      if (!node) continue
      const comp = figma.createComponentFromNode(node)
      results.push({ id: comp.id, name: comp.name, originalId: id })
    }
    return { converted: results }
  }
})
