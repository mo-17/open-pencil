import * as values from '@open-pencil/plugin-contracts/adapter-helpers'

import type { DescriptionsItemV1 } from '#core/plugins/descriptions'
import { parseBoundedModuleObjectArray } from '#core/plugins/module-contract'

const ITEM_KEYS = new Set(['id', 'label', 'value'])
export function parseDescriptionsItems(value: unknown): DescriptionsItemV1[] {
  const ids = new Set<string>()
  return parseBoundedModuleObjectArray(
    value,
    1,
    24,
    'descriptions must contain 1 to 24 items',
    (index) => `descriptions items[${index}] must be a plain object`,
    (entry) => {
      if (!values.hasExactPluginKeys(entry, ITEM_KEYS))
        throw new TypeError('descriptions item must contain id, label, and value')
      const id = values.parseBoundedPluginText(entry.id, 'descriptions item id', 1, 64)
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id) || ids.has(id))
        throw new TypeError(
          'descriptions ids must be unique letters, numbers, underscores, or hyphens'
        )
      ids.add(id)
      const label = values.parseBoundedPluginText(entry.label, 'descriptions item label', 1, 120)
      if (!label.trim()) throw new TypeError('Descriptions item needs a readable label')
      return {
        id,
        label,
        value: values.parseBoundedPluginText(entry.value, 'descriptions item value', 0, 1000)
      }
    }
  )
}
