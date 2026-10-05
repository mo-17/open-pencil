import {
  BOUND_VARIABLES_PLUGIN_KEY,
  EXPORT_SETTINGS_PLUGIN_KEY,
  OPEN_PENCIL_PLUGIN_ID
} from '#fig/node-change/plugin-data'

import type { NodeChange } from '@open-pencil/kiwi/fig/codec'

/** An explicit paint claim clears inherited plugin aliases for the paint array it replaces. */
export function clearInheritedPluginClaims(target: NodeChange, claim: NodeChange): void {
  const arrays = [
    ...(Array.isArray(claim.fillPaints) ? ['fills/'] : []),
    ...(Array.isArray(claim.strokePaints) ? ['strokes/'] : [])
  ]
  if (!target.pluginData) return
  const authored = (key: string) =>
    claim.pluginData?.some(
      (entry) => entry.pluginID === OPEN_PENCIL_PLUGIN_ID && entry.key === key
    ) ?? false
  if (Array.isArray(claim.exportSettings) && !authored(EXPORT_SETTINGS_PLUGIN_KEY)) {
    target.pluginData = target.pluginData.filter(
      (entry) =>
        entry.pluginID !== OPEN_PENCIL_PLUGIN_ID || entry.key !== EXPORT_SETTINGS_PLUGIN_KEY
    )
  }
  if (!arrays.length || authored(BOUND_VARIABLES_PLUGIN_KEY)) return
  target.pluginData = target.pluginData.map((entry) => {
    if (entry.pluginID !== OPEN_PENCIL_PLUGIN_ID || entry.key !== BOUND_VARIABLES_PLUGIN_KEY)
      return entry
    try {
      const bindings: unknown = JSON.parse(entry.value)
      if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) return entry
      const retained = Object.fromEntries(
        Object.entries(bindings).filter(([key]) => !arrays.some((prefix) => key.startsWith(prefix)))
      )
      return { ...entry, value: JSON.stringify(retained) }
    } catch {
      return entry
    }
  })
}
