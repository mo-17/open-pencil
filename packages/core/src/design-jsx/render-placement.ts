import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

export interface RenderPlacementInput {
  defaultParentId: string
  parentId?: string
  replaceId?: string
  insertIndex?: number
}

export interface ResolvedRenderPlacement {
  parentId: string
  insertIndex?: number
  replaceId?: string
}

export interface AppliedRenderPlacement {
  parentId: string
  index: number
  indices: number[]
  replacedId?: string
}

type RenderPlacementRoot = Pick<SceneNode, 'id' | 'name' | 'type'>

/** Describe every additional rendered root with its final sibling index. */
export function renderPlacementSiblings(
  renderedRoots: readonly RenderPlacementRoot[],
  placement: AppliedRenderPlacement
) {
  return renderedRoots.slice(1).map((node, index) => ({
    id: node.id,
    name: node.name,
    type: node.type,
    index: placement.indices[index + 1]
  }))
}

function requireContainer(graph: SceneGraph, parentId: string): void {
  const parent = graph.getNode(parentId)
  if (!parent) throw new Error(`Render parent "${parentId}" not found`)
  if (!graph.isContainer(parentId)) {
    throw new Error(`Render parent "${parentId}" (${parent.type}) cannot contain children`)
  }
}

function validatedInsertIndex(insertIndex: number | undefined): number | undefined {
  if (insertIndex === undefined) return undefined
  if (!Number.isInteger(insertIndex) || insertIndex < 0) {
    throw new Error('insert_index must be a non-negative integer')
  }
  return insertIndex
}

/**
 * Resolve render placement before creating nodes so every transport honors the
 * same replace-over-parent/index precedence as the core render tool.
 */
export function resolveRenderPlacement(
  graph: SceneGraph,
  input: RenderPlacementInput
): ResolvedRenderPlacement {
  if (input.replaceId) {
    const target = graph.getNode(input.replaceId)
    if (!target) throw new Error(`Replace target "${input.replaceId}" not found`)
    if (!target.parentId) {
      throw new Error(`Replace target "${input.replaceId}" has no parent`)
    }
    requireContainer(graph, target.parentId)
    const parent = graph.getNode(target.parentId)
    const replaceIndex = parent?.childIds.indexOf(input.replaceId) ?? -1
    if (replaceIndex < 0) {
      throw new Error(`Replace target "${input.replaceId}" is not attached to its parent`)
    }
    return {
      parentId: target.parentId,
      insertIndex: replaceIndex,
      replaceId: input.replaceId
    }
  }

  const parentId = input.parentId ?? input.defaultParentId
  requireContainer(graph, parentId)
  const insertIndex = validatedInsertIndex(input.insertIndex)
  return {
    parentId,
    ...(insertIndex !== undefined ? { insertIndex } : {})
  }
}

/**
 * Apply the resolved sibling order to every rendered root as one contiguous
 * block. A replacement swaps one old root for the complete rendered block.
 */
export function applyRenderPlacement(
  graph: SceneGraph,
  renderedIds: string | readonly string[],
  placement: ResolvedRenderPlacement
): AppliedRenderPlacement {
  requireContainer(graph, placement.parentId)
  const ids = typeof renderedIds === 'string' ? [renderedIds] : [...renderedIds]
  if (ids.length === 0) throw new Error('Render produced no root nodes')
  if (new Set(ids).size !== ids.length) throw new Error('Rendered root ids must be unique')

  const parent = graph.getNode(placement.parentId)
  if (!parent) throw new Error(`Render parent "${placement.parentId}" not found`)
  for (const id of ids) {
    const node = graph.getNode(id)
    if (!node) throw new Error(`Rendered root "${id}" not found`)
    if (node.parentId !== placement.parentId || !parent.childIds.includes(id)) {
      throw new Error(`Rendered root "${id}" is not attached to parent "${placement.parentId}"`)
    }
  }

  if (placement.replaceId) {
    const target = graph.getNode(placement.replaceId)
    if (target?.parentId !== placement.parentId || !parent.childIds.includes(target.id)) {
      throw new Error(`Replace target "${placement.replaceId}" is no longer attached to its parent`)
    }
  }

  const rootIds = new Set(ids)
  const remainingCount = parent.childIds.filter(
    (id) => !rootIds.has(id) && id !== placement.replaceId
  ).length
  const currentFirstIndex = Math.min(...ids.map((id) => parent.childIds.indexOf(id)))
  const requestedIndex = validatedInsertIndex(placement.insertIndex) ?? currentFirstIndex
  const targetIndex = Math.min(requestedIndex, remainingCount)

  if (placement.replaceId) graph.deleteNode(placement.replaceId)
  ids.forEach((id, offset) => {
    graph.reorderChild(id, placement.parentId, targetIndex + offset)
  })

  const appliedParent = graph.getNode(placement.parentId)
  const indices = ids.map((id) => appliedParent?.childIds.indexOf(id) ?? -1)
  return {
    parentId: placement.parentId,
    index: indices[0] ?? -1,
    indices,
    ...(placement.replaceId ? { replacedId: placement.replaceId } : {})
  }
}
