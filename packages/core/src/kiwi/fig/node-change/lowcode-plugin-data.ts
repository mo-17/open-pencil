// Phase 1 §12: route lowcode SceneNode fields through pluginData so the .fig
// codec actually persists them. Phase 0 §2.5 promised this round-trip but
// the PR never landed — until this module, state / bindings / events /
// interactiveProps lived in editor memory only and were silently dropped on
// every save.
//
// All four values are JSON.stringify'd into PluginDataEntry.value strings
// stored under OPEN_PENCIL_PLUGIN_ID with keys in the `lowcode/<field>`
// namespace. Empty/undefined fields skip emission so .fig files that never
// touched the lowcode panel stay byte-identical (decision §12.3 #4).
//
// Step 1 (this file's serialize side) wires the save path; step 2 adds the
// read side in convert.ts.

import type { NodeChange } from '#core/kiwi/fig/codec'
import type { JsonObject } from '#core/types'
import type {
  ActionDef,
  BindingExpr,
  DocumentStateDef,
  EventName,
  GridPosition,
  LowcodeTranslations,
  NodeType,
  PluginDataEntry,
  ResponsiveOverrides,
  SceneGraph,
  SceneNode,
  StateDef,
  SupabaseConfig,
  WorkflowDef
} from '#core/scene-graph'

import { OPEN_PENCIL_PLUGIN_ID } from './plugin-data'

export const LOWCODE_STATE_KEY = 'lowcode/state'
export const LOWCODE_BINDINGS_KEY = 'lowcode/bindings'
export const LOWCODE_EVENTS_KEY = 'lowcode/events'
export const LOWCODE_INTERACTIVE_PROPS_KEY = 'lowcode/interactiveProps'
/** Phase 2 §9: optional per-node render-condition expression string. */
export const LOWCODE_RENDER_CONDITION_KEY = 'lowcode/renderCondition'
/** Phase 2 §2: document-level state declarations, attached to the root node only. */
export const LOWCODE_DOCUMENT_STATE_KEY = 'lowcode/documentState'
/** Phase 0 NodeType extensions that are NOT in the vendored Figma schema —
 *  kiwi serializes them as 'RECTANGLE' via `mapToFigmaType`'s default arm,
 *  so without this side-channel they all become rectangles after a save. */
export const LOWCODE_NODE_TYPE_KEY = 'lowcode/nodeType'
/** Phase 2 §6: `layoutMode: 'FREE'` is also outside the vendored Figma
 *  enum (`stackMode` carries HORIZONTAL/VERTICAL/undefined only — see
 *  `serialize.ts:285 serializeLayoutProps`). Presence of this flag (value
 *  must be boolean `true`) overrides the kiwi-restored `layoutMode` from
 *  whatever stack mode the schema gave back (typically NONE) to FREE. */
export const LOWCODE_FREE_LAYOUT_KEY = 'lowcode/freeLayout'
/** Phase 3 §2: Supabase connection settings carried on the root node only.
 *  Value is the JSON-encoded SupabaseConfig object ({ url, anonKey, schema? }).
 *  Absent ≡ no Supabase wiring → compiler skips the `_lowcode_supabase.ts`
 *  emit and `$currentUser` auto-registration. */
export const LOWCODE_SUPABASE_CONFIG_KEY = 'lowcode/supabaseConfig'
/** Round-trip fix: `LayoutSizing` carries `'FILL'`, but the vendored Figma
 *  `StackSize` enum only has FIXED / RESIZE_TO_FIT(+implicit) — so on save
 *  `serialize.ts` collapses HUG→RESIZE_TO_FIT and **everything else (incl.
 *  FILL) → FIXED**, silently dropping FILL on every reload. Same bypass as
 *  `lowcode/freeLayout`: persist the FILL axes out-of-band. Value is a JSON
 *  object `{ primary?: 'FILL', counter?: 'FILL' }` carrying only the FILL axes;
 *  absent ≡ neither axis is FILL → legacy .fig files stay byte-identical. */
export const LOWCODE_AXIS_SIZING_KEY = 'lowcode/axisSizing'
/** Round-trip fix: `counterAxisAlignContent: 'SPACE_BETWEEN'` (wrap cross-axis
 *  distribution) has no representable field in the vendored schema
 *  (`StackCounterAlign` lacks SPACE_BETWEEN and there is no
 *  `stackCounterAlignContent`), so it was never serialized and every reload
 *  reset it to 'AUTO', shifting WRAP rows. Value is the literal string
 *  `'SPACE_BETWEEN'`; absent ≡ 'AUTO'. */
export const LOWCODE_COUNTER_ALIGN_CONTENT_KEY = 'lowcode/counterAxisAlignContent'
/** Round-trip fix: a GRID child's `gridPosition` (column/row + spans) has no
 *  per-child field in the vendored schema (only container-level grid tracks /
 *  gaps / counts exist), so explicit placements were dropped and children
 *  re-flowed into auto-placement on reopen. Value is the JSON-encoded
 *  GridPosition; absent ≡ auto-placed (`gridPosition: null`). */
export const LOWCODE_GRID_POSITION_KEY = 'lowcode/gridPosition'
/** Phase 3 §7: per-breakpoint layout overrides (responsive design). Value is
 *  the JSON-encoded `ResponsiveOverrides` map (`{ md: { layoutMode, … }, … }`).
 *  Absent ≡ single (base) layout, so .fig files that never touched the
 *  responsive panel stay byte-identical. Structured field like state/bindings
 *  — restored straight onto the SceneNode, no separate codec override. */
export const LOWCODE_RESPONSIVE_OVERRIDES_KEY = 'lowcode/responsiveOverrides'
/** Phase 3 §9 v7: document-level translation catalog, attached to the root node
 *  only. Value is the JSON-encoded `LowcodeTranslations` map (`{ <locale>: {
 *  <sourceMessage>: <translated> } }`). Absent ≡ no authored translations, so
 *  .fig files that never touched the i18n panel stay byte-identical. */
export const LOWCODE_TRANSLATIONS_KEY = 'lowcode/translations'
/** Phase 3 §10 v4: document-level named workflows, attached to the root node
 *  only. Value is the JSON-encoded `WorkflowDef[]` array. Absent ≡ no authored
 *  workflows, so .fig files that never defined a workflow stay byte-identical. */
export const LOWCODE_WORKFLOWS_KEY = 'lowcode/workflows'
/** Phase 3 §8 v11: per-INSTANCE override table. Value is a JSON object keyed by
 *  the STABLE master-child id (`<masterChildId>:<prop>` → snapshot value), since
 *  instance child ids are reassigned on load. Restored via
 *  `reapplyInstanceOverrides` after `populateInstances`. */
export const LOWCODE_OVERRIDES_KEY = 'lowcode/overrides'

const LOWCODE_NODE_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
  'BUTTON',
  'INPUT',
  'CHECKBOX',
  'FORM',
  'LIST',
  'SELECT',
  // Phase 2 §8
  'RADIO',
  'TEXTAREA',
  'DATEPICKER',
  'SWITCH'
])

/** Set of pluginData keys this module owns. Step 2's read side uses it to
 *  decide which entries to absorb into structured SceneNode fields. */
export const LOWCODE_PLUGIN_KEYS: ReadonlySet<string> = new Set([
  LOWCODE_STATE_KEY,
  LOWCODE_BINDINGS_KEY,
  LOWCODE_EVENTS_KEY,
  LOWCODE_INTERACTIVE_PROPS_KEY,
  LOWCODE_RENDER_CONDITION_KEY,
  LOWCODE_DOCUMENT_STATE_KEY,
  LOWCODE_NODE_TYPE_KEY,
  LOWCODE_FREE_LAYOUT_KEY,
  LOWCODE_SUPABASE_CONFIG_KEY,
  LOWCODE_AXIS_SIZING_KEY,
  LOWCODE_COUNTER_ALIGN_CONTENT_KEY,
  LOWCODE_GRID_POSITION_KEY,
  LOWCODE_RESPONSIVE_OVERRIDES_KEY,
  LOWCODE_TRANSLATIONS_KEY,
  LOWCODE_WORKFLOWS_KEY,
  LOWCODE_OVERRIDES_KEY
])

/**
 * Build the pluginData entries that mirror this node's lowcode fields. Order
 * is stable so two saves of the same in-memory graph produce byte-identical
 * .fig output. New keys are appended at the end so older .fig files re-saved
 * after upgrade keep their original key ordering when the new field is empty.
 *
 * Order: nodeType → state → bindings → events → interactiveProps →
 * renderCondition (Phase 2 §9) → documentState (Phase 2 §2).
 */
export function serializeLowcodeFields(node: SceneNode): PluginDataEntry[] {
  const entries: PluginDataEntry[] = []
  if (LOWCODE_NODE_TYPES.has(node.type)) {
    entries.push(makeEntry(LOWCODE_NODE_TYPE_KEY, node.type))
  }
  if (isNonEmpty(node.state)) entries.push(makeEntry(LOWCODE_STATE_KEY, node.state))
  if (isNonEmpty(node.bindings)) entries.push(makeEntry(LOWCODE_BINDINGS_KEY, node.bindings))
  if (isNonEmpty(node.events)) entries.push(makeEntry(LOWCODE_EVENTS_KEY, node.events))
  if (isNonEmpty(node.interactiveProps)) {
    entries.push(makeEntry(LOWCODE_INTERACTIVE_PROPS_KEY, node.interactiveProps))
  }
  if (typeof node.renderCondition === 'string' && node.renderCondition !== '') {
    entries.push(makeEntry(LOWCODE_RENDER_CONDITION_KEY, node.renderCondition))
  }
  if (isNonEmpty(node.lowcodeDocumentState)) {
    entries.push(makeEntry(LOWCODE_DOCUMENT_STATE_KEY, node.lowcodeDocumentState))
  }
  // Phase 2 §6: persist the FREE flag only when explicitly set; absent ≡
  // false. Legacy .fig files without the flag stay byte-identical
  // (decision §12.3 #4 + §6 risk-mitigation).
  if (node.layoutMode === 'FREE') {
    entries.push(makeEntry(LOWCODE_FREE_LAYOUT_KEY, true))
  }
  // Phase 3 §2: Supabase config on the root node. Absent → no entry written
  // → legacy .fig files without Supabase wiring stay byte-identical.
  if (isSupabaseConfig(node.lowcodeSupabaseConfig)) {
    entries.push(makeEntry(LOWCODE_SUPABASE_CONFIG_KEY, node.lowcodeSupabaseConfig))
  }
  // Round-trip fix: persist FILL axis sizing the vendored StackSize enum can't
  // hold. Only the FILL axes are written; if neither is FILL no entry is
  // emitted, keeping legacy .fig output byte-identical.
  const axisSizing = fillAxisSizing(node)
  if (axisSizing) entries.push(makeEntry(LOWCODE_AXIS_SIZING_KEY, axisSizing))
  // Round-trip fix: persist counterAxisAlignContent SPACE_BETWEEN (no schema
  // field). 'AUTO' (the default) writes nothing.
  if (node.counterAxisAlignContent === 'SPACE_BETWEEN') {
    entries.push(makeEntry(LOWCODE_COUNTER_ALIGN_CONTENT_KEY, 'SPACE_BETWEEN'))
  }
  // Round-trip fix: persist an explicit GRID child placement (no per-child
  // schema field). `null` (auto-placed) writes nothing.
  if (node.gridPosition) entries.push(makeEntry(LOWCODE_GRID_POSITION_KEY, node.gridPosition))
  // Phase 3 §7: per-breakpoint responsive overrides. Empty/absent map writes
  // nothing → non-responsive .fig files stay byte-identical.
  if (isNonEmpty(node.responsiveOverrides)) {
    entries.push(makeEntry(LOWCODE_RESPONSIVE_OVERRIDES_KEY, node.responsiveOverrides))
  }
  // Phase 3 §9 v7: document-level translation catalog (root node only). Empty/
  // absent map writes nothing → non-translated .fig files stay byte-identical.
  if (isNonEmpty(node.lowcodeTranslations)) {
    entries.push(makeEntry(LOWCODE_TRANSLATIONS_KEY, node.lowcodeTranslations))
  }
  // Phase 3 §10 v4: document-level named workflows (root node only). Empty/
  // absent array writes nothing → .fig files without workflows stay
  // byte-identical.
  if (isNonEmpty(node.lowcodeWorkflows)) {
    entries.push(makeEntry(LOWCODE_WORKFLOWS_KEY, node.lowcodeWorkflows))
  }
  return entries
}

/**
 * Phase 3 §8 v11: serialize an INSTANCE's `overrides` table for round-trip.
 * `node.overrides` is keyed by the (unstable) instance-child id; we resolve each
 * to its master-child id (`componentId`, stable) and snapshot the child's CURRENT
 * value for that prop, so on load we can re-apply it onto the freshly cloned
 * child. Returns null for non-instances / empty overrides (legacy .fig stays
 * byte-identical). Needs the graph to resolve child ids, so it's separate from
 * `serializeLowcodeFields`. */
export function serializeInstanceOverrides(node: SceneNode, graph: SceneGraph): PluginDataEntry | null {
  if (node.type !== 'INSTANCE') return null
  const keys = Object.keys(node.overrides)
  if (keys.length === 0) return null
  const table: Record<string, unknown> = {}
  for (const key of keys) {
    const colon = key.lastIndexOf(':')
    if (colon === -1) continue
    const instChild = graph.getNode(key.slice(0, colon))
    if (!instChild) continue
    // Key by the descendant's index-path within the instance (stable across
    // save/load: node ids are remapped, but `populateInstances` re-clones the
    // master structure in the same order). value = the child's current value.
    const path = childIndexPath(graph, node.id, instChild.id)
    if (!path) continue
    const prop = key.slice(colon + 1)
    table[`${path.join('.')}:${prop}`] = instChild[prop as keyof SceneNode]
  }
  if (Object.keys(table).length === 0) return null
  return makeEntry(LOWCODE_OVERRIDES_KEY, table)
}

/** The child-index path from `ancestorId` down to `descendantId` (e.g. [0,2] =
 *  first child's third child), or null if not a descendant. Empty array when
 *  they are the same node. */
function childIndexPath(graph: SceneGraph, ancestorId: string, descendantId: string): number[] | null {
  const path: number[] = []
  let cur = graph.getNode(descendantId)
  while (cur && cur.id !== ancestorId) {
    const parent = cur.parentId ? graph.getNode(cur.parentId) : undefined
    if (!parent) return null
    const idx = parent.childIds.indexOf(cur.id)
    if (idx === -1) return null
    path.unshift(idx)
    cur = parent
  }
  return cur ? path : null
}

/**
 * Phase 3 §8 v11: re-apply instance overrides restored from `lowcode/overrides`,
 * AFTER `populateInstances` has re-cloned each instance's children from its
 * master (which resets them to master values + new ids). For every instance
 * carrying a `pendingInstanceOverrides` snapshot, map each `<masterChildId>:<prop>`
 * entry to the freshly cloned descendant whose `componentId === masterChildId`,
 * set that child's prop to the snapshot value, and rebuild `node.overrides` keyed
 * by the new child id. Clears the pending field so it is idempotent. */
export function reapplyInstanceOverrides(graph: SceneGraph): void {
  for (const node of graph.getAllNodes()) {
    const pending = node.pendingInstanceOverrides
    if (node.type !== 'INSTANCE' || !pending) continue
    const remapped: Record<string, unknown> = {}
    for (const key of Object.keys(pending)) {
      const colon = key.lastIndexOf(':')
      if (colon === -1) continue
      const child = resolveChildByPath(graph, node.id, key.slice(0, colon))
      if (!child) continue
      const prop = key.slice(colon + 1)
      const value = pending[key]
      graph.updateNode(child.id, { [prop]: value } as Partial<SceneNode>)
      remapped[`${child.id}:${prop}`] = value
    }
    node.overrides = remapped
    delete node.pendingInstanceOverrides
  }
}

/** Walk a dot-separated child-index path (`"0.2"`) from `rootId` to the target
 *  descendant. Returns undefined if any index is out of range. */
function resolveChildByPath(graph: SceneGraph, rootId: string, path: string): SceneNode | undefined {
  let cur = graph.getNode(rootId)
  if (path === '') return cur
  for (const part of path.split('.')) {
    if (!cur) return undefined
    const idx = Number(part)
    const childId = cur.childIds[idx]
    cur = childId ? graph.getNode(childId) : undefined
  }
  return cur
}

/** Returns the FILL axes of an auto-layout node as `{ primary?, counter? }`,
 *  or `undefined` when neither axis is FILL (so no pluginData is emitted). */
function fillAxisSizing(node: SceneNode): { primary?: 'FILL'; counter?: 'FILL' } | undefined {
  const out: { primary?: 'FILL'; counter?: 'FILL' } = {}
  if (node.primaryAxisSizing === 'FILL') out.primary = 'FILL'
  if (node.counterAxisSizing === 'FILL') out.counter = 'FILL'
  return out.primary || out.counter ? out : undefined
}

function isSupabaseConfig(value: unknown): value is SupabaseConfig {
  if (value === null || typeof value !== 'object') return false
  const v = value as JsonObject
  return typeof v.url === 'string' && v.url !== '' && typeof v.anonKey === 'string' && v.anonKey !== ''
}

function makeEntry(key: string, value: unknown): PluginDataEntry {
  return { pluginId: OPEN_PENCIL_PLUGIN_ID, key, value: JSON.stringify(value) }
}

function isNonEmpty(value: unknown): boolean {
  if (value === undefined) return false
  if (Array.isArray(value)) return value.length > 0
  if (value !== null && typeof value === 'object') return Object.keys(value).length > 0
  return true
}

/**
 * Read side of the §12 round-trip. Walks `nc.pluginData`, splitting entries
 * into two buckets:
 *
 *   - Entries we own (`pluginID === OPEN_PENCIL_PLUGIN_ID` AND `key` is one of
 *     the known LOWCODE_PLUGIN_KEYS): JSON.parse'd into the structured
 *     SceneNode field they correspond to. The raw entry is **removed** from
 *     the returned pluginData so the in-memory SceneNode keeps a single
 *     source of truth for these fields.
 *   - Everything else (other plugins, unknown future `lowcode/…` keys, our
 *     own non-lowcode keys like `textDirection`): passes through unchanged,
 *     after the codec `pluginID` → entry `pluginId` casing flip.
 *
 * JSON.parse failures: the offending entry is dropped from both buckets and
 * a `console.warn` is logged so the failure isn't silent. The other lowcode
 * entries on the same node continue to parse normally.
 */
export interface ExtractedLowcodeAndPluginData {
  pluginData: PluginDataEntry[]
  /** Override for `mapNodeType`'s 'RECTANGLE' fallback. Present only when
   *  the SceneNode was one of the lowcode interactive types on save. */
  nodeTypeOverride?: NodeType
  state?: StateDef[]
  bindings?: Record<string, BindingExpr>
  events?: Partial<Record<EventName, ActionDef[]>>
  interactiveProps?: Record<string, unknown>
  renderCondition?: string
  /** Phase 2 §2: document-level state declarations (only the root node
   *  carries this in practice; on other nodes it stays undefined). */
  lowcodeDocumentState?: DocumentStateDef[]
  /** Phase 2 §6: when present, callers must override the kiwi-restored
   *  `layoutMode` to `'FREE'`. The vendored schema can only carry
   *  HORIZONTAL/VERTICAL/undefined in `stackMode`, so we store FREE
   *  out-of-band via the `lowcode/freeLayout` flag and restore here. */
  freeLayoutOverride?: true
  /** Phase 3 §2: Supabase connection config restored from
   *  `lowcode/supabaseConfig`. Present only when the saved value passed
   *  the type guard (object with non-empty `url` and `anonKey`). */
  lowcodeSupabaseConfig?: SupabaseConfig
  /** Round-trip fix: FILL axes restored from `lowcode/axisSizing`. Callers
   *  override the kiwi-restored (FIXED) sizing for whichever axis is present. */
  primaryAxisSizingOverride?: 'FILL'
  counterAxisSizingOverride?: 'FILL'
  /** Round-trip fix: present (always `'SPACE_BETWEEN'`) when the saved node had
   *  that wrap distribution; callers override the kiwi-restored 'AUTO'. */
  counterAxisAlignContentOverride?: 'SPACE_BETWEEN'
  /** Round-trip fix: explicit GRID child placement restored from
   *  `lowcode/gridPosition`. Present only when the saved value had the four
   *  numeric placement fields. */
  gridPositionOverride?: GridPosition
  /** Phase 3 §7: per-breakpoint responsive overrides. Structured field — flows
   *  straight onto the SceneNode via `...lowcodeRest` (no codec override). */
  responsiveOverrides?: ResponsiveOverrides
  /** Phase 3 §9 v7: document-level translation catalog (root node only).
   *  Restored onto the root via `assignImportedLowcodeFields`; on regular nodes
   *  it flows through `...lowcodeRest` (harmless — root-only in practice). */
  lowcodeTranslations?: LowcodeTranslations
  /** Phase 3 §10 v4: document-level named workflows (root node only). Restored
   *  onto the root via `assignImportedLowcodeFields`; on regular nodes it flows
   *  through `...lowcodeRest` (harmless — root-only in practice). */
  lowcodeWorkflows?: WorkflowDef[]
  /** Phase 3 §8 v11: per-instance override snapshot (keyed by master-child id).
   *  Flows onto the node via `...lowcodeRest` as `pendingInstanceOverrides`, then
   *  `reapplyInstanceOverrides` remaps it after populate. */
  pendingInstanceOverrides?: Record<string, unknown>
}

export function extractLowcodeAndPluginData(
  nc: Pick<NodeChange, 'pluginData'>
): ExtractedLowcodeAndPluginData {
  const pluginData: PluginDataEntry[] = []
  const result: ExtractedLowcodeAndPluginData = { pluginData }
  for (const entry of nc.pluginData ?? []) {
    const isOurs =
      entry.pluginID === OPEN_PENCIL_PLUGIN_ID && LOWCODE_PLUGIN_KEYS.has(entry.key)
    if (!isOurs) {
      pluginData.push({ pluginId: entry.pluginID, key: entry.key, value: entry.value })
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(entry.value)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      console.warn(
        `[lowcode] failed to parse pluginData "${entry.key}": ${reason}; dropping entry`
      )
      continue
    }
    assignLowcodeField(result, entry.key, parsed)
  }
  return result
}

function assignLowcodeField(
  target: ExtractedLowcodeAndPluginData,
  key: string,
  value: unknown
): void {
  switch (key) {
    case LOWCODE_NODE_TYPE_KEY:
      if (typeof value === 'string' && LOWCODE_NODE_TYPES.has(value as NodeType)) {
        target.nodeTypeOverride = value as NodeType
      }
      return
    case LOWCODE_STATE_KEY:
      target.state = value as StateDef[]
      return
    case LOWCODE_BINDINGS_KEY:
      target.bindings = value as Record<string, BindingExpr>
      return
    case LOWCODE_EVENTS_KEY:
      target.events = value as Partial<Record<EventName, ActionDef[]>>
      return
    case LOWCODE_INTERACTIVE_PROPS_KEY:
      target.interactiveProps = value as JsonObject
      return
    case LOWCODE_RENDER_CONDITION_KEY:
      if (typeof value === 'string') target.renderCondition = value
      return
    case LOWCODE_DOCUMENT_STATE_KEY:
      target.lowcodeDocumentState = value as DocumentStateDef[]
      return
    case LOWCODE_FREE_LAYOUT_KEY:
      // Strict boolean-true gate — anything else is treated as absent so a
      // hand-edited / malformed .fig doesn't accidentally toggle FREE.
      if (value === true) target.freeLayoutOverride = true
      return
    case LOWCODE_SUPABASE_CONFIG_KEY:
      // Strict type-guard same as the write side: object with non-empty
      // `url` and `anonKey`. Anything else (corrupt JSON, schema mismatch)
      // is treated as absent rather than dropped silently — the read-side
      // JSON.parse already logged a warn for true parse failures.
      if (isSupabaseConfig(value)) target.lowcodeSupabaseConfig = value
      return
    case LOWCODE_TRANSLATIONS_KEY:
      // Light guard: a non-null, non-array object. Per-locale / per-message
      // shape isn't strictly validated here — the compiler emit only reads
      // string values via `?? source` fallback, so a stray non-string is
      // harmless. The write path (`set_translations`) validates strictly.
      if (isLowcodeTranslations(value)) target.lowcodeTranslations = value
      return
    case LOWCODE_WORKFLOWS_KEY:
      // Light guard: an array of plain objects. Per-action shape isn't strictly
      // validated here — the IR collect pass drops malformed actions with a
      // warning. The write path (`set_workflows`) validates strictly.
      if (isLowcodeWorkflows(value)) target.lowcodeWorkflows = value
      return
    default:
      // Layout round-trip fixes (axis sizing / counter-align / grid placement)
      // and §7 responsive overrides — grouped out to keep this switch under
      // the complexity limit.
      assignLowcodeLayoutFix(target, key, value)
  }
}

function assignLowcodeLayoutFix(
  target: ExtractedLowcodeAndPluginData,
  key: string,
  value: unknown
): void {
  switch (key) {
    case LOWCODE_AXIS_SIZING_KEY:
      assignFillAxisSizing(target, value)
      return
    case LOWCODE_COUNTER_ALIGN_CONTENT_KEY:
      if (value === 'SPACE_BETWEEN') target.counterAxisAlignContentOverride = 'SPACE_BETWEEN'
      return
    case LOWCODE_RESPONSIVE_OVERRIDES_KEY:
      if (isResponsiveOverrides(value)) target.responsiveOverrides = value
      return
    case LOWCODE_GRID_POSITION_KEY:
      if (isGridPosition(value)) target.gridPositionOverride = value
      return
    case LOWCODE_OVERRIDES_KEY:
      // Phase 3 §8 v11: per-instance override snapshot (`<path>:<prop>` → value).
      // Light guard (non-null, non-array object); remapped onto cloned children by
      // `reapplyInstanceOverrides` after populate, where unknown paths just no-op.
      if (isPlainRecord(value)) target.pendingInstanceOverrides = value
  }
}

/** Light guard: a non-null, non-array object. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Light guard: a non-null, non-array object. The emit side only iterates the
 *  known breakpoint keys (`sm`/`md`/`lg`/`xl`), so any stray keys are ignored
 *  harmlessly; we just reject scalars/arrays from a corrupt .fig. */
function isResponsiveOverrides(value: unknown): value is ResponsiveOverrides {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Light guard: a non-null, non-array object (locale → message map). The emit
 *  side reads string values defensively (`?? source`), so loose shape is safe;
 *  strict per-message validation lives on the write path (`set_translations`). */
function isLowcodeTranslations(value: unknown): value is LowcodeTranslations {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Light guard: an array of plain objects (`WorkflowDef[]`). Per-workflow /
 *  per-action shape isn't validated here — the IR collect pass drops malformed
 *  actions with a warning, and the write path (`set_workflows`) validates
 *  strictly. We only reject non-arrays from a corrupt .fig. */
function isLowcodeWorkflows(value: unknown): value is WorkflowDef[] {
  return Array.isArray(value) && value.every((w) => w !== null && typeof w === 'object')
}

/** Strict guard: all four placement fields must be finite numbers, else the
 *  malformed value is treated as absent (child stays auto-placed). */
function isGridPosition(value: unknown): value is GridPosition {
  if (value === null || typeof value !== 'object') return false
  const v = value as JsonObject
  return (
    typeof v.column === 'number' &&
    typeof v.row === 'number' &&
    typeof v.columnSpan === 'number' &&
    typeof v.rowSpan === 'number'
  )
}

/** Read side of {@link fillAxisSizing}. Strict guard: only the literal 'FILL'
 *  per axis is honored — a malformed value leaves the kiwi-restored (FIXED)
 *  sizing untouched. */
function assignFillAxisSizing(target: ExtractedLowcodeAndPluginData, value: unknown): void {
  if (value === null || typeof value !== 'object') return
  const v = value as JsonObject
  if (v.primary === 'FILL') target.primaryAxisSizingOverride = 'FILL'
  if (v.counter === 'FILL') target.counterAxisSizingOverride = 'FILL'
}
