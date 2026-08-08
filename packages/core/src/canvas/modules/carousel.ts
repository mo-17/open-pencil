import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import { ellipsizeLabelText } from '#core/canvas/labels/text'
import type { SkiaRenderer } from '#core/canvas/renderer'
import {
  CAROUSEL_MODULE_TYPE,
  CAROUSEL_PLUGIN_ID,
  resolveCarouselModule,
  type CarouselModuleConfigV1
} from '#core/plugins/carousel'

import { configureModulePreviewPaint, modulePreviewFrame } from './preview'
import type { ModuleCanvasAdapter } from './types'

export function carouselPreviewLabel(config: CarouselModuleConfigV1): string {
  return `${config.initialIndex + 1} / ${config.slides.length} · ${config.transition}`
}

/** Draw only validated inline text and inert media placeholders. Canvas previews never fetch URLs. */
export function renderCarouselModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  const frame = modulePreviewFrame(node)
  if (!frame) return false
  const resolved = resolveCarouselModule(frame.node.interactiveProps?.module)
  if (!resolved?.ok) return false
  if (frame.empty) return true

  const { width, height } = frame
  const config = resolved.config
  const slide = config.slides[config.initialIndex]
  const inset = Math.min(24, Math.max(8, Math.min(width, height) * 0.06))
  const font = renderer.labelFont
  const previousFontSize = font?.getSize()

  canvas.save()
  try {
    canvas.clipRRect(renderer.makeRRect(frame.node), renderer.ck.ClipOp.Intersect, true)
    configureModulePreviewPaint(renderer, config.backgroundColor)
    canvas.drawRect(renderer.ck.LTRBRect(0, 0, width, height), renderer.fillPaint)

    const mediaBottom = Math.max(inset, height * 0.58)
    configureModulePreviewPaint(renderer, '#1F2937')
    canvas.drawRect(
      renderer.ck.LTRBRect(inset, inset, Math.max(inset, width - inset), mediaBottom),
      renderer.fillPaint
    )
    if (slide.imageUrl !== '') {
      configureModulePreviewPaint(renderer, '#374151')
      const badgeWidth = Math.min(120, Math.max(48, width * 0.24))
      canvas.drawRect(
        renderer.ck.LTRBRect(
          width - inset - badgeWidth,
          inset,
          width - inset,
          Math.min(mediaBottom, inset + 22)
        ),
        renderer.fillPaint
      )
    }

    if (!font) return true
    const availableWidth = Math.max(0, width - inset * 2)
    font.setSize(Math.max(11, Math.min(24, height * 0.07)))
    configureModulePreviewPaint(renderer, config.textColor)
    canvas.drawText(
      ellipsizeLabelText(font, slide.title, availableWidth),
      inset,
      Math.min(height - inset - 28, mediaBottom + 30),
      renderer.fillPaint,
      font
    )

    if (height >= 150 && slide.description !== '') {
      font.setSize(Math.max(9, Math.min(14, height * 0.04)))
      configureModulePreviewPaint(renderer, '#D1D5DB')
      canvas.drawText(
        ellipsizeLabelText(font, slide.description, availableWidth),
        inset,
        Math.min(height - inset - 10, mediaBottom + 53),
        renderer.fillPaint,
        font
      )
    }

    font.setSize(Math.max(8, Math.min(12, height * 0.034)))
    configureModulePreviewPaint(renderer, config.accentColor)
    canvas.drawText(
      ellipsizeLabelText(font, carouselPreviewLabel(config), Math.max(0, availableWidth - 60)),
      inset,
      height - Math.max(6, inset * 0.45),
      renderer.fillPaint,
      font
    )
    if (config.showArrows && width >= 100) {
      canvas.drawText(
        '<',
        width - inset - 38,
        height - Math.max(6, inset * 0.45),
        renderer.fillPaint,
        font
      )
      canvas.drawText(
        '>',
        width - inset - 12,
        height - Math.max(6, inset * 0.45),
        renderer.fillPaint,
        font
      )
    }
    if (config.showDots && height >= 96) {
      const dotCount = Math.min(config.slides.length, 12)
      const dotWidth = 5
      const gap = 4
      const totalWidth = dotCount * dotWidth + Math.max(0, dotCount - 1) * gap
      let left = Math.max(inset, (width - totalWidth) / 2)
      for (let index = 0; index < dotCount; index += 1) {
        configureModulePreviewPaint(
          renderer,
          index === config.initialIndex ? config.accentColor : '#6B7280'
        )
        canvas.drawRect(
          renderer.ck.LTRBRect(left, mediaBottom - 13, left + dotWidth, mediaBottom - 8),
          renderer.fillPaint
        )
        left += dotWidth + gap
      }
    }
  } finally {
    try {
      canvas.restore()
    } finally {
      if (font && previousFontSize !== undefined) font.setSize(previousFontSize)
    }
  }
  return true
}

export const CAROUSEL_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: CAROUSEL_PLUGIN_ID,
  moduleType: CAROUSEL_MODULE_TYPE,
  render: renderCarouselModulePreview
})
