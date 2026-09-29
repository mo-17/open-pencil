import { isCheckboxGroupControl } from '@open-pencil/lowcode'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { boundControlInitialValue } from '#core/canvas/control-state'
import { initialControlOptions } from '#core/canvas/select-state'
import { lowcodeTextProjection } from '#core/text/lowcode'

/** Authored defaults only. Unknown bindings and runtime sources never invent a checked value. */
export function checkboxDesignContent(graph: SceneGraph, node: SceneNode) {
  const group = isCheckboxGroupControl(node)
  const raw = node.interactiveProps?.options
  const source = node.interactiveProps?.optionsSource
  const options =
    typeof source === 'object' && source !== null
      ? (initialControlOptions(graph, node) ?? [])
      : (Array.isArray(raw) ? raw : [])
          .filter((value): value is string => typeof value === 'string')
          .map((value) => ({ value, label: value }))
  const checked =
    node.bindings?.value !== undefined
      ? boundControlInitialValue(graph, node, 'boolean') === true
      : node.interactiveProps?.checked === true
  return {
    group,
    options,
    checked,
    selected: new Set(boundControlInitialValue(graph, node, 'array'))
  }
}

export function checkboxTextNode(graph: SceneGraph, node: SceneNode): SceneNode | null {
  if (node.type !== 'CHECKBOX') return null
  const { group, options } = checkboxDesignContent(graph, node)
  if (!group) return null
  return (
    lowcodeTextProjection({
      ...node,
      interactiveProps: { ...node.interactiveProps, options: options.map((option) => option.label) }
    })?.node ?? null
  )
}
