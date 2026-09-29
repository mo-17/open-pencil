import { findComponentMasterAncestor } from '@open-pencil/lowcode'
import type { BindingExpr, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { stateBindingSelection } from './state-bindings'

export const PAGINATION_BINDING_KEYS = ['currentPage', 'total', 'pageSize'] as const
export type PaginationBindingKey = (typeof PAGINATION_BINDING_KEYS)[number]
export interface PaginationBindingOption {
  value: string
  name: string
  scope: 'page' | 'document'
}

/** Read bindings may reference computed numeric state; only currentPage writes state. */
export function paginationBindingOptions(
  graph: SceneGraph,
  node: SceneNode,
  pageId: string,
  key: PaginationBindingKey
): PaginationBindingOption[] {
  const page = graph.getNode(pageId)
  const document = graph.getNode(graph.rootId)
  const pageStates = findComponentMasterAncestor(graph, node) ? [] : (page?.state ?? [])
  return [
    ...pageStates
      .filter(
        (state) =>
          state.type === 'number' && (key !== 'currentPage' || state.computedExpr === undefined)
      )
      .map((state) => ({ value: `state:${state.id}`, name: state.name, scope: 'page' as const })),
    ...(document?.lowcodeDocumentState ?? [])
      .filter((state) => state.type === 'number')
      .map((state) => ({
        value: `doc:${state.name}`,
        name: state.name,
        scope: 'document' as const
      }))
  ]
}

export function paginationBindingSelection(
  binding: BindingExpr | undefined,
  key: PaginationBindingKey,
  options: readonly PaginationBindingOption[]
): string {
  if (!binding) return ''
  if (binding.kind === 'expr' && key !== 'currentPage') return 'expression'
  return stateBindingSelection(binding, options)
}

export function paginationBindingFromSelection(
  value: string,
  key: PaginationBindingKey,
  options: readonly PaginationBindingOption[]
): BindingExpr | undefined | null {
  if (!value) return undefined
  if (value === 'expression' && key !== 'currentPage') return { kind: 'expr', expr: '' }
  if (!options.some((option) => option.value === value)) return null
  return value.startsWith('state:')
    ? { kind: 'ref', stateId: value.slice(6) }
    : { kind: 'docState', docStateName: value.slice(4) }
}
