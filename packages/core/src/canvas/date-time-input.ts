import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import { configureControlPaint } from './control-content'
import { drawCalendar } from './datepicker'
import type { SkiaRenderer } from './renderer'

export function dateTimeInputCalendarSize(node: SceneNode, width: number, height: number): number {
  if (
    node.type !== 'INPUT' ||
    node.interactiveProps?.inputType !== 'datetime-local' ||
    node.interactiveProps.readOnly === true
  )
    return 0
  return Math.max(0, Math.min(16, width, height))
}

/** Reuse the native-date canvas glyph; this is authored appearance, never an interactive picker. */
export function renderDateTimeInputCalendar(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  width: number,
  height: number,
  size: number
): void {
  configureControlPaint(
    renderer,
    '#6B7280',
    node.interactiveProps?.disabled === true ? 0.45 : 1,
    1.25
  )
  drawCalendar(renderer, canvas, width - size, (height - size) / 2, size)
}
