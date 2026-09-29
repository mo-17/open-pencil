import { progressDisplayValue, type ProgressModuleConfigV1 } from '#core/plugins/progress'

export function progressPreviewGeometry(
  width: number,
  height: number,
  config: ProgressModuleConfigV1
) {
  const inset = Math.min(16, Math.max(0, width / 2))
  const innerWidth = Math.max(0, width - 2 * inset)
  const valueText = progressDisplayValue(config)
  const header = config.showLabel || Boolean(valueText)
  const top = 16 + (header ? config.fontSize * 1.5 + 12 : 0)
  const availableHeight = Math.max(0, height - top - 16)
  const diameter = Math.min(config.diameter, innerWidth, availableHeight)
  return {
    inset,
    innerWidth,
    valueText,
    top,
    linearHeight: Math.min(config.thickness, availableHeight),
    diameter,
    circleStroke: (config.thickness * diameter) / config.diameter,
    circleX: width / 2,
    circleY: top + diameter / 2,
    fillStart: config.indeterminate ? innerWidth * 0.15 : 0,
    fillWidth: innerWidth * (config.indeterminate ? 0.35 : config.value / 100)
  }
}
