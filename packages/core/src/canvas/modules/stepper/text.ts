import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleLabelTextNode } from '#core/canvas/modules/label'
import { resolveStepperModule } from '#core/plugins/stepper'

export function stepperTextNode(node: SceneNode): SceneNode | null {
  if (node.type !== 'FRAME') return null
  const resolved = resolveStepperModule(node.interactiveProps?.module)
  if (!resolved?.ok) return null
  const { config } = resolved
  const text =
    config.items.map((item) => item.title + '\n' + item.description).join('\n') + '\n0123456789✓!•'
  const styleRuns: SceneNode['styleRuns'] = []
  let start = 0
  for (const item of config.items) {
    styleRuns.push({ start, length: item.title.length, style: { fontWeight: 600 } })
    start += item.title.length + item.description.length + 2
  }
  return {
    ...moduleLabelTextNode(node, text, node.width, config.fontSize, node.textLanguage ?? 'en'),
    styleRuns
  }
}
