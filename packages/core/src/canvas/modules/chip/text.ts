import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleLabelTextNode } from '#core/canvas/modules/label'
import { CHIP_LAYOUT, resolveChipModule } from '#core/plugins/chip'

export function chipTextNode(node: SceneNode): SceneNode | null {
  if (node.type !== 'FRAME') return null
  const resolved = resolveChipModule(node.interactiveProps?.module)
  if (!resolved?.ok) return null
  const { config } = resolved
  return {
    ...moduleLabelTextNode(
      node,
      config.label,
      node.width,
      config.fontSize,
      node.textLanguage ?? 'en'
    ),
    fontWeight: 600,
    lineHeight: config.fontSize * CHIP_LAYOUT.lineHeight,
    maxLines: 1
  }
}
