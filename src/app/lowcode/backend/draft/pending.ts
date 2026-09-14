import type { SceneGraph } from '@open-pencil/scene-graph'

interface BackendDraftGuard {
  graph: () => SceneGraph
  reason: () => string
}

// Panel lifetime is explicit. Graph lookup also covers document replacement and AI adapters.
const guards = new Set<BackendDraftGuard>()

export function registerBackendDraftGuard(guard: BackendDraftGuard): () => void {
  guards.add(guard)
  return () => {
    guards.delete(guard)
  }
}

export function pendingBackendDraftReason(graph: SceneGraph): string {
  for (const guard of guards) {
    if (guard.graph() !== graph) continue
    const reason = guard.reason()
    if (reason) return reason
  }
  return ''
}
