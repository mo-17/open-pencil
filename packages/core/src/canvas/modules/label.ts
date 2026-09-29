import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'
import { createDefaultNode } from '@open-pencil/scene-graph/node-defaults'

import type { SkiaRenderer } from '#core/canvas/renderer'
import { parseColor } from '#core/color'
import { DEFAULT_FONT_FAMILY } from '#core/constants'

export interface ModuleLabelOptions {
  text: string
  x: number
  baseline: number
  maxWidth: number
  color: string
  locale?: string
}

/** A transient projection shares its real host ID for font-settlement invalidation. */
export function moduleLabelTextNode(
  host: SceneNode,
  text: string,
  width: number,
  fontSize: number,
  locale: string = 'en'
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

/** Font preflight sees both copy blocks and the title face under the real host identity. */
export function moduleTitleDescriptionTextNode(
  host: SceneNode,
  copy: { title: string; description: string; fontSize: number },
  titleFontSize = copy.fontSize
): SceneNode {
  return {
    ...moduleLabelTextNode(
      host,
      copy.title + '\n' + copy.description,
      host.width,
      copy.fontSize,
      host.textLanguage ?? 'en'
    ),
    styleRuns: copy.title
      ? [
          {
            start: 0,
            length: copy.title.length,
            style: {
              fontWeight: 600,
              ...(titleFontSize === copy.fontSize ? {} : { fontSize: titleFontSize })
            }
          }
        ]
      : []
  }
}

/** Multiline module copy keeps host identity and shaping, without single-line ellipsis. */
export function moduleMultilineLabelNode(
  host: SceneNode,
  text: string,
  typography: Pick<SceneNode, 'width' | 'fontSize' | 'fontWeight' | 'lineHeight'>
): SceneNode {
  return {
    ...moduleLabelTextNode(
      host,
      text,
      typography.width,
      typography.fontSize,
      host.textLanguage ?? 'en'
    ),
    ...typography,
    height: host.height,
    textTruncation: 'DISABLED',
    maxLines: null
  }
}

/** Reuse the existing glyph-coverage/fallback path without retaining module-owned paragraphs. */
export function drawModuleLabel(
  renderer: SkiaRenderer,
  canvas: Canvas,
  host: SceneNode,
  options: ModuleLabelOptions
): void {
  const font = renderer.labelFont
  if (
    !font ||
    !renderer.fontProvider ||
    !renderer.fontsLoaded ||
    !options.text ||
    options.maxWidth <= 0
  )
    return
  const label = moduleLabelTextNode(
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
