import type { Editor } from '@open-pencil/core/editor'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

export async function applyImportedDocument(editor: Editor, imported: SceneGraph) {
  const firstPage = imported.getPages()[0] as SceneNode | undefined
  editor.replaceGraph(imported)
  editor.undo.clear()
  editor.clearSelection()
  const pageId = firstPage?.id ?? editor.graph.rootId
  await editor.switchPage(pageId)
}
