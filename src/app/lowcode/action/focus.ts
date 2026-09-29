import { shallowRef } from 'vue'

import type { SceneGraph } from '@open-pencil/scene-graph'

export interface LowcodeActionFocusTarget {
  nodeId: string
  actionId: string
  actionPath: string
}

const pendingTarget = shallowRef<{
  graph: WeakRef<SceneGraph>
  target: LowcodeActionFocusTarget
} | null>(null)

export function requestLowcodeActionFocus(
  graph: SceneGraph,
  target: LowcodeActionFocusTarget
): void {
  // An unconsumed navigation request must not keep a closed document alive.
  pendingTarget.value = { graph: new WeakRef(graph), target }
}

export function peekLowcodeActionFocus(
  graph: SceneGraph,
  nodeId: string | undefined
): LowcodeActionFocusTarget | null {
  const pending = pendingTarget.value
  if (!nodeId || pending?.graph.deref() !== graph || pending.target.nodeId !== nodeId) return null
  return pending.target
}

export function clearLowcodeActionFocus(target: LowcodeActionFocusTarget): void {
  if (pendingTarget.value?.target === target) pendingTarget.value = null
}
