import type { ChartLayout } from './types'

/** One bounded surface model for authored geometry and complete bound data. */
export function createChartLayout(width: number, height: number): ChartLayout {
  const safeWidth = Number.isFinite(width) ? Math.max(0, width) : 0
  const safeHeight = Number.isFinite(height) ? Math.max(0, height) : 0
  return {
    width: safeWidth,
    height: safeHeight,
    backgroundColor: '#FFFFFF',
    empty: false,
    compact: safeWidth < 80 || safeHeight < 80,
    paths: [],
    rects: [],
    circles: [],
    texts: [],
    hiddenLabelCount: 0
  }
}
