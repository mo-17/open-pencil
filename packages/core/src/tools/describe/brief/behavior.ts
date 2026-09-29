import type { ActionDef, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { type BriefBudget, DESIGN_BRIEF_LIMITS } from './budget'
import { publicPage } from './scope'
import type {
  DesignBriefAction,
  DesignBriefBackend,
  DesignBriefBinding,
  DesignBriefEvent
} from './types'

export function boundedEntries<T>(
  value: Record<string, T> | undefined,
  budget: BriefBudget
): Array<[string, T]> {
  const entries: Array<[string, T]> = []
  if (!value) return entries
  for (const key in value) {
    if (Object.hasOwn(value, key)) {
      if (!budget.detail()) break
      entries.push([key, value[key]])
    } else if (!budget.detail()) break
  }
  return entries
}

export function briefBindings(
  graph: SceneGraph,
  node: SceneNode,
  budget: BriefBudget
): DesignBriefBinding[] {
  return boundedEntries(node.bindings, budget).map(([property, binding]) => {
    const result: DesignBriefBinding = { property: budget.text(property), kind: binding.kind }
    if (binding.kind === 'expr' || binding.kind === 'literal') {
      budget.warnings.add('expressions-omitted')
      return result
    }
    const reference = binding.kind === 'ref' ? binding.stateId : binding.docStateName
    result.reference = budget.text(reference ?? '')
    const declarations =
      binding.kind === 'ref'
        ? publicPage(graph, node)?.state
        : graph.getNode(graph.rootId)?.lowcodeDocumentState
    result.resolved = false
    for (const declaration of declarations ?? []) {
      if (!budget.detail()) {
        delete result.resolved
        return result
      }
      if ((binding.kind === 'ref' ? declaration.id : declaration.name) === reference) {
        result.resolved = true
        break
      }
    }
    if (!result.resolved) budget.warnings.add('missing-reference')
    return result
  })
}

export function referenceStatus(
  graph: SceneGraph,
  nodeId: string,
  inScope: Set<string>
): DesignBriefAction['referenceStatus'] {
  const node = graph.getNode(nodeId)
  if (!node) return 'missing'
  if (!publicPage(graph, node)) return 'private'
  return inScope.has(nodeId) ? 'in-scope' : 'outside-scope'
}

export class BriefBehavior {
  readonly #resources = new Map<string, Set<string>>()
  readonly #commands = new Map<string, Set<string>>()

  constructor(
    readonly graph: SceneGraph,
    readonly inScope: Set<string>,
    readonly budget: BriefBudget
  ) {}

  resource(id: string, operation: string): void {
    this.#add(this.#resources, id, operation)
  }

  #add(target: Map<string, Set<string>>, id: string, operation: string): void {
    const safeId = this.budget.text(id)
    const operations = target.get(safeId) ?? new Set<string>()
    operations.add(this.budget.text(operation))
    target.set(safeId, operations)
  }

  backend(): DesignBriefBackend {
    return {
      coverage: 'referenced-bindings',
      resources: [...this.#resources].map(([resourceId, operations]) => ({
        resourceId,
        operations: [...operations]
      })),
      commands: [...this.#commands].map(([commandId, operations]) => ({
        commandId,
        operations: [...operations]
      }))
    }
  }

  #action(action: ActionDef, branch: string): DesignBriefAction {
    const result: DesignBriefAction = { kind: this.budget.text(action.kind), branch }
    if (action.kind === 'navigate' && action.to) {
      // Query/fragment values can contain application data; only authored local route patterns survive.
      result.target = this.route(action.to)
    } else if (action.kind === 'backendRequest') {
      result.target = this.budget.text(action.resourceId)
      this.resource(action.resourceId, action.operation)
    } else if (action.kind === 'backendCommand' || action.kind === 'backendCommandRecovery') {
      result.target = this.budget.text(action.commandId)
      this.#add(
        this.#commands,
        action.commandId,
        action.kind === 'backendCommand' ? 'execute' : action.operation
      )
    } else if (action.kind === 'callWorkflow') {
      result.target = this.budget.text(action.workflowId ?? '')
    }
    return result
  }

  route(route: string): string {
    if (!route.startsWith('/') || route.startsWith('//')) return '[external route omitted]'
    const prefix = route.slice(0, DESIGN_BRIEF_LIMITS.textPerField)
    if (prefix.length < route.length && !/[?#]/.test(prefix))
      this.budget.warnings.add('text-truncated')
    return this.budget.text(prefix.split(/[?#]/, 1)[0] ?? '')
  }

  #actions(actions: ActionDef[]): DesignBriefAction[] {
    const result: DesignBriefAction[] = []
    const stack: Array<{ actions: ActionDef[]; index: number; branch: string }> = [
      { actions, index: 0, branch: 'main' }
    ]
    const seen = new Set<ActionDef>()
    while (stack.length) {
      const frame = stack.at(-1)
      if (!frame) break
      const action = frame.actions.at(frame.index++)
      if (!action) {
        stack.pop()
        continue
      }
      if (!this.budget.detail()) break
      if (seen.has(action)) {
        this.budget.warnings.add('invalid-hierarchy')
        continue
      }
      seen.add(action)
      result.push(this.#action(action, frame.branch))
      if ('onError' in action && action.onError)
        stack.push({ actions: action.onError, index: 0, branch: 'error' })
      if ('onSuccess' in action && action.onSuccess)
        stack.push({ actions: action.onSuccess, index: 0, branch: 'success' })
      if (action.kind === 'condition' || action.kind === 'confirm') {
        if (action.alternate)
          stack.push({ actions: action.alternate, index: 0, branch: 'alternate' })
        stack.push({ actions: action.consequent, index: 0, branch: 'consequent' })
      }
    }
    return result
  }

  events(node: SceneNode): DesignBriefEvent[] {
    const events: DesignBriefEvent[] = []
    for (const event of ['onClick', 'onChange', 'onSubmit', 'onFocus', 'onBlur'] as const) {
      const actions = node.events?.[event]
      if (actions?.length) events.push({ event, actions: this.#actions(actions) })
    }
    for (const connection of node.prototype?.connections ?? []) {
      if (!this.budget.detail()) break
      const action: DesignBriefAction = { kind: connection.action.kind, branch: 'prototype' }
      if ('targetNodeId' in connection.action) {
        const status = referenceStatus(this.graph, connection.action.targetNodeId, this.inScope)
        action.referenceStatus = status
        if (status === 'private') this.budget.warnings.add('private-reference')
        else action.target = this.budget.text(connection.action.targetNodeId)
        if (status === 'missing') this.budget.warnings.add('missing-reference')
      }
      events.push({ event: this.budget.text(connection.trigger.kind), actions: [action] })
    }
    return events
  }
}
