import type { Canvas } from 'canvaskit-wasm'

import type { SkiaRenderer } from '#core/canvas/renderer'
import {
  SLIDE_MENU_MODULE_TYPE,
  SLIDE_MENU_PLUGIN_ID,
  resolveSlideMenuModule,
  type SlideMenuModuleConfigV1
} from '#core/plugins/slide-menu'

import { createModulePreviewIconAccessory, createModulePreviewTriggerRenderer } from './trigger'
import type { ModuleCanvasAdapter } from './types'

const TRIGGER_ICON_WIDTH = 18
const TRIGGER_ICON_HEIGHT = 14
const TRIGGER_ICON_LINE_HEIGHT = 2
function drawHamburgerIcon(
  renderer: SkiaRenderer,
  canvas: Canvas,
  left: number,
  centerY: number,
  scale: number
): void {
  const width = TRIGGER_ICON_WIDTH * scale
  const height = TRIGGER_ICON_HEIGHT * scale
  const lineHeight = TRIGGER_ICON_LINE_HEIGHT * scale
  const lineGap = (height - lineHeight * 3) / 2
  const top = centerY - height / 2
  for (let index = 0; index < 3; index += 1) {
    const lineTop = top + index * (lineHeight + lineGap)
    canvas.drawRect(
      renderer.ck.LTRBRect(left, lineTop, left + width, lineTop + lineHeight),
      renderer.fillPaint
    )
  }
}

export function slideMenuPreviewMeta(config: SlideMenuModuleConfigV1): string {
  return `${config.presentation} · ${config.direction}`
}

/** Draw an inert button summary only; menu items never create DOM or request their hrefs. */
export const renderSlideMenuModulePreview = createModulePreviewTriggerRenderer(
  resolveSlideMenuModule,
  createModulePreviewIconAccessory(TRIGGER_ICON_WIDTH, TRIGGER_ICON_HEIGHT, drawHamburgerIcon),
  () => ['#2663EB', '#FFFFFF']
)

export const SLIDE_MENU_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: SLIDE_MENU_PLUGIN_ID,
  moduleType: SLIDE_MENU_MODULE_TYPE,
  render: renderSlideMenuModulePreview
})
