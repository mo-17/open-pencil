import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleLabelTextNode } from '#core/canvas/modules/label'
import { resolveDescriptionsModule } from '#core/plugins/descriptions'

export function descriptionsTextNode(node: SceneNode): SceneNode | null {
  if (node.type !== 'FRAME') return null
  const resolved = resolveDescriptionsModule(node.interactiveProps?.module)
  if (!resolved?.ok) return null
  return moduleLabelTextNode(
    node,
    resolved.config.items.map((item) => item.label + '\n' + item.value).join('\n'),
    node.width,
    resolved.config.fontSize,
    node.textLanguage ?? 'en'
  )
}
