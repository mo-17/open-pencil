import { afterEach, describe, expect, test } from 'bun:test'

import { parseRoomInvite, type RoomInvite } from '@/app/collab/room/id'
import { bindDesktopRoomLinks, ROOM_LINKS_EVENT } from '@/app/collab/room/links'

import { clearTauriMocks, installTauriMockWindow } from '#tests/helpers/tauri/mocks'

const ROOM = 'abcdefghijklmnopqrstuvwxyz012345'
const KEY = '0123456789abcdefghijklmnopqrstuvwxyz0123456789ab'
const INPUT = `${ROOM}#k=${KEY}`

afterEach(async () => {
  await clearTauriMocks()
})

describe('desktop keyed invitation IPC', () => {
  test('drains startup and event invitations through the same mandatory-key parser', async () => {
    installTauriMockWindow()
    const { mockIPC } = await import('@tauri-apps/api/mocks')
    const { emit } = await import('@tauri-apps/api/event')
    const pending: string[] = [INPUT]
    mockIPC(
      (command) => {
        if (command === 'take_pending_rooms') return pending.splice(0)
        throw new Error(`Unexpected native command: ${command}`)
      },
      { shouldMockEvents: true }
    )
    const opened: RoomInvite[] = []
    let received: (() => void) | undefined
    const stop = await bindDesktopRoomLinks((input) => {
      const invite = parseRoomInvite(input)
      if (!invite) return
      opened.push(invite)
      received?.()
    })
    try {
      expect(opened).toEqual([{ roomId: ROOM, key: KEY }])
      expect(pending).toEqual([])
      const eventOpened = new Promise<void>((resolve) => {
        received = resolve
      })
      // A stale unkeyed entry cannot join; the complete keyed entry still can.
      pending.push(ROOM, INPUT)
      await emit(ROOM_LINKS_EVENT)
      await eventOpened
      expect(opened).toEqual([
        { roomId: ROOM, key: KEY },
        { roomId: ROOM, key: KEY }
      ])
      expect(pending).toEqual([])
    } finally {
      stop()
    }
    pending.push(INPUT)
    await emit(ROOM_LINKS_EVENT)
    expect(pending).toEqual([INPUT])
  })

  test('keeps the native array contract strict instead of treating null as an empty queue', async () => {
    installTauriMockWindow()
    const { mockIPC } = await import('@tauri-apps/api/mocks')
    mockIPC(() => null, { shouldMockEvents: true })
    await expect(bindDesktopRoomLinks(() => undefined)).rejects.toThrow()
  })
})
