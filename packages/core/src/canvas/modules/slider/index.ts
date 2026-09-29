import type { Canvas } from 'canvaskit-wasm'

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { moduleLabelTextNode } from '#core/canvas/modules/label'
import {
  configureModulePreviewPaint,
  renderResolvedModulePreview,
  withModulePreviewSurface
} from '#core/canvas/modules/preview'
import type { ModuleCanvasAdapter } from '#core/canvas/modules/types'
import { readModuleInitialValue, moduleNumericValue } from '#core/canvas/modules/value-controls'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { withTextParagraph } from '#core/canvas/text'
import { parseColor } from '#core/color'
import { SLIDER_MODULE_TYPE, SLIDER_PLUGIN_ID, resolveSliderModule } from '#core/plugins/slider'

import { sliderPreviewGeometry } from './geometry'

interface SliderLabel {
  text: string
  x: number
  y: number
  width: number
  fontSize: number
  color: string
  align?: SceneNode['textAlignHorizontal']
  weight?: number
  opacity: number
}

function drawLabel(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  options: SliderLabel
): void {
  if (options.width <= 0 || !renderer.fontProvider || !renderer.fontsLoaded) return
  const label = moduleLabelTextNode(
    node,
    options.text,
    options.width,
    options.fontSize,
    node.textLanguage ?? 'en'
  )
  label.textAlignHorizontal = options.align ?? 'LEFT'
  label.fontWeight = options.weight ?? 400
  const readiness = renderer.nodeFontReadiness(label)
  if (readiness !== 'ready' && readiness !== 'substituted') return
  const color = parseColor(options.color)
  withTextParagraph(
    renderer,
    label,
    renderer.color4f(color.r, color.g, color.b, color.a * options.opacity),
    { halfLeading: true },
    (paragraph) => {
      canvas.drawParagraph(paragraph, options.x, options.y)
    }
  )
}

export function renderSliderModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  graph?: SceneGraph
): boolean {
  return renderResolvedModulePreview(node, resolveSliderModule, (frame) => {
    const { width } = frame
    const start = readModuleInitialValue(graph, node, 'value', 'number')
    const end = readModuleInitialValue(graph, node, 'endValue', 'number')
    const rawStart = start.bound ? start.value : frame.config.initialValue
    const rawEnd = end.bound ? end.value : frame.config.initialEndValue
    const valid = (value: unknown): value is number =>
      moduleNumericValue(value, frame.config.min, frame.config.max, frame.config.step)
    const invalid =
      !valid(rawStart) ||
      (frame.config.range && (!valid(rawEnd) || Number(rawStart) > Number(rawEnd)))
    const config = {
      ...frame.config,
      initialValue: valid(rawStart) ? rawStart : frame.config.min,
      initialEndValue: valid(rawEnd) ? rawEnd : frame.config.min
    }
    const geometry = sliderPreviewGeometry(width, config)
    const {
      inset,
      innerWidth,
      thumbRadius,
      trackLeft,
      trackWidth,
      trackY,
      startX,
      endX,
      values,
      boundsY
    } = geometry
    const opacity = config.disabled ? 0.5 : 1
    withModulePreviewSurface(renderer, canvas, frame, config.backgroundColor, () => {
      const valueWidth = config.showValue ? innerWidth * 0.5 : 0
      drawLabel(renderer, canvas, node, {
        text: config.label,
        x: inset,
        y: 16,
        width: Math.max(0, innerWidth - valueWidth - (config.showValue ? 8 : 0)),
        fontSize: config.fontSize,
        color: config.textColor,
        weight: 600,
        opacity
      })
      if (config.showValue)
        drawLabel(renderer, canvas, node, {
          text: invalid ? '—' : values.slice(0, config.range ? 2 : 1).join(' – '),
          x: inset + innerWidth - valueWidth,
          y: 16,
          width: valueWidth,
          fontSize: config.fontSize,
          color: config.accentColor,
          align: 'RIGHT',
          weight: 600,
          opacity
        })
      const pill = (left: number, right: number, color: string) => {
        configureModulePreviewPaint(renderer, color)
        renderer.fillPaint.setAlphaf(opacity)
        canvas.drawRRect(
          renderer.ck.RRectXY(renderer.ck.LTRBRect(left, trackY - 3, right, trackY + 3), 3, 3),
          renderer.fillPaint
        )
      }
      pill(trackLeft, trackLeft + trackWidth, config.trackColor)
      if (!invalid) pill(startX, endX, config.accentColor)
      const thumb = (x: number) => {
        configureModulePreviewPaint(renderer, config.accentColor)
        renderer.fillPaint.setAlphaf(opacity)
        canvas.drawCircle(x, trackY, thumbRadius, renderer.fillPaint)
        configureModulePreviewPaint(renderer, config.backgroundColor)
        canvas.drawCircle(x, trackY, Math.max(0, thumbRadius - 1), renderer.fillPaint)
        configureModulePreviewPaint(renderer, config.accentColor)
        renderer.fillPaint.setAlphaf(opacity)
        canvas.drawCircle(x, trackY, Math.max(0, thumbRadius - 3), renderer.fillPaint)
      }
      if (!invalid) {
        if (config.range) thumb(startX)
        thumb(endX)
      }
      if (config.showBounds) {
        drawLabel(renderer, canvas, node, {
          text: String(config.min),
          x: inset,
          y: boundsY,
          width: innerWidth / 2,
          fontSize: config.fontSize * 0.85,
          color: config.textColor,
          opacity: opacity * 0.7
        })
        drawLabel(renderer, canvas, node, {
          text: String(config.max),
          x: inset + innerWidth / 2,
          y: boundsY,
          width: innerWidth / 2,
          fontSize: config.fontSize * 0.85,
          color: config.textColor,
          align: 'RIGHT',
          opacity: opacity * 0.7
        })
      }
    })
  })
}

export const SLIDER_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: SLIDER_PLUGIN_ID,
  moduleType: SLIDER_MODULE_TYPE,
  render: renderSliderModulePreview
})
