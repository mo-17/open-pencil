import type { Canvas } from 'canvaskit-wasm'

import { inputControlConfig, type InputControlConfig } from '@open-pencil/lowcode'
import type { SceneNode } from '@open-pencil/scene-graph'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import { configureControlPaint } from './control-content'
import type { SkiaRenderer } from './renderer'

interface InputControlLayout {
  config: Exclude<InputControlConfig, { kind: 'color' }>
  buttonWidth: number
  leading: number
  trailing: number
}

function inputControlLayout(node: SceneNode, content: Rect): InputControlLayout | undefined {
  if (node.type !== 'INPUT') return undefined
  const config = inputControlConfig(node.interactiveProps ?? {})
  if (!config || config.kind === 'color') return undefined
  const visible = config.kind === 'password' || config.showStepper
  const sides = config.kind === 'number' && config.placement === 'sides'
  const buttonWidth = visible
    ? Math.min(config.kind === 'password' ? 24 : 28, content.width / (sides ? 3 : 2))
    : 0
  const reservation = buttonWidth > 0 ? buttonWidth + Math.min(8, content.width / 8) : 0
  return { config, buttonWidth, leading: sides ? reservation : 0, trailing: reservation }
}

function drawChevron(
  r: SkiaRenderer,
  canvas: Canvas,
  x: number,
  y: number,
  direction: 1 | -1,
  size: number
): void {
  canvas.drawLine(x - size, y - (direction * size) / 2, x, y + (direction * size) / 2, r.auxStroke)
  canvas.drawLine(x, y + (direction * size) / 2, x + size, y - (direction * size) / 2, r.auxStroke)
}

function drawInputControl(
  r: SkiaRenderer,
  canvas: Canvas,
  layout: InputControlLayout,
  content: Rect
): void {
  const size = Math.min(5, layout.buttonWidth / 4, content.height / 5)
  if (size <= 0) return
  const x = content.width - layout.buttonWidth / 2
  const y = content.height / 2
  if (layout.config.kind === 'password') {
    canvas.drawOval(r.ck.LTRBRect(x - size * 1.7, y - size, x + size * 1.7, y + size), r.auxStroke)
    canvas.drawCircle(x, y, size * 0.45, r.auxStroke)
  } else if (layout.config.placement === 'sides') {
    const left = layout.buttonWidth / 2
    canvas.drawLine(left - size, y, left + size, y, r.auxStroke)
    canvas.drawLine(x - size, y, x + size, y, r.auxStroke)
    canvas.drawLine(x, y - size, x, y + size, r.auxStroke)
  } else {
    drawChevron(r, canvas, x, content.height / 4, -1, size * 0.65)
    drawChevron(r, canvas, x, (content.height * 3) / 4, 1, size * 0.65)
  }
}

/** Static controls only. Canvas never reveals a password or changes a field value. */
export function renderAuthoredInputControls(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  text: SceneNode,
  content: Rect,
  color: string
): boolean {
  const layout = inputControlLayout(node, content)
  if (!layout) return false
  const width = Math.max(0, text.width - layout.leading - layout.trailing)
  if (width > 0 && text.text) {
    canvas.save()
    try {
      canvas.translate(layout.leading, 0)
      canvas.clipRect(r.ck.LTRBRect(0, 0, width, content.height), r.ck.ClipOp.Intersect, true)
      r.renderText(canvas, { ...text, width })
    } finally {
      canvas.restore()
    }
  }
  if (layout.buttonWidth > 0) {
    const inactive =
      node.interactiveProps?.disabled === true ||
      (layout.config.kind === 'number' &&
        (node.interactiveProps?.readOnly === true || node.interactiveProps?.step === 'any'))
    configureControlPaint(r, color, inactive ? 0.45 : 1, 1.4)
    drawInputControl(r, canvas, layout, content)
  }
  return true
}
