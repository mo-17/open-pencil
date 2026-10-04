import type { SceneNode } from '@open-pencil/scene-graph'

import { resolveChartModule } from '#core/plugins/chart'
import { resolveDataGridModule } from '#core/plugins/data-grid'

export interface ModuleDataField {
  key: 'rows' | 'data'
  type: 'array' | 'object'
}

/** Read authority belongs only to an exact, valid reviewed module envelope. */
export function moduleDataField(node: SceneNode): ModuleDataField | undefined {
  if (node.type !== 'FRAME') return undefined
  const module = node.interactiveProps?.module
  if (resolveDataGridModule(module)?.ok) return { key: 'rows', type: 'array' }
  if (resolveChartModule(module)?.ok) return { key: 'data', type: 'object' }
  return undefined
}
