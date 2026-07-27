import type { SceneNode } from '@open-pencil/scene-graph'

import { fontManager, weightToStyle } from '#core/text/fonts'
import { fontCoversTextSync } from '#core/text/opentype'

export const FIGMA_CJK_PROJECTION_FONT = 'Noto Sans SC'

const HAN_TEXT_PATTERN = /\p{Script=Han}/u

function isHanProjectionText(node: SceneNode): boolean {
  return node.type === 'TEXT' && Boolean(node.text) && HAN_TEXT_PATTERN.test(node.text)
}

function needsCJKProjectionFont(node: SceneNode): boolean {
  return !fontCoversTextSync(
    node.fontFamily,
    weightToStyle(node.fontWeight, node.italic),
    node.text
  )
}

/**
 * Give Figma-compatible synthetic text a complete offline CJK face before the
 * archive serializer builds derived glyphs. Figma does not reliably live-shape
 * a projected TEXT node whose primary font lacks Han glyphs: without a real
 * glyph cache the label stays blank until the user selects it.
 *
 * Projection nodes are export-only clones, so changing their font does not
 * mutate the OpenPencil document or its lowcode semantics.
 */
export async function prepareFigmaProjectionFonts(nodes: readonly SceneNode[]): Promise<void> {
  const textNodes = nodes.filter(isHanProjectionText)
  if (textNodes.length === 0) return

  const candidates = textNodes.filter(needsCJKProjectionFont)
  if (candidates.length === 0) return

  const characters = Array.from(new Set(candidates.flatMap((node) => Array.from(node.text)))).join(
    ''
  )
  const loaded = await fontManager.loadFont(FIGMA_CJK_PROJECTION_FONT, 'Regular', characters)
  if (!loaded) return

  for (const node of candidates) {
    if (!fontCoversTextSync(FIGMA_CJK_PROJECTION_FONT, 'Regular', node.text)) continue
    node.fontFamily = FIGMA_CJK_PROJECTION_FONT
    node.fontWeight = 400
    node.italic = false
  }
}
