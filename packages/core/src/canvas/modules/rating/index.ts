import type { Canvas, Path } from 'canvaskit-wasm'

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { moduleLabelTextNode } from '#core/canvas/modules/label'
import {
  configureModulePreviewPaint,
  renderResolvedModulePreview,
  withModulePreviewRectClip,
  withModulePreviewSurface
} from '#core/canvas/modules/preview'
import type { ModuleCanvasAdapter } from '#core/canvas/modules/types'
import {
  readModuleInitialValue,
  moduleNumericValue,
  moduleControlState
} from '#core/canvas/modules/value-controls'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { withTextParagraph } from '#core/canvas/text'
import { parseColor } from '#core/color'
import {
  RATING_MODULE_TYPE,
  RATING_PLUGIN_ID,
  RATING_STAR_PATH,
  resolveRatingModule,
  type RatingModuleConfigV1
} from '#core/plugins/rating'

interface RatingLabel {
  text: string
  x: number
  top: number
  width: number
  align?: SceneNode['textAlignHorizontal']
  muted?: boolean
}

function drawLabel(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  config: RatingModuleConfigV1,
  box: RatingLabel
) {
  if (!renderer.fontProvider || !renderer.fontsLoaded || box.width <= 0) return
  const label = {
    ...moduleLabelTextNode(node, box.text, box.width, config.fontSize, node.textLanguage ?? 'en'),
    lineHeight: config.fontSize * 1.4,
    textAlignHorizontal: box.align ?? 'LEFT'
  }
  const readiness = renderer.nodeFontReadiness(label)
  if (readiness !== 'ready' && readiness !== 'substituted') return
  const color = parseColor(config.textColor)
  withTextParagraph(
    renderer,
    label,
    renderer.color4f(color.r, color.g, color.b, color.a * (box.muted ? 0.45 : 1)),
    { halfLeading: true },
    (paragraph) => paragraph.draw(canvas, box.x, box.top)
  )
}

function drawStar(
  renderer: SkiaRenderer,
  canvas: Canvas,
  path: Path,
  config: RatingModuleConfigV1,
  fraction: number
) {
  configureModulePreviewPaint(renderer, config.inactiveColor)
  renderer.fillPaint.setAlphaf(config.disabled ? 0.45 : 1)
  canvas.drawPath(path, renderer.fillPaint)
  if (fraction <= 0) return
  withModulePreviewRectClip(
    renderer,
    canvas,
    { x: 0, y: 0, width: 24 * fraction, height: 24 },
    () => {
      configureModulePreviewPaint(renderer, config.activeColor)
      renderer.fillPaint.setAlphaf(config.disabled ? 0.45 : 1)
      canvas.drawPath(path, renderer.fillPaint)
    }
  )
}

export function renderRatingModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  graph?: SceneGraph
): boolean {
  return renderResolvedModulePreview(node, resolveRatingModule, (frame) => {
    const binding = readModuleInitialValue(graph, node, 'value', 'number')
    const raw = binding.bound ? binding.value : frame.config.initialValue
    const invalid = !moduleNumericValue(raw, 0, frame.config.max, frame.config.allowHalf ? 0.5 : 1)
    const config = {
      ...frame.config,
      ...moduleControlState(node, frame.config),
      initialValue: invalid ? 0 : raw
    }
    const innerWidth = Math.max(0, frame.width - 24)
    const starsTop = 12 + config.fontSize * 1.4 + 8
    const rowHeight = Math.max(44, config.starSize)
    const size = Math.min(config.starSize, innerWidth / config.max)
    withModulePreviewSurface(renderer, canvas, frame, config.backgroundColor, () => {
      const path = renderer.ck.Path.MakeFromSVGString(RATING_STAR_PATH)
      try {
        if (path && size > 0) {
          for (let index = 0; index < config.max; index++) {
            canvas.save()
            try {
              canvas.translate(12 + index * size, starsTop + (rowHeight - size) / 2)
              canvas.scale(size / 24, size / 24)
              drawStar(
                renderer,
                canvas,
                path,
                config,
                Math.max(0, Math.min(1, config.initialValue - index))
              )
            } finally {
              canvas.restore()
            }
          }
        }
      } finally {
        path?.delete()
      }
      drawLabel(renderer, canvas, node, config, {
        text: config.label,
        x: 12,
        top: 12,
        width: innerWidth
      })
      const footerTop = starsTop + rowHeight + 4 + Math.max(4, (32 - config.fontSize * 1.4) / 2)
      const valueWidth = config.showValue ? Math.min(innerWidth, config.fontSize * 4.5) : 0
      if (config.showValue) {
        drawLabel(renderer, canvas, node, config, {
          text: invalid ? '—' : `${config.initialValue} / ${config.max}`,
          x: 12,
          top: footerTop,
          width: valueWidth
        })
      }
      if (config.allowClear && !config.readOnly) {
        const clearLeft = 12 + valueWidth + (valueWidth > 0 ? 8 : 0)
        drawLabel(renderer, canvas, node, config, {
          text: config.clearLabel,
          x: clearLeft,
          top: footerTop,
          width: Math.max(0, frame.width - 12 - clearLeft),
          align: 'RIGHT',
          muted: config.disabled || config.initialValue === 0
        })
      }
    })
  })
}

export const RATING_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: RATING_PLUGIN_ID,
  moduleType: RATING_MODULE_TYPE,
  render: renderRatingModulePreview
})
