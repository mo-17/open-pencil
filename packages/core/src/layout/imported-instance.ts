import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import type { LayoutGraph } from './graph'

/** Saved instance layout is usable until its occurrence or definition changes layout. */
export function preservesImportedInstanceLayout(graph: LayoutGraph, node: SceneNode): boolean {
  if (node.type !== 'INSTANCE' || node.source.format !== 'fig') return false
  const pending = [node.id]
  const seen = new Set<string>()
  while (pending.length > 0) {
    const id = pending.pop()
    if (!id || seen.has(id)) continue
    seen.add(id)
    const current = graph.getNode(id)
    if (!current) continue
    if (
      current.source.editedFields.some(
        (field) =>
          SceneGraph.LAYOUT_AFFECTING_KEYS.has(field) || SceneGraph.GLYPH_AFFECTING_KEYS.has(field)
      )
    )
      return false
    pending.push(...current.childIds)
    if (current.type === 'INSTANCE' && current.componentId) pending.push(current.componentId)
  }
  return true
}
