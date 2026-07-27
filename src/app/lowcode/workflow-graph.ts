import { validateExpression } from '@open-pencil/core/lowcode-validation'
import type { ActionDef, EventName, SceneNode, WorkflowDef } from '@open-pencil/scene-graph'

export interface WorkflowGraphEdge {
  fromId: string
  fromName: string
  toId: string
  toName?: string
  actionId: string
  actionPath: string
  actionKind: ActionDef['kind']
}

export interface WorkflowGraphIssue {
  type: 'missing-workflow' | 'cycle' | 'call-args'
  message: string
  /** Structured copy for presentation layers that need localized issue text. */
  i18n?: WorkflowGraphIssueI18n
  workflowIds: string[]
  targetWorkflowId?: string
  actionId?: string
  actionPath?: string
}

export type WorkflowGraphCallArgProblem = {
  kind: 'extra' | 'missing' | 'invalid'
  param: string
  message: string
}

export type WorkflowGraphIssueI18n =
  | { code: 'missing-workflow-call'; sourceName: string; workflowId: string }
  | {
      code: 'missing-workflow-entrypoint'
      nodeName: string
      eventName: EventName
      workflowId: string
    }
  | {
      code: 'call-args'
      sourceName: string
      targetName: string
      problems: WorkflowGraphCallArgProblem[]
    }
  | { code: 'cycle'; names: string[] }

export interface WorkflowGraphEntrypoint {
  workflowId: string
  workflowName?: string
  nodeId: string
  nodeName: string
  eventName: EventName
  actionId: string
  actionPath: string
}

export interface WorkflowGraphNode {
  id: string
  name: string
  actionCount: number
  outgoing: WorkflowGraphEdge[]
  incoming: WorkflowGraphEdge[]
  entrypoints: WorkflowGraphEntrypoint[]
  issues: WorkflowGraphIssue[]
}

export interface WorkflowGraphSummary {
  workflowCount: number
  actionCount: number
  callCount: number
  entrypointCount: number
  workflowsWithoutEntrypoints: string[]
  nodes: WorkflowGraphNode[]
  edges: WorkflowGraphEdge[]
  entrypoints: WorkflowGraphEntrypoint[]
  issues: WorkflowGraphIssue[]
}

export interface WorkflowGraphOptions {
  entrypoints?: readonly WorkflowGraphEntrypoint[]
}

function withWorkflowGraphIssueI18n(
  issue: WorkflowGraphIssue,
  i18n: WorkflowGraphIssueI18n
): WorkflowGraphIssue {
  // Keep the legacy enumerable result shape stable for API consumers and tests;
  // presentation layers can still read the structured localization metadata.
  Object.defineProperty(issue, 'i18n', { value: i18n, enumerable: false })
  return issue
}

export function collectWorkflowEntrypoints(
  nodes: readonly SceneNode[],
  workflows: readonly WorkflowDef[]
): WorkflowGraphEntrypoint[] {
  const byId = new Map(workflows.map((workflow) => [workflow.id, workflow]))
  const entrypoints: WorkflowGraphEntrypoint[] = []

  for (const node of nodes) {
    for (const [eventName, actions] of Object.entries(node.events ?? {}) as [
      EventName,
      ActionDef[]
    ][]) {
      collectEventEntrypoints(
        actions,
        {
          nodeId: node.id,
          nodeName: node.name || node.id,
          eventName
        },
        byId,
        entrypoints,
        eventName
      )
    }
  }

  return entrypoints
}

export function analyzeWorkflowGraph(
  workflows: readonly WorkflowDef[],
  options: WorkflowGraphOptions = {}
): WorkflowGraphSummary {
  const byId = new Map(workflows.map((workflow) => [workflow.id, workflow]))
  const edges: WorkflowGraphEdge[] = []
  const callArgIssues: WorkflowGraphIssue[] = []
  const actionCounts = new Map<string, number>()
  const entrypoints = [...(options.entrypoints ?? [])]

  for (const workflow of workflows) {
    actionCounts.set(
      workflow.id,
      collectCalls(workflow.actions, workflow, byId, edges, callArgIssues)
    )
  }

  const issues: WorkflowGraphIssue[] = [
    ...missingWorkflowIssues(edges),
    ...missingEntrypointIssues(entrypoints),
    ...callArgIssues,
    ...cycleIssues(workflows, edges)
  ]
  const nodes = workflows.map((workflow) =>
    workflowNode(workflow, actionCounts.get(workflow.id) ?? 0, edges, entrypoints, issues)
  )

  return {
    workflowCount: workflows.length,
    actionCount: [...actionCounts.values()].reduce((sum, count) => sum + count, 0),
    callCount: edges.length,
    entrypointCount: entrypoints.filter((entrypoint) => byId.has(entrypoint.workflowId)).length,
    workflowsWithoutEntrypoints: nodes
      .filter((node) => node.entrypoints.length === 0)
      .map((node) => node.id),
    nodes,
    edges,
    entrypoints,
    issues
  }
}

function collectEventEntrypoints(
  actions: readonly ActionDef[] | undefined,
  source: Pick<WorkflowGraphEntrypoint, 'nodeId' | 'nodeName' | 'eventName'>,
  workflows: ReadonlyMap<string, WorkflowDef>,
  entrypoints: WorkflowGraphEntrypoint[],
  pathPrefix: string
): void {
  for (const [index, action] of (actions ?? []).entries()) {
    const actionPath = `${pathPrefix}[${index}]`
    if (action.kind === 'callWorkflow' && action.workflowId) {
      entrypoints.push({
        ...source,
        workflowId: action.workflowId,
        workflowName: workflows.get(action.workflowId)?.name,
        actionId: action.id,
        actionPath
      })
    }
    for (const [branchName, branch] of actionBranches(action)) {
      collectEventEntrypoints(branch, source, workflows, entrypoints, `${actionPath}/${branchName}`)
    }
  }
}

function collectCalls(
  actions: readonly ActionDef[] | undefined,
  workflow: WorkflowDef,
  workflows: ReadonlyMap<string, WorkflowDef>,
  edges: WorkflowGraphEdge[],
  callArgIssues: WorkflowGraphIssue[],
  pathPrefix = ''
): number {
  let actionCount = 0
  for (const [index, action] of (actions ?? []).entries()) {
    const actionPath = `${pathPrefix}[${index}]`
    actionCount += 1
    if (action.kind === 'callWorkflow' && action.workflowId) {
      const target = workflows.get(action.workflowId)
      edges.push({
        fromId: workflow.id,
        fromName: workflow.name || workflow.id,
        toId: action.workflowId,
        toName: target?.name,
        actionId: action.id,
        actionPath,
        actionKind: action.kind
      })
      if (target) callArgIssues.push(...callWorkflowArgIssues(action, workflow, target, actionPath))
    }
    for (const [branchName, branch] of actionBranches(action)) {
      actionCount += collectCalls(
        branch,
        workflow,
        workflows,
        edges,
        callArgIssues,
        `${actionPath}/${branchName}`
      )
    }
  }
  return actionCount
}

function callWorkflowArgIssues(
  action: Extract<ActionDef, { kind: 'callWorkflow' }>,
  source: WorkflowDef,
  target: WorkflowDef,
  actionPath: string
): WorkflowGraphIssue[] {
  const problems = callWorkflowArgProblems(action, target)
  if (problems.length === 0) return []
  const sourceName = source.name || source.id
  const targetName = target.name || target.id
  return [
    withWorkflowGraphIssueI18n(
      {
        type: 'call-args',
        message: `${sourceName} calls ${targetName} with invalid arguments: ${problems.map((problem) => problem.message).join(', ')}`,
        workflowIds: [source.id, target.id],
        targetWorkflowId: source.id,
        actionId: action.id,
        actionPath
      },
      { code: 'call-args', sourceName, targetName, problems }
    )
  ]
}

function callWorkflowArgProblems(
  action: Extract<ActionDef, { kind: 'callWorkflow' }>,
  workflow: WorkflowDef
): WorkflowGraphCallArgProblem[] {
  const params = workflow.params ?? []
  const args = action.args ?? {}
  const defaults = workflow.paramDefaults ?? {}
  const optional = new Set(workflow.optionalParams)
  const problems: WorkflowGraphCallArgProblem[] = []
  for (const key of Object.keys(args)) {
    if (!params.includes(key))
      problems.push({ kind: 'extra', param: key, message: `extra "${key}"` })
  }
  for (const param of params) {
    const raw = Object.hasOwn(args, param) ? args[param] : ''
    if (raw.trim() === '') {
      if (!Object.hasOwn(defaults, param) && !optional.has(param))
        problems.push({ kind: 'missing', param, message: `missing "${param}"` })
      continue
    }
    const result = validateExpression(raw)
    if (!result.ok) problems.push({ kind: 'invalid', param, message: `invalid "${param}"` })
  }
  return problems
}

function actionBranches(action: ActionDef): readonly [string, readonly ActionDef[] | undefined][] {
  switch (action.kind) {
    case 'apiCall':
    case 'supabaseQuery':
    case 'supabaseMutation':
      return [
        ['onSuccess', action.onSuccess],
        ['onError', action.onError]
      ]
    case 'condition':
    case 'confirm':
      return [
        ['consequent', action.consequent],
        ['alternate', action.alternate]
      ]
    default:
      return []
  }
}

function missingWorkflowIssues(edges: readonly WorkflowGraphEdge[]): WorkflowGraphIssue[] {
  return edges
    .filter((edge) => !edge.toName)
    .map((edge) =>
      withWorkflowGraphIssueI18n(
        {
          type: 'missing-workflow',
          message: `${edge.fromName} calls a missing workflow (${edge.toId})`,
          workflowIds: [edge.fromId, edge.toId],
          targetWorkflowId: edge.fromId,
          actionId: edge.actionId,
          actionPath: edge.actionPath
        },
        {
          code: 'missing-workflow-call',
          sourceName: edge.fromName,
          workflowId: edge.toId
        }
      )
    )
}

function missingEntrypointIssues(
  entrypoints: readonly WorkflowGraphEntrypoint[]
): WorkflowGraphIssue[] {
  return entrypoints
    .filter((entrypoint) => !entrypoint.workflowName)
    .map((entrypoint) =>
      withWorkflowGraphIssueI18n(
        {
          type: 'missing-workflow',
          message: `${entrypoint.nodeName} ${entrypoint.eventName} calls a missing workflow (${entrypoint.workflowId})`,
          workflowIds: [entrypoint.workflowId]
        },
        {
          code: 'missing-workflow-entrypoint',
          nodeName: entrypoint.nodeName,
          eventName: entrypoint.eventName,
          workflowId: entrypoint.workflowId
        }
      )
    )
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
        const cycleNames = cycle.map((entry) => names.get(entry) ?? entry)
        issues.push(
          withWorkflowGraphIssueI18n(
            {
              type: 'cycle',
              message: `Workflow cycle: ${cycleNames.join(' -> ')}`,
              workflowIds: cycle,
              targetWorkflowId: cycle[0]
            },
            { code: 'cycle', names: cycleNames }
          )
        )
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
  entrypoints: readonly WorkflowGraphEntrypoint[],
  issues: readonly WorkflowGraphIssue[]
): WorkflowGraphNode {
  return {
    id: workflow.id,
    name: workflow.name || workflow.id,
    actionCount,
    outgoing: edges.filter((edge) => edge.fromId === workflow.id),
    incoming: edges.filter((edge) => edge.toId === workflow.id),
    entrypoints: entrypoints.filter((entrypoint) => entrypoint.workflowId === workflow.id),
    issues: issues.filter((issue) => issue.workflowIds.includes(workflow.id))
  }
}

function normalizeCycleKey(cycle: readonly string[]): string {
  const nodes = cycle.slice(0, -1)
  if (nodes.length === 0) return ''
  const rotations = nodes.map((_, index) =>
    [...nodes.slice(index), ...nodes.slice(0, index)].join('\0')
  )
  return rotations.sort()[0]
}
