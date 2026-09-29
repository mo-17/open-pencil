import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleLabelTextNode, moduleMultilineLabelNode } from '#core/canvas/modules/label'
import { resolveAccordionModule } from '#core/plugins/accordion'

export function accordionLabelNode(
  host: SceneNode,
  text: string,
  width: number,
  fontSize: number,
  heading: boolean
): SceneNode {
  return moduleMultilineLabelNode(host, text, {
    width,
    fontSize,
    fontWeight: heading ? 600 : 400,
    lineHeight: fontSize * (heading ? 1.4 : 1.6)
  })
}

/** Include titles and only initially expanded bodies in font preflight; never mutate the module. */
export function accordionTextNode(node: SceneNode): SceneNode | null {
  if (node.type !== 'FRAME') return null
  const resolved = resolveAccordionModule(node.interactiveProps?.module)
  if (!resolved?.ok) return null
  const { config } = resolved
  const open = new Set(config.initialOpenIds)
  let text = ''
  const styleRuns: SceneNode['styleRuns'] = []
  for (const item of config.items) {
    styleRuns.push({ start: text.length, length: item.title.length, style: { fontWeight: 600 } })
    text += item.title + '\n'
    if (open.has(item.id)) text += item.content + '\n'
  }
  return {
    ...moduleLabelTextNode(node, text, node.width, config.fontSize, node.textLanguage ?? 'en'),
    styleRuns
  }
}
