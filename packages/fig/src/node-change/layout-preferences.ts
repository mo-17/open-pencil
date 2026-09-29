import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import type { GridTrack, SceneNode } from '@open-pencil/scene-graph'

import { getOpenPencilPluginValue, OPEN_PENCIL_PLUGIN_ID, upsertPluginData } from './plugin-data'

const KEY = 'layoutPreferences'
const GRID_KEYS = [
  'gridTemplateColumns',
  'gridTemplateRows',
  'gridColumnGap',
  'gridRowGap'
] as const
const KEYS = new Set<string>(['version', 'counterAxisAlign', ...GRID_KEYS])
type Preferences = Partial<Pick<SceneNode, (typeof GRID_KEYS)[number] | 'counterAxisAlign'>>

export function hasNativeLayoutPreferences(node: SceneNode): boolean {
  return (
    node.layoutMode === 'HORIZONTAL' ||
    node.layoutMode === 'VERTICAL' ||
    [
      node.itemSpacing,
      node.counterAxisSpacing,
      node.paddingTop,
      node.paddingRight,
      node.paddingBottom,
      node.paddingLeft
    ].some((value) => value !== 0) ||
    node.primaryAxisSizing !== 'FIXED' ||
    node.counterAxisSizing !== 'FIXED' ||
    node.primaryAxisAlign !== 'MIN' ||
    node.counterAxisAlign !== 'MIN' ||
    node.layoutWrap !== 'NO_WRAP'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonnegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isTracks(value: unknown): value is GridTrack[] {
  return (
    Array.isArray(value) &&
    value.length <= 4096 &&
    value.every(
      (track: unknown) =>
        isRecord(track) &&
        Object.keys(track).length === 2 &&
        typeof track.sizing === 'string' &&
        ['FIXED', 'FR', 'AUTO'].includes(track.sizing) &&
        isNonnegativeNumber(track.value)
    )
  )
}

function parsePreferences(raw: string): Preferences | null {
  if (raw.length > 524288) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(value) || value.version !== 1) return null
  if (Object.keys(value).some((key) => !KEYS.has(key))) return null
  const preferences: Preferences = {}
  if ('counterAxisAlign' in value) {
    if (value.counterAxisAlign !== 'STRETCH') return null
    preferences.counterAxisAlign = 'STRETCH'
  }
  if (GRID_KEYS.some((key) => key in value)) {
    if (
      !isTracks(value.gridTemplateColumns) ||
      !isTracks(value.gridTemplateRows) ||
      !isNonnegativeNumber(value.gridColumnGap) ||
      !isNonnegativeNumber(value.gridRowGap)
    )
      return null
    Object.assign(preferences, {
      gridTemplateColumns: value.gridTemplateColumns,
      gridTemplateRows: value.gridTemplateRows,
      gridColumnGap: value.gridColumnGap,
      gridRowGap: value.gridRowGap
    })
  }
  return Object.keys(preferences).length ? preferences : null
}

/** Only fills gaps in the native stack schema; this payload never enables a layout mode. */
export function extractLayoutPreferences(nc: NodeChange): Preferences {
  const raw = getOpenPencilPluginValue(nc, KEY)
  return raw ? (parsePreferences(raw) ?? {}) : {}
}

export function applyLayoutPreferences(node: SceneNode): void {
  const preferences: Preferences = {}
  if (node.counterAxisAlign === 'STRETCH') preferences.counterAxisAlign = 'STRETCH'
  if (
    node.layoutMode !== 'GRID' &&
    (node.gridTemplateColumns.length ||
      node.gridTemplateRows.length ||
      node.gridColumnGap !== 0 ||
      node.gridRowGap !== 0)
  ) {
    for (const key of GRID_KEYS) Object.assign(preferences, { [key]: node[key] })
  }
  if (Object.keys(preferences).length) {
    upsertPluginData(node, KEY, JSON.stringify({ version: 1, ...preferences }))
  } else {
    // Invalid/future data stays inert and available to a compatible reader.
    node.pluginData = node.pluginData.filter(
      (entry) =>
        entry.pluginId !== OPEN_PENCIL_PLUGIN_ID ||
        entry.key !== KEY ||
        parsePreferences(entry.value) === null
    )
  }
}
