import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import { guidToString } from '@open-pencil/kiwi/fig/guid'

import { nodeChangeToProps } from '../node-change'
import { applyDocumentLayoutBindings } from './bindings/layout'
import { applyDocumentPaintBindings } from './bindings/paint'
import { applyDocumentTextBindings } from './bindings/text'
import { linkComponentPropertyValues, resolveVariantPropertyValues } from './component/values'
import type { AssemblyState, DocumentAssemblyOptions } from './materialize'
import type { createDocumentReader } from './read'

/** Compatibility for decoded records; the document reader still owns every source. */
export function materializeSourceRecords(
  reader: ReturnType<typeof createDocumentReader>,
  blobs: Uint8Array[],
  options: DocumentAssemblyOptions,
  state: AssemblyState
): AssemblyState {
  const { graph, sources, componentIds } = state
  const visited = new Set<string>()
  const create = (record: NodeChange, parentId: string): void => {
    if (!record.guid) throw new Error('Source node has no GUID')
    const id = guidToString(record.guid)
    if (visited.has(id)) throw new Error(`Repeated source hierarchy ${id}`)
    visited.add(id)
    if (record.type === 'DOCUMENT' || record.type === 'VARIABLE' || record.type === 'VARIABLE_SET')
      return
    const converted = nodeChangeToProps(record, blobs, 'source', reader.resolveStyleReference)
    const { nodeType, ...props } = options.mapNodeProps?.(record, converted) ?? converted
    if (nodeType === 'DOCUMENT' || nodeType === 'VARIABLE') return
    if (nodeType === 'CANVAS')
      Object.assign(props, {
        width: record.size?.x ?? 0,
        height: record.size?.y ?? 0,
        componentId: null
      })
    if (props.sharedStyleType) props.internalOnly = true
    const node = graph.createNode(nodeType, parentId, props)
    sources.set(id, node.id)
    if (node.type === 'COMPONENT') componentIds.set(id, node.id)
    if (node.type === 'INSTANCE') state.unexpandedInstanceSourceIds.add(id)
    for (const child of reader.sourceChildren(id)) create(child, node.id)
  }
  for (const page of reader.pages) {
    const record = reader.sourceRecord(page.id)
    if (!record) throw new Error(`Missing source page ${page.id}`)
    create(record, graph.rootId)
  }
  const nodes = [...graph.nodes.values()]
  graph.preserveSourceMetadataDuring(() => {
    for (const node of nodes) {
      if (node.componentId)
        graph.updateNode(node.id, {
          componentId: componentIds.get(node.componentId) ?? node.componentId
        })
      for (const field of [
        'fillStyleId',
        'strokeStyleId',
        'textStyleId',
        'effectStyleId',
        'gridStyleId'
      ] as const)
        if (node[field]) node[field] = sources.get(node[field]) ?? node[field]
    }
    linkComponentPropertyValues(graph, sources, nodes)
    resolveVariantPropertyValues(graph, nodes)
    applyDocumentLayoutBindings(graph, state.savedSizeNodes, nodes)
    applyDocumentPaintBindings(graph, nodes)
    applyDocumentTextBindings(graph, nodes)
    options.afterMaterialize?.(
      graph,
      sources,
      options.afterMaterializeSourceFields
        ? reader.sourceRecordsFor(options.afterMaterializeSourceFields)
        : reader.sourceRecords,
      new Set(sources.values())
    )
  })
  return state
}
