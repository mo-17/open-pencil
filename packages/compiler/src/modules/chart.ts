import { CHART_MODULE_TYPE, CHART_PLUGIN_ID, resolveChartModule } from '@open-pencil/core/plugins'
import type { SceneNode } from '@open-pencil/scene-graph'

import type { CompilerModuleLowerer } from './types'

export const CHART_COMPILER_MODULE_LOWERER: CompilerModuleLowerer = Object.freeze({
  pluginId: CHART_PLUGIN_ID,
  moduleType: CHART_MODULE_TYPE,
  warningCodePrefix: 'chart-module',
  displayName: 'chart',
  hostTypes: Object.freeze(['FRAME'] as const),
  lower(value: unknown, _node: SceneNode) {
    const resolved = resolveChartModule(value)
    if (!resolved?.ok) {
      return { ok: false as const, reason: resolved?.reason ?? 'module identity does not match' }
    }
    const { config } = resolved
    return {
      ok: true as const,
      payload: {
        chartType: config.chartType,
        values: [...config.values],
        labels: [...config.labels],
        color: config.color,
        showValues: config.showValues
      }
    }
  }
})
