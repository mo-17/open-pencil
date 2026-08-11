import type { Canvas } from 'canvaskit-wasm'

import type { SkiaRenderer } from '#core/canvas/renderer'
import { MODAL_MODULE_TYPE, MODAL_PLUGIN_ID, resolveModalModule } from '#core/plugins/modal'

import {
  createModulePreviewIconAccessory as iconAccessory,
  createModulePreviewTriggerRenderer as triggerRenderer
} from './preview'
import type { ModuleCanvasAdapter } from './types'

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

const accessory = iconAccessory(ICON_WIDTH, ICON_HEIGHT, drawModalIcon)
const colors = () => ['#2663EB', '#FFFFFF'] as const
const resolveModule = resolveModalModule

/** Draw only an inert trigger; the modal body is a generated-runtime concern. */
export const renderModalModulePreview = triggerRenderer(resolveModule, accessory, colors)

export const MODAL_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: MODAL_PLUGIN_ID,
  moduleType: MODAL_MODULE_TYPE,
  render: renderModalModulePreview
})
