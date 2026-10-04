import { watch, type Ref } from 'vue'

import type { Editor } from '@open-pencil/core/editor'
import { resolveLowcodeApplicationPages } from '@open-pencil/lowcode'
import type { SceneGraph } from '@open-pencil/scene-graph'

/** Keep canvas render/presentation versions intact while retaining a guarded preview on navigation. */
export function createPreviewSourceInvalidations() {
  const navigation = new Set<number>()
  function record(event: { sceneVersion: number; reason?: 'page-navigation' }): void {
    if (event.reason === 'page-navigation') navigation.add(event.sceneVersion)
    // A delayed or suspended watcher must never retain an unbounded event history.
    if (navigation.size > 64) navigation.clear()
  }
  function changed(graph: SceneGraph, current: number, previous: number): boolean {
    try {
      const scope = resolveLowcodeApplicationPages(graph)
      if (
        scope.mode !== 'application' ||
        !scope.pages.some((page) => page.enterGuard || page.leaveConfirm) ||
        current <= previous ||
        current - previous > 64
      )
        return true
      for (let version = previous + 1; version <= current; version++) {
        if (!navigation.has(version)) return true
      }
      return false
    } finally {
      navigation.clear()
    }
  }
  return { record, changed }
}

export function watchPreviewSourceChanges(
  editor: Pick<Editor, 'graph' | 'state' | 'onEditorEvent'>,
  fonts: Ref<number>,
  ready: () => boolean,
  enqueue: (refreshFonts: boolean) => void
): () => void {
  const invalidations = createPreviewSourceInvalidations()
  const stopEvents = editor.onEditorEvent('render:requested', invalidations.record)
  const stopWatch = watch(
    () => [editor.state.sceneVersion, fonts.value] as const,
    (current, previous) => {
      if (!ready()) return
      const sourceChanged = invalidations.changed(editor.graph, current[0], previous[0])
      const fontsChanged = current[1] !== previous[1]
      if (sourceChanged || fontsChanged) enqueue(fontsChanged)
    }
  )
  return () => {
    stopWatch()
    stopEvents()
  }
}
