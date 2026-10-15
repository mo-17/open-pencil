import { computed, type ComputedRef } from 'vue'

import type { Editor } from '@open-pencil/core/editor'
import type { SceneNode } from '@open-pencil/scene-graph'

export interface PageListContext extends Pick<
  Editor,
  'switchPage' | 'addPage' | 'deletePage' | 'movePage' | 'renamePage'
> {
  editor: Editor
  pages: ComputedRef<SceneNode[]>
  currentPageId: ComputedRef<string>
}

import { useEditor } from '#vue/editor/context'
import { useSceneComputed } from '#vue/internal/scene-computed/use'

/**
 * Returns reactive page state and page-management actions.
 *
 * Use this composable to build page switchers, page lists, or navigation
 * panels without manually reading the graph in each component.
 */
export function usePageList(): PageListContext {
  const editor = useEditor()

  const pages = useSceneComputed(() => editor.graph.getPages())
  const currentPageId = computed(() => editor.state.currentPageId)

  return {
    editor,
    pages,
    currentPageId,
    switchPage: editor.switchPage,
    addPage: editor.addPage,
    deletePage: editor.deletePage,
    movePage: editor.movePage,
    renamePage: editor.renamePage
  }
}
