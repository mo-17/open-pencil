import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleLabelTextNode } from '#core/canvas/modules/label'
import { resolveBreadcrumbModule } from '#core/plugins/breadcrumb'

export function breadcrumbTextNode(node: SceneNode): SceneNode | null {
  if (node.type !== 'FRAME') return null
  const resolved = resolveBreadcrumbModule(node.interactiveProps?.module)
  if (!resolved?.ok) return null
  const text = resolved.config.items.map((item) => item.label).join('\n')
  const last = resolved.config.items.at(-1)
  return {
    ...moduleLabelTextNode(
      node,
      text + '/›·',
      node.width,
      resolved.config.fontSize,
      node.textLanguage ?? 'en'
    ),
    styleRuns: last
      ? [
          {
            start: text.length - last.label.length,
            length: last.label.length,
            style: { fontWeight: 600 }
          }
        ]
      : []
  }
}
