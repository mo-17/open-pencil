import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleTitleDescriptionTextNode } from '#core/canvas/modules/label'
import { resolveTreeModule } from '#core/plugins/tree'
export function treeLanguage(node: SceneNode): string {
  const language = node.interactiveProps?.lang
  return typeof language === 'string' && language.trim()
    ? language.trim()
    : node.textLanguage?.trim() || 'en'
}
export function treeTextNode(node: SceneNode): SceneNode | null {
  if (node.type !== 'FRAME') return null
  const resolved = resolveTreeModule(node.interactiveProps?.module)
  if (!resolved?.ok) return null
  const config = resolved.config,
    language = treeLanguage(node),
    zh = language.toLowerCase().startsWith('zh')
  return {
    ...moduleTitleDescriptionTextNode(node, {
      title: config.label,
      description: [
        config.placeholder,
        ...config.items.map((item) => item.label),
        ...(zh
          ? ['搜索树节点', '已选', '未选择']
          : ['Search tree items', 'Selected', 'None selected'])
      ].join(' '),
      fontSize: config.fontSize
    }),
    textLanguage: language
  }
}
