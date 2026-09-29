import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleLabelTextNode } from '#core/canvas/modules/label'
import { resolveAvatarModule } from '#core/plugins/avatar'

import { avatarPreviewGeometry } from './geometry'

export function avatarTextNode(node: SceneNode): SceneNode | null {
  if (node.type !== 'FRAME') return null
  const resolved = resolveAvatarModule(node.interactiveProps?.module)
  if (!resolved?.ok) return null
  const geometry = avatarPreviewGeometry(node.width, node.height, resolved.config)
  return {
    ...moduleLabelTextNode(
      node,
      geometry.text,
      geometry.size,
      geometry.fontSize,
      node.textLanguage ?? 'en'
    ),
    textAlignHorizontal: 'CENTER'
  }
}
