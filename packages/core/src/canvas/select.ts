import type { Canvas } from 'canvaskit-wasm'

import {
  DEFAULT_LOWCODE_PLACEHOLDER_COLOR,
  DEFAULT_LOWCODE_TEXT_COLOR,
  normalizeLowcodeTextColor
} from '@open-pencil/lowcode'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { selectTextProjection } from '#core/text/lowcode'

import { clipControlContent, configureControlPaint, controlContentBox } from './control-content'
import type { SkiaRenderer } from './renderer'
import { selectDesignContent } from './select-state'

/** A select stays closed and read-only on the design canvas; runtime owns interaction. */
export function renderSelectContent(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  graph: SceneGraph
): void {
  const content = controlContentBox(node)
  if (node.width <= 0 || node.height <= 0 || !content) return
  const projection = selectTextProjection(node, selectDesignContent(graph, node))
  if (!projection) return
  const placeholder = projection.contentKind === 'select_placeholder'
  const textColor = normalizeLowcodeTextColor(
    node.interactiveProps?.[placeholder ? 'placeholderColor' : 'textColor'],
    placeholder ? DEFAULT_LOWCODE_PLACEHOLDER_COLOR : DEFAULT_LOWCODE_TEXT_COLOR
  )
  const opacity = node.interactiveProps?.disabled === true ? 0.45 : 1
  const iconSize = Math.min(12, content.width, content.height)
  const textWidth = Math.max(0, content.width - iconSize - 8)
  canvas.save()
  try {
    clipControlContent(r, canvas, node, content)
    if (textWidth > 0 && projection.node.text !== '') {
      configureControlPaint(r, textColor, opacity)
      r.renderText(canvas, { ...projection.node, width: textWidth, height: content.height })
    }
    configureControlPaint(
      r,
      DEFAULT_LOWCODE_PLACEHOLDER_COLOR,
      opacity,
      Math.min(1.5, iconSize / 5)
    )
    const left = content.width - iconSize
    const centerY = content.height / 2
    canvas.drawLine(
      left + iconSize * 0.2,
      centerY - iconSize * 0.15,
      left + iconSize / 2,
      centerY + iconSize * 0.15,
      r.auxStroke
    )
    canvas.drawLine(
      left + iconSize / 2,
      centerY + iconSize * 0.15,
      left + iconSize * 0.8,
      centerY - iconSize * 0.15,
      r.auxStroke
    )
  } finally {
    canvas.restore()
  }
}
