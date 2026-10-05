import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { sceneNodeAttributes } from './export'
import { jsxNodeFields } from './fields'

/**
 * Fields a layer keeps when its code is rendered again: its place in the tree and the identity
 * that other layers, libraries and files refer to.
 */
const IDENTITY_FIELDS = new Set<keyof SceneNode>([
  'id',
  'type',
  'parentId',
  'childIds',
  'source',
  'componentKey',
  'sourceLibraryKey',
  'publishId',
  'overrideKey'
])

/**
 * Types rebuilt as a whole: instance overrides are keyed by the ids of their sublayers, and icon
 * and SVG artwork is drawn again from its paths.
 */
const REPLACED_TYPES = new Set<SceneNode['type']>(['INSTANCE', 'VECTOR', 'BOOLEAN_OPERATION'])

function updatesInPlace(existing: SceneNode, rendered: SceneNode): boolean {
  return existing.type === rendered.type && !REPLACED_TYPES.has(existing.type)
}

/** Names identify children; a newly named layer must not inherit a deleted layer's metadata. */
function matchChildren(
  existing: readonly SceneNode[],
  rendered: readonly SceneNode[]
): Map<SceneNode, SceneNode> {
  const pairs = new Map<SceneNode, SceneNode>()
  const free = new Set(existing)
  const take = (node: SceneNode, test: (candidate: SceneNode) => boolean) => {
    for (const candidate of free) {
      if (!test(candidate)) continue
      free.delete(candidate)
      pairs.set(node, candidate)
      return
    }
  }
  for (const node of rendered) {
    take(node, (candidate) => candidate.type === node.type && candidate.name === node.name)
  }
  for (const node of rendered) {
    if (!pairs.has(node)) take(node, (candidate) => candidate.name === node.name)
  }
  return pairs
}

function authoredChanges(
  graph: SceneGraph,
  existing: SceneNode,
  rendered: SceneNode
): Partial<SceneNode> {
  // Compare with what the old code described, not metadata that JSX cannot express.
  const { fields, bindings } = jsxNodeFields(
    graph,
    existing.type,
    sceneNodeAttributes(existing.id, graph) ?? [],
    rendered.parentId ?? graph.rootId
  )
  fields.boundVariables = bindings
  const changes: Partial<SceneNode> = {}
  for (const key of Object.keys(rendered) as (keyof SceneNode)[]) {
    if (IDENTITY_FIELDS.has(key)) continue
    const next = rendered[key]
    if (JSON.stringify(fields[key]) === JSON.stringify(next)) continue
    if (JSON.stringify(existing[key]) === JSON.stringify(next)) continue
    Object.assign(changes, { [key]: structuredClone(next) })
  }
  return changes
}

class Reconciler {
  /** Rendered layer id → the id it has once reconciled: the existing layer's, or its own. */
  readonly ids = new Map<string, string>()
  private readonly used = new Set<string>()
  private readonly retained = new Set<string>()
  private readonly removed = new Set<string>()
  private readonly existingByName = new Map<string, SceneNode[]>()
  private readonly renderedCounts = new Map<string, number>()

  constructor(
    private readonly graph: SceneGraph,
    existingRootIds: readonly string[],
    renderedRootIds: readonly string[]
  ) {
    const visit = (id: string, collect: (node: SceneNode) => void) => {
      for (const child of graph.getChildren(id)) {
        collect(child)
        visit(child.id, collect)
      }
    }
    for (const id of existingRootIds)
      visit(id, (node) => {
        const nodes = this.existingByName.get(node.name) ?? []
        nodes.push(node)
        this.existingByName.set(node.name, nodes)
      })
    for (const id of renderedRootIds)
      visit(id, (node) => {
        this.renderedCounts.set(node.name, (this.renderedCounts.get(node.name) ?? 0) + 1)
      })
  }

  finish() {
    // Defer removal until moved children have reached their new parents.
    for (const id of this.removed) if (!this.retained.has(id)) this.graph.deleteNode(id)
    this.graph.remapClonedNodeReferences(this.ids)
  }

  keepRendered(node: SceneNode, allowMoves = true) {
    this.ids.set(node.id, node.id)
    for (const [index, child] of this.graph.getChildren(node.id).entries()) {
      const match = allowMoves ? this.movedMatch(child) : undefined
      if (match) {
        // Detach the matched subtree from its old ancestors before reconciling descendants.
        this.graph.insertChildAt(match.id, node.id, index)
        this.graph.insertChildAt(this.pair(match, child), node.id, index)
      } else this.keepRendered(child, allowMoves)
    }
  }

  private movedMatch(node: SceneNode): SceneNode | undefined {
    const candidates = this.existingByName.get(node.name)
    const match =
      candidates?.length === 1 && this.renderedCounts.get(node.name) === 1
        ? candidates[0]
        : undefined
    return match && !this.used.has(match.id) ? match : undefined
  }

  /** Makes `existing` match `rendered` and returns the id the pair ends up with. */
  pair(existing: SceneNode, rendered: SceneNode): string {
    this.used.add(existing.id)
    if (!updatesInPlace(existing, rendered)) {
      // Rebuilding artwork or changing its type does not author a plugin-data deletion.
      this.graph.updateNode(rendered.id, { pluginData: structuredClone(existing.pluginData) })
      if (existing.type === 'INSTANCE' && existing.componentId !== rendered.componentId) {
        this.keepRendered(rendered, false)
      } else {
        this.ids.set(rendered.id, rendered.id)
        this.children(existing.id, rendered.id, rendered.id)
      }
      const parentId = existing.parentId
      const parent = parentId ? this.graph.getNode(parentId) : undefined
      if (parent && parentId) {
        this.graph.insertChildAt(rendered.id, parentId, parent.childIds.indexOf(existing.id))
      }
      this.removed.add(existing.id)
      return rendered.id
    }
    const changes = authoredChanges(this.graph, existing, rendered)
    if (Object.keys(changes).length > 0) this.graph.updateNode(existing.id, changes)
    this.ids.set(rendered.id, existing.id)
    this.retained.add(existing.id)
    this.children(existing.id, rendered.id)
    this.graph.deleteNode(rendered.id)
    return existing.id
  }

  private children(existingId: string, renderedId: string, destinationId = existingId) {
    const renderedChildren = this.graph.getChildren(renderedId)
    const pairs = matchChildren(
      this.graph.getChildren(existingId).filter((node) => !this.used.has(node.id)),
      renderedChildren
    )
    const order = renderedChildren.map((child, index) => {
      const match = pairs.get(child) ?? this.movedMatch(child)
      if (match) pairs.set(child, match)
      else this.keepRendered(child)
      // The desired parent is mounted first, so an old ancestor can safely become its child.
      if (match) this.graph.insertChildAt(match.id, destinationId, index)
      return match ? this.pair(match, child) : child.id
    })
    const kept = new Set(order)
    for (const child of this.graph.getChildren(existingId)) {
      if (!kept.has(child.id)) this.removed.add(child.id)
    }
    for (const [index, id] of order.entries()) this.graph.insertChildAt(id, destinationId, index)
  }
}

/**
 * Folds freshly rendered layers into the layers they replace, so code edits update layers in
 * place: matched layers keep their ids, and only the properties that differ change. Roots pair
 * by position; extra rendered roots stay, extra existing roots are deleted. Returns the id each
 * rendered layer ends up with.
 */
export function reconcileRenderedLayers(
  graph: SceneGraph,
  existingRootIds: readonly string[],
  renderedRootIds: readonly string[]
): { rootIds: string[]; ids: Map<string, string> } {
  const reconciler = new Reconciler(graph, existingRootIds, renderedRootIds)
  const rootIds = renderedRootIds.flatMap((renderedId, index) => {
    const rendered = graph.getNode(renderedId)
    if (!rendered) return []
    const existingId = existingRootIds.at(index)
    const existing = existingId ? graph.getNode(existingId) : undefined
    if (existing) return [reconciler.pair(existing, rendered)]
    reconciler.keepRendered(rendered)
    return [rendered.id]
  })
  for (const id of existingRootIds.slice(renderedRootIds.length)) graph.deleteNode(id)
  reconciler.finish()
  return { rootIds, ids: reconciler.ids }
}
