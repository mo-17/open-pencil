import { describe, expect, test } from 'bun:test'

import { computed } from 'vue'

import type { CursorBroadcastScheduler } from '@/app/collab/cursor-broadcast'
import { openRoomSession, type RoomSession, type RoomSessionOptions } from '@/app/collab/session'
import { createEditorStore, type EditorStore } from '@/app/editor/session'
import { follow, presenceOf } from '@/app/presence/registry'

import { createMemoryRooms } from '#tests/helpers/collab/memory-transport'

const ROOM = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const color = { r: 1, g: 0, b: 0, a: 1 }

async function withSessions(
  run: (host: RoomSession, guest: RoomSession, settle: () => Promise<void>) => Promise<void>,
  cursorScheduler?: CursorBroadcastScheduler
) {
  const rooms = createMemoryRooms()
  const stores: EditorStore[] = []
  const sessions: RoomSession[] = []
  function open(name: string, origin: RoomSessionOptions['origin']) {
    const store = createEditorStore()
    stores.push(store)
    const session = openRoomSession({
      roomId: ROOM,
      store,
      origin,
      joinRoom: rooms.join,
      identity: { name: computed(() => name), color },
      cursorScheduler,
      openSavedCopy: () => ({ whenSynced: Promise.resolve(), destroy: () => undefined })
    })
    sessions.push(session)
    return session
  }
  try {
    const host = open('Host', 'shared')
    host.shareDocument()
    const guest = open('Guest', 'joined')
    await rooms.settle()
    await run(host, guest, rooms.settle)
  } finally {
    for (const session of sessions) session.dispose()
    for (const store of stores) store.dispose()
  }
}

describe('room presence cadence', () => {
  test('remote cursor changes repaint presence without invalidating the document', async () => {
    await withSessions(async (host, guest, settle) => {
      const sceneVersion = guest.store.state.sceneVersion
      const canvasVersion = guest.store.state.canvasVersion
      const renderVersion = guest.store.state.renderVersion
      host.updateCursor(4, 5, host.store.state.currentPageId)
      host.flushCursor()
      await settle()
      expect(guest.peers.value[0]?.cursor?.x).toBe(4)
      expect(guest.store.state.renderVersion).toBeGreaterThan(renderVersion)
      expect(guest.store.state.canvasVersion).toBe(canvasVersion)
      expect(guest.store.state.sceneVersion).toBe(sceneVersion)
    })
  })

  test('local awareness changes do not refresh the remote peer list', async () => {
    await withSessions(async (host) => {
      const peers = host.peers.value
      const version = host.store.state.renderVersion
      host.updateCursor(1, 2, host.store.state.currentPageId)
      host.flushCursor()
      host.updateSelection([])
      expect(host.peers.value).toBe(peers)
      expect(host.store.state.renderVersion).toBe(version)
    })
  })

  test('selection and editing boundaries flush the trailing cursor and clear stale presence', async () => {
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
      setDelay: (callback, delay) => setTimeout(callback, delay),
      clearDelay: (handle) => clearTimeout(handle)
    }
    await withSessions(async (host, guest, settle) => {
      host.updateCursor(1, 2, host.store.state.currentPageId, 15)
      expect(frame).not.toBeNull()
      host.updateSelection([])
      expect(frame).toBeNull()
      await settle()
      expect(guest.peers.value[0]?.cursor?.x).toBe(1)
      host.updateCursor(3, 4, host.store.state.currentPageId, 15)
      host.updateEditingTarget({ kind: 'events', nodeId: 'node-1' })
      await settle()
      expect(guest.peers.value[0]?.cursor?.x).toBe(3)
      expect(guest.peers.value[0]?.editing).toEqual({ kind: 'events', nodeId: 'node-1' })
      host.updateSelection([])
      await settle()
      expect(guest.peers.value[0]?.editing).toBeUndefined()
    }, scheduler)
  })

  test('leaving a room releases remote cursors without changing scene content', async () => {
    await withSessions(async (host, guest, settle) => {
      host.updateCursor(4, 5, host.store.state.currentPageId)
      host.flushCursor()
      await settle()
      const version = guest.store.state.sceneVersion
      guest.dispose()
      expect(presenceOf(guest.store).peers.value).toEqual([])
      expect(guest.store.state.presenceCursors).toEqual([])
      expect(guest.store.state.sceneVersion).toBe(version)
    })
  })

  test('panning does not bypass cadence while zoom updates the last sent cursor', async () => {
    await withSessions(async (host, guest, settle) => {
      host.updateCursor(10, 20, host.store.state.currentPageId)
      host.flushCursor()
      await settle()
      const peers = guest.peers.value
      host.store.pan(5, 6)
      await settle()
      expect(guest.peers.value).toBe(peers)
      host.store.setZoomAroundPoint(2, 0, 0)
      await settle()
      expect(guest.peers.value[0]?.cursor?.zoom).toBe(2)
      const scene = guest.store.state.sceneVersion
      follow(guest.store, { kind: 'person', clientId: guest.peers.value[0]?.clientId ?? -1 })
      expect(guest.store.state.zoom).toBe(2)
      expect(guest.store.state.sceneVersion).toBe(scene)
    })
  })
})
