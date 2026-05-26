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
  validateExpression,
  validateStateName,
  validateSupabaseConfig,
  validateUrlTemplate
} from '#core/lowcode-validation'
import type {
  ActionDef,
  ActionKind,
  BindingExpr,
  EventName,
  SceneNode,
  StateDef,
  StateValueType,
  SupabaseConfig,
  SupabaseFilter
} from '#core/scene-graph'

type BindingKind = BindingExpr['kind']
// `SupabaseFilter.op` is an inline literal union on the interface; mirror
// it as a Set here for runtime validation. Keep this in sync with
// `SupabaseFilter.op` in `scene-graph/types.ts` (Phase 3 §2).
type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'in'
import { defineTool, type ToolCtx } from '#core/tools/schema'

type ModifyResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string }

const KNOWN_ACTION_KINDS = new Set<ActionKind>([
  'setState',
  'navigate',
  'setVariable',
  'apiCall',
  'supabaseQuery',
  'supabaseMutation'
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

const KNOWN_FILTER_OPS = new Set<FilterOp>([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'like',
  'in'
])

const KNOWN_MUTATION_OPS = new Set<string>(['insert', 'upsert', 'update', 'delete'])

// Patch fields the tool understands. Anything else in the patch is a
// reject — we don't silently drop unknown keys, otherwise AI typos turn
// into silent no-ops that look like "the change didn't apply" bugs.
const PATCH_KEYS = new Set([
  'state',
  'bindings',
  'events',
  'interactiveProps',
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

function parseJson(src: string, what: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(src) }
  } catch (err) {
    return {
      ok: false,
      error: `${what} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    }
  }
}

function validateBindingExpr(channel: string, value: unknown): { ok: true; binding: BindingExpr } | { ok: false; error: string } {
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
  }
  return { ok: true }
}

function validateActionShape(
  eventName: string,
  index: number,
  value: unknown
): { ok: true; action: ActionDef } | { ok: false; error: string } {
  const where = `events.${eventName}[${index}]`
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
  if (kind === 'setState' || kind === 'setVariable') {
    const r = validateValueExpr(where, value)
    if (!r.ok) return r
  } else if (kind === 'apiCall') {
    const r = validateApiCallUrl(where, value)
    if (!r.ok) return r
  } else if (kind === 'supabaseQuery' || kind === 'supabaseMutation') {
    const r = validateSupabaseAction(where, kind, value)
    if (!r.ok) return r
  }
  return { ok: true, action: buildActionFromValidated(value.id, kind as ActionKind, value) }
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
      return { id, kind, to: raw.to as string | undefined }
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
        targetName: raw.targetName as string
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
        errorTarget: raw.errorTarget as string | undefined
      }
    case 'supabaseMutation':
      return {
        id,
        kind,
        operation: raw.operation as 'insert' | 'update' | 'delete' | 'upsert',
        table: raw.table as string,
        payloadJson: raw.payloadJson as string | undefined,
        filters: raw.filters as SupabaseFilter[] | undefined,
        resultTarget: raw.resultTarget as string | undefined,
        errorTarget: raw.errorTarget as string | undefined
      }
    default: {
      // Exhaustive — ActionKind has exactly the 6 variants above. The
      // assignment proves it to TypeScript and the throw matches the
      // ts-eslint(consistent-return) rule for switch-based dispatch.
      const _exhaustive: never = kind
      throw new Error(`unreachable action kind: ${String(_exhaustive)}`)
    }
  }
}

function validateStateDecls(
  what: string,
  raw: unknown,
  rejectDollarPrefix: boolean
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
    decls.push({
      id: entry.id,
      name: entry.name,
      type: entry.type as StateValueType,
      defaultValue: entry.defaultValue
    })
  }
  return { ok: true, decls }
}

function validateRenderCondition(value: unknown): { ok: true; expr: string } | { ok: false; error: string } {
  if (typeof value !== 'string') return { ok: false, error: 'renderCondition must be a string' }
  if (value === '') return { ok: true, expr: '' }
  const r = validateExpression(value)
  if (!r.ok) return { ok: false, error: `renderCondition — ${r.reason}` }
  return { ok: true, expr: value }
}

type FieldResult = { ok: true } | { ok: false; error: string }

function applyStateField(raw: Record<string, unknown>, patch: Partial<SceneNode>): FieldResult {
  if (!('state' in raw)) return { ok: true }
  if (raw.state === null) {
    patch.state = undefined
    return { ok: true }
  }
  const r = validateStateDecls('state', raw.state, false)
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

function applyInteractivePropsField(raw: Record<string, unknown>, patch: Partial<SceneNode>): FieldResult {
  if (!('interactiveProps' in raw)) return { ok: true }
  if (raw.interactiveProps === null) {
    patch.interactiveProps = undefined
    return { ok: true }
  }
  if (!isPlainObject(raw.interactiveProps)) return fail('interactiveProps must be an object')
  patch.interactiveProps = raw.interactiveProps
  return { ok: true }
}

function applyRenderConditionField(raw: Record<string, unknown>, patch: Partial<SceneNode>): FieldResult {
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
  const r = validateStateDecls('lowcodeDocumentState', raw.lowcodeDocumentState, true)
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

function applySupabaseConfigField(raw: Record<string, unknown>, patch: Partial<SceneNode>): FieldResult {
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
  applyRenderConditionField,
  applyDocStateField,
  applySupabaseConfigField
]

/**
 * Validate a partial lowcode patch and build the `Partial<SceneNode>`
 * payload to hand to `graph.updateNode`. Unknown keys are rejected
 * (rather than silently dropped) so AI typos surface as clear errors.
 */
function buildPatch(raw: Record<string, unknown>): ModifyResult<Partial<SceneNode>> {
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
  if (!ctx?.editor) {
    figma.graph.updateNode(nodeId, patch)
    return
  }
  const editor = ctx.editor
  const node = editor.graph.getNode(nodeId)
  if (!node) {
    figma.graph.updateNode(nodeId, patch)
    return
  }
  const keys = Object.keys(patch) as (keyof SceneNode)[]
  const previous = Object.fromEntries(
    keys.map((key) => [key, structuredClone(node[key])])
  ) as Partial<SceneNode>
  editor.graph.updateNode(nodeId, patch)
  editor.undo.push({
    label,
    forward: () => editor.graph.updateNode(nodeId, patch),
    inverse: () => editor.graph.updateNode(nodeId, previous)
  })
}

export const updateLowcodeNode = defineTool({
  name: 'update_lowcode_node',
  mutates: true,
  description:
    "Update the lowcode-specific fields of a single SceneNode in one atomic commit. Fields not listed in the patch are left UNCHANGED (no implicit clearing); to clear a field, set its value to null explicitly. Allowed patch keys: state, bindings, events, interactiveProps, renderCondition, lowcodeDocumentState (root only), lowcodeSupabaseConfig (root only). Every input is validated at the tool boundary: state names go through validateStateName ($-prefix reserved for built-ins), bindings.expr / actions.valueExpr / renderCondition go through the Phase 0 expression sublanguage parser, apiCall urls through the §4 template parser, supabaseConfig through validateSupabaseConfig which hard-rejects service_role JWTs. Unknown patch keys are rejected (no silent drops). One call → one undo entry. IMPORTANT: setVariable.valueExpr identifiers can ONLY resolve to declared page-state names plus `$prev` (the functional-update previous-value placeholder for the doc-state being written) — doc-state names are NOT in scope inside setVariable.valueExpr and a reference to one is silently dropped by the IR walker (`action-setvariable-unknown-identifier`), even though the tool accepts the patch as ok. Use `$prev` for self-referential updates (e.g. `$prev + 1` to increment, `$prev` to pass-through). setState.valueExpr has no such restriction. IMPORTANT (Phase 3 §3.x): on an INPUT node, setting bindings.value to { kind: 'docState', docStateName: '<name>' } or { kind: 'ref', stateId: '<id>' } makes the input controlled — the compiler emits `value={read}` plus a synthesized `onChange` that calls setDocState / the page-state setter with `e.target.value` (string targets) or `Number(e.target.value)` (number targets). The referenced docState / page-state MUST be type 'string' or 'number'; number-typed targets additionally make the compiler emit `<input type=\"number\">` on the HTML side. Other types (boolean / array / object) and the literal / expr kinds are rejected at IR collect time with a warning and the input falls back to uncontrolled emit. A controlled INPUT's user-defined onChange handler is dropped (with an `input-controlled-onchange-conflict` warning) so the synthesized writer stays the single source of truth. This is the only path for capturing runtime input values into state today — other interactive types (TEXTAREA / SELECT / CHECKBOX / RADIO / DATEPICKER / SWITCH) have no controlled binding yet. Example: update_lowcode_node({ id: 'btn-1', patch_json: '{\"interactiveProps\":{\"text\":\"Submit\"},\"events\":{\"onClick\":[{\"id\":\"a-1\",\"kind\":\"navigate\",\"to\":\"/done\"}]}}' }) → { ok: true, data: { id: 'btn-1', updated: ['interactiveProps', 'events'] } }. Clearing example: '{\"renderCondition\":null}' clears the renderCondition.",
  params: {
    id: { type: 'string', description: 'Node id', required: true },
    patch_json: {
      type: 'string',
      description:
        'JSON object: any subset of {state, bindings, events, interactiveProps, renderCondition, lowcodeDocumentState, lowcodeSupabaseConfig}. Use null as a value to clear a field.',
      required: true
    }
  },
  execute: (figma, args, ctx): ModifyResult<{ id: string; updated: string[] }> => {
    const node = figma.graph.getNode(args.id)
    if (!node) return fail(`Node "${args.id}" not found`)
    const parsed = parseJson(args.patch_json, 'patch_json')
    if (!parsed.ok) return fail(parsed.error)
    if (!isPlainObject(parsed.value)) return fail('patch_json must be a JSON object')
    const built = buildPatch(parsed.value)
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
    "Replace the root node's lowcodeDocumentState array wholesale. Pass the FULL list — entries omitted from the JSON are deleted (decision §3.2 #b: no per-entry diff in MVP; preserve existing entries by including them again). Each entry needs {id, name, type, defaultValue}; name goes through validateStateName which rejects empty / non-identifier / $-prefixed names ($currentUser etc. are reserved). Type is one of string / number / boolean / array / object. Duplicate names or duplicate ids are rejected. Example: set_doc_states({ states_json: '[{\"id\":\"d-1\",\"name\":\"count\",\"type\":\"number\",\"defaultValue\":0},{\"id\":\"d-2\",\"name\":\"items\",\"type\":\"array\",\"defaultValue\":[]}]' }) → { ok: true, data: { count: 2 } }. Clear all with states_json: '[]'.",
  params: {
    states_json: {
      type: 'string',
      description:
        'JSON array of DocumentStateDef: [{id, name, type, defaultValue}]. Pass [] to clear.',
      required: true
    }
  },
  execute: (figma, args, ctx): ModifyResult<{ count: number }> => {
    const parsed = parseJson(args.states_json, 'states_json')
    if (!parsed.ok) return fail(parsed.error)
    const validated = validateStateDecls('states_json', parsed.value, true)
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
    "Replace the root node's lowcodeSupabaseConfig wholesale. Pass JSON `null` (literal string \"null\") to clear the config entirely (decision §3.2 #d). Otherwise pass {url, anonKey, schema?} — anonKey MUST be the anon (public) key; a service_role JWT is hard-rejected at this tool boundary, never persists (decision §3.2 #h, mirrors SupabaseConfigPanel.vue rejection logic via shared validateSupabaseConfig). url must start with http:// or https://. Example: set_supabase_config({ config_json: '{\"url\":\"https://abc.supabase.co\",\"anonKey\":\"eyJ.anon.signature\"}' }) → { ok: true, data: { cleared: false } }. Clear example: set_supabase_config({ config_json: 'null' }) → { ok: true, data: { cleared: true } }.",
  params: {
    config_json: {
      type: 'string',
      description:
        'JSON object {url, anonKey, schema?} OR the literal string "null" to clear.',
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
