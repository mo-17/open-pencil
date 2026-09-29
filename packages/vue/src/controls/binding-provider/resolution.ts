import type { Editor } from '@open-pencil/core/editor'
import type { VariableValue } from '@open-pencil/scene-graph'

import type { BindingTarget } from './types'

/** Validate the effective value without substituting values from other modes. */
export function resolveEffectiveBindingValue(
  editor: Editor,
  variableId: string,
  target: BindingTarget
): VariableValue | undefined {
  return editor.graph.resolveEffectiveVariableForNode(target.nodeId, variableId)
}
