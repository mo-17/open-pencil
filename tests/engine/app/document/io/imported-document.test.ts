import { expect, mock, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { SceneGraph } from '@open-pencil/scene-graph'

import { applyImportedDocument } from '@/app/document/io/imported-document'
import { createEditorPreparationController } from '@/app/editor/preparation/controller'
import { createInitialAppEditorState } from '@/app/editor/session/types'

import { registerFigPopulationWorker } from '#core/kiwi/fig/population/client'
import type { FigSessionRequest, FigSessionResponse } from '#core/kiwi/fig/session/protocol'

import { createOwnershipWorker } from '#tests/helpers/worker'

function trackGraphResource(graph: SceneGraph) {
  const terminate = mock(() => undefined)
  const worker = createOwnershipWorker(terminate)
  // The document lifecycle now prepares the page before transferring ownership.
  // This already materialized graph must acknowledge population, just as its real
  // session worker does; an ownership-only silent double would never settle.
  worker.postMessage = (request: FigSessionRequest) => {
    if (request.type !== 'populate') return
    const result: FigSessionResponse = {
      type: 'population-result',
      requestId: request.requestId,
      baseRevision: request.baseRevision,
      populated: false,
      delta: {
        created: [],
        updated: [],
        deleted: [],
        instanceIndex: [],
        populatedRootIds: [request.pageId]
      }
    }
    queueMicrotask(() => worker.onmessage?.(new MessageEvent('message', { data: result })))
  }
  registerFigPopulationWorker(graph, worker)
  return terminate
}

test('cancelled imported-document staging preserves the live graph', async () => {
  const liveGraph = new SceneGraph()
  const liveEditor = createEditor({ graph: liveGraph, skipInitialGraphSetup: true })
  const imported = new SceneGraph()
  const importedPage = imported.getPages()[0]
  if (!importedPage) throw new Error('Expected imported page')
  imported.updateNode(importedPage.id, { name: 'Imported' })
  const controller = createEditorPreparationController(
    createInitialAppEditorState(liveGraph.rootId)
  )
  const preparation = controller.begin({ kind: 'document-open' })
  const terminateLive = trackGraphResource(liveGraph)
  const terminateImported = trackGraphResource(imported)
  preparation.cancel()

  await expect(applyImportedDocument(liveEditor, imported, preparation)).rejects.toHaveProperty(
    'name',
    'AbortError'
  )
  expect(liveEditor.graph).toBe(liveGraph)
  expect(terminateImported).toHaveBeenCalledTimes(1)
  expect(terminateLive).not.toHaveBeenCalled()
  liveEditor.releaseGraphResources()
  liveEditor.dispose()
  controller.dispose()
})

test('prepared imported documents replace the live graph only after staging', async () => {
  const liveGraph = new SceneGraph()
  const liveEditor = createEditor({ graph: liveGraph, skipInitialGraphSetup: true })
  const imported = new SceneGraph()
  const page = imported.getPages()[0]
  if (!page) throw new Error('Expected imported page')
  imported.updateNode(page.id, { name: 'Imported' })
  const terminateLive = trackGraphResource(liveGraph)
  const terminateImported = trackGraphResource(imported)

  await applyImportedDocument(liveEditor, imported)

  expect(liveEditor.graph).toBe(imported)
  expect(liveEditor.state.currentPageId).toBe(page.id)
  expect(terminateLive).toHaveBeenCalledTimes(1)
  expect(terminateImported).not.toHaveBeenCalled()
  liveEditor.releaseGraphResources()
  liveEditor.dispose()
})
