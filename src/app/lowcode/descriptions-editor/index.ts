import {
  createDescriptionsModuleInstance,
  type DescriptionsItemV1
} from '@open-pencil/core/plugins'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

export function descriptionsRows(config: JSONObject): DescriptionsItemV1[] {
  if (!Array.isArray(config.items)) return []
  const rows: DescriptionsItemV1[] = []
  for (const item of config.items) {
    if (
      !item ||
      typeof item !== 'object' ||
      Array.isArray(item) ||
      typeof item.id !== 'string' ||
      typeof item.label !== 'string' ||
      typeof item.value !== 'string'
    )
      return []
    rows.push({ id: item.id, label: item.label, value: item.value })
  }
  return rows
}

export function descriptionsDraftValid(config: JSONObject, items: DescriptionsItemV1[]): boolean {
  try {
    createDescriptionsModuleInstance({ ...config, items })
    return true
  } catch {
    return false
  }
}

export function nextDescriptionsId(items: readonly DescriptionsItemV1[]): string {
  const ids = new Set(items.map(({ id }) => id))
  for (let index = 1; ; index++) if (!ids.has(`item-${index}`)) return `item-${index}`
}
