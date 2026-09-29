import type { Canvas } from 'canvaskit-wasm'

import { DEFAULT_LOWCODE_TEXT_COLOR, normalizeLowcodeTextColor } from '@open-pencil/lowcode'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { parseColor } from '#core/color'

import { clipControlContent, controlContentBox } from './control-content'
import { boundControlInitialValue } from './control-state'
import type { SkiaRenderer } from './renderer'

/** Read authored initial state only; the editor never runs a control's event handlers. */
export function radioDesignValue(graph: SceneGraph, node: SceneNode): string {
  return (
    boundControlInitialValue(graph, node, 'string') ??
    (typeof node.interactiveProps?.value === 'string' ? node.interactiveProps.value : '')
  )
}

function optionTextNode(node: SceneNode, text: string, width: number, height: number): SceneNode {
  return {
    ...node,
    type: 'TEXT',
    childIds: [],
    text,
    width,
    height,
    textAutoResize: 'NONE',
    textAlignHorizontal: 'LEFT',
    textAlignVertical: 'CENTER',
    textTruncation: 'ENDING',
    maxLines: 1,
    textPicture: null,
    derivedTextGlyphs: null,
    textPathData: null,
    textPathBox: null
  }
}

function paintColor(r: SkiaRenderer, css: string, alpha: number, stroke = false): void {
  const color = parseColor(css)
  const paint = stroke ? r.auxStroke : r.fillPaint
  paint.setShader(null)
  paint.setColor(r.color4f(color.r, color.g, color.b, color.a * alpha))
  paint.setBlendMode(r.ck.BlendMode.SrcOver)
  if (stroke) {
    r.auxStroke.setStrokeWidth(1.5)
    r.auxStroke.setPathEffect(null)
  }
}

interface RadioAppearance {
  color: string
  alpha: number
  selected: string
  radius: number
}

function radioAppearance(graph: SceneGraph, node: SceneNode, rowHeight: number): RadioAppearance {
  return {
    color: normalizeLowcodeTextColor(node.interactiveProps?.textColor, DEFAULT_LOWCODE_TEXT_COLOR),
    alpha: node.interactiveProps?.disabled === true ? 0.45 : 1,
    selected: radioDesignValue(graph, node),
    radius: Math.min(8, rowHeight / 2 - 1)
  }
}

function drawOption(
  r: SkiaRenderer,
  canvas: Canvas,
  label: SceneNode,
  appearance: RadioAppearance
): void {
  const { color, alpha, selected, radius } = appearance
  paintColor(r, '#6B7280', alpha, true)
  canvas.drawCircle(radius + 1, label.height / 2, radius, r.auxStroke)
  if (label.text !== '' && label.text === selected) {
    paintColor(r, color, alpha)
    canvas.drawCircle(radius + 1, label.height / 2, radius * 0.5, r.fillPaint)
  }
  if (label.width <= 0) return
  canvas.translate(radius * 2 + 8, 0)
  paintColor(r, color, alpha)
  r.renderText(canvas, label)
}

/** A bounded, non-interactive representation of the native radio group's initial appearance. */
export function renderRadioContent(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  graph: SceneGraph
): void {
  const options = node.interactiveProps?.options
  if (!Array.isArray(options) || node.width <= 0 || node.height <= 0) return
  const values = options.filter((option): option is string => typeof option === 'string')
  const content = controlContentBox(node)
  if (values.length === 0 || !content) return
  const { width, height } = content

  const rowHeight = Math.max(20, node.lineHeight || node.fontSize * 1.5)
  const appearance = radioAppearance(graph, node, rowHeight)
  const labelLeft = appearance.radius * 2 + 8
  const horizontal = node.layoutMode === 'HORIZONTAL'
  const gap = node.layoutMode === 'NONE' ? 8 : Math.max(0, node.itemSpacing)
  let offset = 0

  canvas.save()
  try {
    clipControlContent(r, canvas, node, content)
    for (const value of values) {
      if (offset >= (horizontal ? width : height)) break
      const labelWidth = Math.max(0, width - (horizontal ? offset : 0) - labelLeft)
      const label = optionTextNode(node, value, labelWidth, rowHeight)
      const rowWidth = horizontal
        ? Math.min(
            width - offset,
            labelLeft + (r.measureTextNode(label, labelWidth)?.width ?? labelWidth)
          )
        : width
      canvas.save()
      try {
        canvas.translate(horizontal ? offset : 0, horizontal ? 0 : offset)
        drawOption(r, canvas, label, appearance)
      } finally {
        canvas.restore()
      }
      offset += (horizontal ? rowWidth : rowHeight) + gap
    }
  } finally {
    canvas.restore()
  }
}
