import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleLabelTextNode } from '#core/canvas/modules/label'
import { withModulePreviewRectClip } from '#core/canvas/modules/preview'
import type { SkiaRenderer } from '#core/canvas/renderer'
import type { TextLayout } from '#core/canvas/text'
import { parseColor } from '#core/color'

import { codeBlockLocale } from './text'

interface CodeParagraphOptions {
  text: string
  width: number
  fontSize: number
  color: string
  lineHeight: number
  wrap?: boolean
  weight?: number
  align?: SceneNode['textAlignHorizontal']
}

export function codeBlockParagraph(
  renderer: SkiaRenderer,
  node: SceneNode,
  options: CodeParagraphOptions
): TextLayout | undefined {
  if (!renderer.fontProvider || !renderer.fontsLoaded || options.width <= 0) return undefined
  const label: SceneNode = {
    ...moduleLabelTextNode(
      node,
      options.text || ' ',
      options.width,
      options.fontSize,
      codeBlockLocale(node)
    ),
    fontWeight: options.weight ?? 400,
    lineHeight: options.lineHeight,
    textAlignHorizontal: options.align ?? 'LEFT',
    textTruncation: options.wrap ? 'DISABLED' : 'ENDING',
    maxLines: options.wrap ? null : 1
  }
  const readiness = renderer.nodeFontReadiness(label)
  if (readiness !== 'ready' && readiness !== 'substituted') return undefined
  const color = parseColor(options.color)
  return renderer.buildParagraph(label, renderer.color4f(color.r, color.g, color.b, color.a), {
    halfLeading: true
  })
}

export function paintCodeBlockLabel(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  x: number,
  y: number,
  options: CodeParagraphOptions
): void {
  const paragraph = codeBlockParagraph(renderer, node, options)
  if (!paragraph) return
  try {
    withModulePreviewRectClip(
      renderer,
      canvas,
      { x, y, width: options.width, height: options.lineHeight },
      () => paragraph.draw(canvas, x, y)
    )
  } finally {
    paragraph.delete()
  }
}
