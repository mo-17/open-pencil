import { OPEN_PENCIL_PLUGIN_ID } from '@open-pencil/fig/node-change'
import {
  isGridTrackList,
  isNonnegativeFiniteNumber,
  isPlainJSONObject
} from '@open-pencil/scene-graph'
import type { PluginDataEntry, SceneNode } from '@open-pencil/scene-graph'

/** The vendored Figma stack schema cannot represent OpenPencil Grid containers. */
export const LOWCODE_GRID_LAYOUT_KEY = 'lowcode/gridLayout'

const NUMERIC_FIELDS = [
  'gridColumnGap',
  'gridRowGap',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft'
] as const
const SIZING_FIELDS = ['primaryAxisSizing', 'counterAxisSizing'] as const
const TRACK_FIELDS = ['gridTemplateColumns', 'gridTemplateRows'] as const
const GRID_FIELDS = [...TRACK_FIELDS, ...NUMERIC_FIELDS, ...SIZING_FIELDS] as const
const PAYLOAD_KEYS = new Set<string>(['version', ...GRID_FIELDS])

export type GridLayoutOverride = Pick<SceneNode, (typeof GRID_FIELDS)[number]> & {
  layoutMode: 'GRID'
}

export function serializeGridLayout(node: SceneNode): PluginDataEntry[] {
  if (node.layoutMode !== 'GRID') return []
  const payload = Object.fromEntries(GRID_FIELDS.map((field) => [field, node[field]]))
  return [
    {
      pluginId: OPEN_PENCIL_PLUGIN_ID,
      key: LOWCODE_GRID_LAYOUT_KEY,
      value: JSON.stringify({ version: 1, ...payload })
    }
  ]
}

/** Invalid/future payloads remain inert plugin data instead of overriding native layout. */
export function parseGridLayout(raw: string): GridLayoutOverride | undefined {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!isPlainJSONObject(value) || value.version !== 1) return undefined
  if (Object.keys(value).some((key) => !PAYLOAD_KEYS.has(key))) return undefined
  if (!TRACK_FIELDS.every((field) => isGridTrackList(value[field]))) return undefined
  if (!NUMERIC_FIELDS.every((field) => isNonnegativeFiniteNumber(value[field]))) return undefined
  if (
    !SIZING_FIELDS.every(
      (field) => typeof value[field] === 'string' && ['FIXED', 'HUG', 'FILL'].includes(value[field])
    )
  ) {
    return undefined
  }
  const fields = Object.fromEntries(GRID_FIELDS.map((field) => [field, value[field]]))
  return { ...fields, layoutMode: 'GRID' } as GridLayoutOverride
}
