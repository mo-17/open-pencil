import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import { moduleLabelTextNode } from '#core/canvas/modules/label'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { withTextParagraph } from '#core/canvas/text'
import { parseColor } from '#core/color'
import { DATE_RANGE_LAYOUT } from '#core/plugins/date-range'

import { dateRangeNodeLanguage } from './text'

export interface DateRangeTextRun extends Rect {
  text: string
  fontSize: number
  weight?: number
  centered?: boolean
  multiline?: boolean
}
export function drawDateRangeText(
  renderer: SkiaRenderer,
  canvas: Canvas,
  host: SceneNode,
  run: DateRangeTextRun,
  color: string,
  opacity: number
): void {
  if (!renderer.fontProvider || !renderer.fontsLoaded || run.width <= 0 || !run.text) return
  const label = moduleLabelTextNode(
    host,
    run.text,
    run.width,
    run.fontSize,
    dateRangeNodeLanguage(host)
  )
  label.fontWeight = run.weight ?? 400
  label.lineHeight = run.fontSize * DATE_RANGE_LAYOUT.lineHeight
  label.textAlignHorizontal = run.centered ? 'CENTER' : 'LEFT'
  label.maxLines = run.multiline ? null : 1
  label.textTruncation = run.multiline ? 'DISABLED' : 'ENDING'
  const readiness = renderer.nodeFontReadiness(label)
  if (readiness !== 'ready' && readiness !== 'substituted') return
  const tint = parseColor(color)
  withTextParagraph(
    renderer,
    label,
    renderer.color4f(tint.r, tint.g, tint.b, opacity),
    { halfLeading: true },
    (paragraph) => {
      canvas.drawParagraph(
        paragraph,
        run.x,
        run.y + Math.max(0, (run.height - paragraph.getHeight()) / 2)
      )
    }
  )
}
