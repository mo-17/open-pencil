import { OPEN_PENCIL_PLUGIN_ID } from '@open-pencil/fig/node-change'
import type { GridTrack, PluginDataEntry, SceneNode } from '@open-pencil/scene-graph'

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonnegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isTrackList(value: unknown): value is GridTrack[] {
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

/** Invalid/future payloads remain inert plugin data instead of overriding native layout. */
export function parseGridLayout(raw: string): GridLayoutOverride | undefined {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!isRecord(value) || value.version !== 1) return undefined
  if (Object.keys(value).some((key) => !PAYLOAD_KEYS.has(key))) return undefined
  if (!TRACK_FIELDS.every((field) => isTrackList(value[field]))) return undefined
  if (!NUMERIC_FIELDS.every((field) => isNonnegativeNumber(value[field]))) return undefined
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
