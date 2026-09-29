import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleTitleDescriptionTextNode } from '#core/canvas/modules/label'
import { EMPTY_STATE_LAYOUT, resolveEmptyStateModule } from '#core/plugins/empty-state'

/** Font discovery uses the real host identity and both authored text faces. */
export function emptyStateTextNode(node: SceneNode): SceneNode | null {
  if (node.type !== 'FRAME') return null
  const resolved = resolveEmptyStateModule(node.interactiveProps?.module)
  if (!resolved?.ok) return null
  const { config } = resolved
  return moduleTitleDescriptionTextNode(
    node,
    config,
    config.fontSize * EMPTY_STATE_LAYOUT.titleScale
  )
}
