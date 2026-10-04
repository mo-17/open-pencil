import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { readModuleDataInitial } from '#core/canvas/module-data'
import { buildChartDataLayout, type ChartModuleConfigV1, parseChartData } from '#core/plugins/chart'

export function chartDataProjection(
  node: SceneNode,
  graph: SceneGraph | undefined,
  authored: ChartModuleConfigV1,
  width: number,
  height: number
) {
  const binding = readModuleDataInitial(node, graph, 'data')
  const data = binding.bound ? parseChartData(binding.value, authored.chartType) : authored
  const config = {
    ...authored,
    values: data?.values ?? [],
    labels: data?.labels ?? []
  }
  return {
    config,
    layout: buildChartDataLayout(config, width, height),
    invalid: binding.bound && data === null,
    emptyData: binding.bound && data?.values.length === 0
  }
}
