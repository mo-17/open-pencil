import type { ChartModuleConfigV1 } from '#core/plugins/chart'

import { buildCartesianChart } from './cartesian'
import { buildCircularChart } from './circular'
import { createChartLayout } from './model'
import type { ChartLayout } from './types'

/** Static authored geometry shared verbatim by CanvasKit and generated SVG; no fonts or IO. */
export function buildChartLayout(
  config: ChartModuleConfigV1,
  width: number,
  height: number
): ChartLayout {
  const model = createChartLayout(width, height)
  if (!model.width || !model.height) {
    model.compact = true
    model.hiddenLabelCount = config.labels.length
    return model
  }
  if (config.chartType === 'pie' || config.chartType === 'donut') buildCircularChart(config, model)
  else buildCartesianChart(config, model)
  return model
}
