import {
  isPageViewportRawEntry,
  pageViewportIsEditable
} from '@/app/lowcode/page-viewport/mutation'

import type { NotesTemplateEditor } from '../notes-template'

/** Called only by fresh mobile template generation; never replace an existing page setting. */
export function markNewMobileTemplateViewport(editor: NotesTemplateEditor, rootId: string): void {
  let node = editor.graph.getNode(rootId)
  const seen = new Set<string>()
  while (node && node.type !== 'CANVAS') {
    if (seen.has(node.id)) return
    seen.add(node.id)
    node = node.parentId ? editor.graph.getNode(node.parentId) : undefined
  }
  if (
    !node ||
    !pageViewportIsEditable(editor.graph, node) ||
    node.lowcodePageViewport !== undefined ||
    node.pluginData.some(isPageViewportRawEntry)
  )
    return
  editor.updateNodeWithUndo(
    node.id,
    { lowcodePageViewport: { version: 1, mode: 'responsive' } },
    'Configure mobile template viewport'
  )
}
