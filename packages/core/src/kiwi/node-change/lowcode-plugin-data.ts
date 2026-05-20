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

import type { NodeChange } from '#core/kiwi/binary/codec'
import type {
  ActionDef,
  BindingExpr,
  EventName,
  NodeType,
  PluginDataEntry,
  SceneNode,
  StateDef
} from '#core/scene-graph'

import { OPEN_PENCIL_PLUGIN_ID } from './plugin-data'

export const LOWCODE_STATE_KEY = 'lowcode/state'
export const LOWCODE_BINDINGS_KEY = 'lowcode/bindings'
export const LOWCODE_EVENTS_KEY = 'lowcode/events'
export const LOWCODE_INTERACTIVE_PROPS_KEY = 'lowcode/interactiveProps'
/** Phase 0 NodeType extensions that are NOT in the vendored Figma schema —
 *  kiwi serializes them as 'RECTANGLE' via `mapToFigmaType`'s default arm,
 *  so without this side-channel they all become rectangles after a save. */
export const LOWCODE_NODE_TYPE_KEY = 'lowcode/nodeType'

const LOWCODE_NODE_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
  'BUTTON',
  'INPUT',
  'CHECKBOX',
  'FORM',
  'LIST',
  'SELECT'
])

/** Set of pluginData keys this module owns. Step 2's read side uses it to
 *  decide which entries to absorb into structured SceneNode fields. */
export const LOWCODE_PLUGIN_KEYS: ReadonlySet<string> = new Set([
  LOWCODE_STATE_KEY,
  LOWCODE_BINDINGS_KEY,
  LOWCODE_EVENTS_KEY,
  LOWCODE_INTERACTIVE_PROPS_KEY,
  LOWCODE_NODE_TYPE_KEY
])

/**
 * Build the pluginData entries that mirror this node's lowcode fields. Order
 * is stable (state → bindings → events → interactiveProps) so two saves of
 * the same in-memory graph produce byte-identical .fig output.
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
  return entries
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
   *  the SceneNode was one of the 6 lowcode types on save. */
  nodeTypeOverride?: NodeType
  state?: StateDef[]
  bindings?: Record<string, BindingExpr>
  events?: Partial<Record<EventName, ActionDef[]>>
  interactiveProps?: Record<string, unknown>
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
      target.interactiveProps = value as Record<string, unknown>
      return
  }
}
