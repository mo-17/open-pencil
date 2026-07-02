import type { WorkflowGraphEdge, WorkflowGraphNode } from '@/app/lowcode/workflow-graph'

type GraphMapSearchMatch = {
  id: string
}

export function graphMapNodeSearchMatchId(node: WorkflowGraphNode): string {
  return `node:${node.id}`
}

export function graphMapEdgeSearchMatchId(edge: WorkflowGraphEdge): string {
  return `edge:${edge.fromId}:${edge.actionPath}:${edge.actionId}:${edge.toId}`
}

export function graphMapNodeMatchesSearch(node: WorkflowGraphNode, term: string): boolean {
  return [
    node.id,
    node.name,
    ...node.entrypoints.map((entrypoint) => entrypoint.nodeName),
    ...node.entrypoints.map((entrypoint) => entrypoint.eventName),
    ...node.entrypoints.map((entrypoint) => entrypoint.actionId)
  ].some((value) => value.toLowerCase().includes(term))
}

export function graphMapEdgeMatchesSearch(edge: WorkflowGraphEdge, term: string): boolean {
  return [
    edge.fromId,
    edge.fromName,
    edge.toId,
    edge.toName ?? '',
    edge.actionId,
    edge.actionPath,
    edge.actionKind,
    graphMapEdgeBranchLabel(edge)
  ].some((value) => value.toLowerCase().includes(term))
}

export function graphMapEdgeBranchLabel(edge: WorkflowGraphEdge): string {
  if (!edge.actionPath.includes('/')) return 'Root'
  const branch = edge.actionPath.split('/').at(-1)?.replace(/\[\d+\]$/, '') ?? ''
  switch (branch) {
    case 'consequent':
      return 'Then'
    case 'alternate':
      return 'Else'
    case 'onSuccess':
      return 'On success'
    case 'onError':
      return 'On error'
    default:
      return branch || 'Nested'
  }
}

export function nextGraphMapSearchMatchId(
  nodes: readonly WorkflowGraphNode[],
  edges: readonly WorkflowGraphEdge[],
  currentId: string | null,
  reverse: boolean
): string | null {
  const matches = graphMapSearchMatches(nodes, edges)
  if (matches.length === 0) return null
  const currentIndex = matches.findIndex((match) => match.id === currentId)
  const step = reverse ? -1 : 1
  const nextIndex = currentIndex === -1 ? (reverse ? matches.length - 1 : 0) : currentIndex + step
  const normalizedIndex = (nextIndex + matches.length) % matches.length
  return matches[normalizedIndex]?.id ?? null
}

function graphMapSearchMatches(
  nodes: readonly WorkflowGraphNode[],
  edges: readonly WorkflowGraphEdge[]
): GraphMapSearchMatch[] {
  return [
    ...nodes.map((node) => ({ id: graphMapNodeSearchMatchId(node) })),
    ...edges.map((edge) => ({ id: graphMapEdgeSearchMatchId(edge) }))
  ]
}
