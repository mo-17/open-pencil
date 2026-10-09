import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleLabelTextNode } from '#core/canvas/modules/label'
import { getEffectPickCatalogEntry, resolveEffectPickModule } from '#core/plugins/effect-pick'

export const EFFECT_PICK_PREVIEW_FONT_SIZE = 16
export const EFFECT_PICK_PREVIEW_LINE_HEIGHT = EFFECT_PICK_PREVIEW_FONT_SIZE * 1.3

export function effectPickPreviewLabel(
  host: SceneNode,
  text: string,
  width: number,
  maxLines: number
): SceneNode {
  return {
    ...moduleLabelTextNode(
      host,
      text,
      width,
      EFFECT_PICK_PREVIEW_FONT_SIZE,
      host.textLanguage ?? 'en'
    ),
    fontWeight: 600,
    lineHeight: EFFECT_PICK_PREVIEW_LINE_HEIGHT,
    textAlignHorizontal: 'CENTER',
    maxLines
  }
}

export function effectPickPreviewText(effectId: string, text: string): string {
  if (effectId === 'diagonal-fill') return text
  const title = getEffectPickCatalogEntry(effectId)?.title ?? 'EffectPick'
  return text ? `${title}\n${text}` : title
}

/** Font preflight shares the host identity without adding text to the document graph. */
export function effectPickTextNode(node: SceneNode): SceneNode | null {
  if (node.type !== 'FRAME') return null
  const resolved = resolveEffectPickModule(node.interactiveProps?.module)
  if (!resolved?.ok) return null
  const { effectId, text } = resolved.config
  return effectPickPreviewLabel(node, effectPickPreviewText(effectId, text), node.width, 3)
}
