import { expect, mock, test } from 'bun:test'

import { ref } from 'vue'
import type { Awareness } from 'y-protocols/awareness'

import { createEditor } from '@open-pencil/core/editor'

import { createFollowActions } from '@/app/collab/awareness'
import type { CursorBroadcastScheduler } from '@/app/collab/cursor-broadcast'
import { createLocalAwarenessActions } from '@/app/collab/local-awareness'
import {
  awarenessChangeHasRemoteClient,
  createCollabConnectionActions,
  createCollabRuntime,
  createInitialCollabState,
  disposeCollabSessionResources,
  watchAwarenessZoom
} from '@/app/collab/session'
import type { EditorStore } from '@/app/editor/active-store'

test('remote peer cursor changes repaint overlays without invalidating the scene', () => {
  const editor = createEditor({ skipInitialGraphSetup: true })
  const remoteColor = { r: 1, g: 0, b: 0, a: 1 }
  const awareness = {
    clientID: 1,
    getStates: () =>
      new Map([
        [1, { user: { name: 'Local', color: remoteColor } }],
        [
          2,
          {
            user: { name: 'Remote', color: remoteColor },
            cursor: { x: 4, y: 5, pageId: editor.state.currentPageId }
          }
        ]
      ]),
    setLocalStateField: mock(() => undefined)
  } as Awareness
  let overlays = 0
  editor.onEditorEvent('overlay:requested', () => overlays++)
  const state = ref(createInitialCollabState('Local'))
  const actions = createLocalAwarenessActions({
    state,
    storedName: ref('Local'),
    getStore: () => editor as EditorStore,
    getAwareness: () => awareness
  })
  const initialRenderVersion = editor.state.renderVersion
  const initialSceneVersion = editor.state.sceneVersion

  actions.updatePeersList()

  expect(state.value.peers).toHaveLength(1)
  expect(editor.state.remoteCursors).toHaveLength(1)
  expect(overlays).toBe(1)
  expect(editor.state.renderVersion).toBe(initialRenderVersion)
  expect(editor.state.sceneVersion).toBe(initialSceneVersion)
})

test('local awareness writes do not enter the remote peer repaint route', () => {
  expect(awarenessChangeHasRemoteClient({ added: [], updated: [7], removed: [] }, 7)).toBeFalse()
  expect(awarenessChangeHasRemoteClient({ added: [], updated: [7, 8], removed: [] }, 7)).toBeTrue()
  expect(awarenessChangeHasRemoteClient({ added: [], updated: [], removed: [8] }, 7)).toBeTrue()
})

test('selection and editing boundaries flush the latest cursor first', () => {
  const editor = createEditor({ skipInitialGraphSetup: true })
  const fields: string[] = []
  let frame: FrameRequestCallback | null = null
  const scheduler: CursorBroadcastScheduler = {
    now: () => 0,
    requestFrame: (callback) => {
      frame = callback
      return 1
    },
    cancelFrame: () => {
      frame = null
    },
    setDelay: () => 2 as ReturnType<typeof setTimeout>,
    clearDelay: mock(() => undefined)
  }
  const awareness = {
    setLocalStateField: (field: string) => fields.push(field)
  } as Awareness
  const actions = createLocalAwarenessActions({
    state: ref(createInitialCollabState('Local')),
    storedName: ref('Local'),
    getStore: () => editor as EditorStore,
    getAwareness: () => awareness,
    cursorScheduler: scheduler
  })

  actions.updateCursor(1, 2, editor.state.currentPageId, 15)
  expect(frame).not.toBeNull()
  actions.updateSelection(['node-1'])
  expect(fields).toEqual(['cursor', 'selection', 'editing', 'motionTimeline'])

  actions.updateCursor(3, 4, editor.state.currentPageId, 15)
  actions.updateEditingTarget({ kind: 'events', nodeId: 'node-1' })
  expect(fields.slice(-2)).toEqual(['cursor', 'editing'])
})

test('disconnect cleanup clears cursors with an overlay-only repaint', () => {
  const editor = createEditor({ skipInitialGraphSetup: true })
  editor.state.remoteCursors = [{ name: 'Remote', color: { r: 1, g: 0, b: 0, a: 1 }, x: 1, y: 2 }]
  let overlays = 0
  editor.onEditorEvent('overlay:requested', () => overlays++)
  const initialRenderVersion = editor.state.renderVersion
  const initialSceneVersion = editor.state.sceneVersion

  disposeCollabSessionResources({
    store: editor as EditorStore,
    room: null,
    awareness: null,
    persistence: null,
    ydoc: null,
    motionUndoManager: null,
    unbindGraphEvents: null,
    stopZoomWatch: null,
    resetFollow: mock(() => undefined)
  })

  expect(editor.state.remoteCursors).toEqual([])
  expect(overlays).toBe(1)
  expect(editor.state.renderVersion).toBe(initialRenderVersion)
  expect(editor.state.sceneVersion).toBe(initialSceneVersion)
})

test('disconnect flushes the trailing cursor before destroying awareness', () => {
  const editor = createEditor({ skipInitialGraphSetup: true })
  const calls: string[] = []
  const runtime = createCollabRuntime()
  runtime.connectedStore = editor as EditorStore
  runtime.awareness = {
    destroy: () => calls.push('destroy')
  } as Awareness
  const actions = createCollabConnectionActions({
    runtime,
    state: ref(createInitialCollabState('Local')),
    getStore: () => editor as EditorStore,
    updatePeersList: mock(() => undefined),
    tickFollow: mock(() => undefined),
    broadcastAwareness: mock(() => undefined),
    applyYjsToGraph: mock(() => undefined),
    applyYjsMotionToGraph: mock(() => undefined),
    syncNodeToYjs: mock(() => undefined),
    resetFollow: mock(() => undefined),
    flushCursor: () => calls.push('flush'),
    clearCursorBroadcast: () => calls.push('clear')
  })

  actions.disconnect()

  expect(calls).toEqual(['flush', 'destroy', 'clear'])
})

test('following a peer keeps viewport updates on the scene render path', () => {
  const requestRender = mock(() => undefined)
  const requestOverlayRepaint = mock(() => undefined)
  const store = {
    state: { currentPageId: 'page-1', zoom: 1, panX: 0, panY: 0 },
    switchPage: mock(() => Promise.resolve()),
    requestRender,
    requestOverlayRepaint
  } as EditorStore
  const awareness = {
    getStates: () => new Map([[2, { cursor: { x: 10, y: 20, pageId: 'page-1', zoom: 2 } }]])
  } as Awareness
  const originalDocument = globalThis.document
  const originalDevicePixelRatio = globalThis.devicePixelRatio
  globalThis.document = {
    querySelector: () => ({ width: 800, height: 600 })
  } as Document
  globalThis.devicePixelRatio = 2

  try {
    const follow = createFollowActions(
      () => store,
      () => awareness
    )
    follow.followPeer(2)
    follow.tickFollow()

    expect(store.state.zoom).toBe(2)
    expect(store.state.panX).toBe(180)
    expect(store.state.panY).toBe(110)
    expect(requestRender).toHaveBeenCalledTimes(1)
    expect(requestOverlayRepaint).not.toHaveBeenCalled()
  } finally {
    if (originalDocument) globalThis.document = originalDocument
    else Reflect.deleteProperty(globalThis, 'document')
    if (originalDevicePixelRatio === undefined) {
      Reflect.deleteProperty(globalThis, 'devicePixelRatio')
    } else {
      globalThis.devicePixelRatio = originalDevicePixelRatio
    }
  }
})

test('panning does not bypass cursor cadence while zoom still updates awareness', () => {
  const editor = createEditor({ skipInitialGraphSetup: true })
  const setLocalStateField = mock(() => undefined)
  const awareness = {
    getLocalState: () => ({
      cursor: { x: 10, y: 20, pageId: editor.state.currentPageId, zoom: 1 }
    }),
    setLocalStateField
  } as Awareness
  const stop = watchAwarenessZoom(editor as EditorStore, () => awareness)

  editor.pan(5, 6)
  expect(setLocalStateField).not.toHaveBeenCalled()

  editor.setZoomAroundPoint(2, 0, 0)
  expect(setLocalStateField).toHaveBeenCalledTimes(1)
  expect(setLocalStateField).toHaveBeenLastCalledWith('cursor', {
    x: 10,
    y: 20,
    pageId: editor.state.currentPageId,
    zoom: 2
  })
  stop()
})
