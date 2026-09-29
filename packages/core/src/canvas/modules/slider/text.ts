import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleLabelTextNode } from '#core/canvas/modules/label'
import { resolveSliderModule, sliderInitialValues } from '#core/plugins/slider'

/** Preflight the same authored labels and values that the offline canvas displays. */
export function sliderTextNode(node: SceneNode): SceneNode | null {
  if (node.type !== 'FRAME') return null
  const resolved = resolveSliderModule(node.interactiveProps?.module)
  if (!resolved?.ok) return null
  const { config } = resolved
  const values = sliderInitialValues(config)
  const text = [config.label]
  if (config.showValue) text.push(config.range ? values.join(' – ') : String(values[0]))
  if (config.showBounds) text.push(String(config.min), String(config.max))
  const label = moduleLabelTextNode(
    node,
    text.join('\n'),
    node.width,
    config.fontSize,
    node.textLanguage ?? 'en'
  )
  label.styleRuns = [{ start: 0, length: config.label.length, style: { fontWeight: 600 } }]
  if (config.showValue)
    label.styleRuns.push({
      start: config.label.length + 1,
      length: (config.range ? values.join(' – ') : String(values[0])).length,
      style: { fontWeight: 600 }
    })
  return label
}
