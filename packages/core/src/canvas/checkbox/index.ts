import type { Canvas } from 'canvaskit-wasm'

import { DEFAULT_LOWCODE_TEXT_COLOR, normalizeLowcodeTextColor } from '@open-pencil/lowcode'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import {
  clipControlContent,
  configureControlPaint,
  controlContentBox
} from '#core/canvas/control-content'
import type { SkiaRenderer } from '#core/canvas/renderer'

import { checkboxDesignContent, checkboxTextNode } from './state'

function drawCheck(
  r: SkiaRenderer,
  canvas: Canvas,
  size: number,
  checked: boolean,
  opacity: number
) {
  if (size <= 0) return
  const inset = Math.min(0.75, size / 4)
  const box = r.ck.RRectXY(
    r.ck.LTRBRect(inset, inset, size - inset, size - inset),
    Math.min(3, size / 5),
    Math.min(3, size / 5)
  )
  configureControlPaint(r, checked ? '#2563EB' : '#FFFFFF', opacity)
  canvas.drawRRect(box, r.fillPaint)
  configureControlPaint(r, checked ? '#2563EB' : '#6B7280', opacity, Math.min(1.5, size / 8))
  canvas.drawRRect(box, r.auxStroke)
  if (!checked) return
  configureControlPaint(r, '#FFFFFF', opacity, Math.min(2, size / 8))
  canvas.drawLine(size * 0.23, size * 0.51, size * 0.43, size * 0.71, r.auxStroke)
  canvas.drawLine(size * 0.43, size * 0.71, size * 0.79, size * 0.3, r.auxStroke)
}

/** Inert checkbox appearance; checking the control remains a generated-app interaction. */
export function renderCheckboxContent(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  graph: SceneGraph
): void {
  const box = controlContentBox(node)
  if (!box) return
  const design = checkboxDesignContent(graph, node)
  const opacity = node.interactiveProps?.disabled === true ? 0.45 : 1
  const color = normalizeLowcodeTextColor(
    node.interactiveProps?.textColor,
    DEFAULT_LOWCODE_TEXT_COLOR
  )
  canvas.save()
  try {
    clipControlContent(r, canvas, node, box)
    if (!design.group) {
      const size = Math.min(20, box.width, box.height)
      canvas.translate(0, (box.height - size) / 2)
      drawCheck(r, canvas, size, design.checked, opacity)
      return
    }
    const textNode = checkboxTextNode(graph, node)
    if (!textNode) return
    const rowHeight = Math.max(20, node.lineHeight ?? node.fontSize * 1.5)
    const size = Math.min(16, box.width, rowHeight)
    const labelLeft = size + 8
    const horizontal = node.layoutMode === 'HORIZONTAL'
    const gap = node.layoutMode === 'NONE' ? 8 : Math.max(0, node.itemSpacing)
    let cursor = 0
    for (const option of design.options) {
      const available = horizontal ? box.width - cursor : box.height - cursor
      if (available <= 0) break
      const label: SceneNode = {
        ...textNode,
        text: option.label,
        width: Math.max(0, box.width - labelLeft - (horizontal ? cursor : 0)),
        height: rowHeight,
        textAlignHorizontal: 'LEFT',
        textAlignVertical: 'CENTER',
        textTruncation: 'ENDING',
        maxLines: 1
      }
      canvas.save()
      try {
        canvas.translate(horizontal ? cursor : 0, horizontal ? 0 : cursor)
        canvas.save()
        try {
          canvas.translate(0, (rowHeight - size) / 2)
          drawCheck(r, canvas, size, design.selected.has(option.value), opacity)
        } finally {
          canvas.restore()
        }
        if (label.width > 0) {
          canvas.translate(labelLeft, 0)
          configureControlPaint(r, color, opacity)
          r.renderText(canvas, label)
        }
      } finally {
        canvas.restore()
      }
      cursor +=
        gap +
        (horizontal
          ? labelLeft + (r.measureTextNode(label, label.width)?.width ?? label.width)
          : rowHeight)
    }
  } finally {
    canvas.restore()
  }
}
