import type { ModuleValueField } from '@open-pencil/core/plugins'
import { findComponentMasterAncestor, type LowcodeSelectOption } from '@open-pencil/lowcode'
import type { BindingExpr, SceneGraph, SceneNode, StateDef } from '@open-pencil/scene-graph'

import { stateBindingSelection } from '../state-bindings'

export type ModuleValueKey = ModuleValueField['key']

function writableStates(states: readonly StateDef[]): StateDef[] {
  const ids = new Map<string, number>(),
    names = new Map<string, number>()
  for (const state of states) {
    ids.set(state.id, (ids.get(state.id) ?? 0) + 1)
    names.set(state.name, (names.get(state.name) ?? 0) + 1)
  }
  return states.filter(
    (state) =>
      state.computedExpr === undefined && ids.get(state.id) === 1 && names.get(state.name) === 1
  )
}

export function moduleBindingOptions(
  graph: SceneGraph,
  node: SceneNode,
  pageId: string,
  field: ModuleValueField,
  pageLabel: string,
  documentLabel: string
): LowcodeSelectOption[] {
  const page = findComponentMasterAncestor(graph, node) ? undefined : graph.getNode(pageId)
  return [
    ...writableStates(page?.state ?? [])
      .filter((state) => state.type === field.type)
      .map((state) => ({ value: `state:${state.id}`, label: `${pageLabel}: ${state.name}` })),
    ...writableStates(graph.getNode(graph.rootId)?.lowcodeDocumentState ?? [])
      .filter((state) => state.type === field.type)
      .map((state) => ({ value: `doc:${state.name}`, label: `${documentLabel}: ${state.name}` }))
  ]
}

export function moduleBindingSelection(
  binding: BindingExpr | undefined,
  options: LowcodeSelectOption[]
): string {
  if (!binding) return 'uncontrolled'
  return stateBindingSelection(binding, options)
}

export function moduleBindingFromSelection(
  value: string,
  options: LowcodeSelectOption[]
): BindingExpr | undefined | null {
  if (value === 'uncontrolled') return undefined
  if (!options.some((option) => option.value === value && !option.disabled)) return null
  if (value.startsWith('state:')) return { kind: 'ref', stateId: value.slice(6) }
  if (value.startsWith('doc:')) return { kind: 'docState', docStateName: value.slice(4) }
  return null
}
