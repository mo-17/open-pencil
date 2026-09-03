import type { SceneGraph } from '@open-pencil/scene-graph'

import { readBackendProviderDocumentRequest } from '@/app/lowcode/backend/document'

export interface ServerWorkflowOption {
  readonly id: string
  readonly name: string
  readonly parameters: readonly string[]
}

/** The Backend application is the sole workflow authority when declared. Old
 * root workflows remain a compatibility source only for documents that have
 * not adopted a Backend Provider declaration. Malformed explicit authority is
 * fail-closed and must never fall back to legacy definitions in the selector. */
export function collectServerWorkflowOptions(graph: SceneGraph): readonly ServerWorkflowOption[] {
  try {
    const request = readBackendProviderDocumentRequest(graph)
    if (request) {
      return request.application.workflows.workflows.map((workflow) => ({
        id: workflow.id,
        name: workflow.name,
        parameters: [...workflow.parameters]
      }))
    }
  } catch {
    return []
  }
  const root = graph.getNode(graph.rootId)
  return (root?.lowcodeServerWorkflows ?? []).map((workflow) => ({
    id: workflow.id,
    name: workflow.name,
    parameters: [...(workflow.params ?? [])]
  }))
}
