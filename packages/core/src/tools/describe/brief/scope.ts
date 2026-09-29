import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { type BriefBudget, DESIGN_BRIEF_LIMITS } from './budget'
import type { DesignBriefErrorCode, DesignBriefScope } from './types'

export interface BriefScopeError {
  code: DesignBriefErrorCode
  message: string
}
export type BriefRootsResult = { roots: SceneNode[] } | { error: BriefScopeError }

export function publicPage(graph: SceneGraph, node: SceneNode): SceneNode | undefined {
  let current: SceneNode | undefined = node
  const visited = new Set<string>()
  for (let depth = 0; current && depth < DESIGN_BRIEF_LIMITS.ancestry; depth++) {
    if (current.internalOnly || current.lowcodeLibraryCache || visited.has(current.id))
      return undefined
    visited.add(current.id)
    if (current.type === 'CANVAS') {
      return current.parentId === graph.rootId ? current : undefined
    }
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return undefined
}

export function briefRoots(
  graph: SceneGraph,
  scope: DesignBriefScope,
  budget: BriefBudget
): BriefRootsResult {
  if (scope.kind === 'document') {
    const root = graph.getNode(graph.rootId)
    if (!root) return { error: { code: 'invalid-scope', message: 'Document root is unavailable.' } }
    const roots: SceneNode[] = []
    const ids = root.childIds.slice(0, DESIGN_BRIEF_LIMITS.roots)
    if (ids.length < root.childIds.length) budget.warnings.add('nodes-truncated')
    for (const id of ids) {
      const page = graph.getNode(id)
      if (page?.type === 'CANVAS' && publicPage(graph, page)) roots.push(page)
    }
    return { roots }
  }
  const ids = scope.kind === 'page' ? [scope.pageId] : scope.nodeIds
  if (ids.length === 0)
    return { error: { code: 'empty-selection', message: 'Select at least one node.' } }
  if (ids.length > DESIGN_BRIEF_LIMITS.roots) {
    return { error: { code: 'scope-limit', message: 'Select no more than 300 roots.' } }
  }
  const roots: SceneNode[] = []
  const seen = new Set<string>()
  for (const id of ids) {
    if (id.length > DESIGN_BRIEF_LIMITS.textPerField)
      return {
        error: {
          code: 'scope-limit',
          message: 'Scope node IDs must not exceed 512 UTF-16 code units.'
        }
      }
    const node = graph.getNode(id)
    if (!node || !publicPage(graph, node) || (scope.kind === 'page' && node.type !== 'CANVAS')) {
      return {
        error: {
          code: 'invalid-scope',
          message: 'The scope contains an unavailable or internal node.'
        }
      }
    }
    if (!seen.has(id)) roots.push(node)
    seen.add(id)
  }
  // Canonical ancestor-first roots avoid duplicate descendants, independent of selection order.
  return {
    roots: roots.filter((node) => {
      let parentId = node.parentId
      for (let depth = 0; parentId && depth < DESIGN_BRIEF_LIMITS.ancestry; depth++) {
        if (seen.has(parentId)) return false
        parentId = graph.getNode(parentId)?.parentId ?? null
      }
      return true
    })
  }
}

export interface ScopedBriefNode {
  node: SceneNode
  depth: number
  parentId: string | null
}

export function collectBriefNodes(
  graph: SceneGraph,
  roots: SceneNode[],
  budget: BriefBudget
): ScopedBriefNode[] {
  const result: ScopedBriefNode[] = []
  const seen = new Set<string>()
  const pending = roots
    .map((node) => ({ node, depth: 0, parentId: null }))
    .reverse() as ScopedBriefNode[]
  let edges = 0
  while (pending.length && result.length < DESIGN_BRIEF_LIMITS.nodes) {
    const entry = pending.pop()
    if (!entry) break
    const { node, depth } = entry
    if (seen.has(node.id)) {
      budget.warnings.add('invalid-hierarchy')
      continue
    }
    seen.add(node.id)
    if (node.internalOnly || node.lowcodeLibraryCache) continue
    result.push(entry)
    if (depth >= DESIGN_BRIEF_LIMITS.depth && node.childIds.length) {
      budget.warnings.add('depth-truncated')
      continue
    }
    const capacity = Math.min(node.childIds.length, DESIGN_BRIEF_LIMITS.nodes - result.length)
    if (capacity < node.childIds.length) budget.warnings.add('nodes-truncated')
    for (let index = capacity - 1; index >= 0; index--) {
      if (++edges > DESIGN_BRIEF_LIMITS.edges) {
        budget.warnings.add('nodes-truncated')
        return result
      }
      const child = graph.getNode(node.childIds[index] ?? '')
      if (!child || child.parentId !== node.id) {
        budget.warnings.add('invalid-hierarchy')
        continue
      }
      pending.push({ node: child, depth: depth + 1, parentId: node.id })
    }
  }
  if (pending.length) budget.warnings.add('nodes-truncated')
  return result
}
