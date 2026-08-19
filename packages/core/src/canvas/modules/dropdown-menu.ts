import type { Canvas, Path } from 'canvaskit-wasm'

import type { SkiaRenderer } from '#core/canvas/renderer'
import {
  DROPDOWN_MENU_MODULE_TYPE,
  DROPDOWN_MENU_PLUGIN_ID,
  resolveDropdownMenuModule,
  type DropdownMenuModuleConfig
} from '#core/plugins/dropdown-menu'

import {
  createModulePreviewChevronAccessory as chevronAccessory,
  createModulePreviewTriggerRenderer as triggerRenderer
} from './preview'
import type { ModuleCanvasAdapter } from './types'

const CHEVRON_WIDTH = 14
const CHEVRON_HEIGHT = 8
const CHEVRON_STROKE = 2

function createChevronPath(
  renderer: SkiaRenderer,
  left: number,
  centerY: number,
  scale: number
): Path {
  const builder = new renderer.ck.PathBuilder()
  const width = CHEVRON_WIDTH * scale
  const height = CHEVRON_HEIGHT * scale
  const stroke = CHEVRON_STROKE * scale
  const top = centerY - height / 2
  const bottom = centerY + height / 2
  const middle = left + width / 2
  builder.moveTo(left, top)
  builder.lineTo(middle, bottom)
  builder.lineTo(left + width, top)
  builder.lineTo(left + width - stroke, top)
  builder.lineTo(middle, bottom - stroke * 1.4)
  builder.lineTo(left + stroke, top)
  builder.close()
  return builder.detachAndDelete()
}

function drawDropdownChevron(
  renderer: SkiaRenderer,
  canvas: Canvas,
  left: number,
  centerY: number,
  scale: number
): void {
  const path = createChevronPath(renderer, left, centerY, scale)
  try {
    canvas.drawPath(path, renderer.fillPaint)
  } finally {
    path.delete()
  }
}

const accessory = chevronAccessory(CHEVRON_WIDTH, CHEVRON_HEIGHT, drawDropdownChevron)
const colors = (config: DropdownMenuModuleConfig) =>
  [config.triggerBackground, config.triggerTextColor] as const
const resolveModule = resolveDropdownMenuModule

/** Draw only an inert trigger; the generated runtime owns the popup menu. */
export const renderDropdownMenuModulePreview = triggerRenderer(resolveModule, accessory, colors)

export const DROPDOWN_MENU_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: DROPDOWN_MENU_PLUGIN_ID,
  moduleType: DROPDOWN_MENU_MODULE_TYPE,
  render: renderDropdownMenuModulePreview
})
