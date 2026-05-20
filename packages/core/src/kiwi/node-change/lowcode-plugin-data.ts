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

import type { PluginDataEntry, SceneNode } from '#core/scene-graph'

import { OPEN_PENCIL_PLUGIN_ID } from './plugin-data'

export const LOWCODE_STATE_KEY = 'lowcode/state'
export const LOWCODE_BINDINGS_KEY = 'lowcode/bindings'
export const LOWCODE_EVENTS_KEY = 'lowcode/events'
export const LOWCODE_INTERACTIVE_PROPS_KEY = 'lowcode/interactiveProps'

/** Set of pluginData keys this module owns. Step 2's read side uses it to
 *  decide which entries to absorb into structured SceneNode fields. */
export const LOWCODE_PLUGIN_KEYS: ReadonlySet<string> = new Set([
  LOWCODE_STATE_KEY,
  LOWCODE_BINDINGS_KEY,
  LOWCODE_EVENTS_KEY,
  LOWCODE_INTERACTIVE_PROPS_KEY
])

/**
 * Build the pluginData entries that mirror this node's lowcode fields. Order
 * is stable (state → bindings → events → interactiveProps) so two saves of
 * the same in-memory graph produce byte-identical .fig output.
 */
export function serializeLowcodeFields(node: SceneNode): PluginDataEntry[] {
  const entries: PluginDataEntry[] = []
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
