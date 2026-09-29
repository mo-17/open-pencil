import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleLabelTextNode } from '#core/canvas/modules/label'
import { resolvePopoverModule } from '#core/plugins/popover'

export function popoverTriggerTextNode(node: SceneNode): SceneNode | null {
  const resolved =
    node.type === 'FRAME' ? resolvePopoverModule(node.interactiveProps?.module) : null
  if (!resolved?.ok) return null
  const label = moduleLabelTextNode(
    node,
    resolved.config.triggerLabel,
    Math.max(0, node.width - 24),
    resolved.config.fontSize,
    node.textLanguage ?? 'en'
  )
  label.textAlignHorizontal = 'CENTER'
  return label
}
