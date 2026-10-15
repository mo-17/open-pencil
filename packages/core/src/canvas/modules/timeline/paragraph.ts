import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleMultilineLabelNode } from '#core/canvas/modules/label'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { withTextParagraph } from '#core/canvas/text'
import { parseColor } from '#core/color'
import { TIMELINE_LAYOUT } from '#core/plugins/timeline'

interface TimelineTextBlock {
  text: string
  x: number
  y: number
  width: number
  fontSize: number
  color: string
  strong?: boolean
  endAligned?: boolean
}

/** Paragraph height drives the next event, including CJK fallback and explicit line breaks. */
export function drawTimelineText(
  renderer: SkiaRenderer,
  canvas: Canvas,
  host: SceneNode,
  block: TimelineTextBlock
): number {
  if (!block.text || block.width <= 0 || !renderer.fontProvider || !renderer.fontsLoaded) return 0
  const label: SceneNode = {
    ...moduleMultilineLabelNode(host, block.text, {
      width: block.width,
      fontSize: block.fontSize,
      fontWeight: block.strong ? 600 : 400,
      lineHeight: block.fontSize * TIMELINE_LAYOUT.lineHeight
    }),
    textAlignHorizontal: block.endAligned ? 'RIGHT' : 'LEFT'
  }
  const readiness = renderer.nodeFontReadiness(label)
  if (readiness !== 'ready' && readiness !== 'substituted') return 0
  const color = parseColor(block.color)
  return withTextParagraph(
    renderer,
    label,
    renderer.color4f(color.r, color.g, color.b, color.a),
    { halfLeading: true },
    (paragraph) => {
      paragraph.draw(canvas, block.x, block.y)
      return paragraph.getHeight()
    }
  )
}
