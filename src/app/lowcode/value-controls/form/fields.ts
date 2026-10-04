import {
  moduleValueFields,
  resolveCascaderModule,
  resolveDateRangeModule,
  resolveTreeModule,
  type ModuleValueField
} from '@open-pencil/core/plugins'
import type { LowcodeSelectOption } from '@open-pencil/lowcode'
import type { BindingExpr, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { stateBindingSelection, writableStateBindingOptions } from '../state-bindings'

export type ModuleValueKey = ModuleValueField['key']

/** Only reviewed value modules without a config-level readOnly expose the outer control. */
export function moduleValueReadOnly(node: SceneNode): boolean | undefined {
  if (node.type !== 'FRAME' || moduleValueFields(node).length === 0) return undefined
  const module = node.interactiveProps?.module
  if (
    !resolveTreeModule(module)?.ok &&
    !resolveDateRangeModule(module)?.ok &&
    !resolveCascaderModule(module)?.ok
  )
    return undefined
  return node.interactiveProps?.readOnly === true
}

export function moduleBindingOptions(
  graph: SceneGraph,
  node: SceneNode,
  pageId: string,
  field: ModuleValueField,
  pageLabel: string,
  documentLabel: string
): LowcodeSelectOption[] {
  return writableStateBindingOptions(graph, node, pageId, field.type, pageLabel, documentLabel)
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
