import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import { configureControlPaint } from './control-content'
import type { SkiaRenderer } from './renderer'

export function timeInputClockSize(node: SceneNode, width: number, height: number): number {
  return node.type === 'INPUT' &&
    node.interactiveProps?.inputType === 'time' &&
    node.interactiveProps.readOnly !== true
    ? Math.max(0, Math.min(16, width, height))
    : 0
}

/** A vector clock, never an icon-font dependency or an interactive canvas picker. */
export function renderTimeInputClock(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  width: number,
  height: number,
  size: number
): void {
  configureControlPaint(r, '#6B7280', node.interactiveProps?.disabled === true ? 0.45 : 1, 1.25)
  const x = width - size / 2,
    y = height / 2,
    radius = Math.max(0, size / 2 - 1)
  canvas.drawCircle(x, y, radius, r.auxStroke)
  canvas.drawLine(x, y, x, y - radius * 0.6, r.auxStroke)
  canvas.drawLine(x, y, x + radius * 0.5, y + radius * 0.3, r.auxStroke)
}
