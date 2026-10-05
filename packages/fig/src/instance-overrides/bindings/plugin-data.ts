import { cloneRecord } from '#fig/node-change/clone'

import type { NodeChange, PluginData } from '@open-pencil/kiwi/fig/codec'

/** Non-empty property claims replace named plugin entries, not the other saved keys. */
export function mergePluginDataClaims(
  target: NodeChange,
  claim: NodeChange
): Pick<NodeChange, 'pluginData'> {
  if (!claim.pluginData?.length) return {}
  const entries: PluginData[] = []
  const indices = new Map<string, Map<string, number>>()
  for (const entry of [...(target.pluginData ?? []), ...claim.pluginData]) {
    let keys = indices.get(entry.pluginID)
    if (!keys) {
      keys = new Map()
      indices.set(entry.pluginID, keys)
    }
    const index = keys.get(entry.key)
    const copied = cloneRecord(entry)
    if (index === undefined) {
      keys.set(entry.key, entries.length)
      entries.push(copied)
    } else entries[index] = copied
  }
  return { pluginData: entries }
}
