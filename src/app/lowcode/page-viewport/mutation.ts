import type { Editor } from '@open-pencil/core/editor'
import { LOWCODE_PAGE_VIEWPORT_PLUGIN_KEY, validateLowcodePageViewport } from '@open-pencil/lowcode'
import type { PluginDataEntry, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

export type PageViewportEditor = Pick<Editor, 'graph' | 'state' | 'updateNodeWithUndo'>

export function isPageViewportRawEntry(entry: PluginDataEntry): boolean {
  return entry.pluginId === 'open-pencil' && entry.key === LOWCODE_PAGE_VIEWPORT_PLUGIN_KEY
}

export function currentPageViewportOwner(editor: PageViewportEditor): SceneNode | undefined {
  const page = editor.graph.getNode(editor.state.currentPageId)
  return page?.type === 'CANVAS' ? page : undefined
}

export function pageViewportIsEditable(graph: SceneGraph, page: SceneNode): boolean {
  const root = graph.getNode(graph.rootId)
  return (
    graph.getNode(page.id) === page &&
    page.type === 'CANVAS' &&
    page.parentId === graph.rootId &&
    root?.type === 'FRAME' &&
    root.parentId === null &&
    ![page, root].some((node) => node.locked || node.internalOnly || node.librarySource?.readOnly)
  )
}

/** Recheck the captured live page; a stale callback cannot edit the next active page. */
export function setPageViewportMode(
  editor: PageViewportEditor,
  page: SceneNode,
  mode: unknown,
  label: string
): boolean {
  if (currentPageViewportOwner(editor) !== page || !pageViewportIsEditable(editor.graph, page))
    return false
  const next = validateLowcodePageViewport({ version: 1, mode })
  if (!next.ok) return false
  const current = validateLowcodePageViewport(page.lowcodePageViewport)
  const raw = page.pluginData.some(isPageViewportRawEntry)
  if (current.ok && current.value.mode === next.value.mode && !raw) return false
  editor.updateNodeWithUndo(
    page.id,
    {
      lowcodePageViewport: next.value,
      ...(raw
        ? { pluginData: page.pluginData.filter((entry) => !isPageViewportRawEntry(entry)) }
        : {})
    },
    label
  )
  return true
}
