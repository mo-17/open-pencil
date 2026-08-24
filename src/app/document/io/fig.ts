import type { Editor } from '@open-pencil/core/editor'
import { readFigFile } from '@open-pencil/core/io/formats/fig'
import type { FigPageManifestEntry } from '@open-pencil/kiwi/fig'
import { SceneGraph } from '@open-pencil/scene-graph'

interface FigPageManifestTarget {
  replaceGraph(graph: SceneGraph): void
  state: { loading: boolean }
}

/** Show lightweight page shells while the FIG worker continues decoding the full document. */
export function showFigPageManifest(
  editor: FigPageManifestTarget,
  pages: readonly FigPageManifestEntry[]
): void {
  if (pages.length === 0) return

  const graph = new SceneGraph()
  for (const page of graph.getPages(true)) graph.deleteNode(page.id)
  for (const entry of pages) {
    const page = graph.addPage(entry.name)
    page.internalOnly = entry.internalOnly
    page.source.format = 'fig'
    page.source.id = entry.sourceId
    page.source.orderKey = entry.position
  }

  editor.replaceGraph(graph)
  editor.state.loading = true
}

export function readFigDocument(file: File, editor: Editor) {
  return readFigFile(file, {
    populate: 'first-page',
    onPages: (pages) => showFigPageManifest(editor, pages)
  })
}
