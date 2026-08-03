import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import { parseColor } from '#core/color'
import {
  DEFAULT_LOWCODE_PLACEHOLDER_COLOR,
  DEFAULT_LOWCODE_TEXT_COLOR,
  normalizeLowcodeTextColor
} from '#core/lowcode-validation'
import { buttonLabelTextNode, lowcodeTextNode, lowcodeTextProjection } from '#core/text/lowcode'

import type { SkiaRenderer } from './renderer'

export { buttonLabelTextNode, lowcodeTextNode, lowcodeTextProjection }

function configureTextPaint(r: SkiaRenderer, cssColor: string): void {
  const color = parseColor(cssColor)
  r.fillPaint.setShader(null)
  r.fillPaint.setColor(r.color4f(color.r, color.g, color.b, color.a))
  r.fillPaint.setAlphaf(1)
  r.fillPaint.setBlendMode(r.ck.BlendMode.SrcOver)
}

export function renderButtonLabel(r: SkiaRenderer, canvas: Canvas, node: SceneNode): void {
  const label = buttonLabelTextNode(node)
  if (!label) return

  // BUTTON fills describe its background, not its label color. Keep the
  // foreground in interactiveProps so canvas and generated controls agree.
  const color = normalizeLowcodeTextColor(
    node.interactiveProps?.textColor,
    DEFAULT_LOWCODE_TEXT_COLOR
  )
  configureTextPaint(r, color)
  r.renderText(canvas, label)
}

export function renderTextInputContent(r: SkiaRenderer, canvas: Canvas, node: SceneNode): void {
  const projection = lowcodeTextProjection(node)
  if (!projection || projection.contentKind === 'button_label' || projection.node.text === '')
    return

  const placeholder = projection.contentKind.endsWith('_placeholder')
  const color = normalizeLowcodeTextColor(
    node.interactiveProps?.[placeholder ? 'placeholderColor' : 'textColor'],
    placeholder ? DEFAULT_LOWCODE_PLACEHOLDER_COLOR : DEFAULT_LOWCODE_TEXT_COLOR
  )
  configureTextPaint(r, color)

  canvas.save()
  canvas.translate(node.paddingLeft, node.type === 'TEXTAREA' ? node.paddingTop : 0)
  r.renderText(canvas, projection.node)
  canvas.restore()
}
