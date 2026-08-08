import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import { ellipsizeLabelText } from '#core/canvas/labels/text'
import type { SkiaRenderer } from '#core/canvas/renderer'
import {
  SLIDE_MENU_MODULE_TYPE,
  SLIDE_MENU_PLUGIN_ID,
  resolveSlideMenuModule,
  type SlideMenuModuleConfigV1
} from '#core/plugins/slide-menu'

import { configureModulePreviewPaint, modulePreviewFrame } from './preview'
import type { ModuleCanvasAdapter } from './types'

export function slideMenuPreviewMeta(config: SlideMenuModuleConfigV1): string {
  return `${config.presentation} · ${config.direction}`
}

/** Draw an inert button summary only; menu items never create DOM or request their hrefs. */
export function renderSlideMenuModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  const frame = modulePreviewFrame(node)
  if (!frame) return false
  const resolved = resolveSlideMenuModule(frame.node.interactiveProps?.module)
  if (!resolved?.ok) return false
  if (frame.empty) return true

  const { width, height } = frame
  const inset = Math.min(12, Math.max(6, Math.min(width, height) * 0.16))
  const availableWidth = Math.max(0, width - inset * 2)

  canvas.save()
  try {
    canvas.clipRRect(renderer.makeRRect(frame.node), renderer.ck.ClipOp.Intersect, true)
    configureModulePreviewPaint(renderer, '#2563EB')
    canvas.drawRect(renderer.ck.LTRBRect(0, 0, width, height), renderer.fillPaint)

    const font = renderer.labelFont
    if (!font) return true
    const showMeta = height >= 36
    configureModulePreviewPaint(renderer, '#FFFFFF')
    canvas.drawText(
      ellipsizeLabelText(font, resolved.config.triggerLabel, availableWidth),
      inset,
      showMeta ? Math.min(height - 18, inset + 13) : Math.min(height - 6, height * 0.63),
      renderer.fillPaint,
      font
    )
    if (showMeta) {
      configureModulePreviewPaint(renderer, '#DBEAFE')
      canvas.drawText(
        ellipsizeLabelText(font, slideMenuPreviewMeta(resolved.config), availableWidth),
        inset,
        height - 6,
        renderer.fillPaint,
        font
      )
    }
  } finally {
    canvas.restore()
  }
  return true
}

export const SLIDE_MENU_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: SLIDE_MENU_PLUGIN_ID,
  moduleType: SLIDE_MENU_MODULE_TYPE,
  render: renderSlideMenuModulePreview
})
