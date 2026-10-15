import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import { configureControlPaint } from '#core/canvas/control-content'
import {
  configureModulePreviewPaint,
  renderResolvedModulePreview,
  withModulePreviewSurface
} from '#core/canvas/modules/preview'
import type { ModuleCanvasAdapter } from '#core/canvas/modules/types'
import type { SkiaRenderer } from '#core/canvas/renderer'
import * as emptyState from '#core/plugins/empty-state'

import { emptyStateParagraph } from './paragraph'

function drawIllustration(
  renderer: SkiaRenderer,
  canvas: Canvas,
  config: emptyState.EmptyStateModuleConfigV1,
  box: ReturnType<typeof emptyState.emptyStateGeometry>['icon']
) {
  if (config.illustration === 'none' || box.width <= 0) return
  const path = renderer.ck.Path.MakeFromSVGString(
    emptyState.EMPTY_STATE_ILLUSTRATION_PATHS[config.illustration]
  )
  if (!path) return
  canvas.save()
  try {
    canvas.translate(box.x, box.y)
    canvas.scale(
      box.width / emptyState.EMPTY_STATE_LAYOUT.viewBox,
      box.height / emptyState.EMPTY_STATE_LAYOUT.viewBox
    )
    configureModulePreviewPaint(renderer, config.illustrationColor)
    renderer.fillPaint.setAlphaf(emptyState.EMPTY_STATE_LAYOUT.illustrationOpacity)
    canvas.drawCircle(32, 32, 30, renderer.fillPaint)
    configureControlPaint(
      renderer,
      config.illustrationColor,
      1,
      emptyState.EMPTY_STATE_LAYOUT.illustrationStroke
    )
    canvas.drawPath(path, renderer.auxStroke)
  } finally {
    renderer.fillPaint.setAlphaf(1)
    canvas.restore()
    path.delete()
  }
}

export function renderEmptyStateModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  return renderResolvedModulePreview(node, emptyState.resolveEmptyStateModule, (frame) => {
    const { config, width, height } = frame
    const title = emptyStateParagraph(renderer, node, config, true)
    const description = emptyStateParagraph(renderer, node, config, false)
    try {
      const geometry = emptyState.emptyStateGeometry(
        width,
        height,
        config,
        title?.getHeight() ?? 0,
        description?.getHeight() ?? 0
      )
      const rounded = {
        ...frame,
        node: {
          ...node,
          cornerRadius: config.borderRadius,
          independentCorners: false
        }
      }
      withModulePreviewSurface(renderer, canvas, rounded, config.backgroundColor, () => {
        drawIllustration(renderer, canvas, config, geometry.icon)
        if (title) title.draw(canvas, geometry.title.x, geometry.title.y)
        if (description) description.draw(canvas, geometry.description.x, geometry.description.y)
      })
    } finally {
      title?.delete()
      description?.delete()
    }
  })
}

export const EMPTY_STATE_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: emptyState.EMPTY_STATE_PLUGIN_ID,
  moduleType: emptyState.EMPTY_STATE_MODULE_TYPE,
  render: renderEmptyStateModulePreview
})
