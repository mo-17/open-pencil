import { OPEN_PENCIL_PLUGIN_ID } from '@open-pencil/fig/node-change'
import type { PluginDataEntry, SceneNode } from '@open-pencil/scene-graph'

/** Controls use non-TEXT Figma nodes, which cannot carry native text typography. */
export const LOWCODE_CONTROL_TYPOGRAPHY_KEY = 'lowcode/controlTypography'

const TYPOGRAPHY_FIELDS = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'italic',
  'lineHeight',
  'letterSpacing',
  'textAlignHorizontal',
  'textAlignVertical'
] as const
const PAYLOAD_KEYS = new Set<string>(['version', ...TYPOGRAPHY_FIELDS])

export type ControlTypography = Pick<SceneNode, (typeof TYPOGRAPHY_FIELDS)[number]>

export function serializeControlTypography(node: SceneNode): PluginDataEntry[] {
  if (
    node.pluginData.some(
      (entry) =>
        entry.pluginId === OPEN_PENCIL_PLUGIN_ID &&
        entry.key === LOWCODE_CONTROL_TYPOGRAPHY_KEY &&
        !parseControlTypography(entry.value)
    )
  ) {
    return []
  }
  const fields = Object.fromEntries(TYPOGRAPHY_FIELDS.map((field) => [field, node[field]]))
  return [
    {
      pluginId: OPEN_PENCIL_PLUGIN_ID,
      key: LOWCODE_CONTROL_TYPOGRAPHY_KEY,
      value: JSON.stringify({ version: 1, ...fields })
    }
  ]
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonnegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0
}

function isHorizontalAlignment(value: unknown): value is SceneNode['textAlignHorizontal'] {
  return value === 'LEFT' || value === 'CENTER' || value === 'RIGHT' || value === 'JUSTIFIED'
}

function isVerticalAlignment(value: unknown): value is SceneNode['textAlignVertical'] {
  return value === 'TOP' || value === 'CENTER' || value === 'BOTTOM'
}

function isControlTypography(value: unknown): value is ControlTypography {
  return (
    isRecord(value) &&
    typeof value.fontFamily === 'string' &&
    value.fontFamily.length > 0 &&
    value.fontFamily.length <= 4096 &&
    isNonnegativeNumber(value.fontSize) &&
    isFiniteNumber(value.fontWeight) &&
    value.fontWeight > 0 &&
    typeof value.italic === 'boolean' &&
    (value.lineHeight === null || isNonnegativeNumber(value.lineHeight)) &&
    isFiniteNumber(value.letterSpacing) &&
    isHorizontalAlignment(value.textAlignHorizontal) &&
    isVerticalAlignment(value.textAlignVertical)
  )
}

/** Unknown or malformed payloads stay inert; never spread untrusted object fields. */
export function parseControlTypography(raw: string): ControlTypography | undefined {
  if (raw.length > 16384) return undefined
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!isRecord(value)) return undefined
  const data = value
  if (data.version !== 1 || Object.keys(data).some((key) => !PAYLOAD_KEYS.has(key)))
    return undefined
  if (!isControlTypography(data)) return undefined
  return {
    fontFamily: data.fontFamily,
    fontSize: data.fontSize,
    fontWeight: data.fontWeight,
    italic: data.italic,
    lineHeight: data.lineHeight,
    letterSpacing: data.letterSpacing,
    textAlignHorizontal: data.textAlignHorizontal,
    textAlignVertical: data.textAlignVertical
  }
}
