import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import { drawModuleLabel } from '#core/canvas/modules/label'
import {
  configureModulePreviewPaint,
  renderResolvedModulePreview,
  withModulePreviewFont,
  withModulePreviewSurface
} from '#core/canvas/modules/preview'
import type { ModuleCanvasAdapter } from '#core/canvas/modules/types'
import type { SkiaRenderer } from '#core/canvas/renderer'
import {
  SKELETON_MODULE_TYPE,
  SKELETON_PLUGIN_ID,
  resolveSkeletonModule
} from '#core/plugins/skeleton'

import { skeletonPreviewGeometry } from './geometry'

export function renderSkeletonModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  return renderResolvedModulePreview(node, resolveSkeletonModule, (frame) => {
    const { config, width, height } = frame
    const geometry = skeletonPreviewGeometry(width, height, config)
    withModulePreviewSurface(renderer, canvas, frame, config.backgroundColor, () => {
      if (config.showLabel)
        withModulePreviewFont(renderer, config.fontSize, () =>
          drawModuleLabel(renderer, canvas, node, {
            text: config.label,
            x: geometry.insetX,
            baseline: geometry.insetY + config.fontSize,
            maxWidth: geometry.innerWidth,
            color: config.textColor,
            locale: node.textLanguage ?? 'en'
          })
        )
      configureModulePreviewPaint(renderer, config.color)
      for (const shape of geometry.shapes) {
        if (shape.width <= 0 || shape.height <= 0) continue
        const radius =
          config.variant === 'circle'
            ? shape.width / 2
            : Math.min(config.borderRadius, shape.width / 2, shape.height / 2)
        canvas.drawRRect(
          renderer.ck.RRectXY(
            renderer.ck.LTRBRect(shape.x, shape.y, shape.x + shape.width, shape.y + shape.height),
            radius,
            radius
          ),
          renderer.fillPaint
        )
      }
    })
  })
}
export const SKELETON_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: SKELETON_PLUGIN_ID,
  moduleType: SKELETON_MODULE_TYPE,
  render: renderSkeletonModulePreview
})
