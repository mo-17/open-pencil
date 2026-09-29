import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import { moduleLabelTextNode } from '#core/canvas/modules/label'
import { withModulePreviewRectClip } from '#core/canvas/modules/preview'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { withTextParagraph } from '#core/canvas/text'
import { parseColor } from '#core/color'

interface NavigationTextStyle {
  fontSize: number
  color: string
  strong?: boolean
  lines?: number
  center?: boolean
}

export function navigationLabelNode(
  host: SceneNode,
  text: string,
  width: number,
  style: NavigationTextStyle
): SceneNode {
  return {
    ...moduleLabelTextNode(host, text, width, style.fontSize, host.textLanguage ?? 'en'),
    fontWeight: style.strong ? 600 : 400,
    lineHeight: style.fontSize * 1.5,
    textAlignHorizontal: style.center ? 'CENTER' : 'LEFT',
    maxLines: style.lines ?? 1
  }
}

/** Returns shaped intrinsic width; drawing and measurement use the same glyph fallback path. */
export function drawNavigationLabel(
  renderer: SkiaRenderer,
  canvas: Canvas,
  host: SceneNode,
  text: string,
  box: Rect,
  style: NavigationTextStyle,
  draw = true
): number {
  if (!text || box.width <= 0 || !renderer.fontProvider || !renderer.fontsLoaded) return 0
  const label = navigationLabelNode(host, text, box.width, style)
  const ready = renderer.nodeFontReadiness(label)
  if (ready !== 'ready' && ready !== 'substituted') return 0
  const color = parseColor(style.color)
  return withTextParagraph(
    renderer,
    label,
    renderer.color4f(color.r, color.g, color.b, color.a),
    { halfLeading: true },
    (paragraph) => {
      if (draw)
        withModulePreviewRectClip(renderer, canvas, box, () =>
          canvas.drawParagraph(paragraph, box.x, box.y)
        )
      return Math.min(box.width, Math.ceil(paragraph.getMaxIntrinsicWidth()))
    }
  )
}
