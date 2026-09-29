import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleMultilineLabelNode } from '#core/canvas/modules/label'
import { resolveTooltipModule } from '#core/plugins/tooltip'
export function tooltipTextNode(node: SceneNode): SceneNode | null {
  if (node.type !== 'FRAME') return null
  const resolved = resolveTooltipModule(node.interactiveProps?.module)
  if (!resolved?.ok) return null
  return moduleMultilineLabelNode(node, resolved.config.triggerLabel, {
    width: Math.max(0, node.width - 24),
    fontSize: resolved.config.fontSize,
    fontWeight: 400,
    lineHeight: resolved.config.fontSize * 1.5
  })
}
