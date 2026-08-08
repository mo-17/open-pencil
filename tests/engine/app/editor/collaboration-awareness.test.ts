import { afterEach, describe, expect, mock, test } from 'bun:test'

import { effectScope, reactive } from 'vue'

import type { CanvasPerformanceMode } from '@open-pencil/core/canvas'

import type { CollabReturn } from '@/app/collab/context'
import type { EditorStore } from '@/app/editor/active-store'
import { useCanvasCollaborationAwareness } from '@/app/editor/canvas/collaboration-awareness'

const originalDocument = globalThis.document

afterEach(() => {
  if (originalDocument) globalThis.document = originalDocument
  else Reflect.deleteProperty(globalThis, 'document')
})

describe('canvas collaboration awareness', () => {
  test.each([
    ['resource-saving', 15],
    ['balanced', 30],
    ['smooth', 60]
  ] as const)('uses the %s cursor cadence and flushes lifecycle boundaries', (mode, fpsCap) => {
    const editorListeners = new Map<string, (...args: never[]) => void>()
    const state = reactive({
      cursorCanvasX: null as number | null,
      cursorCanvasY: null as number | null,
      currentPageId: 'page-1',
      editingTextId: null as string | null
    })
    const store = {
      state,
      onEditorEvent: (event: string, handler: (...args: never[]) => void) => {
        editorListeners.set(event, handler)
        return () => editorListeners.delete(event)
      }
    } as EditorStore
    const updateCursor = mock(() => undefined)
    const updateSelection = mock(() => undefined)
    const flushCursor = mock(() => undefined)
    const visibilityListeners = new Set<EventListener>()
    globalThis.document = {
      hidden: false,
      addEventListener: (event: string, listener: EventListenerOrEventListenerObject) => {
        if (event === 'visibilitychange') visibilityListeners.add(listener as EventListener)
      },
      removeEventListener: (event: string, listener: EventListenerOrEventListenerObject) => {
        if (event === 'visibilitychange') visibilityListeners.delete(listener as EventListener)
      }
    } as Document
    const collab = {
      updateCursor,
      updateSelection,
      flushCursor
    } as CollabReturn
    const scope = effectScope()
    const awareness = scope.run(() =>
      useCanvasCollaborationAwareness(store, collab, () => mode as CanvasPerformanceMode)
    )
    if (!awareness) throw new Error('awareness composable did not initialize')

    awareness.updateCursor(10, 20)
    expect(updateCursor).toHaveBeenLastCalledWith(10, 20, 'page-1', fpsCap)
    expect(state.cursorCanvasX).toBe(10)
    expect(state.cursorCanvasY).toBe(20)

    editorListeners.get('selection:changed')?.(['node-1'] as never)
    expect(updateSelection).toHaveBeenLastCalledWith(['node-1'])
    editorListeners.get('page:changed')?.()
    state.editingTextId = 'text-1'
    Reflect.set(globalThis.document, 'hidden', true)
    for (const listener of visibilityListeners) listener(new Event('visibilitychange'))

    expect(flushCursor).toHaveBeenCalledTimes(3)
    scope.stop()
    expect(flushCursor).toHaveBeenCalledTimes(4)
    expect(visibilityListeners.size).toBe(0)
  })
})
