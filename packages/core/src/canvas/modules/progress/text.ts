import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleLabelTextNode } from '#core/canvas/modules/label'
import { progressDisplayValue, resolveProgressModule } from '#core/plugins/progress'

/** Preflight only text actually rendered; pending progress never preloads a fake percentage. */
export function progressTextNode(node: SceneNode): SceneNode | null {
  if (node.type !== 'FRAME') return null
  const resolved = resolveProgressModule(node.interactiveProps?.module)
  if (!resolved?.ok) return null
  const { config } = resolved
  const text = [config.showLabel ? config.label : '', progressDisplayValue(config)]
    .filter(Boolean)
    .join('\n')
  if (!text) return null
  return moduleLabelTextNode(node, text, node.width, config.fontSize, node.textLanguage ?? 'en')
}
