import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'
import { createDefaultNode } from '@open-pencil/scene-graph/node-defaults'

import type { SkiaRenderer } from '#core/canvas/renderer'
import { parseColor } from '#core/color'
import { DEFAULT_FONT_FAMILY } from '#core/constants'
import type { VRTourLocale } from '#core/plugins/vr-tour'

interface VRTourLabelOptions {
  text: string
  x: number
  baseline: number
  maxWidth: number
  color: string
  locale?: VRTourLocale
}

/** A transient projection shares its real host ID for font-settlement invalidation. */
export function vrTourLabelTextNode(
  host: SceneNode,
  text: string,
  width: number,
  fontSize: number,
  locale: VRTourLocale = 'en'
): SceneNode {
  return createDefaultNode(() => host.id, 'TEXT', {
    text,
    width,
    height: fontSize * 1.5,
    fontFamily: DEFAULT_FONT_FAMILY,
    fontWeight: 400,
    fontSize,
    textLanguage: locale,
    textAutoResize: 'NONE',
    textTruncation: 'ENDING',
    maxLines: 1
  })
}

/** Reuse the existing glyph-coverage/fallback path without retaining module-owned paragraphs. */
export function drawVRTourLabel(
  renderer: SkiaRenderer,
  canvas: Canvas,
  host: SceneNode,
  options: VRTourLabelOptions
): void {
  const font = renderer.labelFont
  if (!font || !renderer.fontProvider || !renderer.fontsLoaded || options.maxWidth <= 0) return
  const label = vrTourLabelTextNode(
    host,
    options.text,
    options.maxWidth,
    font.getSize(),
    options.locale
  )
  const readiness = renderer.nodeFontReadiness(label)
  if (readiness !== 'ready' && readiness !== 'substituted') return
  const color = parseColor(options.color)
  const paragraph = renderer.buildParagraph(
    label,
    renderer.color4f(color.r, color.g, color.b, color.a),
    { halfLeading: true }
  )
  try {
    canvas.drawParagraph(paragraph, options.x, options.baseline - paragraph.getAlphabeticBaseline())
  } finally {
    paragraph.delete()
  }
}
