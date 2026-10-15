import type { Canvas } from 'canvaskit-wasm'

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { moduleLabelTextNode } from '#core/canvas/modules/label'
import {
  configureModulePreviewPaint,
  renderResolvedModulePreview,
  withModulePreviewOpacity,
  withModulePreviewSurface
} from '#core/canvas/modules/preview'
import type { ModuleCanvasAdapter } from '#core/canvas/modules/types'
import { readModuleInitialValue, moduleControlState } from '#core/canvas/modules/value-controls'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { withTextParagraph } from '#core/canvas/text'
import { parseColor } from '#core/color'
import {
  TREE_MODULE_TYPE,
  TREE_PLUGIN_ID,
  resolveTreeModule,
  treeSelectedIds,
  treeVisibleRows,
  type TreeRow
} from '#core/plugins/tree'

import { treeLanguage } from './text'
export { treeTextNode } from './text'
export function renderTreeModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  graph?: SceneGraph
): boolean {
  return renderResolvedModulePreview(node, resolveTreeModule, (frame) => {
    const { width, height } = frame,
      config = { ...frame.config, ...moduleControlState(node, frame.config) },
      inset = Math.min(12, width / 8, height / 8),
      inner = Math.max(0, width - inset * 2),
      language = treeLanguage(node),
      zh = language.toLowerCase().startsWith('zh'),
      rowHeight = Math.max(config.rowHeight, config.fontSize * 1.4 + 8)
    const binding = readModuleInitialValue(
      graph,
      node,
      'value',
      config.selectionMode === 'single' ? 'string' : 'array'
    )
    const authored =
      config.selectionMode === 'single'
        ? (config.initialSelectedIds[0] ?? '')
        : config.initialSelectedIds
    const selected = treeSelectedIds(config, binding.bound ? binding.value : authored)
    function label(
      text: string,
      x: number,
      y: number,
      labelWidth: number,
      color = config.textColor,
      opacity = 1,
      fontWeight = 400
    ) {
      if (labelWidth <= 0 || !renderer.fontProvider || !renderer.fontsLoaded) return
      const textNode = {
          ...moduleLabelTextNode(node, text, labelWidth, config.fontSize, language),
          fontWeight
        },
        readiness = renderer.nodeFontReadiness(textNode)
      if (readiness !== 'ready' && readiness !== 'substituted') return
      const rgba = parseColor(color)
      withTextParagraph(
        renderer,
        textNode,
        renderer.color4f(rgba.r, rgba.g, rgba.b, rgba.a * opacity),
        { halfLeading: true },
        (paragraph) => paragraph.draw(canvas, x, y)
      )
    }
    function box(
      x: number,
      y: number,
      w: number,
      h: number,
      color: string,
      radius = 6,
      opacity = 1
    ) {
      if (w <= 0 || h <= 0) return
      configureModulePreviewPaint(renderer, color)
      renderer.fillPaint.setAlphaf(opacity)
      canvas.drawRRect(
        renderer.ck.RRectXY(renderer.ck.XYWHRect(x, y, w, h), radius, radius),
        renderer.fillPaint
      )
    }
    function drawRow(row: TreeRow, y: number, opacity: number) {
      withModulePreviewOpacity(renderer, canvas, row.disabled ? 0.5 : opacity, () => {
        const isSelected = selected?.includes(row.item.id) === true,
          left = inset + Math.min(inner * 0.4, (row.level - 1) * 16)
        if (isSelected) {
          box(inset, y, inner, rowHeight, config.accentColor, 6, 24 / 255)
        }
        const color = isSelected ? config.accentColor : config.textColor,
          fade = 1
        if (row.hasChildren) {
          configureModulePreviewPaint(renderer, color)
          renderer.fillPaint.setAlphaf(fade)
          const center = y + rowHeight / 2
          const path = renderer.ck.Path.MakeFromSVGString(
            row.expanded
              ? `M${left + 5} ${center - 3}L${left + 15} ${center - 3}L${left + 10} ${center + 3}Z`
              : `M${left + 7} ${center - 5}L${left + 13} ${center}L${left + 7} ${center + 5}Z`
          )
          if (path) {
            canvas.drawPath(path, renderer.fillPaint)
            path.delete()
          }
        }
        let textX = left + 26
        if (config.selectionMode === 'multiple') {
          box(
            textX,
            y + (rowHeight - 14) / 2,
            14,
            14,
            isSelected ? config.accentColor : config.borderColor,
            3
          )
          if (!isSelected)
            box(textX + 1, y + (rowHeight - 14) / 2 + 1, 12, 12, config.backgroundColor, 2)
          textX += 22
        }
        label(
          row.item.label,
          textX,
          y + (rowHeight - config.fontSize * 1.4) / 2,
          Math.max(0, width - inset - textX - 6),
          color,
          fade
        )
      })
    }
    withModulePreviewSurface(renderer, canvas, frame, config.backgroundColor, () => {
      let y = inset
      label(config.label, inset, y, inner, config.textColor, 1, 600)
      y += config.fontSize * 1.4 + 8
      const summary = (selected ?? [])
          .map((id) => config.items.find((item) => item.id === id)?.label ?? id)
          .join(', '),
        opacity = config.disabled ? 0.5 : 1
      if (config.presentation === 'select') {
        withModulePreviewOpacity(renderer, canvas, opacity, () => {
          box(inset, y, inner, 44, config.borderColor)
          box(inset + 1, y + 1, Math.max(0, inner - 2), 42, config.backgroundColor)
          label(
            selected === null ? '—' : summary || config.placeholder,
            inset + 10,
            y + (44 - config.fontSize * 1.4) / 2,
            Math.max(0, inner - 38),
            config.textColor,
            1
          )
          configureModulePreviewPaint(renderer, config.textColor)
          const path = renderer.ck.Path.MakeFromSVGString(
            `M${width - inset - 20} ${y + 19}L${width - inset - 14} ${y + 25}L${width - inset - 8} ${y + 19}Z`
          )
          if (path) {
            canvas.drawPath(path, renderer.fillPaint)
            path.delete()
          }
        })
        y += 52
      } else {
        if (config.searchable) {
          box(inset, y, inner, rowHeight, config.borderColor)
          box(inset + 1, y + 1, Math.max(0, inner - 2), rowHeight - 2, config.backgroundColor)
          label(
            zh ? '搜索树节点' : 'Search tree items',
            inset + 8,
            y + (rowHeight - config.fontSize * 1.4) / 2,
            Math.max(0, inner - 16),
            config.textColor,
            0.55
          )
          y += rowHeight + 6
        }
        const reserve = config.showValue ? config.fontSize * 1.4 + 12 : 0
        for (const row of treeVisibleRows(config)) {
          if (y + rowHeight > height - inset - reserve) break
          drawRow(row, y, opacity)
          y += rowHeight
        }
      }
      if (config.showValue && y + config.fontSize * 1.4 < height - inset)
        label(
          (zh ? '已选: ' : 'Selected: ') +
            (selected === null ? '—' : summary || (zh ? '未选择' : 'None selected')),
          inset,
          y + 4,
          inner,
          config.textColor,
          0.7
        )
    })
  })
}
export const TREE_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: TREE_PLUGIN_ID,
  moduleType: TREE_MODULE_TYPE,
  render: renderTreeModulePreview
})
