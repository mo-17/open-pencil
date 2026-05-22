import type { ActionDef, EventName, SceneNode } from '@open-pencil/core/scene-graph'

import type { ExprAst } from '../expression'
import { hasPrevReference, parseExpression, PREV_IDENT, substitutePrev } from '../expression'
import type {
  IRApiCallHandler,
  IRDocStateDecl,
  IREventHandler,
  IREventName,
  IRExpression,
  IRSetVariableHandler,
  IRStateDecl,
  IRWarning,
  ValueUpdateMode
} from '../types'

/** Phase 2 §2: the formal parameter the adapter binds inside a functional
 *  updater (`setX((prev) => ...)`). Collector rewrites `$prev` → this name
 *  in the AST so emit can splice the AST verbatim. */
const PREV_FORMAL = 'prev'

/** Build IR for a node's text binding. Returns null when the node has no
 *  text binding or the binding is unresolvable; the caller falls back to the
 *  static literal. Warnings are pushed for partial failures.
 *
 *  Phase 2 §9: when `bindings.text.kind === 'expr'`, the expression is parsed
 *  and its referenced identifiers are validated against the union of declared
 *  page states, in-scope identifiers (e.g. `item` / `index` inside a LIST
 *  template), and — Phase 2 §4 — Document State names. Unknown identifiers
 *  fall back to a literal text and warn. */
export function resolveTextBinding(
  node: SceneNode,
  states: Map<string, IRStateDecl>,
  warnings: IRWarning[],
  inScope: ReadonlySet<string> = EMPTY_SCOPE,
  docStates: ReadonlyMap<string, IRDocStateDecl> = EMPTY_DOCSTATES,
  docStateReads?: Set<string>
): IRExpression | null {
  const binding = node.bindings?.text
  if (!binding) return null
  if (binding.kind === 'literal') return null
  if (binding.kind === 'docState') {
    const name = binding.docStateName ?? ''
    if (name === '') {
      warnings.push({
        code: 'binding-docstate-missing-name',
        message: `node ${node.id} text binding has no docStateName`,
        nodeId: node.id
      })
      return null
    }
    if (!docStates.has(name)) {
      warnings.push({
        code: 'binding-docstate-unknown-name',
        message: `node ${node.id} text binding references unknown document state "${name}"`,
        nodeId: node.id
      })
      return null
    }
    docStateReads?.add(name)
    return {
      kind: 'expression',
      ast: { kind: 'ident', name },
      references: [name]
    }
  }
  if (binding.kind === 'expr') {
    const src = binding.expr ?? ''
    if (src === '') return null
    const parsed = parseExpression(src)
    if (!parsed.ok) {
      warnings.push({
        code: 'binding-invalid-expression',
        message: `node ${node.id} text binding expression "${src}" → ${parsed.error}`,
        nodeId: node.id
      })
      return null
    }
    if (parsed.references.has(PREV_IDENT)) {
      warnings.push({
        code: 'expression-prev-out-of-context',
        message: `node ${node.id} text binding expression references ${PREV_IDENT}; ${PREV_IDENT} is only valid inside setState / setVariable valueExpr`,
        nodeId: node.id
      })
      return null
    }
    const unknown = unknownIdentifiers(parsed.references, states, inScope, docStates)
    if (unknown.length > 0) {
      warnings.push({
        code: 'binding-unknown-identifier',
        message: `node ${node.id} text binding expression references unknown identifier(s): ${unknown.join(', ')}`,
        nodeId: node.id
      })
      return null
    }
    // Phase 2 §4: a docState referenced inside the expression needs a
    // `useDocState` local on the page.
    registerDocStateReads(parsed.references, docStates, docStateReads)
    return {
      kind: 'expression',
      ast: parsed.ast,
      references: [...parsed.references]
    }
  }
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

const EMPTY_SCOPE: ReadonlySet<string> = new Set()
const EMPTY_DOCSTATES: ReadonlyMap<string, IRDocStateDecl> = new Map()

/** Identifiers referenced by an expression that match neither a declared
 *  page state, an in-scope identifier, nor a Document State. Used by
 *  `resolveTextBinding` (kind=expr), the renderCondition resolver in
 *  `tree.ts`, and the apiCall URL-template resolver.
 *
 *  Phase 2 §4: `docStates` widens the allow-set so a read-context expression
 *  may reference a Document State name (decision §4.2 #3). Callers that
 *  accept the reference must also call `registerDocStateReads` so the page
 *  emits the matching `useDocState` local. */
export function unknownIdentifiers(
  references: ReadonlySet<string>,
  states: Map<string, IRStateDecl>,
  inScope: ReadonlySet<string>,
  docStates: ReadonlyMap<string, IRDocStateDecl> = EMPTY_DOCSTATES
): string[] {
  const stateNames = new Set<string>()
  for (const s of states.values()) stateNames.add(s.name)
  const out: string[] = []
  for (const ref of references) {
    if (stateNames.has(ref)) continue
    if (inScope.has(ref)) continue
    if (docStates.has(ref)) continue
    out.push(ref)
  }
  return out
}

/** Phase 2 §4: record every reference that resolves to a Document State into
 *  `docStateReads`, so the page component emits a `const x = useDocState('x')`
 *  local for it. A no-op when `docStateReads` is undefined. */
export function registerDocStateReads(
  references: Iterable<string>,
  docStates: ReadonlyMap<string, IRDocStateDecl>,
  docStateReads: Set<string> | undefined
): void {
  if (!docStateReads) return
  for (const ref of references) {
    if (docStates.has(ref)) docStateReads.add(ref)
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
  warnings: IRWarning[],
  docStates: ReadonlyMap<string, IRDocStateDecl> = EMPTY_DOCSTATES,
  docStateWrites?: Set<string>
): Partial<Record<IREventName, IREventHandler[]>> | undefined {
  if (!node.events) return undefined
  const out: Partial<Record<IREventName, IREventHandler[]>> = {}
  for (const name of EVENT_NAMES_TO_RESOLVE) {
    const actions = node.events[name]
    if (!actions || actions.length === 0) continue
    const handlers = resolveActions(node, name, actions, states, warnings, docStates, docStateWrites)
    if (handlers.length > 0) out[name] = handlers
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function resolveActions(
  node: SceneNode,
  eventName: EventName,
  actions: ActionDef[],
  states: Map<string, IRStateDecl>,
  warnings: IRWarning[],
  docStates: ReadonlyMap<string, IRDocStateDecl>,
  docStateWrites: Set<string> | undefined
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
      case 'setVariable': {
        const handler = resolveSetVariable(
          node,
          eventName,
          action,
          states,
          docStates,
          warnings
        )
        if (handler) {
          out.push(handler)
          docStateWrites?.add(handler.docStateName)
        }
        break
      }
      case 'apiCall': {
        const handler = resolveApiCall(node, eventName, action, docStates, warnings)
        if (handler) {
          out.push(handler)
          docStateWrites?.add(handler.docStateName)
        }
        break
      }
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

/**
 * Phase 2 §2: derive the AST + references that emit a (functional-or-absolute)
 * setX call. `$prev` triggers functional mode; in functional mode the AST is
 * rewritten so `$prev` becomes the formal parameter `prev` and `$prev` is
 * stripped from the references list (it isn't a state name — it's a closure
 * argument). `extraScope` provides identifiers the adapter binds for free in
 * a functional updater body (currently just the formal parameter itself, used
 * only for setState's stateName when relevant).
 */
function buildValueUpdate(
  parsed: { ast: ExprAst; references: Set<string> }
): {
  ast: ExprAst
  references: string[]
  mode: ValueUpdateMode
} {
  if (!hasPrevReference(parsed.ast)) {
    return {
      ast: parsed.ast,
      references: [...parsed.references],
      mode: 'absolute'
    }
  }
  const stripped = new Set(parsed.references)
  stripped.delete(PREV_IDENT)
  return {
    ast: substitutePrev(parsed.ast, PREV_FORMAL),
    references: [...stripped],
    mode: 'functional'
  }
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
  const { ast, references, mode } = buildValueUpdate(parsed)
  return {
    kind: 'setState',
    stateName: target.name,
    ast,
    references,
    mode
  }
}

function resolveSetVariable(
  node: SceneNode,
  eventName: EventName,
  action: Extract<ActionDef, { kind: 'setVariable' }>,
  states: Map<string, IRStateDecl>,
  docStates: ReadonlyMap<string, IRDocStateDecl>,
  warnings: IRWarning[]
): IRSetVariableHandler | null {
  const name = action.targetName ?? ''
  if (name === '') {
    warnings.push({
      code: 'action-setvariable-missing-target',
      message: `node ${node.id} ${eventName} setVariable has no targetName`,
      nodeId: node.id
    })
    return null
  }
  if (!docStates.has(name)) {
    warnings.push({
      code: 'action-setvariable-unknown-target',
      message: `node ${node.id} ${eventName} setVariable references unknown document state "${name}"`,
      nodeId: node.id
    })
    return null
  }
  const src = action.valueExpr ?? ''
  const parsed = parseExpression(src)
  if (!parsed.ok) {
    warnings.push({
      code: 'action-setvariable-invalid-expression',
      message: `node ${node.id} ${eventName} setVariable valueExpr "${src}" → ${parsed.error}`,
      nodeId: node.id
    })
    return null
  }
  // Decision §2.2 #h: setVariable.valueExpr is identifier-resolved against
  // page states only (plus `$prev`). It does NOT resolve identifiers against
  // other doc-state names — that would invite docState→docState reference
  // graphs we don't want to validate this phase. `$prev` is removed by
  // `buildValueUpdate` (it's the closure parameter, not a real reference).
  const refsExcludingPrev = new Set(parsed.references)
  refsExcludingPrev.delete(PREV_IDENT)
  const stateNames = new Set<string>()
  for (const s of states.values()) stateNames.add(s.name)
  const unknown: string[] = []
  for (const ref of refsExcludingPrev) {
    if (!stateNames.has(ref)) unknown.push(ref)
  }
  if (unknown.length > 0) {
    warnings.push({
      code: 'action-setvariable-unknown-identifier',
      message: `node ${node.id} ${eventName} setVariable valueExpr references unknown identifier(s): ${unknown.join(', ')}`,
      nodeId: node.id
    })
    return null
  }
  const { ast, references, mode } = buildValueUpdate(parsed)
  return {
    kind: 'setVariable',
    docStateName: name,
    ast,
    references,
    mode
  }
}

/** Phase 2 §3: resolve an `apiCall` action into an `IRApiCallHandler`.
 *  Three validation gates — non-empty URL, target resolves to a declared
 *  Document State, and (POST only) the body parses as JSON. Any failure
 *  drops the handler with a warning so the emitted code stays compilable.
 *  The stored `body` is the re-serialised (compact, guaranteed-valid)
 *  JSON so emit can splice it as a JS literal. */
function resolveApiCall(
  node: SceneNode,
  eventName: EventName,
  action: Extract<ActionDef, { kind: 'apiCall' }>,
  docStates: ReadonlyMap<string, IRDocStateDecl>,
  warnings: IRWarning[]
): IRApiCallHandler | null {
  const url = action.url.trim()
  if (url === '') {
    warnings.push({
      code: 'action-apicall-missing-url',
      message: `node ${node.id} ${eventName} apiCall has no url`,
      nodeId: node.id
    })
    return null
  }
  const name = action.targetName
  if (name === '') {
    warnings.push({
      code: 'action-apicall-missing-target',
      message: `node ${node.id} ${eventName} apiCall has no targetName`,
      nodeId: node.id
    })
    return null
  }
  if (!docStates.has(name)) {
    warnings.push({
      code: 'action-apicall-unknown-target',
      message: `node ${node.id} ${eventName} apiCall references unknown document state "${name}"`,
      nodeId: node.id
    })
    return null
  }
  // POST body is a JSON literal. GET ignores it entirely. An empty / absent
  // body on POST is allowed (a bodyless POST is valid).
  let body: string | undefined
  if (action.method === 'POST') {
    const raw = (action.bodyJson ?? '').trim()
    if (raw !== '') {
      try {
        body = JSON.stringify(JSON.parse(raw))
      } catch (err) {
        warnings.push({
          code: 'action-apicall-invalid-body',
          message: `node ${node.id} ${eventName} apiCall body is not valid JSON: ${
            err instanceof Error ? err.message : String(err)
          }`,
          nodeId: node.id
        })
        return null
      }
    }
  }
  return {
    kind: 'apiCall',
    method: action.method,
    url,
    body,
    docStateName: name
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

