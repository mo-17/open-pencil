import { PAYLOAD_ENTRY_KEY_RE, validateExpression, validateURLTemplate } from '@open-pencil/lowcode'
import type {
  ActionDef,
  SupabaseFilter,
  SupabasePayloadEntry,
  WorkflowDef
} from '@open-pencil/scene-graph'

import type { MotionActionTargetOption } from '../motion-action-options'

/**
 * Phase 3 §10 v10 — pure per-action validation for the recursive workflow
 * editor. Mirrors the `resolveActions` branch in `collect/bindings.ts` so the
 * GUI reds exactly what IR collect would reject. Extracted from EventsPanel so
 * `ActionRow` can validate one action at any nesting depth. Control-flow kinds
 * (`condition` / `confirm`) carry no leaf errors here — their nested branches
 * are validated by their own `ActionRow`s.
 */

interface PayloadEntryError {
  keyError?: string
  valueError?: string
}

export interface ActionErrors {
  target?: string
  expr?: string
  to?: string
  url?: string
  body?: string
  endpoint?: string
  table?: string
  payload?: string
  filters?: Map<number, string>
  entries?: Map<number, PayloadEntryError>
  properties?: Map<number, PayloadEntryError>
  payloadSourceConflict?: boolean
  email?: string
  password?: string
  message?: string
  ms?: string
  condExpr?: string
  /** §10 v11 — the callWorkflow dropdown (missing / unknown workflow). */
  workflow?: string
  /** Local success-branch binding created by invokeServerWorkflow. */
  resultName?: string
  /** Motion track dropdown (specified track no longer exists). */
  track?: string
  /** §10 v11 — per-parameter argument errors (required-missing / invalid expr),
   *  keyed by the referenced workflow's formal parameter name. */
  argErrors?: Map<string, string>
}

/** The valid-name sets the validators check targets against. */
export interface ActionValidationCtx {
  validStateIds: ReadonlySet<string>
  validDocStateNames: ReadonlySet<string>
  /** §10 v11 — document-level named workflows (`root.lowcodeWorkflows`), so a
   *  `callWorkflow` row can validate its workflowId + required arguments. */
  workflows: readonly WorkflowDef[]
  /** Every current graph node id, including nodes without valid motion. */
  validNodeIds: ReadonlySet<string>
  /** Nodes whose MotionSpec currently passes strict validation. */
  motionTargets: readonly MotionActionTargetOption[]
  /** Existing animated nodes that cannot be addressed stably after .fig export. */
  unsupportedMotionTargetIds?: ReadonlySet<string>
  /** Existing animated nodes that are not rendered on the current page. */
  outOfScopeMotionTargetIds?: ReadonlySet<string>
}

type SupabaseAuthOp = Extract<ActionDef, { kind: 'supabaseAuth' }>['operation']

// Per-operation credential gating (§2.v4 decision b): mirrors IR collect's
// resolveSupabaseAuth so the form shows / validates exactly the needed fields.
export function authNeedsEmail(op: SupabaseAuthOp): boolean {
  return op === 'signIn' || op === 'signUp' || op === 'resetPassword'
}
export function authNeedsPassword(op: SupabaseAuthOp): boolean {
  return op === 'signIn' || op === 'signUp' || op === 'updatePassword'
}

function setStateErrors(
  action: Extract<ActionDef, { kind: 'setState' }>,
  ctx: ActionValidationCtx
): ActionErrors {
  const e: ActionErrors = {}
  if (!action.targetStateId) e.target = 'target required'
  else if (!ctx.validStateIds.has(action.targetStateId)) e.target = 'state no longer exists'
  const result = validateExpression(action.valueExpr ?? '')
  if (!result.ok) e.expr = result.reason
  return e
}

function setVariableErrors(
  action: Extract<ActionDef, { kind: 'setVariable' }>,
  ctx: ActionValidationCtx
): ActionErrors {
  const e: ActionErrors = {}
  if (!action.targetName || action.targetName.trim() === '') e.target = 'target required'
  else if (!ctx.validDocStateNames.has(action.targetName))
    e.target = 'document state no longer exists'
  const result = validateExpression(action.valueExpr ?? '')
  if (!result.ok) e.expr = result.reason
  return e
}

function apiCallErrors(
  action: Extract<ActionDef, { kind: 'apiCall' }>,
  ctx: ActionValidationCtx
): ActionErrors {
  const e: ActionErrors = {}
  const urlResult = validateURLTemplate(action.url)
  if (!urlResult.ok) e.url = urlResult.reason
  if (action.targetName.trim() === '') e.target = 'target required'
  else if (!ctx.validDocStateNames.has(action.targetName))
    e.target = 'document state no longer exists'
  // §10 v9 — optional errorTarget must resolve when set.
  if (action.errorTarget && !ctx.validDocStateNames.has(action.errorTarget))
    e.target = 'error target no longer exists'
  if (action.method === 'POST') {
    const raw = (action.bodyJson ?? '').trim()
    if (raw !== '') {
      try {
        JSON.parse(raw)
      } catch (err) {
        e.body = err instanceof Error ? err.message : String(err)
      }
    }
  }
  return e
}

function filterErrors(filters: SupabaseFilter[] | undefined): Map<number, string> | undefined {
  if (!filters || filters.length === 0) return undefined
  const out = new Map<number, string>()
  filters.forEach((f, i) => {
    const result = validateExpression(f.valueExpr)
    if (!result.ok) out.set(i, result.reason ?? 'invalid expression')
  })
  return out.size > 0 ? out : undefined
}

function supabaseQueryErrors(
  action: Extract<ActionDef, { kind: 'supabaseQuery' }>,
  ctx: ActionValidationCtx
): ActionErrors {
  const e: ActionErrors = {}
  if (action.table.trim() === '') e.table = 'table required'
  if (action.resultTarget.trim() === '') e.target = 'target required'
  else if (!ctx.validDocStateNames.has(action.resultTarget))
    e.target = 'document state no longer exists'
  if (action.errorTarget && !ctx.validDocStateNames.has(action.errorTarget))
    e.target = 'error target no longer exists'
  const fe = filterErrors(action.filters)
  if (fe) e.filters = fe
  return e
}

function payloadEntryErrors(
  entries: SupabasePayloadEntry[] | undefined
): Map<number, PayloadEntryError> | undefined {
  if (!entries || entries.length === 0) return undefined
  const out = new Map<number, PayloadEntryError>()
  const seen = new Map<string, number>()
  entries.forEach((entry, i) => {
    const slot: PayloadEntryError = {}
    if (entry.key === '') slot.keyError = 'column required'
    else if (!PAYLOAD_ENTRY_KEY_RE.test(entry.key)) slot.keyError = 'invalid identifier'
    else if (seen.has(entry.key)) slot.keyError = `duplicates "${entry.key}"`
    else seen.set(entry.key, i)
    const v = validateExpression(entry.valueExpr)
    if (!v.ok) slot.valueError = v.reason ?? 'invalid expression'
    if (slot.keyError || slot.valueError) out.set(i, slot)
  })
  return out.size > 0 ? out : undefined
}

function supabaseMutationErrors(
  action: Extract<ActionDef, { kind: 'supabaseMutation' }>
): ActionErrors {
  const e: ActionErrors = {}
  if (action.table.trim() === '') e.table = 'table required'
  const raw = (action.payloadJson ?? '').trim()
  if (raw !== '') {
    try {
      JSON.parse(raw)
    } catch (err) {
      e.payload = err instanceof Error ? err.message : String(err)
    }
  }
  const fe = filterErrors(action.filters)
  if (fe) e.filters = fe
  const ee = payloadEntryErrors(action.payloadEntries)
  if (ee) e.entries = ee
  if (raw !== '' && (action.payloadEntries?.length ?? 0) > 0) e.payloadSourceConflict = true
  return e
}

function stripeRedirectErrors(
  action: Extract<ActionDef, { kind: 'stripeCheckout' | 'stripeCustomerPortal' }>,
  ctx: ActionValidationCtx
): ActionErrors {
  const e: ActionErrors = {}
  const endpoint = validateURLTemplate(action.endpoint ?? '')
  if (!endpoint.ok) e.endpoint = endpoint.reason
  if (action.errorTarget && !ctx.validDocStateNames.has(action.errorTarget)) {
    e.target = 'error target no longer exists'
  }
  const entries = payloadEntryErrors(action.payloadEntries)
  if (entries) e.entries = entries
  return e
}

function supabaseAuthErrors(
  action: Extract<ActionDef, { kind: 'supabaseAuth' }>,
  ctx: ActionValidationCtx
): ActionErrors {
  const e: ActionErrors = {}
  if (action.errorTarget && !ctx.validDocStateNames.has(action.errorTarget))
    e.target = 'error target no longer exists'
  if (authNeedsEmail(action.operation)) {
    const email = validateExpression(action.emailExpr ?? '')
    if (!email.ok) e.email = email.reason ?? 'invalid expression'
  }
  if (authNeedsPassword(action.operation)) {
    const password = validateExpression(action.passwordExpr ?? '')
    if (!password.ok) e.password = password.reason ?? 'invalid expression'
  }
  return e
}

function flatWorkflowErrors(
  action: Extract<ActionDef, { kind: 'toast' | 'clipboard' | 'trackEvent' | 'delay' }>
): ActionErrors {
  if (action.kind === 'toast') {
    const r = validateExpression(action.messageExpr ?? '')
    return r.ok ? {} : { message: r.reason ?? 'invalid expression' }
  }
  if (action.kind === 'clipboard') {
    const r = validateExpression(action.valueExpr ?? '')
    return r.ok ? {} : { expr: r.reason ?? 'invalid expression' }
  }
  if (action.kind === 'trackEvent') {
    const r = validateExpression(action.eventNameExpr ?? '')
    const e: ActionErrors = r.ok ? {} : { expr: r.reason ?? 'invalid expression' }
    const properties = payloadEntryErrors(
      Object.entries(action.properties ?? {}).map(([key, valueExpr]) => ({
        key,
        valueExpr
      }))
    )
    if (properties) e.properties = properties
    return e
  }
  const ms = action.ms
  return ms === undefined || (Number.isFinite(ms) && ms >= 0) ? {} : { ms: 'must be ≥ 0' }
}

/** §10 v10 — `condition` / `confirm` leaf errors: only the optional expression
 *  (condExpr / messageExpr). Nested branches validate via their own rows. */
function controlFlowErrors(
  action: Extract<ActionDef, { kind: 'condition' | 'confirm' }>
): ActionErrors {
  if (action.kind === 'condition') {
    if (action.condExpr === undefined || action.condExpr.trim() === '') return {}
    const r = validateExpression(action.condExpr)
    return r.ok ? {} : { condExpr: r.reason ?? 'invalid expression' }
  }
  const r = validateExpression(action.messageExpr ?? '')
  return r.ok ? {} : { message: r.reason ?? 'invalid expression' }
}

/** §10 v11 — `callWorkflow` leaf errors: the referenced workflow must exist and
 *  every required parameter (one without a `paramDefaults` entry and not in
 *  `optionalParams`) needs a non-empty, parseable argument expression. Mirrors
 *  IR collect's missing-id / unknown / missing-arg / invalid-arg drops; the
 *  cycle check is a collect-time whole-graph walk and stays out of the GUI. */
function callWorkflowErrors(
  action: Extract<ActionDef, { kind: 'callWorkflow' }>,
  ctx: ActionValidationCtx
): ActionErrors {
  if (!action.workflowId) return { workflow: 'workflow required' }
  const wf = ctx.workflows.find((w) => w.id === action.workflowId)
  if (!wf) return { workflow: 'workflow no longer exists' }
  const params = wf.params ?? []
  const defaults = wf.paramDefaults ?? {}
  const optional = new Set(wf.optionalParams)
  const args = action.args ?? {}
  const argErrors = new Map<string, string>()
  for (const p of params) {
    const raw = Object.hasOwn(args, p) ? args[p] : ''
    if (raw.trim() !== '') {
      const r = validateExpression(raw)
      if (!r.ok) argErrors.set(p, r.reason ?? 'invalid expression')
    } else if (!Object.hasOwn(defaults, p) && !optional.has(p)) {
      argErrors.set(p, 'argument required')
    }
  }
  return argErrors.size > 0 ? { argErrors } : {}
}

const ACTION_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

function invokeServerWorkflowErrors(
  action: Extract<ActionDef, { kind: 'invokeServerWorkflow' }>
): ActionErrors {
  const errors: ActionErrors = {}
  if (action.workflowId.trim() === '') errors.workflow = 'server workflow required'
  if (action.resultName && !ACTION_IDENTIFIER_RE.test(action.resultName)) {
    errors.resultName = 'must be a valid identifier'
  }
  const argErrors = new Map<string, string>()
  for (const [name, expression] of Object.entries(action.args ?? {})) {
    if (!ACTION_IDENTIFIER_RE.test(name)) {
      argErrors.set(name, 'argument name must be a valid identifier')
      continue
    }
    const result = validateExpression(expression)
    if (!result.ok) argErrors.set(name, result.reason ?? 'invalid expression')
  }
  if (argErrors.size > 0) errors.argErrors = argErrors
  return errors
}

function motionActionErrors(
  action: Extract<
    ActionDef,
    { kind: 'playMotion' | 'stopMotion' | 'toggleMotion' | 'awaitMotion' }
  >,
  ctx: ActionValidationCtx
): ActionErrors {
  if (!action.targetNodeId || action.targetNodeId.trim() === '') {
    return { target: 'motion target required' }
  }
  if (!ctx.validNodeIds.has(action.targetNodeId)) {
    return { target: 'target node no longer exists' }
  }
  if (ctx.unsupportedMotionTargetIds?.has(action.targetNodeId)) {
    return { target: 'instance child motion targets cannot be saved to .fig' }
  }
  if (ctx.outOfScopeMotionTargetIds?.has(action.targetNodeId)) {
    return { target: 'motion target is not available on the current page' }
  }
  const target = ctx.motionTargets.find((candidate) => candidate.id === action.targetNodeId)
  if (!target) return { target: 'target node has no valid motion' }
  if (action.trackId && !target.tracks.some((track) => track.id === action.trackId)) {
    return { track: 'motion track no longer exists' }
  }
  if (
    action.kind === 'awaitMotion' &&
    action.timeoutMs !== undefined &&
    (!Number.isFinite(action.timeoutMs) || action.timeoutMs < 0 || action.timeoutMs > 120_000)
  ) {
    return { ms: 'timeout must be between 0 and 120000 ms' }
  }
  return {}
}

function referenceActionErrors(action: ActionDef, ctx: ActionValidationCtx): ActionErrors {
  if (action.kind === 'callWorkflow') return callWorkflowErrors(action, ctx)
  if (action.kind === 'invokeServerWorkflow') return invokeServerWorkflowErrors(action)
  if (
    action.kind === 'playMotion' ||
    action.kind === 'stopMotion' ||
    action.kind === 'toggleMotion' ||
    action.kind === 'awaitMotion'
  ) {
    return motionActionErrors(action, ctx)
  }
  return {}
}

/** Compute the validation errors for one action (leaf-level only — branch
 *  children validate via their own rows). Mirrors `errorsFor` in IR collect. */
export function computeActionErrors(action: ActionDef, ctx: ActionValidationCtx): ActionErrors {
  if (action.kind === 'setState') return setStateErrors(action, ctx)
  if (action.kind === 'navigate') {
    return !action.to || action.to.trim() === '' ? { to: 'path required' } : {}
  }
  if (action.kind === 'setVariable') return setVariableErrors(action, ctx)
  if (action.kind === 'apiCall') return apiCallErrors(action, ctx)
  if (action.kind === 'supabaseQuery') return supabaseQueryErrors(action, ctx)
  if (action.kind === 'supabaseMutation') return supabaseMutationErrors(action)
  if (action.kind === 'supabaseAuth') return supabaseAuthErrors(action, ctx)
  if (action.kind === 'stripeCheckout' || action.kind === 'stripeCustomerPortal') {
    return stripeRedirectErrors(action, ctx)
  }
  if (
    action.kind === 'toast' ||
    action.kind === 'clipboard' ||
    action.kind === 'trackEvent' ||
    action.kind === 'delay'
  ) {
    return flatWorkflowErrors(action)
  }
  if (action.kind === 'condition' || action.kind === 'confirm') return controlFlowErrors(action)
  return referenceActionErrors(action, ctx)
}
