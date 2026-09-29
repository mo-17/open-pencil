import type { SliderModuleConfigV1 } from '#core/plugins/slider'
import { sliderInitialValues } from '#core/plugins/slider'

export function sliderPreviewGeometry(width: number, config: SliderModuleConfigV1) {
  const inset = Math.min(16, Math.max(0, width / 2))
  const innerWidth = Math.max(0, width - inset * 2)
  const thumbRadius = Math.min(10, innerWidth / 2)
  const trackLeft = inset + thumbRadius
  const trackWidth = Math.max(0, innerWidth - thumbRadius * 2)
  const headerHeight = config.fontSize * 1.4
  const trackY = 16 + headerHeight + 4 + 20
  const values = sliderInitialValues(config)
  const project = (value: number) =>
    trackLeft + ((value - config.min) / (config.max - config.min)) * trackWidth
  return {
    inset,
    innerWidth,
    thumbRadius,
    trackLeft,
    trackWidth,
    trackY,
    headerHeight,
    values,
    startX: config.range ? project(values[0]) : trackLeft,
    endX: project(config.range ? values[1] : values[0]),
    boundsY: trackY + 20
  }
}
