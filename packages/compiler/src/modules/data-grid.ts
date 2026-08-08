import {
  DATA_GRID_MODULE_TYPE,
  DATA_GRID_PLUGIN_ID,
  resolveDataGridModule
} from '@open-pencil/core/plugins'
import type { SceneNode } from '@open-pencil/scene-graph'

import type { CompilerModuleLowerer } from './types'

export const DATA_GRID_COMPILER_MODULE_LOWERER: CompilerModuleLowerer = Object.freeze({
  pluginId: DATA_GRID_PLUGIN_ID,
  moduleType: DATA_GRID_MODULE_TYPE,
  warningCodePrefix: 'data-grid-module',
  displayName: 'Advanced Data Grid',
  hostTypes: Object.freeze(['FRAME'] as const),
  lower(value: unknown, _node: SceneNode) {
    const resolved = resolveDataGridModule(value)
    if (!resolved?.ok) {
      return { ok: false as const, reason: resolved?.reason ?? 'module identity does not match' }
    }
    const { config } = resolved
    return {
      ok: true as const,
      payload: {
        data: {
          columns: config.data.columns.map((column) => ({ ...column })),
          rows: config.data.rows.map((row) => ({ id: row.id, cells: [...row.cells] }))
        },
        initialSort: config.initialSort ? { ...config.initialSort } : null,
        filters: config.filters.map((filter) => ({ ...filter })),
        pageSize: config.pageSize,
        selectionMode: config.selectionMode,
        density: config.density,
        showHeader: config.showHeader,
        stickyHeader: config.stickyHeader,
        striped: config.striped,
        borderColor: config.borderColor,
        headerBackground: config.headerBackground,
        textColor: config.textColor,
        accentColor: config.accentColor,
        fontSize: config.fontSize
      }
    }
  }
})
