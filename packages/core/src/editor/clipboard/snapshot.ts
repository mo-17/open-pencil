import { styleRunReferences, type SceneGraph, type SceneNode } from '@open-pencil/scene-graph'
import { createPaintNodeIdResolver, remapNodePaintReferences } from '@open-pencil/scene-graph/copy'

import { collectClipboardNodeImageHashes } from '#core/clipboard/image-references'

import { clipboardPlacement, type ClipboardPlacement } from './placement'
import { captureClipboardVariables, type ClipboardVariables } from './variables'

export type ClipboardNodeTree = SceneNode & { children?: ClipboardNodeTree[] }

export interface ClipboardSnapshot {
  sourceRootId: string
  sourceDocumentId?: string
  componentDependencies: ClipboardNodeTree[]
  styleDefinitions: SceneNode[]
  variableDependencies: ClipboardVariables
  nodes: ClipboardNodeTree[]
  /** Where the copied layers sat on the canvas when they were copied. */
  placement: ClipboardPlacement
  images: Map<string, Uint8Array>
}

const documentIds = new WeakMap<SceneGraph, string>()

/** Runtime node/root IDs can repeat in another process; clipboard provenance must not. */
function clipboardDocumentId(graph: SceneGraph): string {
  let id = documentIds.get(graph)
  if (!id) {
    id = crypto.randomUUID()
    documentIds.set(graph, id)
  }
  return id
}

/** Reject incomplete cross-document paint fragments before any destination mutation. */
export function validateClipboardPaintReferences(
  graph: SceneGraph,
  roots: readonly ClipboardNodeTree[],
  dependencies: readonly ClipboardNodeTree[],
  sourceDocumentId?: string
): void {
  const nodes = new Map<string, SceneNode>()
  const visit = (node: ClipboardNodeTree) => {
    nodes.set(node.id, node)
    for (const child of node.children ?? []) visit(child)
  }
  for (const node of [...roots, ...dependencies]) visit(node)
  const identities = new Map([...nodes.keys()].map((id) => [id, id]))
  const copied = createPaintNodeIdResolver(nodes, identities)
  const local =
    sourceDocumentId === clipboardDocumentId(graph)
      ? createPaintNodeIdResolver(
          graph.nodes,
          new Map([...graph.nodes.keys()].map((id) => [id, id]))
        )
      : undefined
  for (const node of nodes.values())
    remapNodePaintReferences(node, (id) => {
      const resolved = copied(id) ?? local?.(id)
      if (!resolved)
        throw new Error(
          `Paint target is outside the copied document fragment: ${id}. Copy its source layer together with the painted layer.`
        )
      return resolved
    })
}

function referencedStyleIds(nodes: SceneNode[]): Set<string> {
  const ids = new Set<string>()
  for (const node of nodes) {
    for (const id of [
      node.fillStyleId,
      node.strokeStyleId,
      node.textStyleId,
      node.effectStyleId,
      node.gridStyleId,
      ...styleRunReferences(node.styleRuns).styles
    ]) {
      if (id) ids.add(id)
    }
  }
  return ids
}

export function captureClipboardSnapshot(
  graph: SceneGraph,
  selectedNodes: SceneNode[]
): ClipboardSnapshot {
  const selectedIds = new Set(selectedNodes.map((node) => node.id))
  const roots = selectedNodes.filter((node) => !node.parentId || !selectedIds.has(node.parentId))
  const images = new Map<string, Uint8Array>()
  const capturedNodes: SceneNode[] = []
  const resolvePaintNodeId = createPaintNodeIdResolver(
    graph.nodes,
    new Map([...graph.nodes.keys()].map((id) => [id, id]))
  )
  function capture(node: SceneNode): ClipboardNodeTree {
    capturedNodes.push(node)
    const hashes = new Set<string>()
    collectClipboardNodeImageHashes(node, hashes)
    for (const hash of hashes) {
      const bytes = graph.images.get(hash)
      if (bytes) images.set(hash, bytes.slice())
    }
    const snapshot = structuredClone(node)
    Object.assign(snapshot, remapNodePaintReferences(snapshot, resolvePaintNodeId))
    return { ...snapshot, children: graph.getChildren(node.id).map(capture) }
  }
  const nodes = roots.map(capture)
  const componentDependencies = new Map<string, ClipboardNodeTree>()
  function captureComponent(id: string) {
    if (componentDependencies.has(id) || selectedIds.has(id)) return
    const component = graph.getNode(id)
    if (!component || (component.type !== 'COMPONENT' && component.type !== 'COMPONENT_SET')) return
    const tree = capture(component)
    componentDependencies.set(id, tree)
    visitReferences(tree)
  }
  function visitReferences(node: ClipboardNodeTree) {
    if (node.componentId) captureComponent(node.componentId)
    for (const child of node.children ?? []) visitReferences(child)
  }
  for (const node of nodes) visitReferences(node)
  const styleIds = referencedStyleIds(capturedNodes)
  const styleDefinitions: SceneNode[] = []
  for (const node of graph.getAllNodes()) {
    if (node.source.id && styleIds.has(node.source.id)) styleDefinitions.push(structuredClone(node))
  }
  return {
    sourceRootId: graph.rootId,
    sourceDocumentId: clipboardDocumentId(graph),
    componentDependencies: [...componentDependencies.values()],
    styleDefinitions,
    variableDependencies: captureClipboardVariables(graph, capturedNodes),
    nodes,
    placement: clipboardPlacement(graph, roots),
    images
  }
}
