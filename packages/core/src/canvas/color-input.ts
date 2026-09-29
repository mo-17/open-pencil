import type { Canvas } from 'canvaskit-wasm'

import { isHexColorInputValue } from '@open-pencil/lowcode'
import type { SceneNode } from '@open-pencil/scene-graph'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import { configureControlPaint } from './control-content'
import type { SkiaRenderer } from './renderer'

/** A design preview, not a write: unresolved/invalid business colors never become black. */
export function renderColorInputContent(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  text: SceneNode,
  content: Rect,
  foreground: string
): boolean {
  if (node.type !== 'INPUT' || node.interactiveProps?.inputType !== 'color') return false
  const size = Math.min(28, content.height, content.width / 2)
  const offset = size + Math.min(8, content.width / 8)
  const y = (content.height - size) / 2
  const opacity = node.interactiveProps.disabled === true ? 0.45 : 1
  const swatchOpacity = node.interactiveProps.readOnly === true ? opacity * 0.45 : opacity
  const valid = isHexColorInputValue(text.text)
  const rect = r.ck.LTRBRect(0.5, y + 0.5, Math.max(0.5, size - 0.5), y + size - 0.5)
  configureControlPaint(r, valid ? text.text : '#F1F5F9', swatchOpacity)
  canvas.drawRRect(r.ck.RRectXY(rect, Math.min(4, size / 4), Math.min(4, size / 4)), r.fillPaint)
  configureControlPaint(r, '#94A3B8', swatchOpacity, 1)
  canvas.drawRRect(r.ck.RRectXY(rect, Math.min(4, size / 4), Math.min(4, size / 4)), r.auxStroke)
  if (!valid) canvas.drawLine(3, y + size - 3, size - 3, y + 3, r.auxStroke)
  const width = Math.max(0, content.width - offset)
  if (width > 0) {
    configureControlPaint(r, foreground, opacity)
    canvas.save()
    try {
      canvas.translate(offset, 0)
      canvas.clipRect(r.ck.LTRBRect(0, 0, width, content.height), r.ck.ClipOp.Intersect, true)
      r.renderText(canvas, { ...text, width, textAlignHorizontal: 'LEFT' })
    } finally {
      canvas.restore()
    }
  }
  return true
}
