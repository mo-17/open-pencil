import type { Paragraph } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleMultilineLabelNode } from '#core/canvas/modules/label'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { parseColor } from '#core/color'
import { DESCRIPTIONS_LAYOUT } from '#core/plugins/descriptions'

export function descriptionsParagraph(
  renderer: SkiaRenderer,
  node: SceneNode,
  text: string,
  width: number,
  fontSize: number,
  cssColor: string
): Paragraph | undefined {
  if (!text || width <= 0 || !renderer.fontProvider || !renderer.fontsLoaded) return undefined
  const label = moduleMultilineLabelNode(node, text, {
    width,
    fontSize,
    fontWeight: 400,
    lineHeight: fontSize * DESCRIPTIONS_LAYOUT.lineHeight
  })
  const readiness = renderer.nodeFontReadiness(label)
  if (readiness !== 'ready' && readiness !== 'substituted') return undefined
  const color = parseColor(cssColor)
  return renderer.buildParagraph(label, renderer.color4f(color.r, color.g, color.b, color.a), {
    halfLeading: true
  })
}
