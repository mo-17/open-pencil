import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleLabelTextNode } from '#core/canvas/modules/label'
import { resolveWalktourModule, WALKTOUR_MODULE_TRIGGER_HEIGHT } from '#core/plugins/walktour'

/** The closed design-time trigger is the only generated text; child fonts are collected normally. */
export function walktourTextNode(node: SceneNode): SceneNode | null {
  if (node.type !== 'FRAME') return null
  const resolved = resolveWalktourModule(node.interactiveProps?.module)
  if (!resolved?.ok) return null
  return {
    ...moduleLabelTextNode(
      node,
      resolved.config.triggerLabel,
      Math.max(0, node.width - 24),
      resolved.config.fontSize,
      node.textLanguage ?? 'en'
    ),
    height: Math.max(0, Math.min(WALKTOUR_MODULE_TRIGGER_HEIGHT, node.height)),
    textAlignHorizontal: 'CENTER',
    fontWeight: 600,
    lineHeight: resolved.config.fontSize * 1.5
  }
}
