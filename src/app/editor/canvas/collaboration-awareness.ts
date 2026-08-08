import { tryOnScopeDispose, useEventListener } from '@vueuse/core'
import { watch } from 'vue'

import { canvasPerformanceProfile, type CanvasPerformanceMode } from '@open-pencil/core/canvas'

import type { useCollabInjected } from '@/app/collab/use'
import type { EditorStore } from '@/app/editor/active-store'

type Collaboration = ReturnType<typeof useCollabInjected>

export function useCanvasCollaborationAwareness(
  store: EditorStore,
  collab: Collaboration,
  getPerformanceMode: () => CanvasPerformanceMode
) {
  function updateCursor(cx: number, cy: number) {
    store.state.cursorCanvasX = cx
    store.state.cursorCanvasY = cy
    const fpsCap = canvasPerformanceProfile(getPerformanceMode()).collaborationCursorFpsCap
    collab?.updateCursor(cx, cy, store.state.currentPageId, fpsCap)
  }

  function flushCursor() {
    collab?.flushCursor()
  }

  const stopSelection = store.onEditorEvent('selection:changed', (ids) =>
    collab?.updateSelection(ids)
  )
  const stopPage = store.onEditorEvent('page:changed', flushCursor)
  const stopEditing = watch(() => store.state.editingTextId, flushCursor, { flush: 'sync' })

  if (typeof document !== 'undefined') {
    useEventListener(document, 'visibilitychange', () => {
      if (document.hidden) flushCursor()
    })
  }

  tryOnScopeDispose(() => {
    flushCursor()
    stopSelection()
    stopPage()
    stopEditing()
  })

  return { updateCursor, flushCursor }
}
