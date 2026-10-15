import { tryOnScopeDispose, useEventListener } from '@vueuse/core'
import { watch } from 'vue'

import {
  canvasPerformanceProfile,
  DEFAULT_CANVAS_PERFORMANCE_MODE,
  type CanvasPerformanceMode
} from '@open-pencil/core/canvas'

import { roomForStore } from '@/app/collab/rooms'
import { getActiveEditorStore, type EditorStore } from '@/app/editor/active-store'

/**
 * Publishes a canvas's cursor and selection to the room its own tab is in, and no other.
 *
 * Canvases read the editor through a proxy that follows the active tab, which no room is keyed
 * by. Every canvas is keyed by its tab, so the tab's own store is the active one while it mounts.
 */
export function useCanvasCollaborationAwareness(
  store: EditorStore,
  performanceMode: () => CanvasPerformanceMode = () => DEFAULT_CANVAS_PERFORMANCE_MODE
) {
  const tabStore = getActiveEditorStore()

  function updateCursor(cx: number, cy: number) {
    store.state.cursorCanvasX = cx
    store.state.cursorCanvasY = cy
    roomForStore(tabStore)?.updateCursor(
      cx,
      cy,
      tabStore.state.currentPageId,
      canvasPerformanceProfile(performanceMode()).collaborationCursorFpsCap
    )
  }

  const stopSelection = tabStore.onEditorEvent('selection:changed', (ids) =>
    roomForStore(tabStore)?.updateSelection(ids)
  )
  function flushCursor() {
    roomForStore(tabStore)?.flushCursor()
  }
  const stopPage = tabStore.onEditorEvent('page:changed', flushCursor)
  watch(() => store.state.editingTextId, flushCursor, { flush: 'sync' })
  if (typeof document !== 'undefined') {
    useEventListener(document, 'visibilitychange', () => {
      if (document.hidden) flushCursor()
    })
  }
  tryOnScopeDispose(() => {
    flushCursor()
    stopSelection()
    stopPage()
  })

  return { updateCursor, flushCursor }
}
