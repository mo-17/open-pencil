import type { Room } from 'trystero'
import type { Ref } from 'vue'
import { IndexeddbPersistence } from 'y-indexeddb'
import * as awarenessProtocol from 'y-protocols/awareness'
import type { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'

import { randomIndex } from '@open-pencil/core/random'

import {
  createMotionTimelineUndoManager,
  MOTION_TIMELINES_DOC_KEY
} from '@/app/collab/motion-timeline-yjs'
import { connectCollabRoom } from '@/app/collab/room'
import type { CollabState, PreviewDocStatePayload } from '@/app/collab/types'
import { bindCollabGraphEvents, registerYjsObservers } from '@/app/collab/yjs-sync'
import type { EditorStore } from '@/app/editor/active-store'
import { PEER_COLORS } from '@/constants'

export type CollabRuntime = {
  ydoc: Y.Doc | null
  awareness: awarenessProtocol.Awareness | null
  ynodes: Y.Map<Y.Map<unknown>> | null
  yimages: Y.Map<Uint8Array> | null
  ymotions: Y.Map<Y.Map<unknown>> | null
  motionUndoManager: Y.UndoManager | null
  room: Room | null
  persistence: IndexeddbPersistence | null
  connectedStore: EditorStore | null
  suppressGraphSync: boolean
  suppressYjsEvents: boolean
  unbindGraphEvents: (() => void) | null
  stopZoomWatch: (() => void) | null
  // Phase 3 §4.6 — preview runtime docState channel. `send` is the room
  // action (null when disconnected); `handler` is the PreviewPane's receiver,
  // registered after connect and resolved lazily by the room.
  sendPreviewDocState: ((payload: PreviewDocStatePayload) => void) | null
  previewDocStateHandler: ((payload: PreviewDocStatePayload) => void) | null
}

interface CollabSessionSyncOptions {
  runtime: CollabRuntime
  state: Ref<CollabState>
  updatePeersList: () => void
  tickFollow: () => void
  broadcastAwareness: () => void
  applyYjsToGraph: (events: Y.YEvent<Y.Map<unknown>>[]) => void
  applyYjsMotionToGraph: (events: Y.YEvent<Y.Map<unknown>>[]) => void
  syncNodeToYjs: (nodeId: string) => void
}

interface ConnectCollabSessionOptions extends CollabSessionSyncOptions {
  roomId: string
  store: EditorStore
  disconnect: () => void
  // Phase 3 §4.2 — room auth.
  key?: string
  onAuthError?: () => void
}

interface CollabConnectionActionsOptions extends CollabSessionSyncOptions {
  getStore: () => EditorStore
  resetFollow: () => void
}

type CollabSessionResources = {
  store: EditorStore
  room: Room | null
  awareness: awarenessProtocol.Awareness | null
  persistence: IndexeddbPersistence | null
  ydoc: Y.Doc | null
  motionUndoManager: Y.UndoManager | null
  unbindGraphEvents: (() => void) | null
  stopZoomWatch: (() => void) | null
  resetFollow: () => void
}

export function createCollabRuntime(): CollabRuntime {
  return {
    ydoc: null,
    awareness: null,
    ynodes: null,
    yimages: null,
    ymotions: null,
    motionUndoManager: null,
    room: null,
    persistence: null,
    connectedStore: null,
    suppressGraphSync: false,
    suppressYjsEvents: false,
    unbindGraphEvents: null,
    stopZoomWatch: null,
    sendPreviewDocState: null,
    previewDocStateHandler: null
  }
}

export function createInitialCollabState(localName: string): CollabState {
  return {
    connected: false,
    roomId: null,
    roomKey: null,
    peers: [],
    localName,
    localColor: PEER_COLORS[randomIndex(PEER_COLORS.length)],
    motionConflicts: []
  }
}

export function createCollabConnectionActions({
  runtime,
  state,
  getStore,
  updatePeersList,
  tickFollow,
  broadcastAwareness,
  applyYjsToGraph,
  applyYjsMotionToGraph,
  syncNodeToYjs,
  resetFollow
}: CollabConnectionActionsOptions) {
  function connect(roomId: string, key?: string, onAuthError?: () => void) {
    connectCollabSession({
      roomId,
      runtime,
      state,
      store: getStore(),
      disconnect,
      updatePeersList,
      tickFollow,
      broadcastAwareness,
      applyYjsToGraph,
      applyYjsMotionToGraph,
      syncNodeToYjs,
      key,
      onAuthError
    })
  }

  function disconnect() {
    const store = runtime.connectedStore ?? getStore()
    disposeCollabSessionResources({
      store,
      room: runtime.room,
      awareness: runtime.awareness,
      persistence: runtime.persistence,
      ydoc: runtime.ydoc,
      motionUndoManager: runtime.motionUndoManager,
      unbindGraphEvents: runtime.unbindGraphEvents,
      stopZoomWatch: runtime.stopZoomWatch,
      resetFollow
    })
    resetCollabRuntime(runtime)
    resetCollabConnectionState(state)
  }

  return { connect, disconnect }
}

export function watchAwarenessZoom(store: EditorStore, getAwareness: () => Awareness | null) {
  return store.onEditorEvent('viewport:changed', (viewport) => {
    const awareness = getAwareness()
    if (!awareness) return
    const prev = awareness.getLocalState()?.cursor as
      | { x: number; y: number; pageId: string; zoom: number }
      | undefined
    if (prev) {
      awareness.setLocalStateField('cursor', { ...prev, zoom: viewport.zoom })
    }
  })
}

export function connectCollabSession({
  roomId,
  runtime,
  state,
  store,
  disconnect,
  updatePeersList,
  tickFollow,
  broadcastAwareness,
  applyYjsToGraph,
  applyYjsMotionToGraph,
  syncNodeToYjs,
  key,
  onAuthError
}: ConnectCollabSessionOptions) {
  if (runtime.room) disconnect()

  runtime.connectedStore = store
  state.value.roomId = roomId
  state.value.roomKey = key ?? null
  runtime.ydoc = new Y.Doc()
  runtime.awareness = new awarenessProtocol.Awareness(runtime.ydoc)
  runtime.ynodes = runtime.ydoc.getMap('nodes')
  runtime.yimages = runtime.ydoc.getMap('images')
  runtime.ymotions = runtime.ydoc.getMap(MOTION_TIMELINES_DOC_KEY)
  runtime.motionUndoManager = createMotionTimelineUndoManager(runtime.ymotions)
  runtime.persistence = new IndexeddbPersistence(`op-room-${roomId}`, runtime.ydoc)

  runtime.awareness.on('change', () => {
    updatePeersList()
    tickFollow()
  })

  registerYjsObservers({
    store,
    ynodes: runtime.ynodes,
    yimages: runtime.yimages,
    ymotions: runtime.ymotions,
    getSuppressYjsEvents: () => runtime.suppressYjsEvents,
    setSuppressGraphSync: (value) => {
      runtime.suppressGraphSync = value
    },
    applyYjsToGraph,
    applyYjsMotionToGraph
  })

  const roomConnection = connectCollabRoom({
    roomId,
    ydoc: runtime.ydoc,
    awareness: runtime.awareness,
    setConnected: () => {
      state.value.connected = true
    },
    updatePeersList,
    password: key,
    onAuthError,
    getPreviewDocStateHandler: () => runtime.previewDocStateHandler ?? undefined
  })
  runtime.room = roomConnection.room
  runtime.sendPreviewDocState = roomConnection.sendPreviewDocState
  state.value.connected = true
  broadcastAwareness()

  runtime.stopZoomWatch = watchAwarenessZoom(store, () => runtime.awareness)

  runtime.unbindGraphEvents = bindCollabGraphEvents({
    store,
    getYdoc: () => runtime.ydoc,
    getYnodes: () => runtime.ynodes,
    getYmotions: () => runtime.ymotions,
    getSuppressGraphSync: () => runtime.suppressGraphSync,
    setSuppressYjsEvents: (value) => {
      runtime.suppressYjsEvents = value
    },
    syncNodeToYjs
  })
}

export function resetCollabRuntime(runtime: CollabRuntime) {
  runtime.unbindGraphEvents = null
  runtime.stopZoomWatch = null
  runtime.room = null
  runtime.awareness = null
  runtime.persistence = null
  runtime.ydoc = null
  runtime.ynodes = null
  runtime.yimages = null
  runtime.ymotions = null
  runtime.motionUndoManager = null
  runtime.connectedStore = null
  runtime.sendPreviewDocState = null
  // Keep previewDocStateHandler — the PreviewPane registers it once and it is
  // valid across reconnects; only the room-bound sender is per-connection.
}

export function resetCollabConnectionState(state: Ref<CollabState>) {
  state.value.connected = false
  state.value.roomId = null
  state.value.roomKey = null
  state.value.peers = []
  state.value.motionConflicts = []
}

export function disposeCollabSessionResources(resources: CollabSessionResources) {
  resources.unbindGraphEvents?.()
  resources.stopZoomWatch?.()
  void resources.room?.leave()
  resources.awareness?.destroy()
  if (resources.persistence) {
    void resources.persistence.destroy()
  }
  resources.motionUndoManager?.destroy()
  resources.ydoc?.destroy()
  resources.resetFollow()
  resources.store.state.remoteCursors = []
  resources.store.requestRender()
}
