import { watch } from 'vue'

import type { SceneGraph } from '@open-pencil/scene-graph'

import { readAppBackendProviderDocumentRequest } from '@/app/plugins/host/backend-provider'

function documentIdentity(graph: SceneGraph): string | null {
  try {
    const request = readAppBackendProviderDocumentRequest(graph)
    return request ? JSON.stringify(request) : null
  } catch {
    return 'invalid-backend-provider-document'
  }
}

/** Authority changes invalidate displayed output even under the Manual refresh policy. */
export function watchPreviewBackendProvider(input: {
  graph(): SceneGraph
  sceneVersion(): number
  providerSnapshot(): unknown
  invalidate(): void
}): () => void {
  let previousGraph = input.graph()
  let previousIdentity = documentIdentity(previousGraph)
  return watch(
    () => [input.graph(), input.sceneVersion(), input.providerSnapshot()] as const,
    (current, previous) => {
      const graph = current[0]
      const identity = documentIdentity(graph)
      const hadBackend = identity !== null || previousIdentity !== null
      const changed =
        identity !== previousIdentity ||
        (hadBackend && (graph !== previousGraph || current[2] !== previous[2]))
      previousGraph = graph
      previousIdentity = identity
      if (changed) input.invalidate()
    },
    { flush: 'sync' }
  )
}

/** A login entry route participates in the external-browser connection identity. */
export function watchPreviewLoginRoute(input: {
  graph(): SceneGraph
  sceneVersion(): number
  invalidate(): void
}): () => void {
  return watch(
    () => {
      void input.sceneVersion()
      const graph = input.graph()
      const redirect = graph.getNode(graph.rootId)?.lowcodeAuthRedirect
      return JSON.stringify([
        redirect,
        graph
          .getPages()
          .filter((page) => page.lowcodeRoutePattern === redirect)
          .map((page) => [page.id, page.lowcodeRequiresAuth, page.internalOnly])
      ])
    },
    () => input.invalidate(),
    { flush: 'sync' }
  )
}
