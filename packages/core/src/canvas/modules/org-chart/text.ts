import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleTitleDescriptionTextNode } from '#core/canvas/modules/label'
import { resolveOrgChartModule } from '#core/plugins/org-chart'

/** Include hidden descendants too, so expanding a branch cannot introduce unloaded glyphs. */
export function orgChartTextNode(node: SceneNode): SceneNode | null {
  if (node.type !== 'FRAME') return null
  const resolved = resolveOrgChartModule(node.interactiveProps?.module)
  if (!resolved?.ok) return null
  return moduleTitleDescriptionTextNode(node, {
    title: resolved.config.items.map((item) => item.label).join('\n'),
    description: resolved.config.items.map((item) => item.description).join('\n'),
    fontSize: resolved.config.fontSize
  })
}
