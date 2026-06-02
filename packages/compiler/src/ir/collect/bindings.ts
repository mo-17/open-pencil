import type { ActionDef, EventName, SceneNode } from '@open-pencil/core/scene-graph'
import {
  type ExprAst,
  hasPrevReference,
  normalizeSupabaseMutationPayloadJson,
  parseExpression,
  parseTemplate,
  PAYLOAD_ENTRY_KEY_RE,
  PREV_IDENT,
  substitutePrev
} from '@open-pencil/core/lowcode-validation'
import type {
  IRApiCallHandler,
  IRConditionalHandler,
  IRControlledInput,
  IRDelayHandler,
  IRDocStateDecl,
  IREventHandler,
  IREventName,
  IRExpression,
  IRSetVariableHandler,
  IRStateDecl,
  IRSupabaseAuthHandler,
  IRSupabaseFilter,
  IRSupabaseMutationHandler,
  IRSupabasePayloadEntry,
  IRSupabaseQueryHandler,
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

/** Phase 3 §3.v4: per-node valid `targetType` constraint for a controlled
 *  form control. INPUT supports both string and number; the text-like
 *  family (TEXTAREA / SELECT / RADIO / DATEPICKER) is string only;
 *  SWITCH is boolean only. CHECKBOX depends on `interactiveProps.options`
 *  presence — step 8: with options it becomes a multi-select group bound
 *  to an `array<string>` state; without options it stays a single boolean
 *  toggle (back-compat with §3.x). Returns the legal set; mismatches go
 *  through `binding-value-bad-state-type` (sourced from `resolveValueBinding`). */
type CtrlTargetType = 'string' | 'number' | 'boolean' | 'array'

function checkboxHasOptions(node: SceneNode): boolean {
  const raw = node.interactiveProps?.options
  return Array.isArray(raw) && raw.length > 0
}

function allowedTargetTypes(node: SceneNode): ReadonlySet<CtrlTargetType> {
  if (node.type === 'INPUT') return new Set(['string', 'number'])
  if (node.type === 'SWITCH') return new Set(['boolean'])
  if (node.type === 'CHECKBOX') {
    return new Set([checkboxHasOptions(node) ? 'array' : 'boolean'])
  }
  return new Set(['string'])
}

function asCtrlTargetType(
  t: 'string' | 'number' | 'boolean' | 'object' | 'array'
): CtrlTargetType | null {
  return t === 'string' || t === 'number' || t === 'boolean' || t === 'array' ? t : null
}

/** Phase 3 §3.x + §3.v4: resolve a form control's `bindings.value` to a
 *  controlled descriptor the adapter can emit as a two-way binding.
 *  Returns null when there is no value binding or the binding cannot be
 *  wired (kind / type validation failures push a warning and fall back to
 *  the uncontrolled emit path).
 *
 *  Supported `kind`s: `'docState'` (write through `setDocState`), `'ref'`
 *  (write through the page-state setter). `'literal'` and `'expr'` are
 *  rejected because the writer needs an addressable target. The resolved
 *  state type must be in `allowedTargetTypes(node)`: INPUT accepts
 *  string|number; TEXTAREA/SELECT/RADIO/DATEPICKER accept string only;
 *  SWITCH accepts boolean only; CHECKBOX accepts boolean (single mode)
 *  or array (group mode — when `interactiveProps.options` is set).
 *  Mismatches fall back to uncontrolled with `binding-value-bad-state-type`.
 *  Resolving against a
 *  docState additionally registers a read + write so the page scaffolds
 *  `useDocState` / `setDocState` imports. */
export function resolveValueBinding(
  node: SceneNode,
  states: Map<string, IRStateDecl>,
  warnings: IRWarning[],
  docStates: ReadonlyMap<string, IRDocStateDecl> = EMPTY_DOCSTATES,
  docStateReads?: Set<string>,
  docStateWrites?: Set<string>
): IRControlledInput | null {
  const binding = node.bindings?.value
  if (!binding) return null
  if (binding.kind === 'literal' || binding.kind === 'expr') {
    warnings.push({
      code: 'binding-value-unsupported-kind',
      message: `node ${node.id} bindings.value kind "${binding.kind}" is not addressable; only docState / ref are supported for controlled inputs`,
      nodeId: node.id
    })
    return null
  }
  const allowed = allowedTargetTypes(node)
  const allowedList = [...allowed].join('|')
  if (binding.kind === 'docState') {
    const name = binding.docStateName ?? ''
    if (name === '') {
      warnings.push({
        code: 'binding-value-docstate-missing-name',
        message: `node ${node.id} bindings.value has no docStateName`,
        nodeId: node.id
      })
      return null
    }
    const decl = docStates.get(name)
    if (!decl) {
      warnings.push({
        code: 'binding-value-docstate-unknown-name',
        message: `node ${node.id} bindings.value references unknown document state "${name}"`,
        nodeId: node.id
      })
      return null
    }
    const ctrlType = asCtrlTargetType(decl.type)
    if (ctrlType === null || !allowed.has(ctrlType)) {
      warnings.push({
        code: 'binding-value-bad-state-type',
        message: `node ${node.id} (${node.type}) bindings.value docState "${name}" is type ${decl.type}; controlled ${node.type} requires type=${allowedList}`,
        nodeId: node.id
      })
      return null
    }
    docStateReads?.add(name)
    docStateWrites?.add(name)
    return { read: name, write: { kind: 'docState', name, targetType: ctrlType } }
  }
  // kind === 'ref'
  if (!binding.stateId) {
    warnings.push({
      code: 'binding-value-missing-state',
      message: `node ${node.id} bindings.value has no stateId`,
      nodeId: node.id
    })
    return null
  }
  const state = states.get(binding.stateId)
  if (!state) {
    warnings.push({
      code: 'binding-value-unknown-state',
      message: `node ${node.id} bindings.value references unknown state ${binding.stateId}`,
      nodeId: node.id
    })
    return null
  }
  const ctrlType = asCtrlTargetType(state.type)
  if (ctrlType === null || !allowed.has(ctrlType)) {
    warnings.push({
      code: 'binding-value-bad-state-type',
      message: `node ${node.id} (${node.type}) bindings.value state "${state.name}" is type ${state.type}; controlled ${node.type} requires type=${allowedList}`,
      nodeId: node.id
    })
    return null
  }
  return { read: state.name, write: { kind: 'state', name: state.name, targetType: ctrlType } }
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
  docStateWrites?: Set<string>,
  inScope: ReadonlySet<string> = EMPTY_SCOPE,
  docStateReads?: Set<string>
): Partial<Record<IREventName, IREventHandler[]>> | undefined {
  if (!node.events) return undefined
  const out: Partial<Record<IREventName, IREventHandler[]>> = {}
  for (const name of EVENT_NAMES_TO_RESOLVE) {
    const actions = node.events[name]
    if (!actions || actions.length === 0) continue
    const handlers = resolveActions(
      node,
      name,
      actions,
      states,
      warnings,
      docStates,
      docStateWrites,
      inScope,
      docStateReads
    )
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
  docStateWrites: Set<string> | undefined,
  inScope: ReadonlySet<string>,
  docStateReads: Set<string> | undefined
): IREventHandler[] {
  const ctx: ResolveCtx = {
    node,
    eventName,
    states,
    warnings,
    docStates,
    docStateWrites,
    inScope,
    docStateReads
  }
  return resolveBranch(actions, ctx)
}

/** Phase 3 §10: lower one ActionDef chain into IR handlers, dropping invalid
 *  ones with a warning and recording the docState each writes. Used for both
 *  the top-level event chain and the nested `then` / `else` branches of a
 *  `condition` handler, so workflows nest through the same pipeline. */
function resolveBranch(actions: ActionDef[], ctx: ResolveCtx): IREventHandler[] {
  const out: IREventHandler[] = []
  for (const action of actions) {
    const handler = dispatchAction(action, ctx)
    if (handler) {
      out.push(handler)
      recordWrites(handler, ctx.docStateWrites)
    }
  }
  return out
}

interface ResolveCtx {
  node: SceneNode
  eventName: EventName
  states: Map<string, IRStateDecl>
  warnings: IRWarning[]
  docStates: ReadonlyMap<string, IRDocStateDecl>
  docStateWrites: Set<string> | undefined
  inScope: ReadonlySet<string>
  docStateReads: Set<string> | undefined
}

/** Exhaustive dispatch on the discriminated union (Phase 1 §7.4). Adding a
 *  kind without a case here is a tsgo error — the silent-drop hole that
 *  Phase 0 had is closed. */
function dispatchAction(action: ActionDef, ctx: ResolveCtx): IREventHandler | null {
  switch (action.kind) {
    case 'setState':
      return resolveSetState(ctx.node, ctx.eventName, action, ctx.states, ctx.warnings)
    case 'navigate':
      return resolveNavigate(ctx.node, ctx.eventName, action, ctx.warnings)
    case 'setVariable':
      return resolveSetVariable(ctx.node, ctx.eventName, action, ctx.states, ctx.docStates, ctx.warnings)
    case 'apiCall':
      return resolveApiCall(
        ctx.node,
        ctx.eventName,
        action,
        ctx.states,
        ctx.inScope,
        ctx.docStates,
        ctx.docStateReads,
        ctx.warnings
      )
    case 'supabaseQuery':
      return resolveSupabaseQuery(
        ctx.node,
        ctx.eventName,
        action,
        ctx.states,
        ctx.inScope,
        ctx.docStates,
        ctx.docStateReads,
        ctx.warnings
      )
    case 'supabaseMutation':
      return resolveSupabaseMutation(
        ctx.node,
        ctx.eventName,
        action,
        ctx.states,
        ctx.inScope,
        ctx.docStates,
        ctx.docStateReads,
        ctx.warnings
      )
    case 'supabaseAuth':
      return resolveSupabaseAuth(
        ctx.node,
        ctx.eventName,
        action,
        ctx.states,
        ctx.inScope,
        ctx.docStates,
        ctx.docStateReads,
        ctx.warnings
      )
    case 'condition':
      return resolveCondition(action, ctx)
    case 'delay':
      return resolveDelay(ctx.node, ctx.eventName, action, ctx.warnings)
    case 'stop':
      return { kind: 'stop' }
    default: {
      // `action satisfies never` would be ideal here, but the cast keeps
      // older .fig files (saved with an unknown future kind) loadable.
      const unknown = action as { kind: string }
      ctx.warnings.push({
        code: 'action-unsupported-kind',
        message: `node ${ctx.node.id} ${ctx.eventName} has unsupported action kind "${unknown.kind}"`,
        nodeId: ctx.node.id
      })
      return null
    }
  }
}

/** Mirror what each handler kind writes into docState so the page emits the
 *  matching `setDocState` import. apiCall + setVariable both write a single
 *  target; supabase handlers may write a result and/or error target. */
function recordWrites(handler: IREventHandler, docStateWrites: Set<string> | undefined): void {
  if (!docStateWrites) return
  switch (handler.kind) {
    case 'setVariable':
    case 'apiCall':
      docStateWrites.add(handler.docStateName)
      return
    case 'supabaseQuery':
      docStateWrites.add(handler.resultTarget)
      if (handler.errorTarget) docStateWrites.add(handler.errorTarget)
      return
    case 'supabaseMutation':
      if (handler.resultTarget) docStateWrites.add(handler.resultTarget)
      if (handler.errorTarget) docStateWrites.add(handler.errorTarget)
      return
    case 'supabaseAuth':
      if (handler.errorTarget) docStateWrites.add(handler.errorTarget)
      return
    case 'setState':
    case 'navigate':
    // Phase 3 §10: condition writes are recorded per nested handler while its
    // branches are resolved (resolveBranch); delay / stop write nothing.
    case 'condition':
    case 'delay':
    case 'stop':
      break
  }
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

/** Phase 2 §3 + §4: resolve an `apiCall` action into an `IRApiCallHandler`.
 *  Validation gates — non-empty URL, the URL parses as a `${}` template
 *  (§4) whose identifiers all resolve (page state / docState / in-scope),
 *  target resolves to a declared Document State, and (POST only) the body
 *  parses as JSON. Any failure drops the handler with a warning so the
 *  emitted code stays compilable. The stored `body` is the re-serialised
 *  (compact, guaranteed-valid) JSON so emit can splice it as a JS literal. */
function resolveApiCall(
  node: SceneNode,
  eventName: EventName,
  action: Extract<ActionDef, { kind: 'apiCall' }>,
  states: Map<string, IRStateDecl>,
  inScope: ReadonlySet<string>,
  docStates: ReadonlyMap<string, IRDocStateDecl>,
  docStateReads: Set<string> | undefined,
  warnings: IRWarning[]
): IRApiCallHandler | null {
  const rawUrl = action.url.trim()
  if (rawUrl === '') {
    warnings.push({
      code: 'action-apicall-missing-url',
      message: `node ${node.id} ${eventName} apiCall has no url`,
      nodeId: node.id
    })
    return null
  }
  // Phase 2 §4: the URL is a `${}` template. A static URL is a degenerate
  // zero-expression template.
  const urlTemplate = parseTemplate(rawUrl)
  if (!urlTemplate.ok) {
    warnings.push({
      code: 'action-apicall-invalid-url',
      message: `node ${node.id} ${eventName} apiCall url "${rawUrl}" → ${urlTemplate.error}`,
      nodeId: node.id
    })
    return null
  }
  if (urlTemplate.references.has(PREV_IDENT)) {
    warnings.push({
      code: 'expression-prev-out-of-context',
      message: `node ${node.id} ${eventName} apiCall url references ${PREV_IDENT}; ${PREV_IDENT} is only valid inside setState / setVariable valueExpr`,
      nodeId: node.id
    })
    return null
  }
  const unknown = unknownIdentifiers(urlTemplate.references, states, inScope, docStates)
  if (unknown.length > 0) {
    warnings.push({
      code: 'action-apicall-unknown-identifier',
      message: `node ${node.id} ${eventName} apiCall url references unknown identifier(s): ${unknown.join(', ')}`,
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
  // Phase 2 §4: a docState referenced inside the URL template needs a
  // `useDocState` local on the page.
  registerDocStateReads(urlTemplate.references, docStates, docStateReads)
  return {
    kind: 'apiCall',
    method: action.method,
    url: urlTemplate.ast,
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

/** Phase 3 §10: lower a `condition` action. Parses the condition expression
 *  (read-context: page state / docState / in-scope identifiers, `$prev`
 *  rejected) and recursively lowers the `then` / `else` branches through the
 *  same pipeline (`resolveBranch`), so workflows nest. An empty / unparseable
 *  condition drops the whole handler with a warning. The `else` branch is
 *  omitted when the source had none or it resolves to no handlers. */
function resolveCondition(
  action: Extract<ActionDef, { kind: 'condition' }>,
  ctx: ResolveCtx
): IRConditionalHandler | null {
  const src = (action.condExpr ?? '').trim()
  if (src === '') {
    ctx.warnings.push({
      code: 'action-condition-missing-expression',
      message: `node ${ctx.node.id} ${ctx.eventName} condition has no condExpr`,
      nodeId: ctx.node.id
    })
    return null
  }
  const parsed = parseExpression(src)
  if (!parsed.ok) {
    ctx.warnings.push({
      code: 'action-condition-invalid-expression',
      message: `node ${ctx.node.id} ${ctx.eventName} condition condExpr "${src}" → ${parsed.error}`,
      nodeId: ctx.node.id
    })
    return null
  }
  const refCtx = `${ctx.eventName} action-condition condExpr`
  if (
    !checkExprRefs(
      parsed.references,
      ctx.states,
      ctx.inScope,
      ctx.docStates,
      ctx.node,
      refCtx,
      'action-condition',
      ctx.warnings
    )
  ) {
    return null
  }
  registerDocStateReads(parsed.references, ctx.docStates, ctx.docStateReads)
  const consequent = resolveBranch(action.consequent, ctx)
  const alternate = resolveBranch(action.alternate ?? [], ctx)
  return {
    kind: 'condition',
    condAst: parsed.ast,
    references: [...parsed.references],
    consequent,
    alternate: alternate.length > 0 ? alternate : undefined
  }
}

/** Phase 3 §10: lower a `delay` action. `ms` must be a finite, non-negative
 *  number; anything else drops the handler with a warning. */
function resolveDelay(
  node: SceneNode,
  eventName: EventName,
  action: Extract<ActionDef, { kind: 'delay' }>,
  warnings: IRWarning[]
): IRDelayHandler | null {
  const ms = action.ms
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) {
    warnings.push({
      code: 'action-delay-invalid-ms',
      message: `node ${node.id} ${eventName} delay ms must be a finite non-negative number (got ${JSON.stringify(ms)})`,
      nodeId: node.id
    })
    return null
  }
  return { kind: 'delay', ms }
}

/** Phase 3 §2: parse `SupabaseFilter[]` into `IRSupabaseFilter[]`. Returns
 *  `null` (and warns) on the first failing filter so the whole action drops
 *  rather than silently emitting a partial chain. Validates each value
 *  expression against state / inScope / docState — same allow-set as
 *  apiCall URL templates — and records reachable docStates as reads. */
function resolveSupabaseFilters(
  node: SceneNode,
  eventName: EventName,
  source: { filters?: { column: string; op: string; valueExpr: string }[] } | undefined,
  code: string,
  states: Map<string, IRStateDecl>,
  inScope: ReadonlySet<string>,
  docStates: ReadonlyMap<string, IRDocStateDecl>,
  docStateReads: Set<string> | undefined,
  warnings: IRWarning[]
): IRSupabaseFilter[] | null {
  const raw = source?.filters ?? []
  const out: IRSupabaseFilter[] = []
  for (let i = 0; i < raw.length; i++) {
    const f = raw[i]
    if (!f.column || f.column.trim() === '') {
      warnings.push({
        code: `${code}-filter-missing-column`,
        message: `node ${node.id} ${eventName} ${code} filter[${i}] has no column`,
        nodeId: node.id
      })
      return null
    }
    const expr = f.valueExpr.trim()
    if (expr === '') {
      warnings.push({
        code: `${code}-filter-missing-value`,
        message: `node ${node.id} ${eventName} ${code} filter[${i}] "${f.column}" has no valueExpr`,
        nodeId: node.id
      })
      return null
    }
    const parsed = parseExpression(expr)
    if (!parsed.ok) {
      warnings.push({
        code: `${code}-filter-invalid-value`,
        message: `node ${node.id} ${eventName} ${code} filter[${i}] valueExpr "${expr}" → ${parsed.error}`,
        nodeId: node.id
      })
      return null
    }
    const refCtx = `${eventName} ${code} filter[${i}]`
    if (!checkExprRefs(parsed.references, states, inScope, docStates, node, refCtx, code, warnings)) {
      return null
    }
    registerDocStateReads(parsed.references, docStates, docStateReads)
    out.push({
      column: f.column,
      op: f.op as IRSupabaseFilter['op'],
      ast: parsed.ast,
      references: [...parsed.references]
    })
  }
  return out
}

/** Phase 3 §2: shared `$prev` + unknown-identifier check. Pushes the right
 *  warning code/message on failure (callers per-context still own the gate
 *  for parse + missing-target). */
function checkExprRefs(
  references: ReadonlySet<string>,
  states: Map<string, IRStateDecl>,
  inScope: ReadonlySet<string>,
  docStates: ReadonlyMap<string, IRDocStateDecl>,
  node: SceneNode,
  ctxLabel: string,
  code: string,
  warnings: IRWarning[]
): boolean {
  if (references.has(PREV_IDENT)) {
    warnings.push({
      code: 'expression-prev-out-of-context',
      message: `node ${node.id} ${ctxLabel} references ${PREV_IDENT}; ${PREV_IDENT} is only valid inside setState / setVariable valueExpr`,
      nodeId: node.id
    })
    return false
  }
  const unknown = unknownIdentifiers(references, states, inScope, docStates)
  if (unknown.length > 0) {
    warnings.push({
      code: `${code}-unknown-identifier`,
      message: `node ${node.id} ${ctxLabel} references unknown identifier(s): ${unknown.join(', ')}`,
      nodeId: node.id
    })
    return false
  }
  return true
}

function resolveDocStateTarget(
  node: SceneNode,
  eventName: EventName,
  code: string,
  name: string | undefined,
  docStates: ReadonlyMap<string, IRDocStateDecl>,
  warnings: IRWarning[],
  required: boolean
): string | undefined | null {
  const trimmed = (name ?? '').trim()
  if (trimmed === '') {
    if (!required) return undefined
    warnings.push({
      code: `${code}-missing-target`,
      message: `node ${node.id} ${eventName} ${code} has no resultTarget`,
      nodeId: node.id
    })
    return null
  }
  if (!docStates.has(trimmed)) {
    warnings.push({
      code: `${code}-unknown-target`,
      message: `node ${node.id} ${eventName} ${code} references unknown document state "${trimmed}"`,
      nodeId: node.id
    })
    return null
  }
  return trimmed
}

/** Phase 3 §2: validate + lower a `supabaseQuery` action. Mirrors
 *  `resolveApiCall`'s shape — drops the handler on any partial failure so
 *  emit stays compilable. */
function resolveSupabaseQuery(
  node: SceneNode,
  eventName: EventName,
  action: Extract<ActionDef, { kind: 'supabaseQuery' }>,
  states: Map<string, IRStateDecl>,
  inScope: ReadonlySet<string>,
  docStates: ReadonlyMap<string, IRDocStateDecl>,
  docStateReads: Set<string> | undefined,
  warnings: IRWarning[]
): IRSupabaseQueryHandler | null {
  const table = action.table.trim()
  if (table === '') {
    warnings.push({
      code: 'action-supabase-query-missing-table',
      message: `node ${node.id} ${eventName} supabaseQuery has no table`,
      nodeId: node.id
    })
    return null
  }
  const resultTarget = resolveDocStateTarget(
    node,
    eventName,
    'action-supabase-query',
    action.resultTarget,
    docStates,
    warnings,
    true
  )
  if (resultTarget === null) return null
  const errorTarget =
    action.errorTarget === undefined
      ? undefined
      : resolveDocStateTarget(
          node,
          eventName,
          'action-supabase-query',
          action.errorTarget,
          docStates,
          warnings,
          false
        )
  if (errorTarget === null) return null
  const filters = resolveSupabaseFilters(
    node,
    eventName,
    action,
    'action-supabase-query',
    states,
    inScope,
    docStates,
    docStateReads,
    warnings
  )
  if (filters === null) return null
  return {
    kind: 'supabaseQuery',
    table,
    columns: action.columns?.trim() ? action.columns.trim() : '*',
    filters,
    single: !!action.single,
    resultTarget: resultTarget as string,
    errorTarget
  }
}

/** Phase 3 §2: validate + lower a `supabaseMutation` action.
 *  - insert / upsert: payloadJson required (row to write)
 *  - update: payloadJson required + filters required (which rows)
 *  - delete: payloadJson forbidden + filters required
 *  payloadJson is re-serialised compact (same as apiCall body) so emit
 *  splices it verbatim. resultTarget / errorTarget both optional. */
function resolveSupabaseMutation(
  node: SceneNode,
  eventName: EventName,
  action: Extract<ActionDef, { kind: 'supabaseMutation' }>,
  states: Map<string, IRStateDecl>,
  inScope: ReadonlySet<string>,
  docStates: ReadonlyMap<string, IRDocStateDecl>,
  docStateReads: Set<string> | undefined,
  warnings: IRWarning[]
): IRSupabaseMutationHandler | null {
  const table = action.table.trim()
  if (table === '') {
    warnings.push({
      code: 'action-supabase-mutation-missing-table',
      message: `node ${node.id} ${eventName} supabaseMutation has no table`,
      nodeId: node.id
    })
    return null
  }
  const hasEntries = (action.payloadEntries?.length ?? 0) > 0
  const normalizedJson = normalizeSupabaseMutationPayloadJson(action.payloadJson)
  if (hasEntries && (normalizedJson ?? '') !== '') {
    warnings.push({
      code: 'action-supabase-mutation-payload-source-conflict',
      message: `node ${node.id} ${eventName} supabaseMutation has both payloadEntries and payloadJson — payloadEntries wins, payloadJson dropped (decision §3.v2.2 #e)`,
      nodeId: node.id
    })
  }
  let payload: string | undefined
  let payloadEntries: IRSupabasePayloadEntry[] | undefined
  if (hasEntries) {
    const resolved = resolvePayloadEntries(
      node,
      eventName,
      action,
      states,
      inScope,
      docStates,
      docStateReads,
      warnings
    )
    if (resolved === null) return null
    payloadEntries = resolved
  } else {
    const literal = resolveMutationPayload(node, eventName, action, warnings)
    if (literal === null) return null
    payload = literal
  }
  if (!ensureMutationFilters(node, eventName, action, warnings)) return null
  const filters = resolveSupabaseFilters(
    node,
    eventName,
    action,
    'action-supabase-mutation',
    states,
    inScope,
    docStates,
    docStateReads,
    warnings
  )
  if (filters === null) return null
  const resultTarget = resolveOptionalTarget(
    node,
    eventName,
    'action-supabase-mutation',
    action.resultTarget,
    docStates,
    warnings
  )
  if (resultTarget === null) return null
  const errorTarget = resolveOptionalTarget(
    node,
    eventName,
    'action-supabase-mutation',
    action.errorTarget,
    docStates,
    warnings
  )
  if (errorTarget === null) return null
  return {
    kind: 'supabaseMutation',
    operation: action.operation,
    table,
    payload,
    payloadEntries,
    filters,
    resultTarget,
    errorTarget
  }
}

/** Phase 3 §2.v2: validate + lower a `supabaseAuth` action. §2.v3 adds signUp;
 *  §2.v4 adds resetPassword + updatePassword. Per-operation credential gating
 *  (decision §2.v4.2 b): signIn / signUp need email + password; resetPassword
 *  needs email only; updatePassword needs password only; signOut needs neither.
 *  Each required expr (same sub-language as filter values, so it can read a
 *  controlled INPUT's docState) is parsed; an empty / unparseable required
 *  expr drops the handler with a warning. No resultTarget — `$currentUser`
 *  stays synced via the runtime's `onAuthStateChange` (decision §2.v2.2 e).
 *  `errorTarget` is the only optional docState write. */
function resolveSupabaseAuth(
  node: SceneNode,
  eventName: EventName,
  action: Extract<ActionDef, { kind: 'supabaseAuth' }>,
  states: Map<string, IRStateDecl>,
  inScope: ReadonlySet<string>,
  docStates: ReadonlyMap<string, IRDocStateDecl>,
  docStateReads: Set<string> | undefined,
  warnings: IRWarning[]
): IRSupabaseAuthHandler | null {
  const errorTarget = resolveOptionalTarget(
    node,
    eventName,
    'action-supabase-auth',
    action.errorTarget,
    docStates,
    warnings
  )
  if (errorTarget === null) return null
  if (action.operation === 'signOut') {
    return { kind: 'supabaseAuth', operation: 'signOut', references: [], errorTarget }
  }
  // Per-op credential gating (§2.v4 decision b): signIn/signUp need both,
  // resetPassword needs email only, updatePassword needs password only.
  const op = action.operation
  const needsEmail = op === 'signIn' || op === 'signUp' || op === 'resetPassword'
  const needsPassword = op === 'signIn' || op === 'signUp' || op === 'updatePassword'
  const references: string[] = []
  let emailAst: ExprAst | undefined
  let passwordAst: ExprAst | undefined
  if (needsEmail) {
    const email = resolveAuthCredential(
      node, eventName, op, 'email', action.emailExpr, states, inScope, docStates, docStateReads, warnings
    )
    if (email === null) return null
    emailAst = email.ast
    references.push(...email.references)
  }
  if (needsPassword) {
    const password = resolveAuthCredential(
      node, eventName, op, 'password', action.passwordExpr, states, inScope, docStates, docStateReads, warnings
    )
    if (password === null) return null
    passwordAst = password.ast
    references.push(...password.references)
  }
  return { kind: 'supabaseAuth', operation: op, emailAst, passwordAst, references, errorTarget }
}

/** Parse one signIn / signUp credential expression. Empty →
 *  missing-credentials warn; bad parse / unknown reference → drop the handler. */
function resolveAuthCredential(
  node: SceneNode,
  eventName: EventName,
  operation: 'signIn' | 'signUp' | 'resetPassword' | 'updatePassword',
  which: 'email' | 'password',
  exprSrc: string | undefined,
  states: Map<string, IRStateDecl>,
  inScope: ReadonlySet<string>,
  docStates: ReadonlyMap<string, IRDocStateDecl>,
  docStateReads: Set<string> | undefined,
  warnings: IRWarning[]
): { ast: ExprAst; references: string[] } | null {
  const src = (exprSrc ?? '').trim()
  if (src === '') {
    warnings.push({
      code: 'action-supabase-auth-missing-credentials',
      message: `node ${node.id} ${eventName} supabaseAuth ${operation} has no ${which} expression`,
      nodeId: node.id
    })
    return null
  }
  const parsed = parseExpression(src)
  if (!parsed.ok) {
    warnings.push({
      code: 'action-supabase-auth-invalid-credential',
      message: `node ${node.id} ${eventName} supabaseAuth ${operation} ${which} "${src}" → ${parsed.error}`,
      nodeId: node.id
    })
    return null
  }
  const refCtx = `${eventName} action-supabase-auth ${which}`
  if (
    !checkExprRefs(
      parsed.references,
      states,
      inScope,
      docStates,
      node,
      refCtx,
      'action-supabase-auth',
      warnings
    )
  ) {
    return null
  }
  registerDocStateReads(parsed.references, docStates, docStateReads)
  return { ast: parsed.ast, references: [...parsed.references] }
}

/** Phase 3 §3.v2: parse + validate `SupabaseMutationAction.payloadEntries`.
 *  Per-entry: `key` must be a JS identifier (column-safe); `valueExpr`
 *  must parse + reference only in-scope identifiers (same rules as
 *  filter values). Duplicate keys drop the whole handler. `delete` +
 *  non-empty entries reuses the existing
 *  `action-supabase-mutation-unexpected-payload` code so editor / AI
 *  tooling can surface both payload channels with one filter. */
function resolvePayloadEntries(
  node: SceneNode,
  eventName: EventName,
  action: Extract<ActionDef, { kind: 'supabaseMutation' }>,
  states: Map<string, IRStateDecl>,
  inScope: ReadonlySet<string>,
  docStates: ReadonlyMap<string, IRDocStateDecl>,
  docStateReads: Set<string> | undefined,
  warnings: IRWarning[]
): IRSupabasePayloadEntry[] | null {
  const raw = action.payloadEntries ?? []
  if (action.operation === 'delete' && raw.length > 0) {
    warnings.push({
      code: 'action-supabase-mutation-unexpected-payload',
      message: `node ${node.id} ${eventName} supabaseMutation operation "delete" must not have payloadEntries`,
      nodeId: node.id
    })
    return null
  }
  const out: IRSupabasePayloadEntry[] = []
  const seenKeys = new Set<string>()
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i]
    const key = entry.key.trim()
    if (key === '') {
      warnings.push({
        code: 'action-supabase-mutation-entry-missing-key',
        message: `node ${node.id} ${eventName} supabaseMutation payloadEntries[${i}] has no key`,
        nodeId: node.id
      })
      return null
    }
    if (!PAYLOAD_ENTRY_KEY_RE.test(key)) {
      warnings.push({
        code: 'action-supabase-mutation-entry-invalid-key',
        message: `node ${node.id} ${eventName} supabaseMutation payloadEntries[${i}] key "${key}" must be a JS identifier (column name)`,
        nodeId: node.id
      })
      return null
    }
    if (seenKeys.has(key)) {
      warnings.push({
        code: 'action-supabase-mutation-entry-duplicate-key',
        message: `node ${node.id} ${eventName} supabaseMutation payloadEntries[${i}] duplicates key "${key}"`,
        nodeId: node.id
      })
      return null
    }
    seenKeys.add(key)
    const exprSrc = entry.valueExpr.trim()
    if (exprSrc === '') {
      warnings.push({
        code: 'action-supabase-mutation-entry-missing-value',
        message: `node ${node.id} ${eventName} supabaseMutation payloadEntries[${i}] "${key}" has no valueExpr`,
        nodeId: node.id
      })
      return null
    }
    const parsed = parseExpression(exprSrc)
    if (!parsed.ok) {
      warnings.push({
        code: 'action-supabase-mutation-entry-invalid-value',
        message: `node ${node.id} ${eventName} supabaseMutation payloadEntries[${i}] "${key}" valueExpr "${exprSrc}" → ${parsed.error}`,
        nodeId: node.id
      })
      return null
    }
    const refCtx = `${eventName} action-supabase-mutation payloadEntries[${i}]`
    if (
      !checkExprRefs(
        parsed.references,
        states,
        inScope,
        docStates,
        node,
        refCtx,
        'action-supabase-mutation',
        warnings
      )
    ) {
      return null
    }
    registerDocStateReads(parsed.references, docStates, docStateReads)
    out.push({ key, ast: parsed.ast, references: [...parsed.references] })
  }
  return out
}

/** Per-operation payload rules:
 *   insert / update / upsert require a non-empty JSON literal,
 *   delete forbids one. Returns the compact JSON on success, `undefined`
 *   when no payload is expected, or `null` to abort the whole handler.
 *   Mirrors `resolveApiCall`'s POST-body re-serialisation. */
function resolveMutationPayload(
  node: SceneNode,
  eventName: EventName,
  action: Extract<ActionDef, { kind: 'supabaseMutation' }>,
  warnings: IRWarning[]
): string | undefined | null {
  const raw = (normalizeSupabaseMutationPayloadJson(action.payloadJson) ?? '').trim()
  if (action.operation === 'delete') {
    if (raw !== '') {
      warnings.push({
        code: 'action-supabase-mutation-unexpected-payload',
        message: `node ${node.id} ${eventName} supabaseMutation operation "delete" must not have payloadJson`,
        nodeId: node.id
      })
      return null
    }
    return undefined
  }
  if (raw === '') {
    warnings.push({
      code: 'action-supabase-mutation-missing-payload',
      message: `node ${node.id} ${eventName} supabaseMutation operation "${action.operation}" requires payloadJson`,
      nodeId: node.id
    })
    return null
  }
  try {
    return JSON.stringify(JSON.parse(raw))
  } catch (err) {
    warnings.push({
      code: 'action-supabase-mutation-invalid-payload',
      message: `node ${node.id} ${eventName} supabaseMutation payloadJson is not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
      nodeId: node.id
    })
    return null
  }
}

/** update / delete must carry at least one filter (where clause); otherwise
 *  the mutation would touch every row in the table. Returns `false` and
 *  warns to drop the handler when violated. */
function ensureMutationFilters(
  node: SceneNode,
  eventName: EventName,
  action: Extract<ActionDef, { kind: 'supabaseMutation' }>,
  warnings: IRWarning[]
): boolean {
  if (action.operation !== 'update' && action.operation !== 'delete') return true
  if (action.filters !== undefined && action.filters.length > 0) return true
  warnings.push({
    code: 'action-supabase-mutation-missing-filters',
    message: `node ${node.id} ${eventName} supabaseMutation operation "${action.operation}" requires filters (where clause)`,
    nodeId: node.id
  })
  return false
}

/** Wrap `resolveDocStateTarget` for optional fields so callers can chain
 *  uniform `=== null` aborts. */
function resolveOptionalTarget(
  node: SceneNode,
  eventName: EventName,
  code: string,
  name: string | undefined,
  docStates: ReadonlyMap<string, IRDocStateDecl>,
  warnings: IRWarning[]
): string | undefined | null {
  if (name === undefined) return undefined
  return resolveDocStateTarget(node, eventName, code, name, docStates, warnings, false)
}

