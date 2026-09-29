import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleLabelTextNode } from '#core/canvas/modules/label'
import { withModulePreviewRectClip } from '#core/canvas/modules/preview'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { parseColor } from '#core/color'
import { resolveChartModule, type ChartText } from '#core/plugins/chart'
import { chartLabel, CHART_FONT_SIZE } from '#core/plugins/chart/primitives'

function chartLocale(node: SceneNode): string {
  const language = node.interactiveProps?.lang
  if (typeof language === 'string' && language.trim()) return language.trim()
  return node.textLanguage?.trim() || 'en'
}

function emptyLabel(node: SceneNode): string {
  return chartLocale(node).toLowerCase().startsWith('zh') ? '暂无非零数据' : 'No non-zero values'
}

export function chartTextNode(node: SceneNode): SceneNode | null {
  if (node.type !== 'FRAME') return null
  const resolved = resolveChartModule(node.interactiveProps?.module)
  if (!resolved?.ok) return null
  const { config } = resolved
  const text = [...config.labels, ...config.values.map(String), emptyLabel(node), '+64'].join('\n')
  return moduleLabelTextNode(node, text, node.width, CHART_FONT_SIZE, chartLocale(node))
}

export function drawChartText(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  item: ChartText
): void {
  if (!renderer.fontProvider || !renderer.fontsLoaded) return
  const text =
    item.kind === 'empty' ? chartLabel(emptyLabel(node), item.width, item.fontSize) : item.text
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
