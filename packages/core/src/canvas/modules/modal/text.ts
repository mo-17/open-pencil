import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleLabelTextNode } from '#core/canvas/modules/label'
import { modalHidesContent } from '#core/plugins/content/modal'
import { resolveModalModule } from '#core/plugins/modal'

export const MODAL_TRIGGER_FONT_SIZE = 14

export function modalTriggerTextNode(node: SceneNode): SceneNode | null {
  if (node.type !== 'FRAME' || node.width <= 0 || node.height < 14) return null
  const resolved = resolveModalModule(node.interactiveProps?.module)
  if (!resolved?.ok || !resolved.config.showTriggerLabel) return null
  if (node.childIds.length > 0 && !modalHidesContent(node)) return null
  return moduleLabelTextNode(
    node,
    resolved.config.triggerLabel,
    node.width,
    MODAL_TRIGGER_FONT_SIZE,
    node.textLanguage ?? 'en'
  )
}
