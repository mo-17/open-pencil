import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import { configureControlPaint } from '#core/canvas/control-content'
import { renderResolvedModulePreview, withModulePreviewSurface } from '#core/canvas/modules/preview'
import type { ModuleCanvasAdapter } from '#core/canvas/modules/types'
import type { SkiaRenderer } from '#core/canvas/renderer'
import {
  CAROUSEL_MODULE_TYPE,
  CAROUSEL_PLUGIN_ID,
  resolveCarouselModule,
  type CarouselModuleConfigV3
} from '#core/plugins/carousel'

import { carouselNavigationGeometry } from './geometry'
import { drawCarouselNavigation } from './navigation'
import { drawCarouselText, measureCarouselText } from './paragraph'

export { carouselPreviewLabel } from './text'

const CONTENT_PADDING = 20
const FOOTER_HEIGHT = 36
const TEXT_ALIGNMENTS: Record<
  CarouselModuleConfigV3['textAlign'],
  SceneNode['textAlignHorizontal']
> = {
  left: 'LEFT',
  center: 'CENTER',
  right: 'RIGHT'
}

function contentBounds(
  renderer: SkiaRenderer,
  node: SceneNode,
  config: CarouselModuleConfigV3,
  mediaHeight: number,
  alignment: SceneNode['textAlignHorizontal']
): Rect {
  const overlay = config.layout === 'overlay'
  const navigation = carouselNavigationGeometry(node, config)
  const top = Math.max((overlay ? 0 : mediaHeight) + CONTENT_PADDING, navigation.content.top)
  const footer = node.height >= 48 ? FOOTER_HEIGHT : 0
  const bounds = {
    x: navigation.content.horizontal,
    y: top,
    width: Math.max(0, node.width - navigation.content.horizontal * 2),
    height: Math.max(0, node.height - footer - 8 - top)
  }
  if (!overlay || config.textPosition === 'top') return bounds
  const slide = config.slides[config.initialIndex]
  const title = measureCarouselText(
    renderer,
    node,
    slide.title,
    'title',
    config.textColor,
    bounds,
    alignment
  )
  const description = measureCarouselText(
    renderer,
    node,
    slide.description,
    'description',
    config.textColor,
    bounds,
    alignment
  )
  const total = title + (slide.description ? 8 + description : 0)
  const remaining = Math.max(0, bounds.height - total)
  const offset = config.textPosition === 'center' ? remaining / 2 : remaining
  return { ...bounds, y: bounds.y + offset, height: bounds.height - offset }
}

function drawMediaPlaceholder(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  config: CarouselModuleConfigV3,
  height: number
): void {
  configureControlPaint(renderer, config.textColor, 0.06)
  canvas.drawRect(renderer.ck.LTRBRect(0, 0, node.width, height), renderer.fillPaint)
  if (node.width < 96 || height < 88) return
  const cx = node.width / 2
  const cy = (height - 26) / 2
  // A neutral picture glyph and authored alt text identify an inert placeholder;
  // image URLs are never resolved by the canvas renderer.
  configureControlPaint(renderer, config.textColor, 0.45, 2)
  canvas.drawRRect(
    renderer.ck.RRectXY(renderer.ck.LTRBRect(cx - 28, cy - 20, cx + 28, cy + 20), 4, 4),
    renderer.auxStroke
  )
  canvas.drawLine(cx - 26, cy + 13, cx - 7, cy - 3, renderer.auxStroke)
  canvas.drawLine(cx - 7, cy - 3, cx + 5, cy + 8, renderer.auxStroke)
  canvas.drawLine(cx + 5, cy + 8, cx + 13, cy + 1, renderer.auxStroke)
  canvas.drawLine(cx + 13, cy + 1, cx + 27, cy + 15, renderer.auxStroke)
  configureControlPaint(renderer, config.textColor, 0.45)
  canvas.drawCircle(cx + 14, cy - 10, 4, renderer.fillPaint)
  if (config.layout === 'overlay') return
  const inset = carouselNavigationGeometry(node, config).content.horizontal
  drawCarouselText(
    renderer,
    canvas,
    node,
    config.slides[config.initialIndex].alt,
    'caption',
    config.textColor,
    {
      x: inset,
      y: height - 30,
      width: node.width - inset * 2,
      height: 20
    }
  )
}

/** Paint one authored initial slide; no remote media, timers or business interactions. */
export function renderCarouselModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  return renderResolvedModulePreview(node, resolveCarouselModule, (frame) => {
    const { config, width, height } = frame
    const slide = config.slides[config.initialIndex]
    const overlay = config.layout === 'overlay'
    const mediaHeight = slide.imageUrl ? (overlay ? height : height * 0.58) : 0
    const alignment = TEXT_ALIGNMENTS[config.textAlign]
    const content = contentBounds(renderer, node, config, mediaHeight, alignment)
    withModulePreviewSurface(renderer, canvas, frame, config.backgroundColor, () => {
      if (mediaHeight > 0) drawMediaPlaceholder(renderer, canvas, node, config, mediaHeight)
      if (overlay) {
        configureControlPaint(renderer, '#000000', config.overlayOpacity)
        canvas.drawRect(renderer.ck.LTRBRect(0, 0, width, height), renderer.fillPaint)
      }
      const titleHeight = drawCarouselText(
        renderer,
        canvas,
        node,
        slide.title,
        'title',
        config.textColor,
        content,
        alignment
      )
      if (titleHeight !== null && slide.description) {
        drawCarouselText(
          renderer,
          canvas,
          node,
          slide.description,
          'description',
          config.textColor,
          {
            ...content,
            y: content.y + titleHeight + 8,
            height: Math.max(0, content.height - titleHeight - 8)
          },
          alignment
        )
      }
      drawCarouselNavigation(renderer, canvas, node, config)
    })
  })
}

export const CAROUSEL_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: CAROUSEL_PLUGIN_ID,
  moduleType: CAROUSEL_MODULE_TYPE,
  render: renderCarouselModulePreview
})
