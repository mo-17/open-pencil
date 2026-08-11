import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import { ellipsizeLabelText, measureLabelText } from '#core/canvas/labels/text'
import type { SkiaRenderer } from '#core/canvas/renderer'
import {
  SLIDE_MENU_MODULE_TYPE,
  SLIDE_MENU_PLUGIN_ID,
  resolveSlideMenuModule,
  type SlideMenuModuleConfig,
  type SlideMenuModuleConfigV1
} from '#core/plugins/slide-menu'

import { configureModulePreviewPaint, modulePreviewFrame } from './preview'
import type { ModuleCanvasAdapter } from './types'

const TRIGGER_ICON_WIDTH = 18
const TRIGGER_ICON_HEIGHT = 14
const TRIGGER_ICON_LINE_HEIGHT = 2
const TRIGGER_ICON_GAP = 8
const TRIGGER_LABEL_BASELINE_OFFSET = 4

function fittedTriggerLabel(
  font: NonNullable<SkiaRenderer['labelFont']>,
  label: string,
  maximumWidth: number
): string {
  if (maximumWidth <= 0) return ''
  const fitted = ellipsizeLabelText(font, label, maximumWidth)
  return measureLabelText(font, fitted) <= maximumWidth ? fitted : ''
}

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

function triggerPreviewLayout(
  renderer: SkiaRenderer,
  config: SlideMenuModuleConfig,
  width: number,
  height: number
) {
  const inset = Math.min(12, Math.max(6, Math.min(width, height) * 0.16))
  const availableWidth = Math.max(0, width - inset * 2)
  const iconScale = Math.min(
    1,
    Math.max(0, (height - 4) / TRIGGER_ICON_HEIGHT),
    Math.max(0, availableWidth / TRIGGER_ICON_WIDTH)
  )
  const showIcon = config.showTriggerIcon && iconScale >= 0.5
  const iconWidth = showIcon ? TRIGGER_ICON_WIDTH * iconScale : 0
  const font = config.showTriggerLabel && height >= 14 ? renderer.labelFont : null
  const requestedGap = showIcon && font ? TRIGGER_ICON_GAP * iconScale : 0
  const label = font
    ? fittedTriggerLabel(
        font,
        config.triggerLabel,
        Math.max(0, availableWidth - iconWidth - requestedGap)
      )
    : ''
  const labelWidth = font && label ? measureLabelText(font, label) : 0
  const gap = showIcon && label ? requestedGap : 0
  const contentWidth = iconWidth + gap + labelWidth
  return {
    centerY: height / 2,
    contentLeft: (width - contentWidth) / 2,
    font,
    gap,
    iconScale,
    iconWidth,
    label,
    showIcon
  }
}

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
  if (frame.node.childIds.length > 0) return true
  if (frame.empty) return true

  const { width, height } = frame
  const { centerY, contentLeft, font, gap, iconScale, iconWidth, label, showIcon } =
    triggerPreviewLayout(renderer, resolved.config, width, height)

  canvas.save()
  try {
    canvas.clipRRect(renderer.makeRRect(frame.node), renderer.ck.ClipOp.Intersect, true)
    configureModulePreviewPaint(renderer, '#2663EB')
    canvas.drawRect(renderer.ck.LTRBRect(0, 0, width, height), renderer.fillPaint)

    if (showIcon || (font && label)) configureModulePreviewPaint(renderer, '#FFFFFF')
    if (showIcon) drawHamburgerIcon(renderer, canvas, contentLeft, centerY, iconScale)
    if (font && label) {
      canvas.drawText(
        label,
        contentLeft + iconWidth + gap,
        centerY + TRIGGER_LABEL_BASELINE_OFFSET,
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
