import type { Rect } from '@open-pencil/scene-graph/primitives'

import type { SkeletonModuleConfigV1 } from '#core/plugins/skeleton'

/** Insets shrink with both dimensions so even collapsed hosts cannot expand or overflow. */
export function skeletonPreviewGeometry(
  width: number,
  height: number,
  config: SkeletonModuleConfigV1
) {
  const insetX = Math.min(16, Math.max(0, width * 0.05)),
    insetY = Math.min(16, Math.max(0, height * 0.2))
  const innerWidth = Math.max(0, width - 2 * insetX)
  const header = config.showLabel ? config.fontSize * 1.5 + 12 : 0
  const top = insetY + header,
    availableHeight = Math.max(0, height - 2 * insetY - header)
  const naturalHeight = config.rows * config.lineHeight + (config.rows - 1) * config.gap
  const scale = Math.min(1, availableHeight / naturalHeight)
  const shapes: Rect[] = []
  if (config.variant === 'text') {
    for (let index = 0; index < config.rows; index++)
      shapes.push({
        x: insetX,
        y: top + index * (config.lineHeight + config.gap) * scale,
        width: innerWidth * (index === config.rows - 1 ? config.lastLineWidth / 100 : 1),
        height: config.lineHeight * scale
      })
  } else {
    const circleSize = Math.min(innerWidth, availableHeight)
    shapes.push({
      x: insetX,
      y: top,
      width: config.variant === 'circle' ? circleSize : innerWidth,
      height: config.variant === 'circle' ? circleSize : availableHeight
    })
  }
  return { insetX, insetY, innerWidth, availableHeight, shapes }
}
