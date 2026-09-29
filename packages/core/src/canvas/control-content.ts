import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import { parseColor } from '#core/color'

import type { SkiaRenderer } from './renderer'

/** Reset shared foreground paints so authored backgrounds cannot tint native control content. */
export function configureControlPaint(
  r: SkiaRenderer,
  color: string,
  opacity: number,
  strokeWidth?: number
): void {
  const rgba = parseColor(color)
  const paint = strokeWidth === undefined ? r.fillPaint : r.auxStroke
  paint.setShader(null)
  paint.setBlendMode(r.ck.BlendMode.SrcOver)
  paint.setColor(r.color4f(rgba.r, rgba.g, rgba.b, rgba.a * opacity))
  if (strokeWidth !== undefined) {
    r.auxStroke.setStrokeWidth(strokeWidth)
    r.auxStroke.setPathEffect(null)
  }
}

/** The authored surface stays separate from the native control content inside its padding. */
export function controlContentBox(node: SceneNode): Rect | null {
  const width = node.width - node.paddingLeft - node.paddingRight
  const height = node.height - node.paddingTop - node.paddingBottom
  if (width <= 0 || height <= 0) return null
  return { x: node.paddingLeft, y: node.paddingTop, width, height }
}

/** Call inside a saved canvas scope; content coordinates start at the padding origin. */
export function clipControlContent(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  box: Rect
): void {
  canvas.clipRRect(r.makeRRect(node), r.ck.ClipOp.Intersect, true)
  canvas.translate(box.x, box.y)
  canvas.clipRect(r.ck.LTRBRect(0, 0, box.width, box.height), r.ck.ClipOp.Intersect, true)
}
