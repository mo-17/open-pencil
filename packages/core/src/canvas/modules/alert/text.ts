import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleTitleDescriptionTextNode } from '#core/canvas/modules/label'
import { resolveAlertModule } from '#core/plugins/alert'

/** Font preflight includes the title's semibold face and all authored, initially visible text. */
export function alertTextNode(node: SceneNode): SceneNode | null {
  if (node.type !== 'FRAME') return null
  const resolved = resolveAlertModule(node.interactiveProps?.module)
  if (!resolved?.ok) return null
  return moduleTitleDescriptionTextNode(node, resolved.config)
}
