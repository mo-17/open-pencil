import { tryOnScopeDispose, useLocalStorage } from '@vueuse/core'
import { computed, ref } from 'vue'

import { createFollowActions, generateRoomId, generateRoomKey } from '@/app/collab/awareness'
import type { DocStateConflictKind } from '@/app/collab/conflict'
import { createLocalAwarenessActions } from '@/app/collab/local-awareness'
import {
  createCollabConnectionActions,
  createCollabRuntime,
  createInitialCollabState
} from '@/app/collab/session'
import {
  DEFAULT_COLLAB_STATE,
  type CollabState,
  type PresenceEditingKind,
  type PresenceEditingTarget,
  type PreviewDocStatePayload,
  type RemotePeer
} from '@/app/collab/types'
import { createYjsGraphSync } from '@/app/collab/yjs-sync'
import type { EditorStore } from '@/app/editor/active-store'

export { COLLAB_KEY, useCollabInjected } from '@/app/collab/context'
export { DEFAULT_COLLAB_STATE }
export type {
  CollabState,
  PresenceEditingKind,
  PresenceEditingTarget,
  PreviewDocStatePayload,
  RemotePeer
}

export function useCollab(storeOrGetter: EditorStore | (() => EditorStore)) {
  const getStore = () =>
    typeof storeOrGetter === 'function' ? (storeOrGetter as () => EditorStore)() : storeOrGetter
  const storedName = useLocalStorage('op-collab-name', '')
  const state = ref<CollabState>(createInitialCollabState(storedName.value))
  const runtime = createCollabRuntime()
  const remotePeers = computed(() => state.value.peers)
  const getActiveStore = () => runtime.connectedStore ?? getStore()

  const { followingPeer, followPeer, resetFollow, tickFollow } = createFollowActions(
    getActiveStore,
    () => runtime.awareness
  )
  const {
    broadcastAwareness,
    updateCursor,
    updateSelection,
    updateEditingTarget,
    updatePeersList,
    setLocalName
  } = createLocalAwarenessActions({
    state,
    storedName,
    getStore: getActiveStore,
    getAwareness: () => runtime.awareness
  })

  // Phase 3 §4.5 — the app registers a handler that toasts when a remote
  // docState/page-state update would overwrite a concurrent local edit.
  let conflictHandler: ((kind: DocStateConflictKind) => void) | undefined
  function onDocStateConflict(handler: ((kind: DocStateConflictKind) => void) | null) {
    conflictHandler = handler ?? undefined
  }

  // Phase 3 §4.6 — preview runtime docState collaboration. The PreviewPane
  // relays bridge messages both ways: `sendPreviewDocState` broadcasts a local
  // change (no-op when disconnected); `onPreviewDocState` registers the receiver
  // that posts remote changes back into the local iframe.
  function sendPreviewDocState(payload: PreviewDocStatePayload) {
    runtime.sendPreviewDocState?.(payload)
  }
  function onPreviewDocState(handler: ((payload: PreviewDocStatePayload) => void) | null) {
    runtime.previewDocStateHandler = handler
  }

  const { syncNodeToYjs, syncAllNodesToYjs, applyYjsToGraph } = createYjsGraphSync({
    getStore: getActiveStore,
    getYdoc: () => runtime.ydoc,
    getYnodes: () => runtime.ynodes,
    getYimages: () => runtime.yimages,
    setSuppressYjsEvents: (value) => {
      runtime.suppressYjsEvents = value
    },
    getConflictHandler: () => conflictHandler
  })
  const { connect, disconnect } = createCollabConnectionActions({
    runtime,
    state,
    getStore,
    updatePeersList,
    tickFollow,
    broadcastAwareness,
    applyYjsToGraph,
    syncNodeToYjs,
    resetFollow
  })

  // Phase 3 §4.2 — minting a room also mints a random key (Trystero password).
  // The key rides the share-link URL fragment; callers embed it in the invite.
  function shareCurrentDoc(): { roomId: string; key: string } {
    const roomId = generateRoomId()
    const key = generateRoomKey()
    connect(roomId, key)
    syncAllNodesToYjs()
    return { roomId, key }
  }

  tryOnScopeDispose(disconnect)

  return {
    state,
    remotePeers,
    followingPeer,
    connect,
    disconnect,
    shareCurrentDoc,
    updateCursor,
    updateSelection,
    updateEditingTarget,
    onDocStateConflict,
    sendPreviewDocState,
    onPreviewDocState,
    setLocalName,
    followPeer,
    tickFollow
  }
}
