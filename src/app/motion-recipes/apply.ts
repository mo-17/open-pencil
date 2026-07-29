import type { MotionRecipeInstantiation } from '@open-pencil/scene-graph'

import { applyMotionApplications, type MotionMutationEditor } from '@/app/properties/motion'

/** Apply a fully instantiated recipe only after every target has been resolved. */
export function applyMotionRecipeInstantiation(
  editor: MotionMutationEditor,
  instance: MotionRecipeInstantiation,
  label: string
): number {
  const missing = instance.assignments.filter(({ nodeId }) => !editor.graph.getNode(nodeId))
  if (missing.length > 0) {
    throw new Error(
      `Motion recipe target node(s) no longer exist: ${missing
        .map(({ nodeId }) => nodeId)
        .join(', ')}`
    )
  }
  return applyMotionApplications(editor, instance.assignments, label)
}
