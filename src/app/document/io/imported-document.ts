import { createEditor, type Editor } from '@open-pencil/core/editor'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { loadFont } from '@/app/editor/fonts'
import type { EditorPreparationHandle as DocumentLoadSession } from '@/app/editor/preparation/types'

export async function applyImportedDocument(
  editor: Editor,
  imported: SceneGraph,
  load?: DocumentLoadSession,
  preferredPageId?: string
) {
  const previousGraph = editor.graph
  let stagingEditor: Editor | null = null
  let ownershipTransferred = previousGraph === imported
  try {
    const firstPage = imported.getPages()[0] as SceneNode | undefined
    const pageId = preferredPageId ?? firstPage?.id ?? imported.rootId
    stagingEditor = createEditor({
      graph: imported,
      loadFont,
      skipInitialGraphSetup: true
    })
    load?.update({ phase: 'populating-page', detail: firstPage?.name ?? null })
    const prepared = await stagingEditor.preparePage(pageId, {
      signal: load?.signal,
      onProgress: (progress) => load?.update(progress)
    })
    load?.signal.throwIfAborted()
    if (!prepared) throw new Error('Imported page preparation was superseded')

    try {
      editor.replaceGraph(imported, { currentPageId: pageId })
    } finally {
      ownershipTransferred = editor.graph === imported
      if (ownershipTransferred && previousGraph !== imported) {
        editor.releaseGraphResources(previousGraph)
      }
    }
    editor.undo.clear()
    editor.clearSelection()
  } finally {
    if (!ownershipTransferred) editor.releaseGraphResources(imported)
    stagingEditor?.dispose()
  }
}
