import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleLabelTextNode } from '#core/canvas/modules/label'
import { resolveTimelineModule } from '#core/plugins/timeline'

export function timelineTextNode(node: SceneNode): SceneNode | null {
  if (node.type !== 'FRAME') return null
  const resolved = resolveTimelineModule(node.interactiveProps?.module)
  if (!resolved?.ok) return null
  const { config } = resolved
  const text =
    config.items.map((item) => [item.title, item.description, item.time].join('\n')).join('\n') ||
    config.emptyText
  const styleRuns: SceneNode['styleRuns'] = []
  let start = 0
  for (const item of config.items) {
    styleRuns.push({ start, length: item.title.length, style: { fontWeight: 600 } })
    start += item.title.length + item.description.length + item.time.length + 3
  }
  return {
    ...moduleLabelTextNode(node, text, node.width, config.fontSize, node.textLanguage ?? 'en'),
    styleRuns
  }
}
