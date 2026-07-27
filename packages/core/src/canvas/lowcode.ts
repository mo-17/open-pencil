import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import { buttonLabelTextNode } from '#core/text/lowcode'

import type { SkiaRenderer } from './renderer'

export { buttonLabelTextNode }

export function renderButtonLabel(r: SkiaRenderer, canvas: Canvas, node: SceneNode): void {
  const label = buttonLabelTextNode(node)
  if (!label) return

  // BUTTON fills describe its background, not its label color. Match the
  // generated control's default foreground and let style runs override it.
  r.fillPaint.setShader(null)
  r.fillPaint.setColor(r.ck.BLACK)
  r.fillPaint.setAlphaf(1)
  r.fillPaint.setBlendMode(r.ck.BlendMode.SrcOver)
  r.renderText(canvas, label)
}
