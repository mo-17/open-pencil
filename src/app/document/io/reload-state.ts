import type { Editor, EditorState } from '@open-pencil/core/editor'
import type { SceneGraph } from '@open-pencil/scene-graph'

type ReloadViewport = Pick<EditorState, 'panX' | 'panY' | 'zoom'>

export type ReloadStateSnapshot = {
  viewport: ReloadViewport
  pageId: string
  pageSourceId: string | null
  pageName: string | null
  pageIndex: number
}

export function captureReloadState(editor: Editor, state: EditorState): ReloadStateSnapshot {
  const pages = editor.graph.getPages()
  const currentPage = editor.graph.getNode(state.currentPageId)
  return {
    viewport: { panX: state.panX, panY: state.panY, zoom: state.zoom },
    pageId: state.currentPageId,
    pageSourceId: currentPage?.source.id || null,
    pageName: currentPage?.name ?? null,
    pageIndex: pages.findIndex((page) => page.id === state.currentPageId)
  }
}

export function resolveReloadPageId(graph: SceneGraph, snapshot: ReloadStateSnapshot): string {
  const pages = graph.getPages()
  const bySource = snapshot.pageSourceId
    ? pages.find((page) => page.source.id === snapshot.pageSourceId)
    : null
  if (bySource) return bySource.id

  const byRuntimeId = graph.getNode(snapshot.pageId)
  if (byRuntimeId?.type === 'CANVAS') return byRuntimeId.id

  if (snapshot.pageName) {
    const namedPages = pages.filter((page) => page.name === snapshot.pageName)
    if (namedPages.length === 1) return namedPages[0].id
  }

  return pages[snapshot.pageIndex]?.id ?? pages[0].id
}

export function restoreReloadState(
  editor: Editor,
  state: EditorState,
  snapshot: ReloadStateSnapshot
) {
  editor.clearSelection()
  state.panX = snapshot.viewport.panX
  state.panY = snapshot.viewport.panY
  state.zoom = snapshot.viewport.zoom
}
