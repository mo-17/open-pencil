import { isNotNil } from 'es-toolkit/predicate'

import { computeBounds } from '@open-pencil/scene-graph/geometry'

import type { EditorContext } from '#core/editor/types'
import { createSceneGeometry } from '#core/geometry/scene'

export function createClipboardPlacementActions(ctx: EditorContext) {
  function centerNodesAt(nodeIds: string[], cx: number, cy: number) {
    const items = nodeIds.map((id) => ctx.graph.getNode(id)).filter(isNotNil)
    if (ctx.state.contentEdit && items[0]?.parentId) {
      const parent = ctx.graph.getNode(items[0].parentId)
      const local = parent ? createSceneGeometry(ctx.graph).toLocal(parent, { x: cx, y: cy }) : null
      if (local) ({ x: cx, y: cy } = local)
    }
    const bounds = computeBounds(items)
    if (bounds.width === 0 && bounds.height === 0 && items.length === 0) return
    const dx = cx - (bounds.x + bounds.width / 2)
    const dy = cy - (bounds.y + bounds.height / 2)
    for (const id of nodeIds) {
      const node = ctx.graph.getNode(id)
      if (node) ctx.graph.updateNode(id, { x: node.x + dx, y: node.y + dy })
    }
  }

  return { centerNodesAt }
}
