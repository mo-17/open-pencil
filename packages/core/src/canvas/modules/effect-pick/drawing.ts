import type { Canvas, PathBuilder } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'
import type { Rect, Vector } from '@open-pencil/scene-graph/primitives'

import { configureControlPaint } from '#core/canvas/control-content'
import { withModulePreviewRectClip } from '#core/canvas/modules/preview'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { withTextParagraph, type TextLayout } from '#core/canvas/text'
import { parseColor } from '#core/color'
import type { EffectPickConfigV1 } from '#core/plugins/effect-pick'

import {
  EFFECT_PICK_PREVIEW_LINE_HEIGHT,
  effectPickPreviewLabel,
  effectPickPreviewText
} from './text'

export function familyBody(node: SceneNode): Rect {
  const inset = Math.min(16, node.width * 0.06, node.height * 0.1)
  return {
    x: inset,
    y: inset,
    width: node.width - inset * 2,
    height: node.height - inset * 2
  }
}

export function familyRegions(body: Rect) {
  const labelHeight =
    body.height >= 48 ? Math.min(EFFECT_PICK_PREVIEW_LINE_HEIGHT * 2, body.height * 0.55) : 0
  const label: Rect = {
    x: body.x,
    y: body.y + body.height - labelHeight,
    width: body.width,
    height: labelHeight
  }
  return {
    label,
    glyph: {
      ...body,
      height: Math.max(0, body.height - labelHeight - (labelHeight ? 6 : 0))
    }
  }
}

export function familyPoint(box: Rect, x: number, y: number): Vector {
  return { x: box.x + box.width * x, y: box.y + box.height * y }
}

export function drawFamilyBox(
  renderer: SkiaRenderer,
  canvas: Canvas,
  box: Rect,
  color: string,
  opacity = 1,
  strokeWidth?: number
): void {
  if (box.width <= 0 || box.height <= 0) return
  configureControlPaint(renderer, color, opacity, strokeWidth)
  const bounds = renderer.ck.XYWHRect(box.x, box.y, box.width, box.height)
  const radius = Math.min(12, box.width * 0.06, box.height * 0.2)
  canvas.drawRRect(
    renderer.ck.RRectXY(bounds, radius, radius),
    strokeWidth === undefined ? renderer.fillPaint : renderer.auxStroke
  )
}

export function drawFamilyLine(
  renderer: SkiaRenderer,
  canvas: Canvas,
  start: Vector,
  end: Vector,
  color: string,
  opacity = 1,
  width = 1.5
): void {
  configureControlPaint(renderer, color, opacity, width)
  canvas.drawLine(start.x, start.y, end.x, end.y, renderer.auxStroke)
}

export function drawFamilyPath(
  renderer: SkiaRenderer,
  canvas: Canvas,
  color: string,
  build: (path: PathBuilder) => void,
  opacity = 1,
  strokeWidth?: number
): void {
  const builder = new renderer.ck.PathBuilder()
  build(builder)
  const path = builder.detachAndDelete()
  try {
    configureControlPaint(renderer, color, opacity, strokeWidth)
    canvas.drawPath(path, strokeWidth === undefined ? renderer.fillPaint : renderer.auxStroke)
  } finally {
    path.delete()
  }
}

export function drawFamilyGradient(
  renderer: SkiaRenderer,
  canvas: Canvas,
  box: Rect,
  config: EffectPickConfigV1,
  opacity: number
): void {
  const colors = [config.color, config.secondaryColor].map((value) => {
    const rgba = parseColor(value)
    return renderer.ck.Color4f(rgba.r, rgba.g, rgba.b, rgba.a * opacity)
  })
  const shader = renderer.ck.Shader.MakeLinearGradient(
    [box.x, box.y],
    [box.x + box.width, box.y + box.height],
    colors,
    [0, 1],
    renderer.ck.TileMode.Clamp
  )
  try {
    renderer.fillPaint.setBlendMode(renderer.ck.BlendMode.SrcOver)
    renderer.fillPaint.setColor(renderer.color4f(1, 1, 1, 1))
    renderer.fillPaint.setShader(shader)
    canvas.drawRect(renderer.ck.XYWHRect(box.x, box.y, box.width, box.height), renderer.fillPaint)
  } finally {
    renderer.fillPaint.setShader(null)
    shader.delete()
  }
}

export function drawFamilyLabel(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  config: EffectPickConfigV1,
  box: Rect
): void {
  if (box.width <= 0 || box.height < EFFECT_PICK_PREVIEW_LINE_HEIGHT) return
  if (!renderer.fontProvider || !renderer.fontsLoaded) return
  withEffectPickPreviewParagraph(
    renderer,
    node,
    config,
    box.width,
    Math.min(2, Math.floor(box.height / EFFECT_PICK_PREVIEW_LINE_HEIGHT)),
    (paragraph) =>
      withModulePreviewRectClip(renderer, canvas, box, () =>
        paragraph.draw(canvas, box.x, box.y + Math.max(0, (box.height - paragraph.getHeight()) / 2))
      )
  )
}

export function withEffectPickPreviewParagraph(
  renderer: SkiaRenderer,
  node: SceneNode,
  config: EffectPickConfigV1,
  width: number,
  maxLines: number,
  draw: (paragraph: TextLayout) => void
): void {
  const label = effectPickPreviewLabel(
    node,
    effectPickPreviewText(config.effectId, config.text),
    width,
    maxLines
  )
  const readiness = renderer.nodeFontReadiness(label)
  if (readiness !== 'ready' && readiness !== 'substituted') return
  const color = parseColor(config.color)
  withTextParagraph(
    renderer,
    label,
    renderer.color4f(color.r, color.g, color.b, color.a),
    { halfLeading: true },
    draw
  )
}
