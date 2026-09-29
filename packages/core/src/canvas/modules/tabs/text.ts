import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleLabelTextNode } from '#core/canvas/modules/label'
import { resolveTabsModule } from '#core/plugins/tabs'

export function tabsHeaderTextNode(node: SceneNode, text: string, fontSize: number): SceneNode {
  return {
    ...moduleLabelTextNode(node, text, 10_000, fontSize, node.textLanguage ?? 'en'),
    fontWeight: 600,
    lineHeight: fontSize * 1.3
  }
}

export function tabsBodyTextNode(
  node: SceneNode,
  text: string,
  fontSize: number,
  width: number,
  height: number
): SceneNode {
  return {
    ...moduleLabelTextNode(node, text, width, fontSize, node.textLanguage ?? 'en'),
    height,
    lineHeight: fontSize * 1.6,
    textTruncation: 'DISABLED',
    maxLines: null
  }
}

/** Font preflight describes only the labels and the initial inline panel being painted. */
export function tabsTextNode(node: SceneNode): SceneNode | null {
  if (node.type !== 'FRAME' || node.width <= 0 || node.height <= 0) return null
  const resolved = resolveTabsModule(node.interactiveProps?.module)
  if (!resolved?.ok) return null
  const { config } = resolved
  const headers = config.tabs.map((tab) => tab.label).join('\n')
  const active = config.tabs.find((tab) => tab.id === config.initialTabId)
  const content = active && !active.contentChildName ? active.content : ''
  const text = content ? headers + '\n' + content : headers
  return {
    ...moduleLabelTextNode(node, text, node.width, config.fontSize, node.textLanguage ?? 'en'),
    styleRuns: [{ start: 0, length: headers.length, style: { fontWeight: 600 } }]
  }
}
