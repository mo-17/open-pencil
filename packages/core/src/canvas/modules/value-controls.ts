import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { boundControlInitialValue } from '#core/canvas/control-state'

/** Canvas shows declared state defaults; it never evaluates or writes running preview state. */
export function readModuleInitialValue(
  graph: SceneGraph | undefined,
  node: SceneNode,
  key: 'value' | 'endValue',
  type: 'number' | 'string' | 'array'
): { bound: boolean; value: unknown } {
  const bound = !!node.bindings && Object.hasOwn(node.bindings, key)
  if (!bound || !graph) return { bound, value: undefined }
  const binding = node.bindings?.[key]
  if (!binding) return { bound, value: undefined }
  const projection =
    key === 'value' ? node : { ...node, bindings: { ...node.bindings, value: binding } }
  let value: unknown
  if (type === 'number') value = boundControlInitialValue(graph, projection, 'number')
  if (type === 'string') value = boundControlInitialValue(graph, projection, 'string')
  if (type === 'array') value = boundControlInitialValue(graph, projection, 'array')
  return { bound, value }
}

export function moduleNumericValue(
  value: unknown,
  min: number,
  max: number,
  step: number,
  origin = min
): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max &&
    Math.abs((value - origin) / step - Math.round((value - origin) / step)) < 1e-7
  )
}
