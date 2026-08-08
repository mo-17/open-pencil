import type { Ref } from 'vue'
import type { Awareness } from 'y-protocols/awareness'

import { buildRemotePeers, remotePeersToCursors } from '@/app/collab/awareness'
import {
  createCursorBroadcastQueue,
  type CursorBroadcastScheduler
} from '@/app/collab/cursor-broadcast'
import type { CollabState, MotionTimelinePresence, PresenceEditingTarget } from '@/app/collab/types'
import type { EditorStore } from '@/app/editor/active-store'

type LocalAwarenessOptions = {
  state: Ref<CollabState>
  storedName: Ref<string>
  getStore: () => EditorStore
  getAwareness: () => Awareness | null
  cursorScheduler?: CursorBroadcastScheduler
}

export function createLocalAwarenessActions({
  state,
  storedName,
  getStore,
  getAwareness,
  cursorScheduler
}: LocalAwarenessOptions) {
  const cursorBroadcast = createCursorBroadcastQueue(
    ({ x, y, pageId }: { x: number; y: number; pageId: string }) => {
      const awareness = getAwareness()
      if (!awareness) return
      awareness.setLocalStateField('cursor', { x, y, pageId, zoom: getStore().state.zoom })
    },
    cursorScheduler
  )

  function broadcastAwareness() {
    const awareness = getAwareness()
    if (!awareness) return
    awareness.setLocalStateField('user', {
      name: state.value.localName,
      color: state.value.localColor
    })
  }

  function updateCursor(x: number, y: number, pageId: string, fpsCap = 30) {
    if (!getAwareness()) return
    cursorBroadcast.push({ x, y, pageId }, fpsCap)
  }

  function flushCursor() {
    cursorBroadcast.flush()
  }

  function clearCursorBroadcast() {
    cursorBroadcast.clear()
  }

  function updateSelection(ids: string[]) {
    flushCursor()
    const awareness = getAwareness()
    if (!awareness) return
    awareness.setLocalStateField('selection', ids)
    // §4.4 — a selection change means the user has moved away from whatever
    // lowcode panel they were editing; clear the stale editing target.
    awareness.setLocalStateField('editing', null)
    awareness.setLocalStateField('motionTimeline', null)
  }

  // §4.4 — broadcast which lowcode panel the local user is editing (set on
  // panel focus-in, cleared with null on focus-out / selection change / disconnect).
  function updateEditingTarget(target: PresenceEditingTarget | null) {
    flushCursor()
    const awareness = getAwareness()
    if (!awareness) return
    awareness.setLocalStateField('editing', target)
  }

  function updateMotionTimelinePresence(target: MotionTimelinePresence | null) {
    const awareness = getAwareness()
    if (!awareness) return
    awareness.setLocalStateField('motionTimeline', target)
  }

  function updatePeersList() {
    const awareness = getAwareness()
    if (!awareness) return

    const store = getStore()
    const peers = buildRemotePeers(
      awareness.getStates() as Map<number, Record<string, unknown>>,
      awareness.clientID
    )

    state.value.peers = peers
    store.state.remoteCursors = remotePeersToCursors(peers, store.state.currentPageId)
    store.requestOverlayRepaint()
  }

  function setLocalName(name: string) {
    state.value.localName = name
    storedName.value = name
    broadcastAwareness()
  }

  return {
    broadcastAwareness,
    updateCursor,
    flushCursor,
    clearCursorBroadcast,
    updateSelection,
    updateEditingTarget,
    updateMotionTimelinePresence,
    updatePeersList,
    setLocalName
  }
}
