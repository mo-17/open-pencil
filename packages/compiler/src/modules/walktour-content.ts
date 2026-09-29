import type { IRModule, IRNode, IRWarning } from '#compiler/ir/types'

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

export function isWalktourModule(module: IRModule | undefined | null): boolean {
  return module?.pluginId === 'open-pencil.walktour' && module.moduleType === 'walktour'
}
function sourceNodeId(node: IRNode): string | undefined {
  if (node.kind === 'conditional') return sourceNodeId(node.consequent)
  if (node.kind === 'list') return sourceNodeId(node.template)
  return 'sourceId' in node ? node.sourceId : undefined
}
function owningChildId(child: IRNode, owner: SceneNode, graph: SceneGraph): string | undefined {
  const id = sourceNodeId(child),
    seen = new Set<string>()
  let node = id ? graph.getNode(id) : undefined
  while (node && !seen.has(node.id)) {
    if (node.parentId === owner.id) return node.id
    seen.add(node.id)
    node = node.parentId ? graph.getNode(node.parentId) : undefined
  }
  return undefined
}
export function collectWalktourContentSlots(
  node: SceneNode,
  module: IRModule,
  graph: SceneGraph,
  children: readonly IRNode[],
  warnings: IRWarning[]
): void {
  const steps = module.payload.steps
  if (!Array.isArray(steps)) return
  const direct = node.childIds.flatMap((id) => graph.getNode(id) ?? []),
    ids = children.map((child) => owningChildId(child, node, graph)),
    assigned = new Set<number>()
  module.contentSlots = steps.flatMap((step) => {
    if (
      !step ||
      typeof step !== 'object' ||
      Array.isArray(step) ||
      typeof step.id !== 'string' ||
      typeof step.targetChildName !== 'string' ||
      !step.targetChildName
    )
      return []
    const matches = direct.filter((child) => child.name === step.targetChildName),
      match = matches.length === 1 ? matches[0] : undefined,
      index = match ? ids.indexOf(match.id) : -1
    if (index < 0)
      warnings.push({
        code: 'walktour-target-unavailable',
        nodeId: node.id,
        message: `Walktour step ${step.id} has no unique renderable direct child target; its guide remains available as a centered step.`
      })
    if (index >= 0) assigned.add(index)
    return [
      {
        name: 'target-' + step.id,
        sourceId: match?.id ?? null,
        ...(index < 0 ? {} : { childIndex: index })
      }
    ]
  })
  children.forEach((_, index) => {
    if (!assigned.has(index))
      module.contentSlots?.push({
        name: 'extra-' + index,
        sourceId: ids[index] ?? null,
        childIndex: index
      })
  })
  module.contentSlots.sort(
    (left, right) => (left.childIndex ?? Infinity) - (right.childIndex ?? Infinity)
  )
}
