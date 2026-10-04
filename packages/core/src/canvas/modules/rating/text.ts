import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleLabelTextNode } from '#core/canvas/modules/label'
import { moduleControlState } from '#core/canvas/modules/value-controls'
import { resolveRatingModule } from '#core/plugins/rating'

/** Include every authored label that can appear, including a disabled clear action. */
export function ratingTextNode(node: SceneNode): SceneNode | null {
  if (node.type !== 'FRAME') return null
  const resolved = resolveRatingModule(node.interactiveProps?.module)
  if (!resolved?.ok) return null
  const config = { ...resolved.config, ...moduleControlState(node, resolved.config) }
  const text = [
    config.label,
    ...(config.showValue ? [`${config.initialValue} / ${config.max}`] : []),
    ...(config.allowClear && !config.readOnly ? [config.clearLabel] : [])
  ].join('\n')
  return moduleLabelTextNode(node, text, node.width, config.fontSize, node.textLanguage ?? 'en')
}
