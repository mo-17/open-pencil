import type { SceneGraph } from '@open-pencil/scene-graph'

import { computeAllLayouts } from '#core/layout'

export function createComponentSyncScheduler(
  getGraph: () => SceneGraph,
  requestRender: () => void
) {
  let pendingComponentSync: { graph: SceneGraph; ids: Set<string> } | null = null
  let isFlushingComponentSync = false

  function flushComponentSync() {
    const batch = pendingComponentSync
    if (!batch) return
    pendingComponentSync = null
    if (getGraph() !== batch.graph) return
    isFlushingComponentSync = true
    try {
      const { graph, ids } = batch
      let didSync = false
      graph.withNodeMutationOrigin('derived-component-sync', () => {
        const componentIds = new Set<string>()
        for (const id of ids) {
          let current = graph.getNode(id)
          while (current) {
            if (current.type === 'COMPONENT') {
              componentIds.add(current.id)
              break
            }
            current = current.parentId ? graph.getNode(current.parentId) : undefined
          }
        }
        for (const compId of componentIds) {
          graph.preserveSourceMetadataDuring(() => graph.syncInstances(compId))
        }
        if (componentIds.size > 0) {
          graph.preserveSourceMetadataDuring(() => computeAllLayouts(graph))
          didSync = true
        }
      })
      if (didSync) requestRender()
    } finally {
      isFlushingComponentSync = false
    }
  }

  function scheduleComponentSync(nodeId: string) {
    if (isFlushingComponentSync) return
    const graph = getGraph()
    if (pendingComponentSync?.graph !== graph) pendingComponentSync = null
    if (!pendingComponentSync) {
      pendingComponentSync = { graph, ids: new Set() }
      queueMicrotask(flushComponentSync)
    }
    pendingComponentSync.ids.add(nodeId)
  }

  return { scheduleComponentSync }
}
