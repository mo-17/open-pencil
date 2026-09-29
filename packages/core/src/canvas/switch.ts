import type { Canvas } from 'canvaskit-wasm'

import { LOWCODE_SWITCH_APPEARANCE, lowcodeSwitchGeometry } from '@open-pencil/lowcode'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { parseColor } from '#core/color'

import { boundControlInitialValue } from './control-state'
import type { SkiaRenderer } from './renderer'

function switchChecked(graph: SceneGraph, node: SceneNode): boolean {
  return boundControlInitialValue(graph, node, 'boolean') ?? node.interactiveProps?.checked === true
}

/** The native switch owns its track palette and capsule shape without changing authored data. */
export function withSwitchSurface(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  graph: SceneGraph,
  draw: (surface: SceneNode) => void
): void {
  const checked = switchChecked(graph, node)
  const style = LOWCODE_SWITCH_APPEARANCE
  const surface: SceneNode = {
    ...node,
    cornerRadius: Math.max(0, Math.min(node.width, node.height) / 2),
    cornerSmoothing: 0,
    independentCorners: false,
    fills: [
      {
        type: 'SOLID',
        color: parseColor(checked ? style.trackOn : style.trackOff),
        opacity: 1,
        visible: true
      }
    ]
  }
  const disabled = node.interactiveProps?.disabled === true
  if (disabled) {
    r.opacityPaint.setAlphaf(style.disabledOpacity)
    r.opacityPaint.setBlendMode(r.ck.BlendMode.SrcOver)
    canvas.saveLayer(r.opacityPaint)
  }
  try {
    draw(surface)
  } finally {
    if (disabled) {
      canvas.restore()
      r.opacityPaint.setAlphaf(1)
      r.opacityPaint.setBlendMode(r.ck.BlendMode.SrcOver)
    }
  }
}

/** Only the authored initial value is shown; interaction remains in the generated preview. */
export function renderSwitchContent(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  graph: SceneGraph
): void {
  const geometry = lowcodeSwitchGeometry(node, switchChecked(graph, node))
  if (!geometry) return
  const { thumb, trackRadius } = geometry
  const color = parseColor(LOWCODE_SWITCH_APPEARANCE.thumb)
  canvas.save()
  try {
    canvas.clipRRect(
      r.ck.RRectXY(r.ck.LTRBRect(0, 0, node.width, node.height), trackRadius, trackRadius),
      r.ck.ClipOp.Intersect,
      true
    )
    r.fillPaint.setShader(null)
    r.fillPaint.setColor(r.color4f(color.r, color.g, color.b, color.a))
    r.fillPaint.setBlendMode(r.ck.BlendMode.SrcOver)
    canvas.drawCircle(
      thumb.x + thumb.width / 2,
      thumb.y + thumb.height / 2,
      thumb.width / 2,
      r.fillPaint
    )
  } finally {
    canvas.restore()
  }
}
