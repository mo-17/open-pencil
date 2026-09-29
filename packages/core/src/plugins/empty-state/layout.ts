import type { EmptyStateModuleConfigV1 } from '#core/plugins/empty-state'

export const EMPTY_STATE_LAYOUT = Object.freeze({
  viewBox: 64,
  titleScale: 1.25,
  lineHeight: 1.5,
  illustrationStroke: 2.5,
  illustrationOpacity: 0.1,
  maximumInsetRatio: 0.25
})
export const EMPTY_STATE_ILLUSTRATION_PATHS = Object.freeze({
  box: 'M12 25 32 14 52 25v23L32 59 12 48V25ZM12 25l20 11 20-11M32 36v23M22 19l20 11',
  search: 'M41 41 55 55M44 29a15 15 0 1 0-30 0 15 15 0 0 0 30 0'
})

/** Center short content; overflowing copy starts at the inset so its beginning stays readable. */
export function emptyStateGeometry(
  width: number,
  height: number,
  config: EmptyStateModuleConfigV1,
  titleHeight: number,
  descriptionHeight: number
) {
  const inset = Math.min(config.padding, Math.max(0, width) * EMPTY_STATE_LAYOUT.maximumInsetRatio)
  const contentWidth = Math.max(0, width - inset * 2)
  const iconSize = config.illustration === 'none' ? 0 : Math.min(config.iconSize, contentWidth)
  const iconBlock = iconSize > 0 ? iconSize + config.gap : 0
  const descriptionGap = config.description ? config.gap : 0
  const contentHeight = iconBlock + titleHeight + descriptionGap + descriptionHeight
  const y = Math.max(inset, (height - contentHeight) / 2)
  return {
    icon: {
      x: config.alignment === 'center' ? (width - iconSize) / 2 : inset,
      y,
      width: iconSize,
      height: iconSize
    },
    title: { x: inset, y: y + iconBlock, width: contentWidth, height: titleHeight },
    description: {
      x: inset,
      y: y + iconBlock + titleHeight + descriptionGap,
      width: contentWidth,
      height: descriptionHeight
    },
    contentHeight
  }
}
