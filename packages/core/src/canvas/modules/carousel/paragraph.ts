import type { Canvas, Paragraph } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import { withModulePreviewRectClip } from '#core/canvas/modules/preview'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { withTextParagraph } from '#core/canvas/text'
import { parseColor } from '#core/color'

import { carouselLabelNode, type CarouselTextRole } from './text'

function withCarouselParagraph(
  renderer: SkiaRenderer,
  host: SceneNode,
  text: string,
  role: CarouselTextRole,
  cssColor: string,
  bounds: Rect,
  alignment: SceneNode['textAlignHorizontal'],
  use: (paragraph: Paragraph) => number
): number | null {
  if (!text || bounds.width <= 0 || bounds.height <= 0) return 0
  if (!renderer.fontProvider || !renderer.fontsLoaded) return null
  const label = carouselLabelNode(host, text, role, bounds, alignment)
  const readiness = renderer.nodeFontReadiness(label)
  if (readiness !== 'ready' && readiness !== 'substituted') return null
  const rgba = parseColor(cssColor)
  const color = renderer.color4f(rgba.r, rgba.g, rgba.b, rgba.a)
  return withTextParagraph(renderer, label, color, { halfLeading: true }, use)
}

export function measureCarouselText(
  renderer: SkiaRenderer,
  host: SceneNode,
  text: string,
  role: CarouselTextRole,
  cssColor: string,
  bounds: Rect,
  alignment: SceneNode['textAlignHorizontal']
): number {
  return (
    withCarouselParagraph(renderer, host, text, role, cssColor, bounds, alignment, (paragraph) =>
      paragraph.getHeight()
    ) ?? 0
  )
}

export function drawCarouselText(
  renderer: SkiaRenderer,
  canvas: Canvas,
  host: SceneNode,
  text: string,
  role: CarouselTextRole,
  cssColor: string,
  bounds: Rect,
  alignment: SceneNode['textAlignHorizontal'] = 'LEFT'
): number | null {
  return withCarouselParagraph(
    renderer,
    host,
    text,
    role,
    cssColor,
    bounds,
    alignment,
    (paragraph) =>
      withModulePreviewRectClip(renderer, canvas, bounds, () => {
        canvas.drawParagraph(paragraph, bounds.x, bounds.y)
        return paragraph.getHeight()
      })
  )
}
