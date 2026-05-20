import type { ActionDef, EventName, SceneNode } from '@open-pencil/core/scene-graph'

import { parseExpression } from '../expression'
import type {
  IREventHandler,
  IREventName,
  IRExpression,
  IRStateDecl,
  IRWarning
} from '../types'

/** Build IR for a node's text binding. Returns null when the node has no
 *  text binding or the binding is unresolvable; the caller falls back to the
 *  static literal. Warnings are pushed for partial failures. */
export function resolveTextBinding(
  node: SceneNode,
  states: Map<string, IRStateDecl>,
  warnings: IRWarning[]
): IRExpression | null {
  const binding = node.bindings?.text
  if (!binding) return null
  if (binding.kind === 'literal') return null
  // kind === 'ref'
  if (!binding.stateId) {
    warnings.push({
      code: 'binding-missing-state',
      message: `node ${node.id} text binding has no stateId`,
      nodeId: node.id
    })
    return null
  }
  const state = states.get(binding.stateId)
  if (!state) {
    warnings.push({
      code: 'binding-unknown-state',
      message: `node ${node.id} text binding references unknown state ${binding.stateId}`,
      nodeId: node.id
    })
    return null
  }
  return {
    kind: 'expression',
    ast: { kind: 'ident', name: state.name },
    references: [state.name]
  }
}

const EVENT_NAMES_TO_RESOLVE: EventName[] = [
  'onClick',
  'onChange',
  'onSubmit',
  'onFocus',
  'onBlur'
]

/** Translate a node's `events` map into IR event handlers, resolving each
 *  ActionDef into a fully-validated handler. Invalid handlers are dropped
 *  with a warning so the emitted code stays compilable. */
export function resolveEvents(
  node: SceneNode,
  states: Map<string, IRStateDecl>,
  warnings: IRWarning[]
): Partial<Record<IREventName, IREventHandler[]>> | undefined {
  if (!node.events) return undefined
  const out: Partial<Record<IREventName, IREventHandler[]>> = {}
  for (const name of EVENT_NAMES_TO_RESOLVE) {
    const actions = node.events[name]
    if (!actions || actions.length === 0) continue
    const handlers = resolveActions(node, name, actions, states, warnings)
    if (handlers.length > 0) out[name] = handlers
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function resolveActions(
  node: SceneNode,
  eventName: EventName,
  actions: ActionDef[],
  states: Map<string, IRStateDecl>,
  warnings: IRWarning[]
): IREventHandler[] {
  const out: IREventHandler[] = []
  for (const action of actions) {
    // Exhaustive dispatch on the discriminated union (Phase 1 §7.4). Adding
    // a kind without a case here is a tsgo error — the silent-drop hole that
    // Phase 0 had is closed.
    switch (action.kind) {
      case 'setState': {
        const handler = resolveSetState(node, eventName, action, states, warnings)
        if (handler) out.push(handler)
        break
      }
      case 'navigate': {
        const handler = resolveNavigate(node, eventName, action, warnings)
        if (handler) out.push(handler)
        break
      }
      case 'setVariable':
        warnings.push({
          code: 'action-setvariable-not-implemented',
          message:
            `node ${node.id} ${eventName} setVariable is reserved for future runtime; ` +
            `the handler is dropped from the compiled output`,
          nodeId: node.id
        })
        break
      default: {
        // `action satisfies never` would be ideal here, but the cast keeps
        // older .fig files (saved with an unknown future kind) loadable.
        const unknown = action as { kind: string }
        warnings.push({
          code: 'action-unsupported-kind',
          message: `node ${node.id} ${eventName} has unsupported action kind "${unknown.kind}"`,
          nodeId: node.id
        })
      }
    }
  }
  return out
}

function resolveSetState(
  node: SceneNode,
  eventName: EventName,
  action: Extract<ActionDef, { kind: 'setState' }>,
  states: Map<string, IRStateDecl>,
  warnings: IRWarning[]
): IREventHandler | null {
  if (!action.targetStateId) {
    warnings.push({
      code: 'action-missing-target',
      message: `node ${node.id} ${eventName} setState has no targetStateId`,
      nodeId: node.id
    })
    return null
  }
  const target = states.get(action.targetStateId)
  if (!target) {
    warnings.push({
      code: 'action-unknown-state',
      message: `node ${node.id} ${eventName} setState references unknown state ${action.targetStateId}`,
      nodeId: node.id
    })
    return null
  }
  const src = action.valueExpr ?? ''
  const parsed = parseExpression(src)
  if (!parsed.ok) {
    warnings.push({
      code: 'action-invalid-expression',
      message: `node ${node.id} ${eventName} setState valueExpr "${src}" → ${parsed.error}`,
      nodeId: node.id
    })
    return null
  }
  return {
    kind: 'setState',
    stateName: target.name,
    ast: parsed.ast,
    references: [...parsed.references]
  }
}

function resolveNavigate(
  node: SceneNode,
  eventName: EventName,
  action: Extract<ActionDef, { kind: 'navigate' }>,
  warnings: IRWarning[]
): IREventHandler | null {
  const to = action.to?.trim() ?? ''
  if (to === '') {
    warnings.push({
      code: 'action-navigate-missing-to',
      message: `node ${node.id} ${eventName} navigate has no target path`,
      nodeId: node.id
    })
    return null
  }
  return { kind: 'navigate', to }
}

