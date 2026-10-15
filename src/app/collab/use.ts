import { tryOnScopeDispose } from '@vueuse/core'
import { computed, watch, type WatchStopHandle } from 'vue'

import type { DocStateConflictKind } from '@/app/collab/conflict'
import { useCollabIdentity } from '@/app/collab/identity'
import {
  activeRoom,
  activeTabLeftRoom,
  dismissLeftRoomNote,
  joinRoom,
  leaveRoom,
  shareDocument,
  type JoinRoomOptions
} from '@/app/collab/rooms'
import {
  DEFAULT_COLLAB_STATE,
  type CollabState,
  type RemotePeer,
  type MotionTimelinePresence,
  type PresenceEditingKind,
  type PresenceEditingTarget,
  type PreviewDocStatePayload
} from '@/app/collab/types'
import { follow, presenceOf } from '@/app/presence/registry'
import type { FollowTarget } from '@/app/presence/types'
import { activeTab } from '@/app/tabs'

export { COLLAB_KEY, useCollabInjected } from '@/app/collab/context'
export { DEFAULT_COLLAB_STATE }
export type {
  CollabState,
  RemotePeer,
  MotionTimelinePresence,
  PresenceEditingKind,
  PresenceEditingTarget,
  PreviewDocStatePayload
}

/**
 * The collaboration UI's view of the active tab: its room, if it is in one, and the app-wide
 * identity. Each room tab keeps its own session in `src/app/collab/rooms.ts`; switching tabs
 * switches what this shows.
 */
export function useCollab() {
  const identity = useCollabIdentity()

  const state = computed<CollabState>(() => {
    const room = activeRoom.value
    return {
      inRoom: room !== undefined,
      connected: room !== undefined,
      roomKey: room?.roomKey ?? null,
      motionConflicts: room?.motionConflicts.value ?? [],
      roomId: room?.roomId ?? null,
      status: room?.status.value ?? null,
      peers: room?.peers.value ?? [],
      localName: identity.name.value,
      localColor: identity.color,
      hasChosenName: identity.hasChosenName.value
    }
  })
  const remotePeers = computed(() => state.value.peers)
  const leftRoom = computed(() => activeTabLeftRoom.value)
  const following = computed(() => {
    const store = activeTab.value?.store
    return store ? presenceOf(store).following.value : null
  })
  const followingPeer = computed(() =>
    following.value?.kind === 'person' ? following.value.clientId : null
  )

  function followTarget(target: FollowTarget | null) {
    const store = activeTab.value?.store
    if (store) follow(store, target)
  }

  let stopConflict: WatchStopHandle | undefined
  let stopPreview: WatchStopHandle | undefined
  tryOnScopeDispose(() => {
    stopConflict?.()
    stopPreview?.()
  })
  return {
    state,
    updateEditingTarget: (target: PresenceEditingTarget | null) =>
      activeRoom.value?.updateEditingTarget(target),
    updateMotionTimelinePresence: (target: MotionTimelinePresence | null) =>
      activeRoom.value?.updateMotionTimelinePresence(target),
    flushCursor: () => activeRoom.value?.flushCursor(),
    clearMotionTimelineConflicts: () => activeRoom.value?.clearMotionTimelineConflicts(),
    undoMotionTimeline: () => activeRoom.value?.undoMotionTimeline(),
    redoMotionTimeline: () => activeRoom.value?.redoMotionTimeline(),
    sendPreviewDocState: (payload: PreviewDocStatePayload) =>
      activeRoom.value?.sendPreviewDocState(payload),
    onPreviewDocState: (handler: ((payload: PreviewDocStatePayload) => void) | null) => {
      stopPreview?.()
      stopPreview = watch(
        activeRoom,
        (room, previous) => {
          previous?.onPreviewDocState(null)
          room?.onPreviewDocState(handler)
        },
        { immediate: true, flush: 'sync' }
      )
    },
    onDocStateConflict: (handler: ((kind: DocStateConflictKind) => void) | null) => {
      stopConflict?.()
      stopConflict = watch(
        activeRoom,
        (room, previous) => {
          previous?.setDocStateConflictHandler(null)
          room?.setDocStateConflictHandler(handler)
        },
        { immediate: true, flush: 'sync' }
      )
    },
    remotePeers,
    leftRoom,
    following,
    followingPeer,
    /** Opens a room in its own tab; false when the ID is not a room ID. */
    join: (roomId: string, options: JoinRoomOptions) => joinRoom(roomId, options) !== null,
    /** Puts the active tab's document into a room and returns the room ID. */
    shareCurrentDoc: (roomId?: string): string | null => {
      const store = activeTab.value?.store
      if (!store || activeTab.value?.kind === 'home') return null
      return shareDocument(store, roomId).roomId
    },
    disconnect: () => {
      const room = activeRoom.value
      if (room) leaveRoom(room)
    },
    updateCursor: (x: number, y: number, pageId: string, fpsCap?: number) => {
      activeRoom.value?.updateCursor(x, y, pageId, fpsCap)
    },
    updateSelection: (ids: string[]) => {
      activeRoom.value?.updateSelection(ids)
    },
    dismissLeftRoomNote: () => {
      const store = activeTab.value?.store
      if (store) dismissLeftRoomNote(store)
    },
    setLocalName: identity.setName,
    follow: followTarget,
    followPeer: (clientId: number | null) =>
      followTarget(clientId === null ? null : { kind: 'person', clientId })
  }
}
