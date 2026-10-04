import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleLabelTextNode } from '#core/canvas/modules/label'
import { LABEL_FONT_SIZE } from '#core/constants'
import { modalHidesContent } from '#core/plugins/content/modal'
import { resolveDropdownMenuModule } from '#core/plugins/dropdown-menu'
import { resolveSlideMenuModule } from '#core/plugins/slide-menu'
import { resolveUploadButtonModule } from '#core/plugins/upload-button'

/** Only the intrinsic trigger is visible; authored children and hidden popup bodies keep their own fonts. */
export function triggerTextNode(node: SceneNode): SceneNode | null {
  if (node.type !== 'FRAME' || node.width <= 0 || node.height < 14) return null
  if (node.childIds.length > 0 && !modalHidesContent(node)) return null
  const instance = node.interactiveProps?.module
  const resolved =
    resolveDropdownMenuModule(instance) ??
    resolveUploadButtonModule(instance) ??
    resolveSlideMenuModule(instance)
  if (!resolved?.ok || !resolved.config.showTriggerLabel) return null
  return moduleLabelTextNode(
    node,
    resolved.config.triggerLabel,
    node.width,
    LABEL_FONT_SIZE,
    node.textLanguage ?? 'en'
  )
}
