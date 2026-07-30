import { isEqual } from 'es-toolkit/predicate'

import type { SceneGraph, SceneNode, Variable, VariableCollection } from '@open-pencil/scene-graph'

import type { EditorContext } from '#core/editor/types'
import { computeAllLayouts } from '#core/layout'

export type PageSnapshot = Map<string, SceneNode> & {
  /** Shallow byte references keep image undo exact without duplicating large buffers. */
  images?: Map<string, Uint8Array>
}

export interface DocumentSnapshot {
  activeMode: Map<string, string>
  currentPageId: string
  documentColorSpace: SceneGraph['documentColorSpace']
  figKiwiVersion: number | null
  figMessageObjectAnimations: unknown
  figSchemaDeflated: Uint8Array | null
  images: Map<string, Uint8Array>
  instanceIndex: Map<string, Set<string>>
  nodes: Map<string, SceneNode>
  positionPreviewVersion: number
  rootId: string
  variableCollections: Map<string, VariableCollection>
  variables: Map<string, Variable>
}

const STRUCTURAL_NODE_FIELDS = new Set<keyof SceneNode>(['id', 'type', 'parentId', 'childIds'])

export function snapshotPage(graph: SceneGraph, pageId: string): PageSnapshot {
  const snapshot = new Map<string, SceneNode>() as PageSnapshot
  snapshot.images = new Map(graph.images)
  const walk = (id: string) => {
    const node = graph.getNode(id)
    if (!node) return
    snapshot.set(id, snapshotNode(node))
    for (const childId of node.childIds) walk(childId)
  }
  const root = graph.getNode(graph.rootId)
  if (root) snapshot.set(root.id, snapshotNode(root))
  walk(pageId)
  return snapshot
}

export function snapshotDocument(graph: SceneGraph, currentPageId: string): DocumentSnapshot {
  return {
    activeMode: structuredClone(graph.activeMode),
    currentPageId,
    documentColorSpace: graph.documentColorSpace,
    figKiwiVersion: graph.figKiwiVersion,
    figMessageObjectAnimations: structuredClone(graph.figMessageObjectAnimations),
    figSchemaDeflated: graph.figSchemaDeflated?.slice() ?? null,
    images: new Map(graph.images),
    instanceIndex: structuredClone(graph.instanceIndex),
    nodes: snapshotNodes(graph.nodes),
    positionPreviewVersion: graph.positionPreviewVersion,
    rootId: graph.rootId,
    variableCollections: structuredClone(graph.variableCollections),
    variables: structuredClone(graph.variables)
  }
}

export function documentSnapshotChanged(graph: SceneGraph, snapshot: DocumentSnapshot): boolean {
  if (!isEqual(graph.variables, snapshot.variables)) return true
  if (!isEqual(graph.variableCollections, snapshot.variableCollections)) return true
  if (!isEqual(graph.activeMode, snapshot.activeMode)) return true
  if (graph.images.size !== snapshot.images.size) return true
  for (const [hash, bytes] of graph.images) {
    if (snapshot.images.get(hash)?.byteLength !== bytes.byteLength) return true
  }
  return (
    graph.rootId !== snapshot.rootId ||
    graph.figKiwiVersion !== snapshot.figKiwiVersion ||
    graph.documentColorSpace !== snapshot.documentColorSpace ||
    graph.positionPreviewVersion !== snapshot.positionPreviewVersion ||
    graph.figSchemaDeflated?.byteLength !== snapshot.figSchemaDeflated?.byteLength
  )
}

export function restorePageFromSnapshot(
  ctx: EditorContext,
  snapshot: PageSnapshot,
  pageId: string = ctx.state.currentPageId
): void {
  const page = ctx.graph.getNode(pageId)
  const pageSnap = snapshot.get(pageId)
  if (!page || !pageSnap) return

  const rootSnap = snapshot.get(ctx.graph.rootId)
  if (rootSnap) restoreNodeFields(ctx.graph, ctx.graph.rootId, rootSnap)
  if (snapshot.images) replaceMapReferences(ctx.graph.images, snapshot.images)
  restoreNodeFields(ctx.graph, pageId, pageSnap)
  for (const childId of page.childIds.slice()) ctx.graph.deleteNode(childId)
  restoreChildren(ctx.graph, snapshot, pageId, pageSnap.childIds)

  ctx.graph.clearAbsPosCache()
  computeAllLayouts(ctx.graph, pageId)
  if (ctx.state.currentPageId === pageId) {
    ctx.setSelectedIds(new Set())
    ctx.state.hoveredNodeId = null
  }
  ctx.requestRender()
}

export function restoreDocumentFromSnapshot(ctx: EditorContext, snapshot: DocumentSnapshot): void {
  const previousPageId = ctx.state.currentPageId
  const previousSelection = [...ctx.state.selectedIds]
  const previousHoveredNodeId = ctx.state.hoveredNodeId
  replaceMap(ctx.graph.nodes, snapshot.nodes)
  replaceMapReferences(ctx.graph.images, snapshot.images)
  replaceMap(ctx.graph.variables, snapshot.variables)
  replaceMap(ctx.graph.variableCollections, snapshot.variableCollections)
  replaceMap(ctx.graph.activeMode, snapshot.activeMode)
  replaceMap(ctx.graph.instanceIndex, snapshot.instanceIndex)
  ctx.graph.rootId = snapshot.rootId
  ctx.graph.figKiwiVersion = snapshot.figKiwiVersion
  ctx.graph.figSchemaDeflated = snapshot.figSchemaDeflated?.slice() ?? null
  ctx.graph.figMessageObjectAnimations = structuredClone(snapshot.figMessageObjectAnimations)
  ctx.graph.documentColorSpace = snapshot.documentColorSpace
  ctx.graph.positionPreviewVersion = snapshot.positionPreviewVersion
  ctx.graph.clearAbsPosCache()
  ctx.getRenderer()?.invalidateAllPictures()

  const previousPage = ctx.graph.getNode(previousPageId)
  const snapshotPage = ctx.graph.getNode(snapshot.currentPageId)
  if (previousPage?.type === 'CANVAS') {
    ctx.state.currentPageId = previousPageId
  } else if (snapshotPage?.type === 'CANVAS') {
    ctx.state.currentPageId = snapshot.currentPageId
  } else {
    ctx.state.currentPageId = ctx.graph.getPages()[0]?.id ?? ctx.graph.rootId
  }
  ctx.setSelectedIds(
    new Set(
      previousSelection.filter(
        (nodeId) => pageIdForNode(ctx.graph, nodeId) === ctx.state.currentPageId
      )
    )
  )
  ctx.state.hoveredNodeId =
    previousHoveredNodeId &&
    pageIdForNode(ctx.graph, previousHoveredNodeId) === ctx.state.currentPageId
      ? previousHoveredNodeId
      : null
  ctx.emitEditorEvent('graph:replaced', ctx.graph)
  if (previousPageId !== ctx.state.currentPageId) {
    ctx.emitEditorEvent('page:changed', ctx.state.currentPageId, previousPageId)
  }
  ctx.requestRender()
}

function pageIdForNode(graph: SceneGraph, nodeId: string): string | undefined {
  let node = graph.getNode(nodeId)
  while (node) {
    if (node.type === 'CANVAS') return node.id
    node = node.parentId ? graph.getNode(node.parentId) : undefined
  }
  return undefined
}

function restoreNodeFields(graph: SceneGraph, nodeId: string, snapshot: SceneNode): void {
  const current = graph.getNode(nodeId)
  if (!current) return

  const fieldsToClear = Object.keys(current).filter(
    (key) => !STRUCTURAL_NODE_FIELDS.has(key as keyof SceneNode) && !Object.hasOwn(snapshot, key)
  ) as (keyof SceneNode)[]
  graph.clearNodeFields(nodeId, fieldsToClear)

  const changes: Partial<SceneNode> = {}
  for (const [key, value] of Object.entries(snapshot)) {
    if (STRUCTURAL_NODE_FIELDS.has(key as keyof SceneNode)) continue
    Object.assign(changes, { [key]: structuredClone(value) })
  }
  graph.updateNode(nodeId, changes)
}

function replaceMap<K, V>(target: Map<K, V>, source: Map<K, V>): void {
  target.clear()
  for (const [key, value] of source) target.set(key, structuredClone(value))
}

function replaceMapReferences<K, V>(target: Map<K, V>, source: Map<K, V>): void {
  target.clear()
  for (const [key, value] of source) target.set(key, value)
}

function snapshotNode(node: SceneNode): SceneNode {
  return structuredClone({ ...node, textPicture: null })
}

function snapshotNodes(nodes: Map<string, SceneNode>): Map<string, SceneNode> {
  const snapshot = new Map<string, SceneNode>()
  for (const [id, node] of nodes) snapshot.set(id, snapshotNode(node))
  return snapshot
}

function restoreChildren(
  graph: SceneGraph,
  snapshot: PageSnapshot,
  parentId: string,
  childIds: string[]
): void {
  for (const childId of childIds) {
    const snap = snapshot.get(childId)
    if (!snap) continue
    const { parentId: _snapParentId, childIds: snapChildIds, ...rest } = snap
    graph.createNode(snap.type, parentId, { ...structuredClone(rest), childIds: [] })
    graph.reorderChild(snap.id, parentId, childIds.indexOf(childId))
    restoreChildren(graph, snapshot, snap.id, snapChildIds)
  }
}
