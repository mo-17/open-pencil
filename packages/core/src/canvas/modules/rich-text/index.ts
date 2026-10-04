import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleLabelTextNode } from '#core/canvas/modules/label'
import { modulePreviewFrame } from '#core/canvas/modules/preview'
import type { ModuleCanvasAdapter } from '#core/canvas/modules/types'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { withTextParagraph } from '#core/canvas/text'
import { parseColor } from '#core/color'
import {
  RICH_TEXT_MODULE_TYPE,
  RICH_TEXT_PLUGIN_ID,
  resolveRichTextModule
} from '#core/plugins/rich-text'

import { richTextVisibleLines } from './text'
export { richTextPreviewLines } from './text'

const TEXT_ALIGNMENT = { left: 'LEFT', center: 'CENTER', right: 'RIGHT' } as const

/** Draw the bounded AST sketch through the editor's shared shaping and fallback pipeline. */
export function renderRichTextModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  const frame = modulePreviewFrame(node)
  if (!frame) return false
  const resolved = resolveRichTextModule(frame.node.interactiveProps?.module)
  if (!resolved?.ok) return false
  if (frame.empty) return true
  if (!renderer.fontProvider || !renderer.fontsLoaded) return true
  const { inset, lineHeight, availableWidth, lines } = richTextVisibleLines(node, resolved.config)

  canvas.save()
  try {
    canvas.clipRRect(renderer.makeRRect(frame.node), renderer.ck.ClipOp.Intersect, true)
    lines.forEach((line, index) => {
      if (!line.text || availableWidth <= 0) return
      const label = {
        ...moduleLabelTextNode(
          node,
          line.text,
          availableWidth,
          resolved.config.fontSize,
          node.textLanguage ?? 'en'
        ),
        lineHeight,
        height: lineHeight,
        textAlignHorizontal: TEXT_ALIGNMENT[line.align]
      }
      const readiness = renderer.nodeFontReadiness(label)
      if (readiness !== 'ready' && readiness !== 'substituted') return
      const color = parseColor(line.color)
      withTextParagraph(
        renderer,
        label,
        renderer.color4f(color.r, color.g, color.b, color.a),
        { halfLeading: true },
        (paragraph) => canvas.drawParagraph(paragraph, inset, inset + lineHeight * index)
      )
    })
  } finally {
    canvas.restore()
  }
  return true
}

export const RICH_TEXT_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: RICH_TEXT_PLUGIN_ID,
  moduleType: RICH_TEXT_MODULE_TYPE,
  render: renderRichTextModulePreview
})
