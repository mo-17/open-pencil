import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import {
  configureModulePreviewPaint,
  renderResolvedModulePreview,
  withModulePreviewClip
} from '#core/canvas/modules/preview'
import type { ModuleCanvasAdapter } from '#core/canvas/modules/types'
import type { SkiaRenderer } from '#core/canvas/renderer'
import type { TextLayout } from '#core/canvas/text'
import { modalHidesContent } from '#core/plugins/content/modal'
import { MODAL_MODULE_TYPE, MODAL_PLUGIN_ID, resolveModalModule } from '#core/plugins/modal'

import { modalTriggerTextNode } from './text'

const ICON_WIDTH = 18
const ICON_HEIGHT = 14
const ICON_STROKE = 2

function drawModalIcon(
  renderer: SkiaRenderer,
  canvas: Canvas,
  left: number,
  centerY: number,
  scale: number
): void {
  const width = ICON_WIDTH * scale
  const height = ICON_HEIGHT * scale
  const stroke = ICON_STROKE * scale
  const top = centerY - height / 2
  const right = left + width
  const bottom = top + height
  const headerTop = top + 4 * scale
  const rects = [
    [left, top, right, top + stroke],
    [left, bottom - stroke, right, bottom],
    [left, top, left + stroke, bottom],
    [right - stroke, top, right, bottom],
    [left + stroke, headerTop, right - stroke, headerTop + stroke]
  ] as const
  for (const rect of rects) {
    canvas.drawRect(renderer.ck.LTRBRect(...rect), renderer.fillPaint)
  }
}

function triggerParagraph(
  renderer: SkiaRenderer,
  node: SceneNode,
  width: number
): TextLayout | null {
  const label = modalTriggerTextNode(node)
  if (!label || !renderer.fontProvider || !renderer.fontsLoaded || width <= 0) return null
  label.width = width
  const readiness = renderer.nodeFontReadiness(label)
  if (readiness !== 'ready' && readiness !== 'substituted') return null
  return renderer.buildParagraph(label, renderer.color4f(1, 1, 1, 1), {
    halfLeading: true
  })
}

/** Draw only an inert trigger; the modal body is a generated-runtime concern. */
export function renderModalModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  return renderResolvedModulePreview(node, resolveModalModule, (frame) => {
    if (node.childIds.length > 0 && !modalHidesContent(node)) return
    const inset = Math.min(12, Math.max(6, Math.min(frame.width, frame.height) * 0.16))
    const available = Math.max(0, frame.width - inset * 2)
    const scale = Math.max(0, Math.min(1, (frame.height - 4) / ICON_HEIGHT, available / ICON_WIDTH))
    const showIcon = frame.config.showTriggerIcon && scale >= 0.5
    const iconWidth = showIcon ? ICON_WIDTH * scale : 0
    const gap = showIcon && frame.config.showTriggerLabel ? 8 * scale : 0
    const paragraph = triggerParagraph(renderer, node, available - iconWidth - gap)
    try {
      const labelWidth = paragraph
        ? Math.min(paragraph.getLongestLine(), available - iconWidth - gap)
        : 0
      const actualGap = labelWidth > 0 ? gap : 0
      const left = (frame.width - iconWidth - actualGap - labelWidth) / 2
      // The scene has already painted authored fills; preserve user colors and gradients.
      withModulePreviewClip(renderer, canvas, node, () => {
        if (showIcon) {
          configureModulePreviewPaint(renderer, '#FFFFFF')
          drawModalIcon(renderer, canvas, left, frame.height / 2, scale)
        }
        if (paragraph) {
          paragraph.draw(
            canvas,
            left + iconWidth + actualGap,
            (frame.height - paragraph.getHeight()) / 2
          )
        }
      })
    } finally {
      paragraph?.delete()
    }
  })
}

export const MODAL_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: MODAL_PLUGIN_ID,
  moduleType: MODAL_MODULE_TYPE,
  render: renderModalModulePreview
})
