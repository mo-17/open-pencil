import type { Canvas } from 'canvaskit-wasm'

import {
  DEFAULT_LOWCODE_PLACEHOLDER_COLOR,
  DEFAULT_LOWCODE_TEXT_COLOR,
  normalizeLowcodeTextColor
} from '@open-pencil/lowcode'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { datePickerTextProjection } from '#core/text/lowcode'

import { clipControlContent, configureControlPaint, controlContentBox } from './control-content'
import { boundControlInitialValue } from './control-state'
import type { SkiaRenderer } from './renderer'

/** The calendar glyph is vector geometry, independent of installed icon fonts. */
export function drawCalendar(
  r: SkiaRenderer,
  canvas: Canvas,
  x: number,
  y: number,
  size: number
): void {
  canvas.save()
  try {
    canvas.translate(x, y)
    canvas.scale(size / 16, size / 16)
    const rect = r.ck.RRectXY(r.ck.LTRBRect(1, 3, 15, 15), 2, 2)
    canvas.drawRRect(rect, r.auxStroke)
    canvas.drawLine(1, 7, 15, 7, r.auxStroke)
    canvas.drawLine(5, 1, 5, 5, r.auxStroke)
    canvas.drawLine(11, 1, 11, 5, r.auxStroke)
  } finally {
    canvas.restore()
  }
}

/** Static initial appearance only; selecting the canvas node never opens a date picker. */
export function renderDatePickerContent(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  graph: SceneGraph
): void {
  const content = controlContentBox(node)
  if (node.width <= 0 || node.height <= 0 || !content) return
  const { width, height } = content
  const projection = datePickerTextProjection(node, boundControlInitialValue(graph, node, 'string'))
  if (!projection) return
  const placeholder = projection.contentKind === 'datepicker_placeholder'
  const color = normalizeLowcodeTextColor(
    node.interactiveProps?.[placeholder ? 'placeholderColor' : 'textColor'],
    placeholder ? DEFAULT_LOWCODE_PLACEHOLDER_COLOR : DEFAULT_LOWCODE_TEXT_COLOR
  )
  const opacity = node.interactiveProps?.disabled === true ? 0.45 : 1
  // A native readonly date input keeps its value visible but offers no picker affordance.
  const iconSize = node.interactiveProps?.readOnly === true ? 0 : Math.min(16, width, height)
  const textWidth = Math.max(0, width - (iconSize > 0 ? iconSize + 8 : 0))

  canvas.save()
  try {
    clipControlContent(r, canvas, node, content)
    if (textWidth > 0) {
      configureControlPaint(r, color, opacity)
      r.renderText(canvas, { ...projection.node, width: textWidth, height })
    }
    if (iconSize > 0) {
      configureControlPaint(r, DEFAULT_LOWCODE_PLACEHOLDER_COLOR, opacity, 1.25)
      drawCalendar(r, canvas, width - iconSize, (height - iconSize) / 2, iconSize)
    }
  } finally {
    canvas.restore()
  }
}
