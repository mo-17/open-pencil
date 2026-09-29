import type { ChartModuleConfigV1 } from '#core/plugins/chart'

import { buildCartesianChart } from './cartesian'
import { buildCircularChart } from './circular'
import type { ChartLayout } from './types'

/** Static authored geometry shared verbatim by CanvasKit and generated SVG; no fonts or IO. */
export function buildChartLayout(
  config: ChartModuleConfigV1,
  width: number,
  height: number
): ChartLayout {
  const safeWidth = Number.isFinite(width) ? Math.max(0, width) : 0
  const safeHeight = Number.isFinite(height) ? Math.max(0, height) : 0
  const model: ChartLayout = {
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
  if (!safeWidth || !safeHeight) {
    model.compact = true
    model.hiddenLabelCount = config.labels.length
    return model
  }
  if (config.chartType === 'pie' || config.chartType === 'donut') buildCircularChart(config, model)
  else buildCartesianChart(config, model)
  return model
}
