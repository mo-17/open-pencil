import type { ActionDef, WorkflowDef } from '@open-pencil/core/scene-graph'

export interface WorkflowGraphEdge {
  fromId: string
  fromName: string
  toId: string
  toName?: string
  actionId: string
}

export interface WorkflowGraphIssue {
  type: 'missing-workflow' | 'cycle'
  message: string
  workflowIds: string[]
}

export interface WorkflowGraphNode {
  id: string
  name: string
  actionCount: number
  outgoing: WorkflowGraphEdge[]
  incoming: WorkflowGraphEdge[]
  issues: WorkflowGraphIssue[]
}

export interface WorkflowGraphSummary {
  workflowCount: number
  actionCount: number
  callCount: number
  nodes: WorkflowGraphNode[]
  edges: WorkflowGraphEdge[]
  issues: WorkflowGraphIssue[]
}

export function analyzeWorkflowGraph(workflows: readonly WorkflowDef[]): WorkflowGraphSummary {
  const byId = new Map(workflows.map((workflow) => [workflow.id, workflow]))
  const edges: WorkflowGraphEdge[] = []
  const actionCounts = new Map<string, number>()

  for (const workflow of workflows) {
    actionCounts.set(workflow.id, collectCalls(workflow.actions, workflow, byId, edges))
  }

  const issues: WorkflowGraphIssue[] = [
    ...missingWorkflowIssues(edges),
    ...cycleIssues(workflows, edges)
  ]
  const nodes = workflows.map((workflow) =>
    workflowNode(workflow, actionCounts.get(workflow.id) ?? 0, edges, issues)
  )

  return {
    workflowCount: workflows.length,
    actionCount: [...actionCounts.values()].reduce((sum, count) => sum + count, 0),
    callCount: edges.length,
    nodes,
    edges,
    issues
  }
}

function collectCalls(
  actions: readonly ActionDef[] | undefined,
  workflow: WorkflowDef,
  workflows: ReadonlyMap<string, WorkflowDef>,
  edges: WorkflowGraphEdge[]
): number {
  let actionCount = 0
  for (const action of actions ?? []) {
    actionCount += 1
    if (action.kind === 'callWorkflow' && action.workflowId) {
      edges.push({
        fromId: workflow.id,
        fromName: workflow.name || workflow.id,
        toId: action.workflowId,
        toName: workflows.get(action.workflowId)?.name,
        actionId: action.id
      })
    }
    for (const branch of actionBranches(action)) {
      actionCount += collectCalls(branch, workflow, workflows, edges)
    }
  }
  return actionCount
}

function actionBranches(action: ActionDef): readonly ActionDef[][] {
  switch (action.kind) {
    case 'apiCall':
    case 'supabaseQuery':
    case 'supabaseMutation':
      return [action.onSuccess ?? [], action.onError ?? []]
    case 'condition':
    case 'confirm':
      return [action.consequent, action.alternate ?? []]
    default:
      return []
  }
}

function missingWorkflowIssues(edges: readonly WorkflowGraphEdge[]): WorkflowGraphIssue[] {
  return edges
    .filter((edge) => !edge.toName)
    .map((edge) => ({
      type: 'missing-workflow',
      message: `${edge.fromName} calls a missing workflow (${edge.toId})`,
      workflowIds: [edge.fromId, edge.toId]
    }))
}

function cycleIssues(
  workflows: readonly WorkflowDef[],
  edges: readonly WorkflowGraphEdge[]
): WorkflowGraphIssue[] {
  const graph = new Map<string, string[]>()
  const knownIds = new Set(workflows.map((workflow) => workflow.id))
  const names = new Map(workflows.map((workflow) => [workflow.id, workflow.name || workflow.id]))
  for (const edge of edges) {
    if (!knownIds.has(edge.toId)) continue
    graph.set(edge.fromId, [...(graph.get(edge.fromId) ?? []), edge.toId])
  }

  const visited = new Set<string>()
  const active = new Set<string>()
  const activePath: string[] = []
  const seenCycles = new Set<string>()
  const issues: WorkflowGraphIssue[] = []

  function visit(id: string): void {
    if (active.has(id)) {
      const start = activePath.indexOf(id)
      const cycle = [...activePath.slice(start), id]
      const key = normalizeCycleKey(cycle)
      if (!seenCycles.has(key)) {
        seenCycles.add(key)
        issues.push({
          type: 'cycle',
          message: `Workflow cycle: ${cycle.map((entry) => names.get(entry) ?? entry).join(' -> ')}`,
          workflowIds: cycle
        })
      }
      return
    }
    if (visited.has(id)) return
    visited.add(id)
    active.add(id)
    activePath.push(id)
    for (const next of graph.get(id) ?? []) visit(next)
    activePath.pop()
    active.delete(id)
  }

  for (const workflow of workflows) visit(workflow.id)
  return issues
}

function workflowNode(
  workflow: WorkflowDef,
  actionCount: number,
  edges: readonly WorkflowGraphEdge[],
  issues: readonly WorkflowGraphIssue[]
): WorkflowGraphNode {
  return {
    id: workflow.id,
    name: workflow.name || workflow.id,
    actionCount,
    outgoing: edges.filter((edge) => edge.fromId === workflow.id),
    incoming: edges.filter((edge) => edge.toId === workflow.id),
    issues: issues.filter((issue) => issue.workflowIds.includes(workflow.id))
  }
}

function normalizeCycleKey(cycle: readonly string[]): string {
  const nodes = cycle.slice(0, -1)
  if (nodes.length === 0) return ''
  const rotations = nodes.map((_, index) => [...nodes.slice(index), ...nodes.slice(0, index)].join('\0'))
  return rotations.sort()[0]
}
