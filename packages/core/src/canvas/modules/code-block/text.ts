import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleLabelTextNode } from '#core/canvas/modules/label'
import { resolveCodeBlockModule } from '#core/plugins/code-block'

export function codeBlockLocale(node: SceneNode): string {
  const language = node.interactiveProps?.lang
  return typeof language === 'string' && language.trim()
    ? language.trim()
    : node.textLanguage?.trim() || 'en'
}

export function codeBlockCopyLabel(node: SceneNode): string {
  return codeBlockLocale(node).toLowerCase().startsWith('zh') ? '复制' : 'Copy'
}

export function codeBlockTextNode(node: SceneNode): SceneNode | null {
  if (node.type !== 'FRAME') return null
  const resolved = resolveCodeBlockModule(node.interactiveProps?.module)
  if (!resolved?.ok) return null
  const { config } = resolved
  const copy = config.showCopyButton ? codeBlockCopyLabel(node) : ''
  return {
    ...moduleLabelTextNode(
      node,
      [config.label, config.language, copy, config.code].join('\n'),
      node.width,
      config.fontSize,
      codeBlockLocale(node)
    ),
    styleRuns: [{ start: 0, length: config.label.length, style: { fontWeight: 600 } }]
  }
}
