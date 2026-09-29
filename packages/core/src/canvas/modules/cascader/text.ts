import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleLabelTextNode } from '#core/canvas/modules/label'
import { resolveCascaderModule } from '#core/plugins/cascader'

export function cascaderLanguage(node: SceneNode): string {
  const language = node.interactiveProps?.lang
  return typeof language === 'string' && language.trim() ? language : node.textLanguage || 'en'
}
export function cascaderTextNode(node: SceneNode): SceneNode | null {
  if (node.type !== 'FRAME') return null
  const result = resolveCascaderModule(node.interactiveProps?.module)
  if (!result?.ok) return null
  return moduleLabelTextNode(
    node,
    [result.config.placeholder, ...result.config.items.map((item) => item.label), ' / —'].join(' '),
    node.width,
    result.config.fontSize,
    cascaderLanguage(node)
  )
}
