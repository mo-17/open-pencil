import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import { configureControlPaint } from '#core/canvas/control-content'
import type { SkiaRenderer } from '#core/canvas/renderer'
import type { CarouselModuleConfigV3 } from '#core/plugins/carousel'

import { carouselNavigationGeometry } from './geometry'
import { drawCarouselText } from './paragraph'
import { carouselPreviewLabel } from './text'

function drawArrow(
  renderer: SkiaRenderer,
  canvas: Canvas,
  config: CarouselModuleConfigV3,
  cx: number,
  cy: number,
  direction: -1 | 1,
  disabled: boolean
): void {
  configureControlPaint(renderer, config.textColor, disabled ? 0.04 : 0.1)
  canvas.drawRRect(
    renderer.ck.RRectXY(renderer.ck.LTRBRect(cx - 16, cy - 16, cx + 16, cy + 16), 16, 16),
    renderer.fillPaint
  )
  configureControlPaint(renderer, config.textColor, disabled ? 0.3 : 1, 1.8)
  canvas.drawLine(cx - direction * 2, cy - 5, cx + direction * 3, cy, renderer.auxStroke)
  canvas.drawLine(cx + direction * 3, cy, cx - direction * 2, cy + 5, renderer.auxStroke)
}

function drawPaginationMarker(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  config: CarouselModuleConfigV3,
  slideIndex: number,
  cx: number,
  cy: number
): void {
  const numbers = config.paginationStyle === 'numbers'
  const selected = slideIndex === config.initialIndex
  const unselectedAlpha = numbers ? 0.1 : 0.35
  configureControlPaint(
    renderer,
    selected ? config.accentColor : config.textColor,
    selected ? 1 : unselectedAlpha
  )
  if (numbers) {
    canvas.drawRRect(
      renderer.ck.RRectXY(renderer.ck.LTRBRect(cx - 12, cy - 12, cx + 12, cy + 12), 6, 6),
      renderer.fillPaint
    )
    drawCarouselText(
      renderer,
      canvas,
      node,
      String(slideIndex + 1),
      'caption',
      selected ? '#FFFFFF' : config.textColor,
      {
        x: cx - 12,
        y: cy - 9,
        width: 24,
        height: 18
      }
    )
  } else {
    canvas.drawCircle(cx, cy, 3, renderer.fillPaint)
  }
}

export function drawCarouselNavigation(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  config: CarouselModuleConfigV3
): void {
  if (node.width < 40 || node.height < 48) return
  const { arrows, pagination } = carouselNavigationGeometry(node, config)
  const { left: insetLeft, right: insetRight, centerY } = pagination
  if (arrows) {
    drawArrow(
      renderer,
      canvas,
      config,
      arrows[0].x,
      arrows[0].y,
      -1,
      !config.loop && config.initialIndex === 0
    )
    drawArrow(
      renderer,
      canvas,
      config,
      arrows[1].x,
      arrows[1].y,
      1,
      !config.loop && config.initialIndex === config.slides.length - 1
    )
  }
  const available = Math.max(0, node.width - insetLeft - insetRight)
  if (!config.showDots) return
  if (config.paginationStyle === 'fraction') {
    drawCarouselText(
      renderer,
      canvas,
      node,
      carouselPreviewLabel(config),
      'caption',
      config.textColor,
      {
        x: insetLeft,
        y: centerY - 9,
        width: available,
        height: 18
      }
    )
    return
  }
  const numbers = config.paginationStyle === 'numbers'
  const diameter = numbers ? 24 : 6
  const stride = numbers ? 28 : 14
  if ((numbers || config.slides.length > 1) && available >= diameter) {
    // Keep a bounded window around the selected slide on narrow nodes, without
    // overlapping the arrows or dropping the selected indicator.
    const count = Math.min(config.slides.length, Math.floor((available - diameter) / stride) + 1)
    const first = Math.min(
      config.slides.length - count,
      Math.max(0, config.initialIndex - Math.floor(count / 2))
    )
    const left = insetLeft + (available - (count - 1) * stride) / 2
    for (let index = 0; index < count; index++) {
      const cx = left + index * stride
      drawPaginationMarker(renderer, canvas, node, config, first + index, cx, centerY)
    }
  }
}
