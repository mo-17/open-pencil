import type { SceneNode } from '@open-pencil/scene-graph'
import type { Vector } from '@open-pencil/scene-graph/primitives'

import type { CarouselModuleConfigV3 } from '#core/plugins/carousel'

export interface CarouselNavigationGeometry {
  arrows: readonly [Vector, Vector] | null
  pagination: { left: number; right: number; centerY: number }
  content: { top: number; horizontal: number }
}

export function carouselNavigationGeometry(
  node: Pick<SceneNode, 'width' | 'height'>,
  config: CarouselModuleConfigV3
): CarouselNavigationGeometry {
  const { width, height } = node
  const centerY = height - 18
  const geometry: CarouselNavigationGeometry = {
    arrows: null,
    pagination: { left: 12, right: 12, centerY },
    content: { top: 20, horizontal: 20 }
  }
  if (!config.showArrows || config.slides.length < 2 || width < 96 || height < 48) return geometry
  switch (config.arrowPosition) {
    case 'sides':
      geometry.arrows = [
        { x: 28, y: Math.max(28, Math.min(height / 2, height - 54)) },
        { x: width - 28, y: Math.max(28, Math.min(height / 2, height - 54)) }
      ]
      geometry.content.horizontal = 52
      break
    case 'top-corners':
      geometry.arrows = [
        { x: 28, y: 28 },
        { x: width - 28, y: 28 }
      ]
      geometry.content.top = 52
      break
    case 'bottom-left':
      geometry.arrows = [
        { x: 28, y: centerY },
        { x: 68, y: centerY }
      ]
      geometry.pagination.left = 96
      break
    case 'bottom-right':
      geometry.arrows = [
        { x: width - 68, y: centerY },
        { x: width - 28, y: centerY }
      ]
      geometry.pagination.right = 96
      break
    case 'bottom-corners':
      geometry.arrows = [
        { x: 28, y: centerY },
        { x: width - 28, y: centerY }
      ]
      geometry.pagination.left = 52
      geometry.pagination.right = 52
      break
  }
  return geometry
}
