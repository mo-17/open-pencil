import { materializeFigFragment } from '@open-pencil/fig'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import {
  CommittedGraphEventError,
  captureTransferredState,
  removeGraphTransfer,
  applyGraphTransfer,
  prepareGraphTransfer,
  type SceneGraph
} from '@open-pencil/scene-graph'

import { readerSessionOptions } from '#core/kiwi/fig/session/options'

/** Interpret in isolation before any destination mutation. */
export function prepareClipboardImport(
  changes: NodeChange[],
  graph: SceneGraph,
  parentId: string,
  blobs: Uint8Array[] = [],
  offsetX = 0,
  offsetY = 0
) {
  const fragment = materializeFigFragment(changes, blobs, {
    ...readerSessionOptions([]),
    missingComponent: 'detach-empty'
  })
  const plan = prepareGraphTransfer({
    source: fragment.graph,
    rootIds: fragment.rootIds,
    dependencyPageIds: fragment.dependencyPageIds,
    target: graph,
    parentId
  })
  const roots = new Set(plan.rootIds)
  for (const node of plan.nodes)
    if (roots.has(node.id)) {
      node.props.x = (node.props.x ?? 0) + offsetX
      node.props.y = (node.props.y ?? 0) + offsetY
    }
  let snapshot = plan
  const operation = {
    sourceIds: fragment.sources,
    plan,
    capture: () => {
      snapshot = captureTransferredState(graph, plan)
    },
    undo: () => removeGraphTransfer(graph, snapshot),
    redo: () => applyGraphTransfer(graph, snapshot),
    commit: () => {
      let deliveryError: CommittedGraphEventError | undefined
      try {
        applyGraphTransfer(graph, plan)
      } catch (error) {
        if (error instanceof CommittedGraphEventError) deliveryError = error
        else {
          removeGraphTransfer(graph, plan)
          throw error
        }
      }
      // A failed observer reports delivery failure after the atomic transfer has
      // committed. Retain that committed state so the caller can record its undo.
      graph.applyImportedStateDuring(() => graph.remapClonedNodeReferences(plan.nodeIds))
      snapshot = captureTransferredState(graph, plan)
      if (deliveryError) throw deliveryError
      return plan.rootIds
    }
  }
  return operation
}
