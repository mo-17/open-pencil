import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleLabelTextNode } from '#core/canvas/modules/label'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { withTextParagraph } from '#core/canvas/text'
import { parseColor } from '#core/color'
import {
  ORG_CHART_LAYOUT,
  type OrgChartCard,
  type OrgChartModuleConfigV1
} from '#core/plugins/org-chart'

export function drawOrgChartCardText(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  config: OrgChartModuleConfigV1,
  card: OrgChartCard
): void {
  if (!renderer.fontProvider || !renderer.fontsLoaded) return
  const padding = ORG_CHART_LAYOUT.cardPadding
  const width = card.width - padding * 2 - (card.hasChildren && config.collapsible ? 32 : 0)
  const labelHeight = config.fontSize * ORG_CHART_LAYOUT.labelLineHeight * 2
  const copy = [
    {
      text: card.label,
      size: config.fontSize,
      weight: 600,
      lines: 2,
      top: padding,
      color: config.textColor,
      lineHeight: config.fontSize * ORG_CHART_LAYOUT.labelLineHeight
    },
    {
      text: card.description,
      size: Math.max(10, config.fontSize - 2),
      weight: 400,
      lines: 1,
      top: padding + labelHeight + 4,
      color: config.mutedColor,
      lineHeight: Math.max(10, config.fontSize - 2) * ORG_CHART_LAYOUT.descriptionLineHeight
    }
  ]
  for (const part of copy) {
    if (!part.text) continue
    const label = {
      ...moduleLabelTextNode(node, part.text, width, part.size, node.textLanguage ?? 'en'),
      fontWeight: part.weight,
      maxLines: part.lines,
      lineHeight: part.lineHeight,
      height: part.lineHeight * part.lines
    }
    const readiness = renderer.nodeFontReadiness(label)
    if (readiness !== 'ready' && readiness !== 'substituted') continue
    const color = parseColor(part.color)
    withTextParagraph(
      renderer,
      label,
      renderer.color4f(color.r, color.g, color.b, color.a),
      { halfLeading: true },
      (paragraph) => paragraph.draw(canvas, card.x + padding, card.y + part.top)
    )
  }
}
