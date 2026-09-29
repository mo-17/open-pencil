import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import type { TreeItem } from '#core/plugins/tree/types'

export interface CascaderModuleConfigV1 extends JSONObject {
  label: string
  placeholder: string
  items: TreeItem[]
  initialPath: string[]
  searchable: boolean
  clearable: boolean
  disabled: boolean
  backgroundColor: string
  textColor: string
  accentColor: string
  borderColor: string
  fontSize: number
  rowHeight: number
  borderRadius: number
}

export const CASCADER_MODULE_LIMITS = Object.freeze({
  items: 128,
  depth: 6,
  label: 120,
  configBytes: 49152
})

/** Data arrays cannot hide getters, inherited entries, symbols or extra fields. */
export function cascaderDataArray(value: unknown, maximum: number): value is unknown[] {
  if (
    !Array.isArray(value) ||
    value.length > maximum ||
    Object.getPrototypeOf(value) !== Array.prototype
  )
    return false
  if (Reflect.ownKeys(value).length !== value.length + 1) return false
  return Array.from({ length: value.length }, (_, index) => {
    const field = Object.getOwnPropertyDescriptor(value, String(index))
    return Boolean(field?.enumerable && 'value' in field)
  }).every(Boolean)
}

/** A value is an entire enabled root-to-leaf path. Invalid projections never repair state. */
export function parseCascaderPath(items: readonly TreeItem[], value: unknown): string[] | null {
  if (!cascaderDataArray(value, CASCADER_MODULE_LIMITS.depth)) return null
  const result: string[] = []
  let parentId = ''
  for (const id of value) {
    if (typeof id !== 'string') return null
    const item = items.find((candidate) => candidate.id === id)
    if (!item || item.disabled || item.parentId !== parentId) return null
    result.push(id)
    parentId = id
  }
  if (result.length && items.some((item) => item.parentId === parentId)) return null
  return result
}

export function cascaderPathLabels(items: readonly TreeItem[], path: readonly string[]): string {
  return path.map((id) => items.find((item) => item.id === id)?.label ?? '').join(' / ')
}
