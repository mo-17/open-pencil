import type { InstanceOccurrence } from '@open-pencil/fig/instance-overrides'
import type { NodeChange, Paint } from '@open-pencil/kiwi/fig/codec'
import { guidToString } from '@open-pencil/kiwi/fig/guid'
import type { Fill, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { collapseFigmaProjectionChildren } from '#core/kiwi/fig/node-change/figma-projection'
import { reapplyInstanceOverrides } from '#core/kiwi/fig/node-change/lowcode-plugin-data'

/** Restore host semantics only after the format reader has established occurrence identity. */
export function restoreReaderMetadata(
  graph: SceneGraph,
  sources: ReadonlyMap<string, string>,
  records: readonly NodeChange[],
  newSourceNodeIds?: ReadonlySet<string>
): void {
  reapplyInstanceOverrides(graph)
  // Existing policies already use runtime IDs, which can coincide with other saved GUIDs.
  // The reader supplies first-hydrated receivers; Motion and other references keep their
  // existing full-map late resolution when another page arrives.
  graph.remapClonedNodeReferences(sources, 'copy', {
    applicationReferenceNodeIds: newSourceNodeIds
  })
  const byId = new Map(
    records.flatMap((record) => (record.guid ? [[guidToString(record.guid), record] as const] : []))
  )
  const children = new Map<string, string[]>()
  for (const [id, record] of byId) {
    if (!record.parentIndex) continue
    const parent = guidToString(record.parentIndex.guid)
    const siblings = children.get(parent)
    if (siblings) siblings.push(id)
    else children.set(parent, [id])
  }
  for (const [sourceId, nodeId] of sources) {
    const node = graph.getNode(nodeId)
    if (!node) continue
    const projection = collapseFigmaProjectionChildren(
      node.type,
      children.get(sourceId) ?? [],
      {
        getNode: (id) => byId.get(id),
        getChildren: (id) => children.get(id) ?? []
      },
      node.interactiveProps
    )
    if (Object.keys(projection.interactivePropsPatch).length)
      graph.updateNode(node.id, {
        interactiveProps: { ...node.interactiveProps, ...projection.interactivePropsPatch }
      })
    for (const id of projection.collapsedChildIds) {
      const child = sources.get(id)
      if (child) graph.deleteNode(child)
    }
  }
}

/** Repeated instances remap their own Motion targets without retargeting a sibling occurrence. */
export function restoreOccurrenceReferences(
  graph: SceneGraph,
  nodes: ReadonlyMap<InstanceOccurrence, SceneNode>,
  sources: ReadonlyMap<string, string>
): void {
  for (const [occurrence, root] of nodes) {
    if (root.type !== 'INSTANCE') continue
    const mapping = new Map<string, string>()
    const scope: Array<[InstanceOccurrence, SceneNode]> = []
    const visit = (current: InstanceOccurrence): void => {
      const node = nodes.get(current)
      if (!node) return
      const source = current.properties.guid
        ? guidToString(current.properties.guid)
        : current.sourceId
      if (mapping.has(source) && mapping.get(source) !== node.id)
        throw new Error(`Ambiguous Motion occurrence reference ${source}`)
      mapping.set(source, node.id)
      scope.push([current, node])
      if (current !== occurrence && node.type === 'INSTANCE') return
      for (const child of current.children) visit(child)
    }
    visit(occurrence)
    graph.remapClonedNodeReferences(mapping, 'instance')
    for (const [current, node] of scope) {
      const fills = resolveOccurrencePaintSources(
        node.fills,
        current.properties.fillPaints,
        mapping,
        sources
      )
      const strokes = resolveOccurrencePaintSources(
        node.strokes,
        current.properties.strokePaints,
        mapping,
        sources
      )
      if (fills || strokes)
        graph.updateNode(node.id, { ...(fills ? { fills } : {}), ...(strokes ? { strokes } : {}) })
    }
  }
}

function resolveOccurrencePaintSources<T extends Omit<Fill, 'type'>>(
  paints: readonly T[],
  saved: readonly Paint[] | undefined,
  occurrences: ReadonlyMap<string, string>,
  sources: ReadonlyMap<string, string>
): T[] | undefined {
  const resolved = paints.map((paint, index) => {
    const reference = saved?.[index]?.sourceNodeId
    if (!reference) return paint
    // Resolve from the saved GUID; a runtime id can coincide with a different source GUID.
    const source = guidToString(reference)
    const target = occurrences.get(source) ?? sources.get(source)
    return target && target !== paint.sourceNodeId ? { ...paint, sourceNodeId: target } : paint
  })
  return resolved.some((paint, index) => paint !== paints[index]) ? resolved : undefined
}
