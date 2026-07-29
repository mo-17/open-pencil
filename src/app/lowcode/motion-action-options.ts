import { validateMotionSpec, type SceneNode } from '@open-pencil/scene-graph'

export interface MotionActionTrackOption {
  id: string
  label: string
}

export interface MotionActionTargetOption {
  id: string
  label: string
  tracks: readonly MotionActionTrackOption[]
}

/** Controlled data passed from graph-owning panels to recursive action rows. */
export interface MotionActionOptions {
  targets: readonly MotionActionTargetOption[]
  nodeIds: ReadonlySet<string>
  /** Generated INSTANCE descendants are runtime projections and are omitted from .fig exports. */
  unsupportedTargetIds: ReadonlySet<string>
  /** Existing animated nodes that are outside the page currently being authored. */
  outOfScopeTargetIds: ReadonlySet<string>
}

export interface CollectMotionActionOptions {
  /** Restrict selectable targets to descendants of this CANVAS. */
  pageId?: string
}

function hasInstanceAncestor(node: SceneNode, nodesById: ReadonlyMap<string, SceneNode>): boolean {
  const visited = new Set<string>()
  let parentId = node.parentId
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId)
    const parent = nodesById.get(parentId)
    if (!parent) return false
    if (parent.type === 'INSTANCE') return true
    parentId = parent.parentId
  }
  return false
}

function containingPageId(
  node: SceneNode,
  nodesById: ReadonlyMap<string, SceneNode>
): string | undefined {
  const visited = new Set<string>()
  let current: SceneNode | undefined = node
  while (current && !visited.has(current.id)) {
    if (current.type === 'CANVAS') return current.id
    visited.add(current.id)
    current = current.parentId ? nodesById.get(current.parentId) : undefined
  }
  return undefined
}

/**
 * Build action-picker options from the current graph snapshot. Invalid or
 * absent MotionSpec values never become selectable, while `nodeIds` retains
 * every node so validation can distinguish a deleted target from a node whose
 * motion metadata became invalid.
 */
export function collectMotionActionOptions(
  nodes: Iterable<SceneNode>,
  options: CollectMotionActionOptions = {}
): MotionActionOptions {
  const allNodes = [...nodes]
  const nodesById = new Map(allNodes.map((node) => [node.id, node]))
  const nodeIds = new Set<string>()
  const unsupportedTargetIds = new Set<string>()
  const outOfScopeTargetIds = new Set<string>()
  const targets: MotionActionTargetOption[] = []

  for (const node of allNodes) {
    nodeIds.add(node.id)
    if (node.motion === undefined) continue
    const result = validateMotionSpec(node.motion)
    if (!result.success) continue
    if (hasInstanceAncestor(node, nodesById)) {
      unsupportedTargetIds.add(node.id)
      continue
    }
    if (options.pageId && containingPageId(node, nodesById) !== options.pageId) {
      outOfScopeTargetIds.add(node.id)
      continue
    }
    targets.push({
      id: node.id,
      label: `${node.name || node.type} (${node.id})`,
      tracks: result.value.tracks.map((track) => ({ id: track.id, label: track.id }))
    })
  }

  return { targets, nodeIds, unsupportedTargetIds, outOfScopeTargetIds }
}
