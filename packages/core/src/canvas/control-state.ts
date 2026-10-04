import { lowcodeInputRequiresString } from '@open-pencil/lowcode'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { moduleDataField } from '#core/plugins/bindings/data'
import { resolveStepperModule } from '#core/plugins/stepper'
import { moduleValueFields } from '#core/plugins/value-controls'

export function containingStatePage(graph: SceneGraph, node: SceneNode): SceneNode | undefined {
  const seen = new Set<string>([node.id])
  let parent = node.parentId ? graph.getNode(node.parentId) : undefined
  while (parent && parent.type !== 'CANVAS') {
    if (seen.has(parent.id)) return undefined
    seen.add(parent.id)
    // Reusable component bodies do not inherit the containing page's runtime state scope.
    if (['COMPONENT', 'COMPONENT_SET', 'INSTANCE'].includes(parent.type)) return undefined
    parent = parent.parentId ? graph.getNode(parent.parentId) : undefined
  }
  return parent
}

export function boundControlInitialValue(
  graph: SceneGraph,
  node: SceneNode,
  type: 'string'
): string | undefined
export function boundControlInitialValue(
  graph: SceneGraph,
  node: SceneNode,
  type: 'boolean'
): boolean | undefined
export function boundControlInitialValue(
  graph: SceneGraph,
  node: SceneNode,
  type: 'number'
): number | undefined
export function boundControlInitialValue(
  graph: SceneGraph,
  node: SceneNode,
  type: 'array'
): string[] | undefined
/** Read authored initial state only. Never evaluate expressions or preview session state. */
export function boundControlInitialValue(
  graph: SceneGraph,
  node: SceneNode,
  type: 'string' | 'boolean' | 'number' | 'array'
): string | boolean | number | string[] | undefined {
  const binding = node.bindings?.value
  const states =
    binding?.kind === 'docState'
      ? graph.getNode(graph.rootId)?.lowcodeDocumentState
      : containingStatePage(graph, node)?.state
  const state = states?.find((candidate) =>
    binding?.kind === 'docState'
      ? candidate.name === binding.docStateName
      : binding?.kind === 'ref' && candidate.id === binding.stateId
  )
  if (state?.type !== type || state.computedExpr !== undefined) return undefined
  if (
    states?.filter((candidate) => candidate.id === state.id || candidate.name === state.name)
      .length !== 1
  )
    return undefined
  return controlDefaultValue(state.defaultValue, type)
}

function controlDefaultValue(
  value: unknown,
  type: 'string' | 'boolean' | 'number' | 'array'
): string | boolean | number | string[] | undefined {
  if (type === 'string' && typeof value === 'string') return value
  if (type === 'boolean' && typeof value === 'boolean') return value
  if (type === 'number' && typeof value === 'number' && Number.isFinite(value)) return value
  if (type === 'array' && Array.isArray(value) && value.every((item) => typeof item === 'string'))
    return value
  return undefined
}

export function textInputDesignContent(graph: SceneGraph, node: SceneNode) {
  const number =
    node.type === 'INPUT' && !lowcodeInputRequiresString(node.interactiveProps)
      ? boundControlInitialValue(graph, node, 'number')
      : undefined
  const value =
    boundControlInitialValue(graph, node, 'string') ??
    (number === undefined ? undefined : String(number))
  return { value, unresolved: node.bindings?.value !== undefined && value === undefined }
}

/** Effect pictures and rasters must expire when a control's bound initial state changes. */
export function controlDesignDependencies(graph: SceneGraph, node: SceneNode): string[] {
  if (
    !['RADIO', 'SWITCH', 'DATEPICKER', 'SELECT', 'CHECKBOX', 'INPUT', 'TEXTAREA'].includes(
      node.type
    ) &&
    moduleValueFields(node).length === 0 &&
    !resolveStepperModule(node.interactiveProps?.module)?.ok &&
    !moduleDataField(node)
  )
    return []
  const dependencies = new Set<string>()
  const page = containingStatePage(graph, node)
  for (const key of ['value', 'endValue', 'currentIndex', 'rows', 'data']) {
    const binding = node.bindings?.[key]
    if (binding?.kind === 'docState') dependencies.add(graph.rootId)
    if (binding?.kind === 'ref') dependencies.add(page?.id ?? graph.rootId)
  }
  addOptionDependencies(graph, node, page, dependencies)
  return [...dependencies]
}

function addOptionDependencies(
  graph: SceneGraph,
  node: SceneNode,
  page: SceneNode | undefined,
  dependencies: Set<string>
): void {
  if (node.type === 'SELECT' || node.type === 'CHECKBOX') {
    const source = node.interactiveProps?.optionsSource
    if (source && typeof source === 'object' && !Array.isArray(source)) {
      const kind = Object.getOwnPropertyDescriptor(source, 'kind')?.value
      if (kind === 'docStateRef') dependencies.add(graph.rootId)
      if ((kind === 'ref' || kind === 'stateRef') && page) dependencies.add(page.id)
    }
  }
}
