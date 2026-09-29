import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleLabelTextNode } from '#core/canvas/modules/label'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { withTextParagraph } from '#core/canvas/text'
import { parseColor } from '#core/color'
import type { PaginationCell } from '#core/plugins/pagination'

interface TextStyle {
  top: number
  height: number
  fontSize: number
  color: string
  opacity: number
}
export function drawPaginationText(
  renderer: SkiaRenderer,
  canvas: Canvas,
  host: SceneNode,
  cell: PaginationCell,
  style: TextStyle
) {
  if (!renderer.fontProvider || !renderer.fontsLoaded || cell.width <= 0) return
  const label = {
    ...moduleLabelTextNode(
      host,
      cell.text,
      Math.max(0, cell.width - 4),
      style.fontSize,
      host.textLanguage ?? 'en'
    ),
    textAlignHorizontal: 'CENTER' as const,
    ...(cell.kind === 'summary' ? { maxLines: 2, height: style.height } : {}),
    lineHeight: style.fontSize * 1.5
  }
  const readiness = renderer.nodeFontReadiness(label)
  if (readiness !== 'ready' && readiness !== 'substituted') return
  const color = parseColor(style.color)
  withTextParagraph(
    renderer,
    label,
    renderer.color4f(color.r, color.g, color.b, color.a * style.opacity),
    { halfLeading: true },
    (paragraph) => {
      canvas.drawParagraph(
        paragraph,
        cell.x + 2,
        style.top + Math.max(0, (style.height - paragraph.getHeight()) / 2)
      )
    }
  )
}
