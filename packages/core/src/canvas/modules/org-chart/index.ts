import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import {
  configureModulePreviewPaint,
  renderResolvedModulePreview,
  withModulePreviewSurface
} from '#core/canvas/modules/preview'
import type { ModuleCanvasAdapter } from '#core/canvas/modules/types'
import type { SkiaRenderer } from '#core/canvas/renderer'
import * as org from '#core/plugins/org-chart'

import { drawOrgChartCardText } from './draw-text'

function drawCard(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  config: org.OrgChartModuleConfigV1,
  card: org.OrgChartCard
): void {
  const box = (inset: number, color: string) => {
    configureModulePreviewPaint(renderer, color)
    const radius = Math.max(0, config.borderRadius - inset)
    canvas.drawRRect(
      renderer.ck.RRectXY(
        renderer.ck.XYWHRect(
          card.x + inset,
          card.y + inset,
          card.width - inset * 2,
          card.height - inset * 2
        ),
        radius,
        radius
      ),
      renderer.fillPaint
    )
  }
  box(0, config.borderColor)
  box(1, config.cardColor)
  drawOrgChartCardText(renderer, canvas, node, config, card)
  if (!config.collapsible || !card.hasChildren) return
  const size = org.ORG_CHART_LAYOUT.toggleSize
  const x = card.x + card.width - org.ORG_CHART_LAYOUT.cardPadding - size / 2
  const y = card.y + card.height / 2
  configureModulePreviewPaint(renderer, config.borderColor)
  canvas.drawRRect(
    renderer.ck.RRectXY(renderer.ck.XYWHRect(x - size / 2, y - size / 2, size, size), 6, 6),
    renderer.fillPaint
  )
  configureModulePreviewPaint(renderer, config.cardColor)
  canvas.drawRRect(
    renderer.ck.RRectXY(
      renderer.ck.XYWHRect(x - size / 2 + 1, y - size / 2 + 1, size - 2, size - 2),
      5,
      5
    ),
    renderer.fillPaint
  )
  configureModulePreviewPaint(renderer, config.accentColor)
  canvas.drawRect(renderer.ck.XYWHRect(x - 4, y - 1, 8, 2), renderer.fillPaint)
  if (card.collapsed) canvas.drawRect(renderer.ck.XYWHRect(x - 1, y - 4, 2, 8), renderer.fillPaint)
}
export function renderOrgChartModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  return renderResolvedModulePreview(node, org.resolveOrgChartModule, (frame) => {
    const layout = org.orgChartLayout(frame.width, frame.config)
    withModulePreviewSurface(renderer, canvas, frame, frame.config.backgroundColor, () => {
      configureModulePreviewPaint(renderer, frame.config.connectorColor)
      for (const connector of layout.connectors) {
        for (let index = 1; index < connector.points.length; index++) {
          const from = connector.points[index - 1],
            to = connector.points[index]
          canvas.drawRect(
            renderer.ck.XYWHRect(
              Math.min(from.x, to.x) - 0.75,
              Math.min(from.y, to.y) - 0.75,
              Math.abs(to.x - from.x) + 1.5,
              Math.abs(to.y - from.y) + 1.5
            ),
            renderer.fillPaint
          )
        }
      }
      for (const card of layout.cards) {
        if (card.y >= frame.height || card.x >= frame.width) continue
        drawCard(renderer, canvas, node, frame.config, card)
      }
    })
  })
}
export const ORG_CHART_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: org.ORG_CHART_PLUGIN_ID,
  moduleType: org.ORG_CHART_MODULE_TYPE,
  render: renderOrgChartModulePreview
})
