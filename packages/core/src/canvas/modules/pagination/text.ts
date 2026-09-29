import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleLabelTextNode } from '#core/canvas/modules/label'
import { paginationLayout, resolvePaginationModule } from '#core/plugins/pagination'

export function paginationTextNode(node: SceneNode): SceneNode | null {
  if (node.type !== 'FRAME') return null
  const resolved = resolvePaginationModule(node.interactiveProps?.module)
  if (!resolved?.ok) return null
  const layout = paginationLayout(node.width, resolved.config)
  return moduleLabelTextNode(
    node,
    layout.cells.map((cell) => cell.text).join(' '),
    node.width,
    layout.fontSize,
    node.textLanguage ?? 'en'
  )
}
