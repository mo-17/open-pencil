import type { Canvas } from 'canvaskit-wasm'

import type { Rect } from '@open-pencil/scene-graph/primitives'

import { configureControlPaint } from '#core/canvas/control-content'
import type { SkiaRenderer } from '#core/canvas/renderer'
import type { EffectPickConfigV1 } from '#core/plugins/effect-pick'

import { drawFamilyBox, drawFamilyLine, drawFamilyPath, familyPoint } from './drawing'

function drawDots(renderer: SkiaRenderer, canvas: Canvas, box: Rect, config: EffectPickConfigV1) {
  const radius = Math.min(12, box.height * 0.2, box.width / 12)
  drawFamilyBox(
    renderer,
    canvas,
    {
      x: box.x + box.width * 0.32,
      y: box.y + box.height / 2 - radius * 0.35,
      width: box.width * 0.36,
      height: radius * 0.7
    },
    config.secondaryColor,
    0.55
  )
  for (let index = 0; index < 3; index++) {
    const point = familyPoint(box, 0.32 + index * 0.18, 0.5)
    configureControlPaint(renderer, config.color, 1)
    canvas.drawCircle(point.x, point.y, radius, renderer.fillPaint)
  }
}

function drawInfinity(
  renderer: SkiaRenderer,
  canvas: Canvas,
  box: Rect,
  config: EffectPickConfigV1
) {
  const width = Math.min(140, box.width * 0.8)
  const height = Math.min(64, box.height * 0.8)
  const left = box.x + (box.width - width) / 2
  const top = box.y + (box.height - height) / 2
  const cx = left + width / 2
  const cy = top + height / 2
  drawFamilyPath(
    renderer,
    canvas,
    config.color,
    (path) => {
      path.moveTo(cx, cy)
      path.cubicTo(left, top - height * 0.25, left, top + height * 1.25, cx, cy)
      path.cubicTo(left + width, top - height * 0.25, left + width, top + height * 1.25, cx, cy)
    },
    1,
    2
  )
  configureControlPaint(renderer, config.color, 1)
  canvas.drawCircle(
    left + width * 0.82,
    cy - height * 0.14,
    Math.min(5, height * 0.14),
    renderer.fillPaint
  )
}

function drawCradle(renderer: SkiaRenderer, canvas: Canvas, box: Rect, config: EffectPickConfigV1) {
  drawFamilyLine(
    renderer,
    canvas,
    familyPoint(box, 0.25, 0.15),
    familyPoint(box, 0.75, 0.15),
    config.secondaryColor
  )
  const radius = Math.min(8, box.width / 25, box.height * 0.14)
  for (let index = 0; index < 5; index++) {
    const top = familyPoint(box, 0.3 + index * 0.1, 0.15)
    const bottom = familyPoint(box, index === 0 ? 0.17 : 0.3 + index * 0.1, 0.72)
    drawFamilyLine(renderer, canvas, top, bottom, config.color)
    configureControlPaint(renderer, config.color, 1)
    canvas.drawCircle(bottom.x, bottom.y, radius, renderer.fillPaint)
  }
}

function drawEqualizer(
  renderer: SkiaRenderer,
  canvas: Canvas,
  box: Rect,
  config: EffectPickConfigV1
) {
  const heights = [0.35, 0.75, 0.55, 0.9, 0.45]
  const width = Math.min(120, box.width * 0.7)
  const left = box.x + (box.width - width) / 2
  const height = box.height * 0.8
  for (const [index, ratio] of heights.entries())
    drawFamilyBox(
      renderer,
      canvas,
      {
        x: left + (width * index) / 5,
        y: box.y + box.height * 0.9 - height * ratio,
        width: width * 0.12,
        height: height * ratio
      },
      index % 2 ? config.secondaryColor : config.color
    )
}

export function drawFamilyLoader(
  renderer: SkiaRenderer,
  canvas: Canvas,
  box: Rect,
  config: EffectPickConfigV1
): void {
  if (config.effectId === 'infinity-runner') drawInfinity(renderer, canvas, box, config)
  else if (config.effectId === 'newtons-cradle') drawCradle(renderer, canvas, box, config)
  else if (config.effectId === 'equalizer-bars') drawEqualizer(renderer, canvas, box, config)
  else drawDots(renderer, canvas, box, config)
}
