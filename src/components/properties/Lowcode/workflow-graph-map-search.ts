import type { WorkflowGraphEdge, WorkflowGraphNode } from '@/app/lowcode/workflow-graph'

type GraphMapSearchMatch = {
  id: string
  kind: 'node' | 'edge'
}

export type GraphMapEdgeBranchKind =
  | 'root'
  | 'then'
  | 'else'
  | 'success'
  | 'error'
  | 'nested'
  | 'custom'

export interface GraphMapSearchPosition {
  index: number
  total: number
  kind: 'node' | 'edge'
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

export function graphMapEdgeMatchesSearch(
  edge: WorkflowGraphEdge,
  term: string,
  localizedBranchLabel = graphMapEdgeBranchLabel(edge)
): boolean {
  return [
    edge.fromId,
    edge.fromName,
    edge.toId,
    edge.toName ?? '',
    edge.actionId,
    edge.actionPath,
    edge.actionKind,
    graphMapEdgeBranchLabel(edge),
    localizedBranchLabel
  ].some((value) => value.toLowerCase().includes(term))
}

export function graphMapEdgeBranchLabel(edge: WorkflowGraphEdge): string {
  const kind = graphMapEdgeBranchKind(edge)
  if (kind === 'root') return 'Root'
  if (kind === 'then') return 'Then'
  if (kind === 'else') return 'Else'
  if (kind === 'success') return 'On success'
  if (kind === 'error') return 'On error'
  if (kind === 'nested') return 'Nested'
  const branch =
    edge.actionPath
      .split('/')
      .at(-1)
      ?.replace(/\[\d+\]$/, '') ?? ''
  return branch || 'Nested'
}

export function graphMapEdgeBranchKind(edge: WorkflowGraphEdge): GraphMapEdgeBranchKind {
  if (!edge.actionPath.includes('/')) return 'root'
  const branch =
    edge.actionPath
      .split('/')
      .at(-1)
      ?.replace(/\[\d+\]$/, '') ?? ''
  switch (branch) {
    case 'consequent':
      return 'then'
    case 'alternate':
      return 'else'
    case 'onSuccess':
      return 'success'
    case 'onError':
      return 'error'
    default:
      return branch ? 'custom' : 'nested'
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

export function graphMapSearchMatchPositionLabel(
  nodes: readonly WorkflowGraphNode[],
  edges: readonly WorkflowGraphEdge[],
  currentId: string | null
): string {
  const position = graphMapSearchMatchPosition(nodes, edges, currentId)
  if (!position) return ''
  return ` · ${position.index}/${position.total} ${position.kind}`
}

export function graphMapSearchMatchPosition(
  nodes: readonly WorkflowGraphNode[],
  edges: readonly WorkflowGraphEdge[],
  currentId: string | null
): GraphMapSearchPosition | null {
  const matches = graphMapSearchMatches(nodes, edges)
  const index = matches.findIndex((match) => match.id === currentId)
  if (index === -1) return null
  const match = matches[index]
  return { index: index + 1, total: matches.length, kind: match.kind }
}

export function formatGraphMapSearchSummary(
  nodes: readonly WorkflowGraphNode[],
  edges: readonly WorkflowGraphEdge[],
  query: string,
  currentId: string | null
): string {
  const position = graphMapSearchMatchPositionLabel(nodes, edges, currentId)
  return `${countLabel(nodes.length, 'node')}, ${countLabel(edges.length, 'edge')} matching "${query.trim()}"${position}`
}

export function isGraphMapTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

export function scrollGraphMapActiveMatchIntoView(root: HTMLElement | null): void {
  root
    ?.querySelector('[data-graph-map-active-match="true"]')
    ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

function graphMapSearchMatches(
  nodes: readonly WorkflowGraphNode[],
  edges: readonly WorkflowGraphEdge[]
): GraphMapSearchMatch[] {
  return [
    ...nodes.map((node) => ({ id: graphMapNodeSearchMatchId(node), kind: 'node' as const })),
    ...edges.map((edge) => ({ id: graphMapEdgeSearchMatchId(edge), kind: 'edge' as const }))
  ]
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}
