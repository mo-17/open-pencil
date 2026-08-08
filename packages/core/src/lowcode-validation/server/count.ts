import type { ServerActionDef } from '@open-pencil/scene-graph'

export function countServerWorkflowActions(actions: readonly ServerActionDef[]): number {
  return actions.reduce((count, item) => {
    if (item.kind !== 'condition') return count + 1
    return (
      count +
      1 +
      countServerWorkflowActions(item.consequent) +
      countServerWorkflowActions(item.alternate ?? [])
    )
  }, 0)
}
