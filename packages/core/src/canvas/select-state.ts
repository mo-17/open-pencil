import {
  lowcodeSelectOptions,
  lowcodeStateSetterName,
  validateStateName,
  type LowcodeSelectOption
} from '@open-pencil/lowcode'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import type { SelectDesignContent } from '#core/text/lowcode'

import { boundControlInitialValue, containingStatePage } from './control-state'

function ownData(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return undefined
  const property = Object.getOwnPropertyDescriptor(value, key)
  return property && 'value' in property ? property.value : undefined
}

/** A bounded data-path projection, never an expression evaluator or runtime query. */
function optionPath(raw: unknown, itemName: string, fallback: string[]): string[] | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return fallback
  const path = raw.trim().split('.')
  if (path.shift() !== itemName) return undefined
  if (
    path.some(
      (key) =>
        !/^[A-Za-z_$][\w$]*$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)
    )
  )
    return undefined
  return path
}

function optionField(item: unknown, path: string[]): string | undefined {
  let value = item
  for (const key of path) value = ownData(value, key)
  return typeof value === 'string' ? value : undefined
}

function sourceState(graph: SceneGraph, node: SceneNode, source: unknown) {
  const kind = ownData(source, 'kind')
  if (kind === 'docStateRef')
    return graph
      .getNode(graph.rootId)
      ?.lowcodeDocumentState?.find((entry) => entry.name === ownData(source, 'docStateName'))
  if (kind === 'ref' || kind === 'stateRef')
    return containingStatePage(graph, node)?.state?.find(
      (entry) => entry.id === ownData(source, 'stateId')
    )
  return undefined
}

function optionItemName(graph: SceneGraph, node: SceneNode, source: unknown): string | undefined {
  const rawItem = ownData(source, 'itemName')
  const name = typeof rawItem === 'string' && rawItem !== '' ? rawItem : 'item'
  if (!validateStateName(name).ok || name === 'prev') return undefined
  const pageNames = containingStatePage(graph, node)?.state ?? []
  if (pageNames.some((state) => state.name === name || lowcodeStateSetterName(state.name) === name))
    return undefined
  if (graph.getNode(graph.rootId)?.lowcodeDocumentState?.some((state) => state.name === name))
    return undefined
  let ancestor = node.parentId ? graph.getNode(node.parentId) : undefined
  while (ancestor && ancestor.type !== 'CANVAS') {
    // Enclosing iterators are runtime scopes; do not guess the compiler's renamed local.
    if (ancestor.type === 'LIST') return undefined
    ancestor = ancestor.parentId ? graph.getNode(ancestor.parentId) : undefined
  }
  return name
}

export function initialControlOptions(
  graph: SceneGraph,
  node: SceneNode
): LowcodeSelectOption[] | undefined {
  const source = node.interactiveProps?.optionsSource
  const state = sourceState(graph, node, source)
  if (
    state?.type !== 'array' ||
    state.computedExpr !== undefined ||
    !Array.isArray(state.defaultValue)
  )
    return undefined
  const itemName = optionItemName(graph, node, source)
  if (!itemName) return undefined
  const valuePath = optionPath(ownData(source, 'valueExpr'), itemName, [])
  const labelPath = valuePath && optionPath(ownData(source, 'labelExpr'), itemName, valuePath)
  if (!valuePath || !labelPath) return undefined
  const result: LowcodeSelectOption[] = []
  for (const item of state.defaultValue) {
    const value = optionField(item, valuePath)
    const label = optionField(item, labelPath)
    if (value === undefined || label === undefined) return undefined
    result.push({ value, label })
  }
  return result
}

export function selectDesignContent(graph: SceneGraph, node: SceneNode): SelectDesignContent {
  const bound =
    node.interactiveProps?.multiple === true
      ? boundControlInitialValue(graph, node, 'array')
      : boundControlInitialValue(graph, node, 'string')
  const source = node.interactiveProps?.optionsSource
  const options =
    typeof source === 'object' && source !== null
      ? initialControlOptions(graph, node)
      : lowcodeSelectOptions(node.interactiveProps?.options)
  return {
    value: bound,
    options,
    unresolved: options === undefined || (node.bindings?.value !== undefined && bound === undefined)
  }
}
