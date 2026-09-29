import type { Editor } from '@open-pencil/core/editor'

/** System clipboard reads must retain the view that requested them. */
export function captureClipboardContext(editor: Pick<Editor, 'graph' | 'state'>): () => boolean {
  const graph = editor.graph
  const pageId = editor.state.currentPageId
  const contentEdit = editor.state.contentEdit
  return () =>
    editor.graph === graph &&
    editor.state.currentPageId === pageId &&
    editor.state.contentEdit === contentEdit
}
