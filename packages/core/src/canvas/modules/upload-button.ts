import type { Canvas, Path } from 'canvaskit-wasm'

import type { SkiaRenderer } from '#core/canvas/renderer'
import {
  UPLOAD_BUTTON_MODULE_TYPE,
  UPLOAD_BUTTON_PLUGIN_ID,
  resolveUploadButtonModule,
  type UploadButtonModuleConfig
} from '#core/plugins/upload-button'

import {
  createModulePreviewIconAccessory as iconAccessory,
  createModulePreviewTriggerRenderer as triggerRenderer
} from './preview'
import type { ModuleCanvasAdapter } from './types'

const ICON_WIDTH = 18
const ICON_HEIGHT = 18

function createUploadIconPath(
  renderer: SkiaRenderer,
  left: number,
  centerY: number,
  scale: number
): Path {
  const path = new renderer.ck.Path()
  const point = (value: number) => value * scale
  const top = centerY - ICON_HEIGHT * scale * 0.5
  path.moveTo(left + point(8), top + point(13))
  path.lineTo(left + point(10), top + point(13))
  path.lineTo(left + point(10), top + point(6))
  path.lineTo(left + point(14), top + point(6))
  path.lineTo(left + point(9), top + point(1))
  path.lineTo(left + point(4), top + point(6))
  path.lineTo(left + point(8), top + point(6))
  path.close()
  path.moveTo(left + point(1), top + point(11))
  path.lineTo(left + point(3), top + point(11))
  path.lineTo(left + point(3), top + point(16))
  path.lineTo(left + point(15), top + point(16))
  path.lineTo(left + point(15), top + point(11))
  path.lineTo(left + point(17), top + point(11))
  path.lineTo(left + point(17), top + point(18))
  path.lineTo(left + point(1), top + point(18))
  path.close()
  return path
}

function drawUploadIcon(
  renderer: SkiaRenderer,
  canvas: Canvas,
  left: number,
  centerY: number,
  scale: number
): void {
  const path = createUploadIconPath(renderer, left, centerY, scale)
  try {
    canvas.drawPath(path, renderer.fillPaint)
  } finally {
    path.delete()
  }
}

const accessory = iconAccessory(ICON_WIDTH, ICON_HEIGHT, drawUploadIcon)
const colors = (config: UploadButtonModuleConfig) =>
  [config.buttonBackground, config.buttonTextColor] as const
const resolveModule = resolveUploadButtonModule

/** Draw only an inert local-file chooser; generated runtimes own file selection and validation. */
export const renderUploadButtonModulePreview = triggerRenderer(resolveModule, accessory, colors)

export const UPLOAD_BUTTON_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: UPLOAD_BUTTON_PLUGIN_ID,
  moduleType: UPLOAD_BUTTON_MODULE_TYPE,
  render: renderUploadButtonModulePreview
})
