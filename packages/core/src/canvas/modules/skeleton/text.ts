import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleLabelTextNode } from '#core/canvas/modules/label'
import { resolveSkeletonModule } from '#core/plugins/skeleton'

export function skeletonTextNode(node: SceneNode): SceneNode | null {
  if (node.type !== 'FRAME') return null
  const resolved = resolveSkeletonModule(node.interactiveProps?.module)
  if (!resolved?.ok || !resolved.config.showLabel) return null
  return moduleLabelTextNode(
    node,
    resolved.config.label,
    node.width,
    resolved.config.fontSize,
    node.textLanguage ?? 'en'
  )
}
