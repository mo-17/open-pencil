import { useIntervalFn } from '@vueuse/core'
import * as v from 'valibot'
import { computed, ref, shallowRef, watch, type ComputedRef, type Ref } from 'vue'
import { IndexeddbPersistence } from 'y-indexeddb'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as Y from 'yjs'

import { shareAgentPreviews } from '@/app/collab/agent-preview'
import { buildRemotePeers } from '@/app/collab/awareness'
import type { DocStateConflictKind } from '@/app/collab/conflict'
import {
  createCursorBroadcastQueue,
  type CursorBroadcastScheduler
} from '@/app/collab/cursor-broadcast'
import { useCollabIdentity } from '@/app/collab/identity'
import { publishLocalAgents } from '@/app/collab/local-awareness'
import {
  createMotionTimelineUndoManager,
  MOTION_TIMELINES_DOC_KEY,
  MOTION_TIMELINE_CRDT_LIMITS,
  type MotionTimelineConflict
} from '@/app/collab/motion-timeline-yjs'
import { connectCollabRoom } from '@/app/collab/room/connection'
import { deriveRoomStatus, type RoomStatus } from '@/app/collab/room/status'
import {
  readRoomName,
  readRoot,
  TREE_FORMAT,
  writeRoomName,
  type YNodes
} from '@/app/collab/shared-tree/fields'
import type { JoinCollabRoom } from '@/app/collab/transport'
import type {
  MotionTimelinePresence,
  PresenceEditingTarget,
  PreviewDocStatePayload,
  RemotePeer
} from '@/app/collab/types'
import { bindVariableSync, type YRecords } from '@/app/collab/variables'
import { attachRoomVoice, type RoomVoice } from '@/app/collab/voice/room'
import {
  bindCollabGraphEvents,
  createYjsGraphSync,
  registerYjsObservers
} from '@/app/collab/yjs-sync'
import type { EditorStore } from '@/app/editor/active-store'
import { setPeers } from '@/app/presence/registry'
import { ROOM_STATUS_TICK_MS, ROOM_UNREACHABLE_MS } from '@/constants'

/** How a tab came to be in a room: by sharing its own document, or by joining someone's. */
export type RoomOrigin = 'shared' | 'joined'

/** One room, live in one tab: its document, presence, connection, and saved copy. */
export interface RoomSession {
  readonly roomId: string
  readonly roomKey: string | null
  readonly motionConflicts: Readonly<Ref<MotionTimelineConflict[]>>
  readonly store: EditorStore
  readonly origin: RoomOrigin
  readonly peers: Readonly<Ref<RemotePeer[]>>
  readonly status: ComputedRef<RoomStatus>
  /** Whether the room's document has reached this tab, from a peer or the saved copy. */
  readonly hasDocument: Readonly<Ref<boolean>>
  readonly voice: RoomVoice
  updateCursor(x: number, y: number, pageId: string, fpsCap?: number): void
  flushCursor(): void
  updateEditingTarget(target: PresenceEditingTarget | null): void
  updateMotionTimelinePresence(target: MotionTimelinePresence | null): void
  setDocStateConflictHandler(handler: ((kind: DocStateConflictKind) => void) | null): void
  clearMotionTimelineConflicts(): void
  undoMotionTimeline(): void
  redoMotionTimeline(): void
  sendPreviewDocState(payload: PreviewDocStatePayload): void
  onPreviewDocState(handler: ((payload: PreviewDocStatePayload) => void) | null): void
  updateSelection(ids: string[]): void
  /** Writes the tab's whole document into the room and makes its root the room's. */
  shareDocument(): void
  /** Leaves the room and releases its connection, presence, and saved-copy handle. */
  dispose(): void
}

/** This device's saved copy of a room, so it opens before anyone else is online. */
export interface RoomSavedCopy {
  whenSynced: Promise<unknown>
  destroy(): unknown
}

export interface RoomSessionOptions {
  roomId: string
  key?: string
  onAuthError?: () => void
  cursorScheduler?: CursorBroadcastScheduler
  store: EditorStore
  origin: RoomOrigin
  joinRoom?: JoinCollabRoom
  /** Who this tab is in the room; the device's own identity unless a host stands in for one. */
  identity?: Pick<ReturnType<typeof useCollabIdentity>, 'name' | 'color'>
  openSavedCopy?: (roomId: string, ydoc: Y.Doc) => RoomSavedCopy
  /** How long the tab tries to reach the service that introduces peers before saying it cannot. */
  unreachableMs?: number
  /** How often the tab rechecks its connection while it waits for the file. */
  tickMs?: number
}

function openIndexedDBCopy(roomId: string, ydoc: Y.Doc): RoomSavedCopy {
  return new IndexeddbPersistence(`op-room-${roomId}`, ydoc)
}

type CursorState = { x: number; y: number; pageId: string; zoom: number }

export function openRoomSession({
  roomId,
  key,
  onAuthError,
  cursorScheduler,
  store,
  origin,
  joinRoom,
  identity = useCollabIdentity(),
  openSavedCopy = openIndexedDBCopy,
  unreachableMs = ROOM_UNREACHABLE_MS,
  tickMs = ROOM_STATUS_TICK_MS
}: RoomSessionOptions): RoomSession {
  const ydoc = new Y.Doc()
  const awareness = new awarenessProtocol.Awareness(ydoc)
  const ynodes: YNodes = ydoc.getMap('nodes')
  const yimages = ydoc.getMap<Uint8Array>('images')
  const meta = ydoc.getMap<unknown>('meta')
  const yvariables: YRecords = ydoc.getMap('variables')
  const ycollections: YRecords = ydoc.getMap('collections')
  const ymotions = ydoc.getMap<Y.Map<unknown>>(MOTION_TIMELINES_DOC_KEY)
  const motionUndoManager = createMotionTimelineUndoManager(ymotions)
  const motionConflicts = shallowRef<MotionTimelineConflict[]>([])
  let docStateConflictHandler: ((kind: DocStateConflictKind) => void) | null = null
  let previewDocStateHandler: ((payload: PreviewDocStatePayload) => void) | null = null
  const cursorBroadcast = createCursorBroadcastQueue(({ x, y, pageId }: CursorState) => {
    if (!disposed) awareness.setLocalStateField('cursor', { x, y, pageId, zoom: store.state.zoom })
  }, cursorScheduler)
  const persistence = openSavedCopy(roomId, ydoc)

  const peers = shallowRef<RemotePeer[]>([])
  const hasDocument = ref(false)
  const savedCopyLoaded = ref(false)
  const openedAt = Date.now()
  const now = ref(openedAt)
  /** When the current stretch of being connected to the service that introduces peers began. */
  const connectedSince = ref<number | null>(null)
  let suppressYjsEvents = false
  let suppressGraphSync = false
  let disposed = false

  const status = computed(() =>
    deriveRoomStatus({
      hasDocument: hasDocument.value,
      savedCopyLoaded: savedCopyLoaded.value,
      openFor: now.value - openedAt,
      connectedFor: connectedSince.value === null ? null : now.value - connectedSince.value,
      discoveryMs: connection.room.discoveryMs,
      unreachableMs,
      peerCount: peers.value.length,
      peersWithFile: peers.value.filter((peer) => peer.hasFile).length
    })
  )

  const sync = createYjsGraphSync({
    getStore: () => store,
    getYdoc: () => (disposed ? null : ydoc),
    getYnodes: () => (disposed ? null : ynodes),
    getYimages: () => (disposed ? null : yimages),
    getYmotions: () => (disposed ? null : ymotions),
    getSuppressYjsEvents: () => suppressYjsEvents,
    getConflictHandler: () => docStateConflictHandler ?? undefined,
    getMotionConflictHandler: () => (conflict) => {
      const identity = (value: MotionTimelineConflict) =>
        `${value.nodeId}:${value.trackId ?? ''}:${value.keyframeId ?? ''}:${value.code}`
      motionConflicts.value = [
        ...motionConflicts.value.filter((value) => identity(value) !== identity(conflict)),
        conflict
      ].slice(-MOTION_TIMELINE_CRDT_LIMITS.maxConflicts)
    },
    setSuppressYjsEvents: (value) => {
      suppressYjsEvents = value
    }
  })

  function refreshDocument() {
    if (disposed) return
    const rootId = readRoot(meta)
    hasDocument.value = rootId !== undefined && store.graph.rootId === rootId
    // Newcomers wait for someone who has the file, so peers say whether they do.
    if (awareness.getLocalState()?.hasFile !== hasDocument.value) {
      awareness.setLocalStateField('hasFile', hasDocument.value)
    }
    const name = readRoomName(meta)
    if (hasDocument.value && name && origin === 'joined') store.state.documentName = name
  }

  function updatePeers() {
    const next = buildRemotePeers(
      awareness.getStates() as Map<number, Record<string, unknown>>,
      awareness.clientID
    )
    peers.value = next
    setPeers(store, next)
  }

  function broadcastIdentity() {
    awareness.setLocalStateField('user', { name: identity.name.value, color: identity.color })
    awareness.setLocalStateField('treeFormat', TREE_FORMAT)
  }

  const unregisterYjsObservers = registerYjsObservers({
    store,
    ynodes,
    yimages,
    getSuppressYjsEvents: () => suppressYjsEvents,
    setSuppressGraphSync: (value) => {
      suppressGraphSync = value
    },
    ymotions,
    applyYjsMotionToGraph: sync.applyYjsMotionToGraph,
    applyYjsToGraph: (events) => {
      sync.applyYjsToGraph(events)
      refreshDocument()
    }
  })
  meta.observe(refreshDocument)
  const onAwarenessChange = (change: { added: number[]; updated: number[]; removed: number[] }) => {
    if (
      [...change.added, ...change.updated, ...change.removed].some(
        (id) => id !== awareness.clientID
      )
    )
      updatePeers()
  }
  awareness.on('change', onAwarenessChange)

  const connection = connectCollabRoom({
    roomId,
    ydoc,
    awareness,
    updatePeersList: updatePeers,
    joinRoom,
    password: key,
    onAuthError
  })
  function isPreviewDocStateValue(value: unknown): value is PreviewDocStatePayload['value'] {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
    if (typeof value === 'number') return Number.isFinite(value)
    if (Array.isArray(value)) return value.every(isPreviewDocStateValue)
    return typeof value === 'object' && Object.values(value).every(isPreviewDocStateValue)
  }
  const previewStateSchema = v.strictObject({
    name: v.pipe(v.string(), v.minLength(1), v.maxLength(256)),
    value: v.custom<PreviewDocStatePayload['value']>(isPreviewDocStateValue)
  })
  connection.previewDocState[1]((bytes) => {
    if (bytes.byteLength > 1024 * 1024) return
    try {
      const payload = v.safeParse(
        v.pipe(v.string(), v.parseJson(), previewStateSchema),
        new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      )
      if (payload.success) previewDocStateHandler?.(payload.output as PreviewDocStatePayload)
    } catch (error) {
      console.warn(
        '[Collab] Invalid preview state encoding',
        error instanceof Error ? error.name : 'decode failed'
      )
    }
  })
  broadcastIdentity()

  void persistence.whenSynced.then(() => {
    if (disposed) return undefined
    savedCopyLoaded.value = true
    refreshDocument()
    return undefined
  })
  // Signaling services report no events, so the tab polls while it waits for the file.
  function checkConnection() {
    now.value = Date.now()
    if (!connection.room.signalingConnected()) connectedSince.value = null
    else connectedSince.value ??= now.value
  }
  checkConnection()
  const connectionTimer = useIntervalFn(() => {
    if (!hasDocument.value) checkConnection()
  }, tickMs)

  const stopNameWatch = watch(identity.name, broadcastIdentity)
  const stopZoomWatch = store.onEditorEvent('viewport:changed', (viewport) => {
    const cursor = awareness.getLocalState()?.cursor as CursorState | undefined
    if (cursor && cursor.zoom !== viewport.zoom)
      awareness.setLocalStateField('cursor', { ...cursor, zoom: viewport.zoom })
  })
  const stopAgentSync = publishLocalAgents(store, () => awareness, identity.color)
  const stopAgentPreviews = shareAgentPreviews(store, connection)
  const voice = attachRoomVoice({ awareness, peers, connection })
  const variableSync = bindVariableSync({ store, ydoc, yvariables, ycollections })
  const unbindGraphEvents = bindCollabGraphEvents({
    store,
    getYdoc: () => (disposed ? null : ydoc),
    getYnodes: () => (disposed ? null : ynodes),
    getSuppressGraphSync: () => suppressGraphSync,
    syncLocalEdit: sync.syncLocalEdit
  })

  return {
    roomId,
    roomKey: key ?? null,
    motionConflicts,
    store,
    origin,
    peers,
    status,
    hasDocument,
    voice,
    updateCursor(x, y, pageId, fpsCap = 30) {
      if (!cursorScheduler && typeof requestAnimationFrame === 'undefined')
        awareness.setLocalStateField('cursor', { x, y, pageId, zoom: store.state.zoom })
      else cursorBroadcast.push({ x, y, pageId, zoom: store.state.zoom }, fpsCap)
    },
    flushCursor() {
      cursorBroadcast.flush()
    },
    updateEditingTarget(target) {
      cursorBroadcast.flush()
      awareness.setLocalStateField('editing', target)
    },
    updateMotionTimelinePresence(target) {
      awareness.setLocalStateField('motionTimeline', target)
    },
    setDocStateConflictHandler(handler) {
      docStateConflictHandler = handler
    },
    clearMotionTimelineConflicts() {
      motionConflicts.value = []
    },
    undoMotionTimeline() {
      motionUndoManager.undo()
    },
    redoMotionTimeline() {
      motionUndoManager.redo()
    },
    sendPreviewDocState(payload) {
      try {
        if (!v.safeParse(previewStateSchema, payload).success) return
        const bytes = new TextEncoder().encode(JSON.stringify(payload))
        if (bytes.byteLength <= 1024 * 1024) connection.previewDocState[0](bytes)
      } catch (error) {
        console.warn(
          '[Collab] Invalid preview state',
          error instanceof Error ? error.name : 'serialization failed'
        )
      }
    },
    onPreviewDocState(handler) {
      previewDocStateHandler = handler
    },
    updateSelection(ids) {
      cursorBroadcast.flush()
      awareness.setLocalStateField('selection', ids)
      awareness.setLocalStateField('editing', null)
      awareness.setLocalStateField('motionTimeline', null)
    },
    shareDocument() {
      sync.syncAllNodesToYjs()
      motionUndoManager.clear()
      variableSync.share()
      writeRoomName(meta, store.state.documentName)
      refreshDocument()
    },
    dispose() {
      if (disposed) return
      // Unbinding writes an edit still waiting to be sent, so it runs while the room is open.
      cursorBroadcast.flush()
      cursorBroadcast.clear()
      unbindGraphEvents()
      variableSync.dispose()
      disposed = true
      connectionTimer.pause()
      stopNameWatch()
      stopZoomWatch()
      stopAgentSync()
      stopAgentPreviews()
      voice.dispose()
      meta.unobserve(refreshDocument)
      unregisterYjsObservers()
      // Destroying the awareness can emit a last change; nothing here should react to it.
      awareness.off('change', onAwarenessChange)
      void connection.room.leave()
      awareness.destroy()
      void persistence.destroy()
      motionUndoManager.destroy()
      ydoc.destroy()
      peers.value = []
      setPeers(store, [])
    }
  }
}
