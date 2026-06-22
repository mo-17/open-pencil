/**
 * Phase 3 §3 step 3 — lowcode modify tools.
 *
 * Three tools mirror the read counterparts in `tools/read/lowcode.ts`:
 *
 *   - update_lowcode_node(id, patch_json) — mega patch on a single node.
 *     Patch fields not present in the JSON are left unchanged (decision
 *     §3.2 #c); a field explicitly set to `null` clears the SceneNode
 *     property. Atomic — one figma.graph.updateNode call = one undo entry
 *     (decision §3.2 #6).
 *   - set_doc_states(states_json) — replace the root's
 *     lowcodeDocumentState array wholesale (decision §3.2 #b: no
 *     per-entry diff in MVP). Names starting with `$` are rejected at
 *     this entry point (decision §3.2 #h) so AI can never inject a
 *     reserved-prefix state.
 *   - set_supabase_config(config_json) — replace root.lowcodeSupabaseConfig.
 *     `null` JSON value clears the config (decision §3.2 #d).
 *     `validateSupabaseConfig` (shared with `SupabaseConfigPanel.vue`)
 *     hard-rejects a service_role JWT before it can persist (decision
 *     §3.2 #h + §2.7 risk row 1).
 *
 * Validation paths reuse `@open-pencil/core/lowcode-validation`
 * (validateStateName / validateExpression / validateUrlTemplate /
 * validateSupabaseConfig) so editor + tool can never drift. Per-binding
 * and per-action shape checks live inline here for now — extraction
 * into shared `binding.ts` / `action.ts` modules waits until v2, when
 * a second consumer materializes.
 */
import type { FigmaAPI } from '#core/figma-api'
import {
  normalizeSupabaseMutationPayloadJson,
  validateDatePickerProps,
  validateExpression,
  validateStateName,
  validateSupabaseConfig,
  validateSupabasePayloadEntries,
  validateUrlTemplate
} from '#core/lowcode-validation'
import type {
  ActionDef,
  ActionKind,
  BindingExpr,
  EventName,
  LowcodeTranslations,
  SceneNode,
  StateDef,
  StateOverrides,
  StateValueType,
  SupabaseConfig,
  SupabaseFilter,
  SupabasePayloadEntry,
  ToastAction,
  WorkflowDef
} from '#core/scene-graph'

type BindingKind = BindingExpr['kind']
// `SupabaseFilter.op` is an inline literal union on the interface; mirror
// it as a Set here for runtime validation. Keep this in sync with
// `SupabaseFilter.op` in `scene-graph/types.ts` (Phase 3 §2).
type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'in'
import { defineTool, type ToolCtx } from '#core/tools/schema'

type ModifyResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string }

const KNOWN_ACTION_KINDS = new Set<ActionKind>([
  'setState',
  'navigate',
  'setVariable',
  'apiCall',
  'supabaseQuery',
  'supabaseMutation',
  'supabaseAuth',
  // Phase 3 §10 workflow orchestration kinds
  'condition',
  'delay',
  'stop',
  // Phase 3 §10 v2 toast/notify
  'toast',
  // Phase 3 §10 v3 confirm dialog + clipboard
  'confirm',
  'clipboard',
  // Phase 3 §10 v4 named workflow invocation
  'callWorkflow'
])

const KNOWN_BINDING_KINDS = new Set<BindingKind>(['literal', 'ref', 'expr', 'docState'])

const KNOWN_STATE_TYPES = new Set<StateValueType>([
  'string',
  'number',
  'boolean',
  'array',
  'object'
])

const KNOWN_EVENT_NAMES = new Set<EventName>([
  'onClick',
  'onChange',
  'onSubmit',
  'onFocus',
  'onBlur'
])

const KNOWN_INTERACTION_STATES = new Set(['hover', 'focus', 'active', 'disabled'])

const KNOWN_STATE_OVERRIDE_KEYS = new Set([
  'fills',
  'strokes',
  'cornerRadius',
  'opacity',
  'effects'
])

const KNOWN_FILTER_OPS = new Set<FilterOp>(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'in'])

const KNOWN_MUTATION_OPS = new Set<string>(['insert', 'upsert', 'update', 'delete'])

// Patch fields the tool understands. Anything else in the patch is a
// reject — we don't silently drop unknown keys, otherwise AI typos turn
// into silent no-ops that look like "the change didn't apply" bugs.
const PATCH_KEYS = new Set([
  'state',
  'bindings',
  'events',
  'interactiveProps',
  'stateOverrides',
  'renderCondition',
  'lowcodeDocumentState',
  'lowcodeSupabaseConfig'
])

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseJson(
  src: string,
  what: string
): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(src) }
  } catch (err) {
    return {
      ok: false,
      error: `${what} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    }
  }
}

function validateBindingExpr(
  channel: string,
  value: unknown
): { ok: true; binding: BindingExpr } | { ok: false; error: string } {
  if (!isPlainObject(value)) {
    return { ok: false, error: `bindings.${channel} must be an object` }
  }
  const kind = value.kind
  if (typeof kind !== 'string' || !KNOWN_BINDING_KINDS.has(kind as BindingKind)) {
    return {
      ok: false,
      error: `bindings.${channel}.kind must be one of literal / ref / expr / docState (got ${JSON.stringify(kind)})`
    }
  }
  const kindNarrowed = kind as BindingKind
  if (kindNarrowed === 'ref') {
    if (typeof value.stateId !== 'string' || value.stateId === '') {
      return { ok: false, error: `bindings.${channel}.stateId must be a non-empty string` }
    }
    return { ok: true, binding: { kind: 'ref', stateId: value.stateId } }
  }
  if (kindNarrowed === 'docState') {
    if (typeof value.docStateName !== 'string' || value.docStateName === '') {
      return { ok: false, error: `bindings.${channel}.docStateName must be a non-empty string` }
    }
    return { ok: true, binding: { kind: 'docState', docStateName: value.docStateName } }
  }
  if (kindNarrowed === 'expr') {
    if (typeof value.expr !== 'string') {
      return { ok: false, error: `bindings.${channel}.expr must be a string` }
    }
    const r = validateExpression(value.expr)
    if (!r.ok) return { ok: false, error: `bindings.${channel}.expr — ${r.reason}` }
    return { ok: true, binding: { kind: 'expr', expr: value.expr } }
  }
  // `literal` — literalValue is pass-through (any JSON value is valid).
  return { ok: true, binding: { kind: 'literal', literalValue: value.literalValue } }
}

function failAt(where: string, msg: string): { ok: false; error: string } {
  return { ok: false, error: `${where} ${msg}` }
}

function validateValueExpr(
  where: string,
  raw: Record<string, unknown>
): { ok: true } | { ok: false; error: string } {
  const valueExpr = raw.valueExpr
  if (typeof valueExpr !== 'string') return failAt(where, '.valueExpr must be a string')
  const r = validateExpression(valueExpr)
  if (!r.ok) return failAt(where, `.valueExpr — ${r.reason}`)
  return { ok: true }
}

function validateApiCallUrl(
  where: string,
  raw: Record<string, unknown>
): { ok: true } | { ok: false; error: string } {
  const url = raw.url
  if (typeof url !== 'string') return failAt(where, '.url must be a string')
  const r = validateUrlTemplate(url)
  if (!r.ok) return failAt(where, `.url — ${r.reason}`)
  return { ok: true }
}

function validateSupabaseFilters(
  where: string,
  filters: unknown
): { ok: true } | { ok: false; error: string } {
  if (filters === undefined) return { ok: true }
  if (!Array.isArray(filters)) return failAt(where, '.filters must be an array')
  for (let i = 0; i < filters.length; i++) {
    const f = filters[i]
    if (!isPlainObject(f) || typeof f.column !== 'string' || typeof f.op !== 'string') {
      return failAt(where, `.filters[${i}] must have string column + op`)
    }
    if (!KNOWN_FILTER_OPS.has(f.op as FilterOp)) {
      return failAt(where, `.filters[${i}].op invalid (got ${JSON.stringify(f.op)})`)
    }
  }
  return { ok: true }
}

function validateSupabaseAction(
  where: string,
  kind: 'supabaseQuery' | 'supabaseMutation',
  raw: Record<string, unknown>
): { ok: true } | { ok: false; error: string } {
  if (typeof raw.table !== 'string' || raw.table === '') {
    return failAt(where, '.table must be a non-empty string')
  }
  const f = validateSupabaseFilters(where, raw.filters)
  if (!f.ok) return f
  if (kind === 'supabaseMutation') {
    if (typeof raw.operation !== 'string' || !KNOWN_MUTATION_OPS.has(raw.operation)) {
      return failAt(
        where,
        `.operation must be one of insert / upsert / update / delete (got ${JSON.stringify(raw.operation)})`
      )
    }
    const e = validateSupabasePayloadEntries(where, raw.payloadEntries)
    if (!e.ok) return e
  }
  return { ok: true }
}

const SUPABASE_AUTH_OPS = new Set([
  'signIn',
  'signOut',
  'signUp',
  'resetPassword',
  'updatePassword'
])

/** Phase 3 §2.v2: a `supabaseAuth` action. `operation` must be signIn /
 *  signOut. §2.v3 adds signUp; §2.v4 adds resetPassword / updatePassword.
 *  Whichever of `emailExpr` / `passwordExpr` is present must be a parseable
 *  expression (bad → reject, decision §2.v2.2 g); a missing credential is left
 *  for IR collect to warn on per-operation, not rejected here, so the tool
 *  boundary mirrors the §3.v2 "malformed = reject, missing = warn" split. */
function validateSupabaseAuthAction(
  where: string,
  raw: Record<string, unknown>
): { ok: true } | { ok: false; error: string } {
  if (typeof raw.operation !== 'string' || !SUPABASE_AUTH_OPS.has(raw.operation)) {
    return failAt(
      where,
      `.operation must be one of ${[...SUPABASE_AUTH_OPS].join(' / ')} (got ${JSON.stringify(raw.operation)})`
    )
  }
  if (raw.operation === 'signOut') return { ok: true }
  for (const field of ['emailExpr', 'passwordExpr'] as const) {
    const expr = raw[field]
    if (expr === undefined) continue
    if (typeof expr !== 'string') return failAt(where, `.${field} must be a string`)
    if (expr.trim() === '') continue
    const r = validateExpression(expr)
    if (!r.ok) return failAt(where, `.${field} — ${r.reason}`)
  }
  return { ok: true }
}

function validateActionShape(
  eventName: string,
  index: number,
  value: unknown
): { ok: true; action: ActionDef } | { ok: false; error: string } {
  return validateActionAt(`events.${eventName}[${index}]`, value)
}

/** Validate + build one ActionDef at a JSON path. Phase 3 §10: `condition`
 *  recurses into its `then` / `else` branches via this same entry point, so
 *  nested workflows are validated to arbitrary depth and the path reported on
 *  error (`events.onClick[0].then[1]`) pinpoints the offending step. */
function validateActionAt(
  where: string,
  value: unknown
): { ok: true; action: ActionDef } | { ok: false; error: string } {
  if (!isPlainObject(value)) return failAt(where, 'must be an object')
  if (typeof value.id !== 'string' || value.id === '') {
    return failAt(where, '.id must be a non-empty string')
  }
  const kind = value.kind
  if (typeof kind !== 'string' || !KNOWN_ACTION_KINDS.has(kind as ActionKind)) {
    return failAt(
      where,
      `.kind must be one of ${[...KNOWN_ACTION_KINDS].join(' / ')} (got ${JSON.stringify(kind)})`
    )
  }
  // condition / confirm build their nested branches recursively, so they return
  // directly rather than falling through to buildActionFromValidated.
  if (kind === 'condition') return validateConditionAction(where, value.id, value)
  if (kind === 'confirm') return validateConfirmAction(where, value.id, value)
  const fieldsR = validatePerKindFields(where, kind as ActionKind, value)
  if (!fieldsR.ok) return fieldsR
  return { ok: true, action: buildActionFromValidated(value.id, kind as ActionKind, value) }
}

/** Per-kind field validation for a non-`condition` action (condition recurses
 *  separately). Each arm delegates to the kind's validator; kinds with no extra
 *  fields (navigate / stop) fall through to ok. Split out of `validateActionAt`
 *  to keep that dispatcher under the complexity cap (§10 v2 added `toast`). */
function validatePerKindFields(
  where: string,
  kind: ActionKind,
  value: Record<string, unknown>
): { ok: true } | { ok: false; error: string } {
  if (kind === 'setState' || kind === 'setVariable') return validateValueExpr(where, value)
  if (kind === 'navigate') return validateNavigateAction(where, value)
  if (kind === 'apiCall') return validateApiCallAction(where, value)
  if (kind === 'supabaseQuery' || kind === 'supabaseMutation') {
    const r = validateSupabaseAction(where, kind, value)
    if (!r.ok) return r
    return validateResultBranches(where, value)
  }
  if (kind === 'supabaseAuth') return validateSupabaseAuthAction(where, value)
  if (kind === 'delay') return validateDelayAction(where, value)
  if (kind === 'toast') return validateToastAction(where, value)
  if (kind === 'clipboard') return validateClipboardAction(where, value)
  if (kind === 'callWorkflow') return validateCallWorkflowAction(where, value)
  return { ok: true }
}

/** Phase 4 §16.2: a navigate's optional `params` — an object mapping a route
 *  param name (a plain identifier filling a `:id` segment) to a value
 *  expression in the same sub-language as `setState.valueExpr`. Identifier +
 *  parse checks happen here; identifier resolution against state / docState /
 *  `$params` happens at IR collect. */
function validateNavigateAction(
  where: string,
  value: Record<string, unknown>
): { ok: true } | { ok: false; error: string } {
  if (value.params === undefined) return { ok: true }
  if (!isPlainObject(value.params)) {
    return failAt(`${where}.params`, 'must be an object of { paramName: expressionString }')
  }
  for (const [name, expr] of Object.entries(value.params)) {
    if (!PARAM_NAME_RE.test(name)) {
      return failAt(
        `${where}.params`,
        `param name "${name}" must be a valid identifier (fills a :segment)`
      )
    }
    if (typeof expr !== 'string')
      return failAt(`${where}.params.${name}`, 'must be a string expression')
    const r = validateExpression(expr)
    if (!r.ok) return failAt(`${where}.params.${name}`, `— ${r.reason}`)
  }
  return { ok: true }
}

/** Phase 3 §10 v4: `callWorkflow.workflowId`, when present, must be a string.
 *  Existence + cycle checks happen at IR collect (which holds the workflow map
 *  and the call site together), so the tool only validates the shape. Phase 3
 *  §10 v6: `args`, when present, must be an object of `{ param: exprString }`;
 *  argument parsing + missing/extra/unknown checks happen at IR collect. */
function validateCallWorkflowAction(
  where: string,
  value: Record<string, unknown>
): { ok: true } | { ok: false; error: string } {
  if (value.workflowId !== undefined && typeof value.workflowId !== 'string') {
    return failAt(where, '.workflowId must be a string')
  }
  if (value.args !== undefined) {
    if (!isPlainObject(value.args)) {
      return failAt(`${where}.args`, 'must be an object of { param: expressionString }')
    }
    for (const [param, expr] of Object.entries(value.args)) {
      if (typeof expr !== 'string')
        return failAt(`${where}.args.${param}`, 'must be a string expression')
    }
  }
  return { ok: true }
}

/** Validate the `consequent` (required) / `alternate` (optional) branch arrays
 *  shared by `condition` and `confirm`, building each branch's nested actions
 *  recursively. Split out so the two validators stay clone-free (jscpd 0). */
function validateActionBranches(
  where: string,
  value: Record<string, unknown>
):
  | { ok: true; consequent: ActionDef[]; alternate: ActionDef[] | undefined }
  | { ok: false; error: string } {
  const consequentR = validateActionArray(`${where}.consequent`, value.consequent, true)
  if (!consequentR.ok) return consequentR
  let alternate: ActionDef[] | undefined
  if (value.alternate !== undefined) {
    const alternateR = validateActionArray(`${where}.alternate`, value.alternate, false)
    if (!alternateR.ok) return alternateR
    alternate = alternateR.actions
  }
  return { ok: true, consequent: consequentR.actions, alternate }
}

/** Phase 3 §10: validate a `condition` action — optional string `condExpr`,
 *  required `consequent` array, optional `alternate` array — building each
 *  branch's nested actions recursively. */
function validateConditionAction(
  where: string,
  id: string,
  value: Record<string, unknown>
): { ok: true; action: ActionDef } | { ok: false; error: string } {
  if (value.condExpr !== undefined && typeof value.condExpr !== 'string') {
    return failAt(where, '.condExpr must be a string')
  }
  const branchesR = validateActionBranches(where, value)
  if (!branchesR.ok) return branchesR
  return {
    ok: true,
    action: {
      id,
      kind: 'condition',
      condExpr: value.condExpr,
      consequent: branchesR.consequent,
      alternate: branchesR.alternate
    }
  }
}

/** Phase 3 §10 v3: validate a `confirm` action — optional string `messageExpr`,
 *  required `consequent` array, optional `alternate` array — building each
 *  branch's nested actions recursively (a `condition` gated on a user choice). */
function validateConfirmAction(
  where: string,
  id: string,
  value: Record<string, unknown>
): { ok: true; action: ActionDef } | { ok: false; error: string } {
  if (value.messageExpr !== undefined && typeof value.messageExpr !== 'string') {
    return failAt(where, '.messageExpr must be a string')
  }
  // Phase 3 §10 v5: optional static button labels.
  if (value.confirmLabel !== undefined && typeof value.confirmLabel !== 'string') {
    return failAt(where, '.confirmLabel must be a string')
  }
  if (value.cancelLabel !== undefined && typeof value.cancelLabel !== 'string') {
    return failAt(where, '.cancelLabel must be a string')
  }
  const branchesR = validateActionBranches(where, value)
  if (!branchesR.ok) return branchesR
  return {
    ok: true,
    action: {
      id,
      kind: 'confirm',
      messageExpr: value.messageExpr,
      consequent: branchesR.consequent,
      alternate: branchesR.alternate,
      confirmLabel: value.confirmLabel,
      cancelLabel: value.cancelLabel
    }
  }
}

/** Phase 3 §10 v3: `clipboard.valueExpr`, when present, must be a string
 *  (collect parses + validates it as an expression). */
function validateClipboardAction(
  where: string,
  value: Record<string, unknown>
): { ok: true } | { ok: false; error: string } {
  if (value.valueExpr !== undefined && typeof value.valueExpr !== 'string') {
    return failAt(where, '.valueExpr must be a string')
  }
  return { ok: true }
}

/** Validate an array of nested actions (a `condition` branch). When `required`
 *  is false an absent value yields an empty branch. */
function validateActionArray(
  where: string,
  value: unknown,
  required: boolean
): { ok: true; actions: ActionDef[] } | { ok: false; error: string } {
  if (value === undefined) {
    if (required) return failAt(where, 'must be an array')
    return { ok: true, actions: [] }
  }
  if (!Array.isArray(value)) return failAt(where, 'must be an array')
  const actions: ActionDef[] = []
  for (let i = 0; i < value.length; i++) {
    const r = validateActionAt(`${where}[${i}]`, value[i])
    if (!r.ok) return r
    actions.push(r.action)
  }
  return { ok: true, actions }
}

/** Phase 3 §10 v9: validate the optional `onSuccess` / `onError` result-branch
 *  arrays shared by apiCall / supabaseQuery / supabaseMutation (each a recursive
 *  ActionDef chain, like a condition branch). Absent → no branch. */
function validateResultBranches(
  where: string,
  value: Record<string, unknown>
): { ok: true } | { ok: false; error: string } {
  for (const key of ['onSuccess', 'onError'] as const) {
    if (value[key] === undefined) continue
    const r = validateActionArray(`${where}.${key}`, value[key], false)
    if (!r.ok) return r
  }
  return { ok: true }
}

/** Phase 3 §10 v9: validate an `apiCall` action — its URL, optional string
 *  `errorTarget` (error-capture docState), and `onSuccess` / `onError`
 *  result-branches. */
function validateApiCallAction(
  where: string,
  value: Record<string, unknown>
): { ok: true } | { ok: false; error: string } {
  if (value.errorTarget !== undefined && typeof value.errorTarget !== 'string') {
    return failAt(where, '.errorTarget must be a string')
  }
  const urlR = validateApiCallUrl(where, value)
  if (!urlR.ok) return urlR
  return validateResultBranches(where, value)
}

/** Phase 3 §10 v9: re-derive a validated result-branch array for building (the
 *  shape was already checked in `validateResultBranches`, so this never errors;
 *  undefined → branch absent). */
function builtBranch(
  value: Record<string, unknown>,
  key: 'onSuccess' | 'onError'
): ActionDef[] | undefined {
  if (value[key] === undefined) return undefined
  const r = validateActionArray(key, value[key], false)
  return r.ok ? r.actions : undefined
}

/** Phase 3 §10: `delay.ms`, when present, must be a finite non-negative
 *  number (collect also re-checks and drops invalid values with a warning). */
function validateDelayAction(
  where: string,
  value: Record<string, unknown>
): { ok: true } | { ok: false; error: string } {
  const ms = value.ms
  if (ms !== undefined && (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0)) {
    return failAt(where, '.ms must be a finite non-negative number')
  }
  return { ok: true }
}

const TOAST_VARIANTS = new Set(['info', 'success', 'error'])
const TOAST_POSITIONS = new Set([
  'top-left',
  'top-center',
  'top-right',
  'bottom-left',
  'bottom-center',
  'bottom-right'
])

/** Phase 3 §10 v2 / v5: `toast.messageExpr`, when present, must be a string
 *  (collect parses + validates it as an expression); `toast.variant`, when
 *  present, must be one of info / success / error; `toast.position` (§10 v5) must
 *  be one of the six corners; `toast.durationMs` must be a finite non-negative
 *  number (collect re-checks and falls back to the default on a bad value). */
function validateToastAction(
  where: string,
  value: Record<string, unknown>
): { ok: true } | { ok: false; error: string } {
  if (value.messageExpr !== undefined && typeof value.messageExpr !== 'string') {
    return failAt(where, '.messageExpr must be a string')
  }
  if (value.variant !== undefined && !TOAST_VARIANTS.has(value.variant as string)) {
    return failAt(where, '.variant must be one of info / success / error')
  }
  if (value.position !== undefined && !TOAST_POSITIONS.has(value.position as string)) {
    return failAt(where, '.position must be one of ' + [...TOAST_POSITIONS].join(' / '))
  }
  const ms = value.durationMs
  if (ms !== undefined && (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0)) {
    return failAt(where, '.durationMs must be a finite non-negative number')
  }
  return { ok: true }
}

/** Construct a precisely-typed `ActionDef` variant from a Record<string, unknown>
 *  whose shape has already been runtime-checked. Avoids the `as unknown as
 *  ActionDef` broad cast forbidden by the open-pencil/no-broad-double-cast
 *  rule: each variant is built via direct field reads + single casts, which
 *  TypeScript can structurally assign back into the discriminated union.
 *  Optional fields per kind pass through any value present on `raw`; the
 *  IR collect pass surfaces deeper validation issues at compile time. */
function buildActionFromValidated(
  id: string,
  kind: ActionKind,
  raw: Record<string, unknown>
): ActionDef {
  switch (kind) {
    case 'setState':
      return {
        id,
        kind,
        targetStateId: raw.targetStateId as string | undefined,
        valueExpr: raw.valueExpr as string | undefined
      }
    case 'navigate':
      return {
        id,
        kind,
        to: raw.to as string | undefined,
        params: raw.params as Record<string, string> | undefined
      }
    case 'setVariable':
      return {
        id,
        kind,
        targetName: raw.targetName as string | undefined,
        valueExpr: raw.valueExpr as string | undefined
      }
    case 'apiCall':
      return {
        id,
        kind,
        method: raw.method as 'GET' | 'POST',
        url: raw.url as string,
        bodyJson: raw.bodyJson as string | undefined,
        targetName: raw.targetName as string,
        errorTarget: raw.errorTarget as string | undefined,
        onSuccess: builtBranch(raw, 'onSuccess'),
        onError: builtBranch(raw, 'onError')
      }
    case 'supabaseQuery':
      return {
        id,
        kind,
        table: raw.table as string,
        columns: raw.columns as string | undefined,
        filters: raw.filters as SupabaseFilter[] | undefined,
        single: raw.single as boolean | undefined,
        resultTarget: raw.resultTarget as string,
        errorTarget: raw.errorTarget as string | undefined,
        onSuccess: builtBranch(raw, 'onSuccess'),
        onError: builtBranch(raw, 'onError')
      }
    case 'supabaseMutation':
      return {
        id,
        kind,
        operation: raw.operation as 'insert' | 'update' | 'delete' | 'upsert',
        table: raw.table as string,
        payloadJson: normalizeSupabaseMutationPayloadJson(raw.payloadJson as string | undefined),
        payloadEntries: raw.payloadEntries as SupabasePayloadEntry[] | undefined,
        filters: raw.filters as SupabaseFilter[] | undefined,
        resultTarget: raw.resultTarget as string | undefined,
        errorTarget: raw.errorTarget as string | undefined,
        onSuccess: builtBranch(raw, 'onSuccess'),
        onError: builtBranch(raw, 'onError')
      }
    case 'supabaseAuth':
      // Phase 3 §2.v2: signIn/signOut. §2.v3 adds signUp; §2.v4 adds
      // resetPassword / updatePassword. emailExpr/passwordExpr carry through
      // verbatim; expression validation happens in validateSupabaseAuthAction.
      return {
        id,
        kind,
        operation: raw.operation as
          | 'signIn'
          | 'signOut'
          | 'signUp'
          | 'resetPassword'
          | 'updatePassword',
        emailExpr: raw.emailExpr as string | undefined,
        passwordExpr: raw.passwordExpr as string | undefined,
        errorTarget: raw.errorTarget as string | undefined
      }
    case 'condition':
      // Phase 3 §10: built in validateConditionAction (its nested then/else
      // branches need recursive validation), so this arm is never reached.
      throw new Error('condition actions are built via validateConditionAction')
    case 'delay':
      return { id, kind, ms: raw.ms as number | undefined }
    case 'stop':
      return { id, kind }
    case 'toast':
      // Phase 3 §10 v2 / v5: messageExpr + variant + position + durationMs carry
      // through verbatim; expression validation happens in IR collect
      // (resolveToast).
      return {
        id,
        kind,
        messageExpr: raw.messageExpr as string | undefined,
        variant: raw.variant as 'info' | 'success' | 'error' | undefined,
        position: raw.position as ToastAction['position'],
        durationMs: raw.durationMs as number | undefined
      }
    case 'confirm':
      // Phase 3 §10 v3: built in validateConfirmAction (its nested consequent /
      // alternate branches need recursive validation), so this arm is never
      // reached.
      throw new Error('confirm actions are built via validateConfirmAction')
    case 'clipboard':
      // Phase 3 §10 v3: valueExpr carries through verbatim; expression
      // validation happens in IR collect (resolveClipboard).
      return { id, kind, valueExpr: raw.valueExpr as string | undefined }
    case 'callWorkflow':
      // Phase 3 §10 v4: workflowId carries through verbatim; existence + cycle
      // checks happen at IR collect (expandWorkflow). Phase 3 §10 v6: args
      // carry through verbatim; argument parsing / substitution is collect-side.
      return {
        id,
        kind,
        workflowId: raw.workflowId as string | undefined,
        args: raw.args as Record<string, string> | undefined
      }
    default: {
      // Exhaustive — ActionKind covers every variant above. The assignment
      // proves it to TypeScript and the throw matches the
      // ts-eslint(consistent-return) rule for switch-based dispatch.
      const _exhaustive: never = kind
      throw new Error(`unreachable action kind: ${String(_exhaustive)}`)
    }
  }
}

function validateStateDecls(
  what: string,
  raw: unknown,
  rejectDollarPrefix: boolean,
  options: { allowPersistence?: boolean; allowComputed?: boolean } = {}
): { ok: true; decls: StateDef[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: `${what} must be an array` }
  const decls: StateDef[] = []
  const seenNames = new Set<string>()
  const seenIds = new Set<string>()
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i]
    if (!isPlainObject(entry)) return { ok: false, error: `${what}[${i}] must be an object` }
    if (typeof entry.id !== 'string' || entry.id === '') {
      return { ok: false, error: `${what}[${i}].id must be a non-empty string` }
    }
    if (seenIds.has(entry.id)) {
      return { ok: false, error: `${what}[${i}].id "${entry.id}" duplicates an earlier entry` }
    }
    seenIds.add(entry.id)
    if (typeof entry.name !== 'string') {
      return { ok: false, error: `${what}[${i}].name must be a string` }
    }
    // `validateStateName` already rejects `$`-prefixed names (Phase 3 §2 step 1).
    // `rejectDollarPrefix` toggles whether we ALSO short-circuit on `$` for a
    // clearer error message when AI tries to set $currentUser etc. as a
    // user-declared doc-state.
    if (rejectDollarPrefix && entry.name.startsWith('$')) {
      return {
        ok: false,
        error: `${what}[${i}].name "${entry.name}" starts with $ — that prefix is reserved for built-in states (e.g. $currentUser)`
      }
    }
    const nameCheck = validateStateName(entry.name)
    if (!nameCheck.ok) {
      return { ok: false, error: `${what}[${i}].name "${entry.name}" — ${nameCheck.reason}` }
    }
    if (seenNames.has(entry.name)) {
      return { ok: false, error: `${what}[${i}].name "${entry.name}" duplicates an earlier entry` }
    }
    seenNames.add(entry.name)
    if (typeof entry.type !== 'string' || !KNOWN_STATE_TYPES.has(entry.type as StateValueType)) {
      return {
        ok: false,
        error: `${what}[${i}].type must be one of ${[...KNOWN_STATE_TYPES].join(' / ')} (got ${JSON.stringify(entry.type)})`
      }
    }
    const persistence = validateStatePersistence(what, i, entry, options.allowPersistence === true)
    if (!persistence.ok) return persistence
    const computed = validateStateComputed(what, i, entry, options.allowComputed === true)
    if (!computed.ok) return computed
    decls.push({
      id: entry.id,
      name: entry.name,
      type: entry.type as StateValueType,
      defaultValue: entry.defaultValue,
      ...computed.data,
      ...persistence.data
    })
  }
  return { ok: true, decls }
}

function validateStateComputed(
  what: string,
  i: number,
  entry: Record<string, unknown>,
  allowComputed: boolean
): { ok: true; data: Pick<StateDef, 'computedExpr'> } | { ok: false; error: string } {
  if (!('computedExpr' in entry)) return { ok: true, data: {} }
  if (!allowComputed) {
    return fail(`${what}[${i}].computedExpr is only supported on page state`)
  }
  if (typeof entry.computedExpr !== 'string' || entry.computedExpr.trim() === '') {
    return fail(`${what}[${i}].computedExpr must be a non-empty string`)
  }
  const expr = validateExpression(entry.computedExpr)
  if (!expr.ok) return fail(`${what}[${i}].computedExpr — ${expr.reason}`)
  return { ok: true, data: { computedExpr: entry.computedExpr } }
}

function validateStatePersistence(
  what: string,
  i: number,
  entry: Record<string, unknown>,
  allowPersistence: boolean
):
  | { ok: true; data: Pick<StateDef, 'persist' | 'storageKey' | 'storageVersion'> }
  | { ok: false; error: string } {
  const hasPersistence = 'persist' in entry || 'storageKey' in entry || 'storageVersion' in entry
  if (!hasPersistence) return { ok: true, data: {} }
  if (!allowPersistence) {
    return fail(`${what}[${i}] persistence fields are only supported on lowcodeDocumentState`)
  }
  const data: Pick<StateDef, 'persist' | 'storageKey' | 'storageVersion'> = {}
  if ('persist' in entry) {
    if (typeof entry.persist !== 'boolean') {
      return fail(`${what}[${i}].persist must be a boolean`)
    }
    data.persist = entry.persist
  }
  if ('storageKey' in entry) {
    if (typeof entry.storageKey !== 'string' || entry.storageKey === '') {
      return fail(`${what}[${i}].storageKey must be a non-empty string`)
    }
    data.storageKey = entry.storageKey
  }
  if ('storageVersion' in entry) {
    if (typeof entry.storageVersion !== 'string' || entry.storageVersion === '') {
      return fail(`${what}[${i}].storageVersion must be a non-empty string`)
    }
    data.storageVersion = entry.storageVersion
  }
  return { ok: true, data }
}

function validateRenderCondition(
  value: unknown
): { ok: true; expr: string } | { ok: false; error: string } {
  if (typeof value !== 'string') return { ok: false, error: 'renderCondition must be a string' }
  if (value === '') return { ok: true, expr: '' }
  const r = validateExpression(value)
  if (!r.ok) return { ok: false, error: `renderCondition — ${r.reason}` }
  return { ok: true, expr: value }
}

type FieldResult = { ok: true } | { ok: false; error: string }
type StateOverridesResult = { ok: true; value: StateOverrides } | { ok: false; error: string }

function applyStateField(raw: Record<string, unknown>, patch: Partial<SceneNode>): FieldResult {
  if (!('state' in raw)) return { ok: true }
  if (raw.state === null) {
    patch.state = undefined
    return { ok: true }
  }
  const r = validateStateDecls('state', raw.state, false, { allowComputed: true })
  if (!r.ok) return r
  patch.state = r.decls
  return { ok: true }
}

function applyBindingsField(raw: Record<string, unknown>, patch: Partial<SceneNode>): FieldResult {
  if (!('bindings' in raw)) return { ok: true }
  if (raw.bindings === null) {
    patch.bindings = undefined
    return { ok: true }
  }
  if (!isPlainObject(raw.bindings)) return fail('bindings must be an object')
  const out: Record<string, BindingExpr> = {}
  for (const [channel, value] of Object.entries(raw.bindings)) {
    const r = validateBindingExpr(channel, value)
    if (!r.ok) return r
    out[channel] = r.binding
  }
  patch.bindings = out
  return { ok: true }
}

function applyEventsField(raw: Record<string, unknown>, patch: Partial<SceneNode>): FieldResult {
  if (!('events' in raw)) return { ok: true }
  if (raw.events === null) {
    patch.events = undefined
    return { ok: true }
  }
  if (!isPlainObject(raw.events)) return fail('events must be an object')
  const out: Partial<Record<EventName, ActionDef[]>> = {}
  for (const [eventName, value] of Object.entries(raw.events)) {
    if (!KNOWN_EVENT_NAMES.has(eventName as EventName)) {
      return fail(
        `events.${eventName} is not a known event name — allowed: ${[...KNOWN_EVENT_NAMES].join(' / ')}`
      )
    }
    if (!Array.isArray(value)) return fail(`events.${eventName} must be an array of actions`)
    const actions: ActionDef[] = []
    for (let i = 0; i < value.length; i++) {
      const r = validateActionShape(eventName, i, value[i])
      if (!r.ok) return r
      actions.push(r.action)
    }
    out[eventName as EventName] = actions
  }
  patch.events = out
  return { ok: true }
}

function applyInteractivePropsField(
  raw: Record<string, unknown>,
  patch: Partial<SceneNode>
): FieldResult {
  if (!('interactiveProps' in raw)) return { ok: true }
  if (raw.interactiveProps === null) {
    patch.interactiveProps = undefined
    return { ok: true }
  }
  if (!isPlainObject(raw.interactiveProps)) return fail('interactiveProps must be an object')
  patch.interactiveProps = raw.interactiveProps
  return { ok: true }
}

function validateStateOverrides(raw: unknown): StateOverridesResult {
  if (!isPlainObject(raw)) return fail('stateOverrides must be an object')
  const out: StateOverrides = {}
  for (const [state, override] of Object.entries(raw)) {
    if (!KNOWN_INTERACTION_STATES.has(state)) {
      return fail(
        `stateOverrides.${state} is not supported — allowed: ${[...KNOWN_INTERACTION_STATES].join(' / ')}`
      )
    }
    if (!isPlainObject(override)) return fail(`stateOverrides.${state} must be an object`)
    for (const [key, value] of Object.entries(override)) {
      if (!KNOWN_STATE_OVERRIDE_KEYS.has(key)) {
        return fail(
          `stateOverrides.${state}.${key} is not supported — allowed: ${[...KNOWN_STATE_OVERRIDE_KEYS].join(' / ')}`
        )
      }
      if ((key === 'fills' || key === 'strokes' || key === 'effects') && !Array.isArray(value)) {
        return fail(`stateOverrides.${state}.${key} must be an array`)
      }
      if (key === 'cornerRadius' && (typeof value !== 'number' || !Number.isFinite(value))) {
        return fail(`stateOverrides.${state}.cornerRadius must be a finite number`)
      }
      if (key === 'opacity') {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
          return fail(`stateOverrides.${state}.opacity must be a finite number between 0 and 1`)
        }
      }
    }
    out[state as keyof StateOverrides] = override
  }
  return { ok: true, value: out }
}

function applyStateOverridesField(
  raw: Record<string, unknown>,
  patch: Partial<SceneNode>
): FieldResult {
  if (!('stateOverrides' in raw)) return { ok: true }
  if (raw.stateOverrides === null) {
    patch.stateOverrides = undefined
    return { ok: true }
  }
  const r = validateStateOverrides(raw.stateOverrides)
  if (!r.ok) return r
  patch.stateOverrides = r.value
  return { ok: true }
}

function applyRenderConditionField(
  raw: Record<string, unknown>,
  patch: Partial<SceneNode>
): FieldResult {
  if (!('renderCondition' in raw)) return { ok: true }
  if (raw.renderCondition === null) {
    patch.renderCondition = undefined
    return { ok: true }
  }
  const r = validateRenderCondition(raw.renderCondition)
  if (!r.ok) return r
  patch.renderCondition = r.expr
  return { ok: true }
}

function applyDocStateField(raw: Record<string, unknown>, patch: Partial<SceneNode>): FieldResult {
  if (!('lowcodeDocumentState' in raw)) return { ok: true }
  if (raw.lowcodeDocumentState === null) {
    patch.lowcodeDocumentState = undefined
    return { ok: true }
  }
  const r = validateStateDecls('lowcodeDocumentState', raw.lowcodeDocumentState, true, {
    allowPersistence: true
  })
  if (!r.ok) return r
  patch.lowcodeDocumentState = r.decls
  return { ok: true }
}

/** Shape-check + service_role-reject the SupabaseConfig coming off either
 *  the mega-patch (`update_lowcode_node`) or the dedicated setter
 *  (`set_supabase_config`). Returns the typed config so both call sites
 *  can hand it to `graph.updateNode` directly. */
function parseSupabaseConfig(
  raw: unknown,
  what: string
): { ok: true; config: SupabaseConfig } | { ok: false; error: string } {
  if (!isPlainObject(raw)) return fail(`${what} must be an object or null`)
  if (typeof raw.url !== 'string' || typeof raw.anonKey !== 'string') {
    return fail(`${what} requires string url + anonKey`)
  }
  const config: SupabaseConfig = { url: raw.url, anonKey: raw.anonKey }
  if (typeof raw.schema === 'string') config.schema = raw.schema
  const r = validateSupabaseConfig(config)
  if (!r.ok) return fail(`${what} — ${r.reason}`)
  return { ok: true, config }
}

function applySupabaseConfigField(
  raw: Record<string, unknown>,
  patch: Partial<SceneNode>
): FieldResult {
  if (!('lowcodeSupabaseConfig' in raw)) return { ok: true }
  if (raw.lowcodeSupabaseConfig === null) {
    patch.lowcodeSupabaseConfig = undefined
    return { ok: true }
  }
  const r = parseSupabaseConfig(raw.lowcodeSupabaseConfig, 'lowcodeSupabaseConfig')
  if (!r.ok) return r
  patch.lowcodeSupabaseConfig = r.config
  return { ok: true }
}

const FIELD_APPLIERS = [
  applyStateField,
  applyBindingsField,
  applyEventsField,
  applyInteractivePropsField,
  applyStateOverridesField,
  applyRenderConditionField,
  applyDocStateField,
  applySupabaseConfigField
]

// Phase 3 §3.v7 — reject a DATEPICKER whose interactiveProps carry a
// malformed date (decision §3.v7.2 f: format errors hard-fail at the tool
// boundary, same as payloadEntries). Range-inverted / value-out-of-range are
// NOT rejected here — they're warn-and-keep (decision h), surfaced as IR
// warnings at compile time, not tool errors.
function checkDatePickerFields(ip: Record<string, unknown>): FieldResult {
  for (const issue of validateDatePickerProps(ip)) {
    if (issue.code.startsWith('datepicker-invalid') && issue.key) {
      return fail(`interactiveProps.${issue.key} must be a valid YYYY-MM-DD date`)
    }
  }
  return { ok: true }
}

/**
 * Validate a partial lowcode patch and build the `Partial<SceneNode>`
 * payload to hand to `graph.updateNode`. Unknown keys are rejected
 * (rather than silently dropped) so AI typos surface as clear errors.
 * `nodeType` enables per-type interactiveProps checks (§3.v7 DATEPICKER).
 */
function buildPatch(
  raw: Record<string, unknown>,
  nodeType: SceneNode['type']
): ModifyResult<Partial<SceneNode>> {
  for (const key of Object.keys(raw)) {
    if (!PATCH_KEYS.has(key)) {
      return fail(`unknown patch field "${key}" — allowed: ${[...PATCH_KEYS].join(', ')}`)
    }
  }
  const patch: Partial<SceneNode> = {}
  for (const apply of FIELD_APPLIERS) {
    const r = apply(raw, patch)
    if (!r.ok) return r
  }
  if (nodeType === 'DATEPICKER' && isPlainObject(patch.interactiveProps)) {
    const r = checkDatePickerFields(patch.interactiveProps)
    if (!r.ok) return r
  }
  return { ok: true, data: patch }
}

/** Phase 3 §3.v2: apply `patch` to `nodeId` so the change is undoable. When
 *  `ctx.editor` is present (browser dispatch via app's tool-handlers), snap
 *  the previous field values, mutate via the editor's graph, and push an
 *  `UndoEntry` so Cmd+Z restores the whole patch in one step. When
 *  `ctx.editor` is missing (CLI / MCP / fixture tests), fall back to the
 *  raw `figma.graph.updateNode` path so headless callers keep working with
 *  no undo (decision §3.v2 #b). */
function applyPatchWithUndo(
  figma: FigmaAPI,
  nodeId: string,
  patch: Partial<SceneNode>,
  label: string,
  ctx: ToolCtx | undefined
): void {
  // A patch value of `undefined` means "clear this field" (the tool maps an
  // explicit `null` to `undefined`). `graph.updateNode` skips undefined-valued
  // entries, so set and clear must take separate paths: `updateNode` for the
  // defined fields, `clearNodeFields` for the cleared ones.
  const graph = ctx?.editor?.graph ?? figma.graph
  const keys = Object.keys(patch) as (keyof SceneNode)[]
  const clearKeys = keys.filter((key) => patch[key] === undefined)
  const setPatch = Object.fromEntries(
    keys.filter((key) => patch[key] !== undefined).map((key) => [key, patch[key]])
  ) as Partial<SceneNode>
  const applyForward = (): void => {
    if (Object.keys(setPatch).length > 0) graph.updateNode(nodeId, setPatch)
    if (clearKeys.length > 0) graph.clearNodeFields(nodeId, clearKeys)
  }

  const node = graph.getNode(nodeId)
  if (!ctx?.editor || !node) {
    applyForward()
    return
  }
  const editor = ctx.editor

  // Snapshot the prior values so a single undo entry reverts the whole patch.
  // Keys that were previously absent must be re-cleared on undo (updateNode
  // alone can't restore them to absent, since it skips the undefined value).
  const previous = Object.fromEntries(
    keys.map((key) => [key, structuredClone(node[key])])
  ) as Partial<SceneNode>
  const restorePatch = Object.fromEntries(
    keys.filter((key) => previous[key] !== undefined).map((key) => [key, previous[key]])
  ) as Partial<SceneNode>
  const restoreClearKeys = keys.filter((key) => previous[key] === undefined)
  const applyInverse = (): void => {
    if (Object.keys(restorePatch).length > 0) editor.graph.updateNode(nodeId, restorePatch)
    if (restoreClearKeys.length > 0) editor.graph.clearNodeFields(nodeId, restoreClearKeys)
  }

  applyForward()
  editor.undo.push({ label, forward: applyForward, inverse: applyInverse })
}

export const updateLowcodeNode = defineTool({
  name: 'update_lowcode_node',
  mutates: true,
  description:
    "Update the lowcode-specific fields of a single SceneNode in one atomic commit. Fields not listed in the patch are left UNCHANGED (no implicit clearing); to clear a field, set its value to null explicitly. Allowed patch keys: state, bindings, events, interactiveProps, stateOverrides, renderCondition, lowcodeDocumentState (root only), lowcodeSupabaseConfig (root only). Every input is validated at the tool boundary: state names go through validateStateName ($-prefix reserved for built-ins), bindings.expr / actions.valueExpr / renderCondition go through the Phase 0 expression sublanguage parser, apiCall urls through the §4 template parser, supabaseConfig through validateSupabaseConfig which hard-rejects service_role JWTs. Unknown patch keys are rejected (no silent drops). One call → one undo entry. Page state entries may include Phase 4 §27.2 computedExpr; computed page state is emitted as read-only derived state, so setState and controlled bindings cannot write to it. Phase 4 §20 stateOverrides accepts hover/focus/active/disabled appearance overrides over fills/strokes/cornerRadius/opacity/effects; the compiler emits Tailwind pseudo-state classes such as hover:bg-* or disabled:opacity-50. IMPORTANT: setVariable.valueExpr identifiers can ONLY resolve to declared page-state names plus `$prev` (the functional-update previous-value placeholder for the doc-state being written) — doc-state names are NOT in scope inside setVariable.valueExpr and a reference to one is silently dropped by the IR walker (`action-setvariable-unknown-identifier`), even though the tool accepts the patch as ok. Use `$prev` for self-referential updates (e.g. `$prev + 1` to increment, `$prev` to pass-through). In onChange/onFocus/onBlur handlers, `$event` and `$value` are also in scope; `$value` is emitted from the event target's value. setState.valueExpr has no such restriction. IMPORTANT (Phase 3 §3.x / Phase 4 §28): on an INPUT node, setting bindings.value to { kind: 'docState', docStateName: '<name>' } or { kind: 'ref', stateId: '<id>' } makes the input controlled — the compiler emits `value={read}` plus a synthesized `onChange` that calls setDocState / the page-state setter with `e.target.value` (string targets) or `Number(e.target.value)` (number targets). The referenced docState / writable page-state MUST be type 'string' or 'number'; number-typed targets additionally make the compiler emit `<input type=\"number\">` on the HTML side. Other types (boolean / array / object), computed page state, and the literal / expr kinds are rejected at IR collect time with a warning and the input falls back to uncontrolled emit. A controlled INPUT's user-defined onChange handler is composed after the synthesized writer in the same event handler, so use `$value` to read the runtime input value in follow-up actions. Other interactive types (TEXTAREA / SELECT / CHECKBOX / RADIO / DATEPICKER / SWITCH) also support controlled bindings where their target type is valid. IMPORTANT (Phase 3 §3.v2): a `supabaseMutation` action has two payload channels — `payloadJson` (static JSON literal, no interpolation) and `payloadEntries: [{key, valueExpr}]` (one entry per column, each `valueExpr` uses the same restricted expression sub-language as `setState.valueExpr` / filter values, so values can reference docState / page-state / literals). Prefer `payloadEntries` for form-driven writes (e.g. INSERT a row from controlled INPUTs). When both are set on the same action, `payloadEntries` wins and `payloadJson` is dropped with a warning. `delete` operations must have neither. Each `payloadEntries[i].key` must be a JS identifier (column name) and keys must be unique within the entry list. IMPORTANT (Phase 3 §2.v2 / §2.v3 / §2.v4): a `supabaseAuth` action drives Supabase auth — `{ kind: 'supabaseAuth', operation: 'signIn' | 'signOut' | 'signUp' | 'resetPassword' | 'updatePassword', emailExpr?, passwordExpr?, errorTarget? }`. Per-operation credential gating: `signIn` + `signUp` (registration) use both `emailExpr` + `passwordExpr`; `resetPassword` (send a reset email) uses `emailExpr` only; `updatePassword` (set a new password for the current session) uses `passwordExpr` only; `signOut` uses neither. The exprs use the same expression sub-language as filter values (bind them to a controlled INPUT's docState, e.g. emailExpr: 'emailInput'); a malformed expression is rejected here, a missing required one warns at IR collect. There is no resultTarget: the runtime keeps the `$currentUser` docState synced via onAuthStateChange, so read `$currentUser.signedIn` to branch on auth state. Note `signUp` with email confirmation enabled (the Supabase default) does NOT create a session until the user confirms, so `$currentUser.signedIn` stays false until then; `resetPassword` emits redirectTo: window.location.origin and its email round-trip can only be verified in a real deployment (the email link lands on the app and fires PASSWORD_RECOVERY, where an updatePassword action sets the new one). `errorTarget` optionally captures the auth error. IMPORTANT (Phase 4 §16.2): a `navigate` action targeting a dynamic route pattern (`to: '/product/:id'`, declared on the target page via its lowcodeRoutePattern) may carry `params: { id: '<expr>' }` — each key is a route-param identifier (filling a `:segment`) and each value is an expression in the same sub-language as setState.valueExpr (resolves against page state / docState / `$params`). The compiler emits `navigate(generatePath('/product/:id', { id: <expr> }))`; with no params it stays a literal `navigate('/about')`. A param key that isn't an identifier or a value that doesn't parse is rejected here; an unknown identifier in a param drops the whole navigate handler with a warning at IR collect. Example: update_lowcode_node({ id: 'btn-1', patch_json: '{\"interactiveProps\":{\"text\":\"Submit\"},\"events\":{\"onClick\":[{\"id\":\"a-1\",\"kind\":\"navigate\",\"to\":\"/done\"}]}}' }) → { ok: true, data: { id: 'btn-1', updated: ['interactiveProps', 'events'] } }. Clearing example: '{\"renderCondition\":null}' clears the renderCondition.",
  params: {
    id: { type: 'string', description: 'Node id', required: true },
    patch_json: {
      type: 'string',
      description:
        'JSON object: any subset of {state, bindings, events, interactiveProps, stateOverrides, renderCondition, lowcodeDocumentState, lowcodeSupabaseConfig}. Use null as a value to clear a field.',
      required: true
    }
  },
  execute: (figma, args, ctx): ModifyResult<{ id: string; updated: string[] }> => {
    const node = figma.graph.getNode(args.id)
    if (!node) return fail(`Node "${args.id}" not found`)
    const parsed = parseJson(args.patch_json, 'patch_json')
    if (!parsed.ok) return fail(parsed.error)
    if (!isPlainObject(parsed.value)) return fail('patch_json must be a JSON object')
    const built = buildPatch(parsed.value, node.type)
    if (!built.ok) return built
    const patch = built.data ?? {}
    applyPatchWithUndo(figma, args.id, patch, 'AI: update_lowcode_node', ctx)
    return { ok: true, data: { id: args.id, updated: Object.keys(patch) } }
  }
})

export const setDocStates = defineTool({
  name: 'set_doc_states',
  mutates: true,
  description:
    'Replace the root node\'s lowcodeDocumentState array wholesale. Pass the FULL list — entries omitted from the JSON are deleted (decision §3.2 #b: no per-entry diff in MVP; preserve existing entries by including them again). Each entry needs {id, name, type, defaultValue}; optional Phase 4 §27.1 persistence fields are {persist?: boolean, storageKey?: string, storageVersion?: string}. Only entries with persist: true are emitted as localStorage-backed docState. Phase 4 §27.2 computedExpr is page-state only and is rejected for document state. name goes through validateStateName which rejects empty / non-identifier / $-prefixed names ($currentUser etc. are reserved). Type is one of string / number / boolean / array / object. Duplicate names or duplicate ids are rejected. Example: set_doc_states({ states_json: \'[{"id":"d-1","name":"count","type":"number","defaultValue":0,"persist":true},{"id":"d-2","name":"items","type":"array","defaultValue":[]}]\' }) → { ok: true, data: { count: 2 } }. Clear all with states_json: \'[]\'.',
  params: {
    states_json: {
      type: 'string',
      description:
        'JSON array of DocumentStateDef: [{id, name, type, defaultValue, persist?, storageKey?, storageVersion?}]. computedExpr is rejected here; use page state for computed values. Pass [] to clear.',
      required: true
    }
  },
  execute: (figma, args, ctx): ModifyResult<{ count: number }> => {
    const parsed = parseJson(args.states_json, 'states_json')
    if (!parsed.ok) return fail(parsed.error)
    const validated = validateStateDecls('states_json', parsed.value, true, {
      allowPersistence: true
    })
    if (!validated.ok) return validated
    const decls = validated.decls
    applyPatchWithUndo(
      figma,
      figma.graph.rootId,
      { lowcodeDocumentState: decls },
      'AI: set_doc_states',
      ctx
    )
    return { ok: true, data: { count: decls.length } }
  }
})

export const setSupabaseConfig = defineTool({
  name: 'set_supabase_config',
  mutates: true,
  description:
    'Replace the root node\'s lowcodeSupabaseConfig wholesale. Pass JSON `null` (literal string "null") to clear the config entirely (decision §3.2 #d). Otherwise pass {url, anonKey, schema?} — anonKey MUST be the anon (public) key; a service_role JWT is hard-rejected at this tool boundary, never persists (decision §3.2 #h, mirrors SupabaseConfigPanel.vue rejection logic via shared validateSupabaseConfig). url must start with http:// or https://. Example: set_supabase_config({ config_json: \'{"url":"https://abc.supabase.co","anonKey":"eyJ.anon.signature"}\' }) → { ok: true, data: { cleared: false } }. Clear example: set_supabase_config({ config_json: \'null\' }) → { ok: true, data: { cleared: true } }.',
  params: {
    config_json: {
      type: 'string',
      description: 'JSON object {url, anonKey, schema?} OR the literal string "null" to clear.',
      required: true
    }
  },
  execute: (figma, args, ctx): ModifyResult<{ cleared: boolean }> => {
    const parsed = parseJson(args.config_json, 'config_json')
    if (!parsed.ok) return fail(parsed.error)
    if (parsed.value === null) {
      applyPatchWithUndo(
        figma,
        figma.graph.rootId,
        { lowcodeSupabaseConfig: undefined },
        'AI: set_supabase_config',
        ctx
      )
      return { ok: true, data: { cleared: true } }
    }
    const r = parseSupabaseConfig(parsed.value, 'config_json')
    if (!r.ok) return r
    applyPatchWithUndo(
      figma,
      figma.graph.rootId,
      { lowcodeSupabaseConfig: r.config },
      'AI: set_supabase_config',
      ctx
    )
    return { ok: true, data: { cleared: false } }
  }
})

/** Phase 3 §9 v7: validate a translation catalog — a plain object mapping each
 *  locale code (non-empty string) to a `Record<sourceMessage, translated>`
 *  where every value is a string. Rejects scalars/arrays and non-string
 *  entries so a malformed catalog never persists. */
function validateTranslations(
  what: string,
  raw: unknown
): { ok: true; translations: LowcodeTranslations } | { ok: false; error: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return failAt(what, 'must be a JSON object { <locale>: { <source>: <translated> } }')
  }
  const out: LowcodeTranslations = {}
  for (const [locale, messages] of Object.entries(raw)) {
    if (locale === '') return failAt(what, 'locale code must be a non-empty string')
    if (messages === null || typeof messages !== 'object' || Array.isArray(messages)) {
      return failAt(what, `locale "${locale}" must map to an object of source→translated strings`)
    }
    const map: Record<string, string> = {}
    for (const [source, translated] of Object.entries(messages)) {
      if (typeof translated !== 'string') {
        return failAt(what, `translation for "${source}" in locale "${locale}" must be a string`)
      }
      map[source] = translated
    }
    out[locale] = map
  }
  return { ok: true, translations: out }
}

export const setTranslations = defineTool({
  name: 'set_translations',
  mutates: true,
  description:
    'Replace the root node\'s lowcodeTranslations catalog wholesale (Phase 3 §9 v7). Pass the FULL catalog — locales / entries omitted from the JSON are deleted (no per-entry diff; include existing entries again to preserve them). Pass the literal string "null" or \'{}\' to clear all translations. Shape: { <localeCode>: { <sourceMessage>: <translatedString> } } — keyed by the SOURCE message string (the visible canvas text / ICU canonical message the builder authored, NOT the compiler\'s content-hash id). The compiler pre-fills each target `src/locales/<locale>.json` from this; a missing entry falls back to the source string (so the app always renders). Authoring a translation for a locale auto-emits that locale\'s JSON + registers it in the i18n runtime + LocaleSwitcher even if it is not listed in CompilerOptions.locales. Only consulted when the compile runs with i18n enabled. Every locale code must be a non-empty string and every translated value must be a string; malformed input is rejected (no silent drops). One call → one undo entry. Example: set_translations({ translations_json: \'{"fr":{"Submit":"Envoyer","Welcome, {name}!":"Bienvenue, {name} !"}}\' }) → { ok: true, data: { locales: 1, entries: 2 } }. Clear example: set_translations({ translations_json: \'null\' }) → { ok: true, data: { locales: 0, entries: 0 } }.',
  params: {
    translations_json: {
      type: 'string',
      description:
        'JSON object { <locale>: { <source>: <translated> } }, OR the literal string "null" / "{}" to clear.',
      required: true
    }
  },
  execute: (figma, args, ctx): ModifyResult<{ locales: number; entries: number }> => {
    const parsed = parseJson(args.translations_json, 'translations_json')
    if (!parsed.ok) return fail(parsed.error)
    if (parsed.value === null) {
      applyPatchWithUndo(
        figma,
        figma.graph.rootId,
        { lowcodeTranslations: undefined },
        'AI: set_translations',
        ctx
      )
      return { ok: true, data: { locales: 0, entries: 0 } }
    }
    const r = validateTranslations('translations_json', parsed.value)
    if (!r.ok) return r
    const locales = Object.keys(r.translations)
    const entries = locales.reduce((n, loc) => n + Object.keys(r.translations[loc] ?? {}).length, 0)
    // An empty catalog ({}) clears the field — keep absent ≡ no translations so
    // .fig output stays byte-identical (isNonEmpty gate on the serialize side).
    applyPatchWithUndo(
      figma,
      figma.graph.rootId,
      { lowcodeTranslations: locales.length > 0 ? r.translations : undefined },
      'AI: set_translations',
      ctx
    )
    return { ok: true, data: { locales: locales.length, entries } }
  }
})

/** Phase 3 §10 v4: validate a named-workflow list — an array of
 *  `{ id, name, actions }` where `id` is a non-empty unique string, `name` a
 *  string, and `actions` a (possibly empty) ActionDef array validated through
 *  the same recursive pipeline as event chains. Rejects duplicate ids and any
 *  malformed action so a broken workflow never persists. Phase 4 §10 follow-up:
 *  optional `pageId` scopes editor/tool validation to a page's local state. */
/** Phase 3 §10 v6: a workflow parameter name. A plain identifier (letters /
 *  digits / underscore, not starting with a digit), deliberately excluding the
 *  `$`-prefixed reserved tokens (`$prev` / `$event` / `$currentUser` …) so a
 *  parameter can never shadow them. */
const PARAM_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Phase 3 §10 v6: validate a workflow's optional `params` — an array of unique
 *  identifier strings. Returns the validated list (or undefined when absent). */
function validateWorkflowParams(
  where: string,
  raw: unknown
): { ok: true; params: string[] | undefined } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, params: undefined }
  if (!Array.isArray(raw)) return failAt(where, 'must be an array of identifier strings')
  const params: string[] = []
  const seen = new Set<string>()
  for (let j = 0; j < raw.length; j++) {
    const p = raw[j]
    if (typeof p !== 'string' || !PARAM_NAME_RE.test(p)) {
      return failAt(
        `${where}[${j}]`,
        'must be a valid identifier (letters/digits/underscore, not starting with a digit or $)'
      )
    }
    if (seen.has(p)) return failAt(`${where}[${j}]`, `parameter "${p}" is duplicated`)
    seen.add(p)
    params.push(p)
  }
  return { ok: true, params }
}

/** Phase 3 §10 v7: validate a workflow's optional `paramDefaults` — a record of
 *  default argument expression strings keyed by formal parameter name. Each key
 *  must be a declared parameter; each value a non-empty string (parsed as an
 *  expression at compile time, not here). Returns the validated record (or
 *  undefined when absent). */
function validateWorkflowParamDefaults(
  where: string,
  raw: unknown,
  params: readonly string[]
): { ok: true; paramDefaults: Record<string, string> | undefined } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, paramDefaults: undefined }
  if (!isPlainObject(raw))
    return failAt(where, 'must be an object mapping parameter names to default expression strings')
  const paramDefaults: Record<string, string> = {}
  for (const key of Object.keys(raw)) {
    if (!params.includes(key)) {
      return failAt(`${where}.${key}`, `is not a declared workflow parameter`)
    }
    const value = raw[key]
    if (typeof value !== 'string' || value.trim() === '') {
      return failAt(`${where}.${key}`, 'must be a non-empty expression string')
    }
    paramDefaults[key] = value
  }
  return { ok: true, paramDefaults }
}

/** Phase 3 §10 v8: validate a workflow's optional `optionalParams` — an array of
 *  declared parameter names that may be omitted at a callWorkflow even without a
 *  default (resolving to `undefined` in the body). Each must be a unique declared
 *  parameter. Returns the validated list (or undefined when absent). */
function validateWorkflowOptionalParams(
  where: string,
  raw: unknown,
  params: readonly string[]
): { ok: true; optionalParams: string[] | undefined } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, optionalParams: undefined }
  if (!Array.isArray(raw)) return failAt(where, 'must be an array of declared parameter names')
  const optionalParams: string[] = []
  const seen = new Set<string>()
  for (let j = 0; j < raw.length; j++) {
    const p = raw[j]
    if (typeof p !== 'string' || !params.includes(p)) {
      return failAt(`${where}[${j}]`, 'must be a declared workflow parameter')
    }
    if (seen.has(p)) return failAt(`${where}[${j}]`, `parameter "${p}" is duplicated`)
    seen.add(p)
    optionalParams.push(p)
  }
  return { ok: true, optionalParams }
}

function validateWorkflows(
  what: string,
  raw: unknown,
  validPageIds?: ReadonlySet<string>
): { ok: true; workflows: WorkflowDef[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return failAt(what, 'must be a JSON array of { id, name, actions }')
  const out: WorkflowDef[] = []
  const seenIds = new Set<string>()
  for (let i = 0; i < raw.length; i++) {
    const wf = raw[i]
    const where = `${what}[${i}]`
    if (!isPlainObject(wf)) return failAt(where, 'must be an object')
    if (typeof wf.id !== 'string' || wf.id === '')
      return failAt(where, '.id must be a non-empty string')
    if (seenIds.has(wf.id)) return failAt(where, `.id "${wf.id}" is duplicated`)
    if (typeof wf.name !== 'string') return failAt(where, '.name must be a string')
    const pageR = validateWorkflowPageId(where, wf.pageId, validPageIds)
    if (!pageR.ok) return pageR
    const paramsR = validateWorkflowParams(`${where}.params`, wf.params)
    if (!paramsR.ok) return paramsR
    const defaultsR = validateWorkflowParamDefaults(
      `${where}.paramDefaults`,
      wf.paramDefaults,
      paramsR.params ?? []
    )
    if (!defaultsR.ok) return defaultsR
    const optionalR = validateWorkflowOptionalParams(
      `${where}.optionalParams`,
      wf.optionalParams,
      paramsR.params ?? []
    )
    if (!optionalR.ok) return optionalR
    const actionsR = validateActionArray(`${where}.actions`, wf.actions, true)
    if (!actionsR.ok) return actionsR
    seenIds.add(wf.id)
    out.push({
      id: wf.id,
      name: wf.name,
      ...(typeof wf.pageId === 'string' ? { pageId: wf.pageId } : {}),
      params: paramsR.params,
      paramDefaults: defaultsR.paramDefaults,
      optionalParams: optionalR.optionalParams,
      actions: actionsR.actions
    })
  }
  return { ok: true, workflows: out }
}

function validateWorkflowPageId(
  where: string,
  pageId: unknown,
  validPageIds: ReadonlySet<string> | undefined
): { ok: true } | { ok: false; error: string } {
  if (pageId === undefined) return { ok: true }
  if (typeof pageId !== 'string' || pageId === '') {
    return failAt(where, '.pageId must be a non-empty string when present')
  }
  if (validPageIds !== undefined && !validPageIds.has(pageId)) {
    return failAt(where, `.pageId "${pageId}" does not match an existing page`)
  }
  return { ok: true }
}

export const setWorkflows = defineTool({
  name: 'set_workflows',
  mutates: true,
  description:
    'Replace the root node\'s lowcodeWorkflows list wholesale (Phase 3 §10 v4). Workflows are named, reusable action chains that any node\'s event handler — or another workflow — invokes by id via a `callWorkflow` action; the compiler expands the chain INLINE at each call site (no emitted function), so runtime page-local state still belongs to the calling component scope. Pass the FULL list — workflows omitted from the JSON are deleted. Pass the literal string "null" or \'[]\' to clear all workflows. Shape: [{ id, name, pageId?, params?, actions }] where id is a non-empty unique string (referenced by callWorkflow.workflowId), name is a human label (editor/debug only, not emitted), pageId is an optional page scope used by editor/tool validation for page-local state, params (Phase 3 §10 v6, optional) is an array of unique identifier strings the workflow\'s expressions may reference, paramDefaults (Phase 3 §10 v7, optional) is an object mapping a subset of those parameter names to default expression strings — a callWorkflow that omits the arg for a parameter with a default uses the default (caller-scope expression) instead of being dropped, optionalParams (Phase 3 §10 v8, optional) is an array of declared parameter names that may be omitted even without a default (each resolves to the literal `undefined` in the body rather than dropping the call), and actions is an ActionDef array (same shape as a node\'s event handler chain — supports setState/navigate/setVariable/apiCall/supabase*/condition/delay/stop/toast/confirm/clipboard and nested callWorkflow). To pass arguments, a callWorkflow action carries `args: { paramName: expressionString }` (caller-scope expressions); at compile time each parameter identifier in the workflow body is replaced by its argument expression. Every action is validated recursively; a malformed action or a duplicate id/param is rejected (no silent drops). Workflow existence + cycle (A→B→A) + missing/unknown argument checks happen at compile time (dropped with a warning), not here. One call → one undo entry. Example: set_workflows({ workflows_json: \'[{"id":"wf-notify","name":"Notify","params":["msg"],"actions":[{"id":"a1","kind":"toast","messageExpr":"msg","variant":"success"}]}]\' }) → { ok: true, data: { workflows: 1, actions: 1 } }. Clear example: set_workflows({ workflows_json: \'null\' }) → { ok: true, data: { workflows: 0, actions: 0 } }.',
  params: {
    workflows_json: {
      type: 'string',
      description:
        'JSON array [{ id, name, actions }], OR the literal string "null" / "[]" to clear.',
      required: true
    }
  },
  execute: (figma, args, ctx): ModifyResult<{ workflows: number; actions: number }> => {
    const parsed = parseJson(args.workflows_json, 'workflows_json')
    if (!parsed.ok) return fail(parsed.error)
    if (parsed.value === null) {
      applyPatchWithUndo(
        figma,
        figma.graph.rootId,
        { lowcodeWorkflows: undefined },
        'AI: set_workflows',
        ctx
      )
      return { ok: true, data: { workflows: 0, actions: 0 } }
    }
    const validPageIds = new Set(figma.graph.getPages().map((page) => page.id))
    const r = validateWorkflows('workflows_json', parsed.value, validPageIds)
    if (!r.ok) return r
    const actions = r.workflows.reduce((n, wf) => n + wf.actions.length, 0)
    // An empty list ([]) clears the field — keep absent ≡ no workflows so .fig
    // output stays byte-identical (isNonEmpty gate on the serialize side).
    applyPatchWithUndo(
      figma,
      figma.graph.rootId,
      { lowcodeWorkflows: r.workflows.length > 0 ? r.workflows : undefined },
      'AI: set_workflows',
      ctx
    )
    return { ok: true, data: { workflows: r.workflows.length, actions } }
  }
})
