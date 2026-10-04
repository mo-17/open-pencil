import type { Canvas } from 'canvaskit-wasm'

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { moduleLabelTextNode } from '#core/canvas/modules/label'
import { withModulePreviewRectClip } from '#core/canvas/modules/preview'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { parseColor } from '#core/color'
import { resolveChartModule, type ChartText } from '#core/plugins/chart'
import { chartLabel, CHART_FONT_SIZE } from '#core/plugins/chart/primitives'

import { chartDataProjection } from './data'

function chartLocale(node: SceneNode): string {
  const language = node.interactiveProps?.lang
  if (typeof language === 'string' && language.trim()) return language.trim()
  return node.textLanguage?.trim() || 'en'
}

export function chartEmptyLabel(node: SceneNode, invalid = false, emptyData = false): string {
  const chinese = chartLocale(node).toLowerCase().startsWith('zh')
  if (invalid) return chinese ? '图表数据不可用' : 'Chart data unavailable'
  if (emptyData) return chinese ? '暂无数据' : 'No data'
  return chinese ? '暂无非零数据' : 'No non-zero values'
}

export function chartTextNode(node: SceneNode, graph?: SceneGraph): SceneNode | null {
  if (node.type !== 'FRAME') return null
  const resolved = resolveChartModule(node.interactiveProps?.module)
  if (!resolved?.ok) return null
  const projection = chartDataProjection(node, graph, resolved.config, node.width, node.height)
  const { config } = projection
  const text = [
    ...config.labels,
    ...config.values.map(String),
    chartEmptyLabel(node, projection.invalid, projection.emptyData),
    '+64'
  ].join('\n')
  return moduleLabelTextNode(node, text, node.width, CHART_FONT_SIZE, chartLocale(node))
}

export function drawChartText(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  item: ChartText,
  emptyCopy = chartEmptyLabel(node)
): void {
  if (!renderer.fontProvider || !renderer.fontsLoaded) return
  const text = item.kind === 'empty' ? chartLabel(emptyCopy, item.width, item.fontSize) : item.text
  if (!text) return
  const label: SceneNode = {
    ...moduleLabelTextNode(node, text, item.width, item.fontSize, chartLocale(node)),
    height: item.height,
    fontWeight: item.fontWeight,
    lineHeight: item.height,
    textAlignHorizontal: ({ left: 'LEFT', right: 'RIGHT', center: 'CENTER' } as const)[item.align]
  }
  const readiness = renderer.nodeFontReadiness(label)
  if (readiness !== 'ready' && readiness !== 'substituted') return
  const color = parseColor(item.color)
  const paragraph = renderer.buildParagraph(
    label,
    renderer.color4f(color.r, color.g, color.b, color.a),
    { halfLeading: true }
  )
  try {
    withModulePreviewRectClip(renderer, canvas, item, () =>
      canvas.drawParagraph(paragraph, item.x, item.y)
    )
  } finally {
    paragraph.delete()
  }
}
