import { TABLE_MODULE_TYPE, TABLE_PLUGIN_ID, resolveTableModule } from '@open-pencil/core/plugins'
import type { SceneNode } from '@open-pencil/scene-graph'

import type { CompilerModuleLowerer } from './types'

export const TABLE_COMPILER_MODULE_LOWERER: CompilerModuleLowerer = Object.freeze({
  pluginId: TABLE_PLUGIN_ID,
  moduleType: TABLE_MODULE_TYPE,
  warningCodePrefix: 'table-module',
  displayName: 'Table',
  hostTypes: Object.freeze(['FRAME'] as const),
  lower(value: unknown, _node: SceneNode) {
    const resolved = resolveTableModule(value)
    if (!resolved?.ok) {
      return { ok: false as const, reason: resolved?.reason ?? 'module identity does not match' }
    }
    const { config } = resolved
    return {
      ok: true as const,
      payload: {
        table: {
          columns: [...config.table.columns],
          rows: config.table.rows.map((row) => [...row])
        },
        showHeader: config.showHeader,
        striped: config.striped,
        borderColor: config.borderColor,
        headerBackground: config.headerBackground,
        textColor: config.textColor,
        fontSize: config.fontSize
      }
    }
  }
})
