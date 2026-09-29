import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import type { SkiaRenderer } from '#core/canvas/renderer'
import {
  buildChartLayout,
  CHART_MODULE_TYPE,
  CHART_PLUGIN_ID,
  resolveChartModule
} from '#core/plugins/chart'

import { drawChartGeometry } from './chart/draw'
import { drawChartText } from './chart/text'
import { resolveModulePreviewFrame, withModulePreviewSurface } from './preview'
import type { ModuleCanvasAdapter } from './types'

/** Canvas and generated SVG consume one deterministic, offline geometry model. */
export function renderChartModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  const frame = resolveModulePreviewFrame(node, resolveChartModule)
  if (!frame) return false
  if (frame.empty) return true
  const model = buildChartLayout(frame.config, frame.width, frame.height)
  withModulePreviewSurface(renderer, canvas, frame, model.backgroundColor, () => {
    drawChartGeometry(renderer, canvas, model)
    for (const item of model.texts) drawChartText(renderer, canvas, node, item)
  })
  return true
}

export const CHART_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: CHART_PLUGIN_ID,
  moduleType: CHART_MODULE_TYPE,
  render: renderChartModulePreview
})
