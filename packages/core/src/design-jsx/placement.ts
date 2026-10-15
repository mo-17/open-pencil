import type { RenderResult } from '@open-pencil/design-jsx'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { findPageId } from '#core/io/subgraph'
import { layoutAuthoredNodes } from '#core/layout'

/** Placement fields shared by the render tool and its speculative preview. */
export interface RenderPlacementInput {
  parent_id?: string
  replace_id?: string
  insert_index?: number
  x?: number
  y?: number
}

export interface RenderPlacement {
  parentId: string
  /** Leave layout to `finishRenderPlacement`, which runs it once the roots are in order. */
  deferLayout?: boolean
  pageId: string
  replaceId?: string
  insertIndex?: number
  x?: number
  y?: number
}

/** Resolve before creating nodes: replacement geometry/order must come from the original layout. */
export function resolveRenderPlacement(
  graph: SceneGraph,
  input: RenderPlacementInput,
  defaultPageId: string
): RenderPlacement {
  const replacement = input.replace_id ? graph.getNode(input.replace_id) : undefined
  if (input.replace_id && !replacement?.parentId)
    throw new Error(`Replace target "${input.replace_id}" not found`)
  const parentId = replacement?.parentId ?? input.parent_id ?? defaultPageId
  const parent = graph.getNode(parentId)
  requireContainer(graph, parentId)
  const pageId = parent?.type === 'CANVAS' ? parent.id : findPageId(graph, parentId)
  if (!parent || !pageId) throw new Error('Render parent does not belong to a page')
  const insertIndex = replacement ? parent.childIds.indexOf(replacement.id) : input.insert_index
  validatedInsertIndex(insertIndex)
  requireContainer(graph, parentId)
  return {
    parentId,
    deferLayout: true,
    pageId,
    replaceId: replacement?.id,
    insertIndex,
    x: input.x ?? replacement?.x,
    y: input.y ?? replacement?.y
  }
}

/** Complete hierarchy changes before layout so Fill/Hug and sibling positions use the final order. */
export function finishRenderPlacement(
  graph: SceneGraph,
  results: RenderResult[],
  placement: RenderPlacement
): void {
  applyRenderPlacement(
    graph,
    results.map((result) => result.id),
    placement
  )
  layoutAuthoredNodes(
    graph,
    results.map((result) => result.id)
  )
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
 * Apply the resolved sibling order to every rendered root as one contiguous
 * block. A replacement swaps one old root for the complete rendered block.
 */
export function applyRenderPlacement(
  graph: SceneGraph,
  renderedIds: string | readonly string[],
  placement: Pick<RenderPlacement, 'parentId' | 'insertIndex' | 'replaceId'>
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
