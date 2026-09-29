import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleLabelTextNode } from '#core/canvas/modules/label'
import { resolveTableModule, type TableModuleConfigV1 } from '#core/plugins/table'

interface VisibleTableRows {
  rows: readonly string[][]
  headerRows: number
  rowHeight: number
}

export function visibleTableRows(config: TableModuleConfigV1, height: number): VisibleTableRows {
  const rowHeight = Math.max(22, config.fontSize * 1.4)
  const availableRows = Math.max(0, Math.floor(Math.max(0, height) / rowHeight))
  const headerRows = config.showHeader && availableRows > 0 ? 1 : 0
  return {
    rows: config.table.rows.slice(0, Math.max(0, availableRows - headerRows)),
    headerRows,
    rowHeight
  }
}

/** Preflight only cells the bounded table actually displays. */
export function tableTextNode(node: SceneNode): SceneNode | null {
  if (node.type !== 'FRAME' || node.width <= 0 || node.height <= 0) return null
  const resolved = resolveTableModule(node.interactiveProps?.module)
  if (!resolved?.ok) return null
  const visible = visibleTableRows(resolved.config, node.height)
  const headers = visible.headerRows ? resolved.config.table.columns : []
  const text = [...headers, ...visible.rows.flat()].join('\n')
  return moduleLabelTextNode(
    node,
    text,
    node.width,
    resolved.config.fontSize,
    node.textLanguage ?? 'en'
  )
}
