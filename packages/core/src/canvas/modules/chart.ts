import type { Canvas } from 'canvaskit-wasm'

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import type { SkiaRenderer } from '#core/canvas/renderer'
import { CHART_MODULE_TYPE, CHART_PLUGIN_ID, resolveChartModule } from '#core/plugins/chart'

import { chartDataProjection } from './chart/data'
import { drawChartGeometry } from './chart/draw'
import { chartEmptyLabel, drawChartText } from './chart/text'
import { resolveModulePreviewFrame, withModulePreviewSurface } from './preview'
import type { ModuleCanvasAdapter } from './types'

/** Canvas and generated SVG consume one deterministic, offline geometry model. */
export function renderChartModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  graph?: SceneGraph
): boolean {
  const frame = resolveModulePreviewFrame(node, resolveChartModule)
  if (!frame) return false
  if (frame.empty) return true
  const projection = chartDataProjection(node, graph, frame.config, frame.width, frame.height)
  const model = projection.layout
  const emptyCopy = chartEmptyLabel(node, projection.invalid, projection.emptyData)
  withModulePreviewSurface(renderer, canvas, frame, model.backgroundColor, () => {
    drawChartGeometry(renderer, canvas, model)
    for (const item of model.texts) drawChartText(renderer, canvas, node, item, emptyCopy)
  })
  return true
}

export const CHART_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: CHART_PLUGIN_ID,
  moduleType: CHART_MODULE_TYPE,
  render: renderChartModulePreview
})
