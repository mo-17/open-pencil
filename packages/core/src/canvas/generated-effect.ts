import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import type { SkiaRenderer } from '#core/canvas/renderer'
import type { RenderOverlays } from '#core/canvas/renderer/types'
import { sampleGeneratedEffect, type GeneratedEffectPrimitive } from '#core/motion'

function blendMode(r: SkiaRenderer, value: string) {
  switch (value) {
    case 'screen':
      return r.ck.BlendMode.Screen
    case 'multiply':
      return r.ck.BlendMode.Multiply
    case 'overlay':
      return r.ck.BlendMode.Overlay
    default:
      return r.ck.BlendMode.SrcOver
  }
}

function drawPrimitive(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  primitive: GeneratedEffectPrimitive,
  opacity: number
): void {
  const alpha = Math.max(0, Math.min(1, primitive.color.a * primitive.opacity * opacity))
  r.generatedEffectPaint.setColor(
    r.ck.Color4f(primitive.color.r, primitive.color.g, primitive.color.b, alpha)
  )
  if (primitive.kind === 'circle') {
    canvas.drawCircle(
      primitive.x * node.width,
      primitive.y * node.height,
      primitive.radius * Math.min(node.width, node.height),
      r.generatedEffectPaint
    )
    return
  }

  const x = primitive.x * node.width
  const y = primitive.y * node.height
  const width = primitive.width * node.width
  const height = primitive.height * node.height
  if (primitive.rotation) {
    canvas.save()
    canvas.rotate(primitive.rotation, x + width / 2, y + height / 2)
    canvas.drawRect(r.ck.XYWHRect(x, y, width, height), r.generatedEffectPaint)
    canvas.restore()
  } else {
    canvas.drawRect(r.ck.XYWHRect(x, y, width, height), r.generatedEffectPaint)
  }
}

/** Draw the bounded generated layer over one node subtree. Invalid data draws nothing. */
export function drawGeneratedEffect(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  overlays: RenderOverlays
): void {
  if (!node.generatedEffect || overlays.generatedEffectMode === 'disable') return
  const sample = sampleGeneratedEffect(node.generatedEffect, overlays.generatedEffectTimeMs ?? 0, {
    prefersReducedMotion: overlays.generatedEffectMode === 'reduce'
  })
  if (sample.primitives.length === 0 || sample.opacity <= 0) return

  r.generatedEffectPaint.setBlendMode(blendMode(r, sample.blendMode))
  canvas.save()
  canvas.clipRect(r.ck.XYWHRect(0, 0, node.width, node.height), r.ck.ClipOp.Intersect, true)
  for (const primitive of sample.primitives) {
    drawPrimitive(r, canvas, node, primitive, sample.opacity)
  }
  canvas.restore()
  r.generatedEffectPaint.setBlendMode(r.ck.BlendMode.SrcOver)
}
