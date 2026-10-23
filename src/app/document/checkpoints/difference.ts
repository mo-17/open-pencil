import { isEqual, omit, uniq } from 'es-toolkit'

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { CHECKPOINT_LIMITS } from './types'

export interface CheckpointNodeDifference {
  id: string
  name: string
  kind: 'added' | 'removed' | 'changed'
  fields: string[]
}
export interface CheckpointDifference {
  added: number
  removed: number
  changed: number
  nodes: CheckpointNodeDifference[]
  variables: boolean
  assets: boolean
  document: boolean
  truncated: boolean
}

function content(node: SceneNode) {
  // Imported source caches and editor tree expansion are not authored differences.
  return omit(node, ['source', 'derivedLayout', 'expanded'])
}

/** Compare fully populated FIG graphs, both decoded through the same document IO boundary. */
export function compareCheckpointGraphs(
  before: SceneGraph,
  after: SceneGraph
): CheckpointDifference {
  const result: CheckpointDifference = {
    added: 0,
    removed: 0,
    changed: 0,
    nodes: [],
    variables:
      !isEqual(before.variables, after.variables) ||
      !isEqual(before.variableCollections, after.variableCollections) ||
      !isEqual(before.activeMode, after.activeMode),
    assets: !isEqual(before.images, after.images),
    document:
      before.documentColorSpace !== after.documentColorSpace ||
      !isEqual(before.enabledLibraries, after.enabledLibraries) ||
      !isEqual(before.figMessageObjectAnimations, after.figMessageObjectAnimations),
    truncated: false
  }
  const add = (entry: CheckpointNodeDifference) => {
    result[entry.kind]++
    if (result.nodes.length < CHECKPOINT_LIMITS.maxDifferences) result.nodes.push(entry)
    else result.truncated = true
  }
  for (const [id, node] of before.nodes) {
    const current = after.nodes.get(id)
    if (!current) {
      add({ id, name: node.name, kind: 'removed', fields: [] })
      continue
    }
    const left = content(node)
    const right = content(current)
    const fields = uniq([...Object.keys(left), ...Object.keys(right)]).filter(
      (key) => !isEqual(Reflect.get(left, key), Reflect.get(right, key))
    )
    if (fields.length) add({ id, name: current.name, kind: 'changed', fields })
  }
  for (const [id, node] of after.nodes) {
    if (!before.nodes.has(id)) add({ id, name: node.name, kind: 'added', fields: [] })
  }
  return result
}
