/** Shared authored geometry; compact containers collapse alternating content to one readable column. */
export const TIMELINE_LAYOUT = Object.freeze({
  inset: 16,
  columnGap: 12,
  textGap: 4,
  lineHeight: 1.5,
  secondaryScale: 0.9,
  alternateMinWidth: 480
})

export const TIMELINE_MARK_PATHS = Object.freeze({
  completed: 'M4 8 7 11 12 5',
  error: 'M8 4 8 9 M8 11 8 12'
})

export function timelineColumns(width: number, markerSize: number, layout: 'start' | 'alternate') {
  const alternate = layout === 'alternate' && width >= TIMELINE_LAYOUT.alternateMinWidth
  const available = Math.max(0, width - TIMELINE_LAYOUT.inset * 2)
  const textWidth = Math.max(
    0,
    alternate
      ? (available - markerSize - TIMELINE_LAYOUT.columnGap * 2) / 2
      : available - markerSize - TIMELINE_LAYOUT.columnGap
  )
  const markerX = alternate ? width / 2 : TIMELINE_LAYOUT.inset + markerSize / 2
  return {
    alternate,
    markerX,
    textWidth,
    startX: TIMELINE_LAYOUT.inset,
    endX: markerX + markerSize / 2 + TIMELINE_LAYOUT.columnGap
  }
}
