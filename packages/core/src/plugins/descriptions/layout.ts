import type { DescriptionsModuleConfigV1 } from '#core/plugins/descriptions'

export const DESCRIPTIONS_LAYOUT = Object.freeze({
  minimumColumnWidth: 200,
  labelRatio: 0.42,
  lineHeight: 1.5,
  comfortablePadding: 16,
  compactPadding: 10
})
export function descriptionsColumns(width: number, columns: number): number {
  return Math.max(
    1,
    Math.min(columns, Math.floor(Math.max(0, width) / DESCRIPTIONS_LAYOUT.minimumColumnWidth))
  )
}
export function descriptionsCellMetrics(width: number, config: DescriptionsModuleConfigV1) {
  const padding = Math.min(
    config.density === 'compact'
      ? DESCRIPTIONS_LAYOUT.compactPadding
      : DESCRIPTIONS_LAYOUT.comfortablePadding,
    Math.max(0, width) * 0.08
  )
  const horizontal = config.layout === 'horizontal'
  const labelWidth = horizontal ? width * DESCRIPTIONS_LAYOUT.labelRatio : width
  return {
    padding,
    labelWidth,
    valueWidth: horizontal ? width - labelWidth : width,
    labelTextWidth: Math.max(0, labelWidth - padding * 2),
    valueTextWidth: Math.max(0, (horizontal ? width - labelWidth : width) - padding * 2)
  }
}
