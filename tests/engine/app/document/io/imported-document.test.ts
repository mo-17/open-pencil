import { expect, spyOn, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { SceneGraph } from '@open-pencil/scene-graph'

import { applyImportedDocument } from '@/app/document/io/imported-document'
import { createEditorPreparationController } from '@/app/editor/preparation/controller'
import { createInitialAppEditorState } from '@/app/editor/session/types'

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
  const releaseGraphResources = spyOn(liveEditor, 'releaseGraphResources')
  try {
    preparation.cancel()

    await expect(applyImportedDocument(liveEditor, imported, preparation)).rejects.toHaveProperty(
      'name',
      'AbortError'
    )
    expect(liveEditor.graph).toBe(liveGraph)
    expect(releaseGraphResources).toHaveBeenCalledTimes(1)
    expect(releaseGraphResources.mock.calls[0]?.[0]).toBe(imported)
    expect(releaseGraphResources.mock.calls.some(([graph]) => graph === liveGraph)).toBe(false)
  } finally {
    releaseGraphResources.mockRestore()
    liveEditor.releaseGraphResources()
    liveEditor.dispose()
    controller.dispose()
  }
})

test('prepared imported documents replace the live graph only after staging', async () => {
  const liveGraph = new SceneGraph()
  const liveEditor = createEditor({ graph: liveGraph, skipInitialGraphSetup: true })
  const imported = new SceneGraph()
  const page = imported.getPages()[0]
  if (!page) throw new Error('Expected imported page')
  imported.updateNode(page.id, { name: 'Imported' })
  const releaseGraphResources = spyOn(liveEditor, 'releaseGraphResources')

  try {
    await applyImportedDocument(liveEditor, imported)

    expect(liveEditor.graph).toBe(imported)
    expect(liveEditor.state.currentPageId).toBe(page.id)
    expect(releaseGraphResources).toHaveBeenCalledTimes(1)
    expect(releaseGraphResources.mock.calls[0]?.[0]).toBe(liveGraph)
    expect(releaseGraphResources.mock.calls.some(([graph]) => graph === imported)).toBe(false)
  } finally {
    releaseGraphResources.mockRestore()
    liveEditor.releaseGraphResources()
    liveEditor.dispose()
  }
})
