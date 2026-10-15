import { describe, expect, test } from 'bun:test'

import { parseRoomInvite } from '@/app/collab/room/id'
import { roomLinkURL } from '@/app/collab/room/links'
import { getShareURL } from '@/constants'

import { relayURLFor } from '#tests/helpers/collab/room'

const ROOM = 'abcdefghijklmnopqrstuvwxyz012345'
// Deliberately public synthetic data, never a live invitation.
const KEY = '0123456789abcdefghijklmnopqrstuvwxyz0123456789ab'

describe('complete room invitations', () => {
  test('parses web, relative and pasted invitations without dropping a fragment key', () => {
    for (const input of [
      `${ROOM}#k=${KEY}`,
      `/share/${ROOM}#k=${KEY}`,
      `https://app.openpencil.dev/share/${ROOM}/?test#k=${KEY}`,
      `  https://app.openpencil.dev/share/${ROOM}#k=${KEY}  `,
      `/share/${ROOM}#k=%30${KEY.slice(1)}`
    ]) {
      expect(parseRoomInvite(input)).toEqual({ roomId: ROOM, key: KEY })
    }
  })

  test('refuses missing, malformed, query-only and ambiguous keys', () => {
    for (const input of [
      ROOM,
      `/share/${ROOM}`,
      `/share/${ROOM}?k=${KEY}`,
      `/share/${ROOM}#k=`,
      `/share/${ROOM}#k=short`,
      `/share/${ROOM}#k=${KEY.toUpperCase()}`,
      `/share/${ROOM}#k=${KEY}x`,
      `/share/${ROOM}#k=${KEY.slice(0, -1)}%2F`,
      `/share/${ROOM}#k=${KEY}&k=${KEY}`,
      `/share/not-a-room#k=${KEY}`
    ]) {
      expect(parseRoomInvite(input)).toBeNull()
    }
  })

  test('copy and desktop handoff preserve the exact key outside the query', () => {
    const copied = new URL(getShareURL(ROOM, KEY))
    expect(parseRoomInvite(copied.href)).toEqual({ roomId: ROOM, key: KEY })
    expect(copied.searchParams.has('k')).toBe(false)
    const desktop = new URL(roomLinkURL(ROOM, KEY))
    expect(desktop.protocol).toBe('openpencil:')
    expect(desktop.searchParams.get('room')).toBe(ROOM)
    expect(desktop.searchParams.has('k')).toBe(false)
    expect(desktop.hash).toBe(`#k=${KEY}`)
    // Rust returns this exact atomic string through the existing string-array IPC.
    const queuedInput = `${desktop.searchParams.get('room')}${desktop.hash}`
    expect(parseRoomInvite(queuedInput)).toEqual({ roomId: ROOM, key: KEY })
    expect(() => roomLinkURL(ROOM, '')).toThrow('Invalid room invitation')
    expect(() => roomLinkURL(`/share/${ROOM}`, KEY)).toThrow('Invalid room invitation')
    expect(() => roomLinkURL(ROOM, `%30${KEY.slice(1)}`)).toThrow('Invalid room invitation')
  })

  test('fixture transport parameters preserve a keyed route across reload', () => {
    const route = relayURLFor(`/share/${ROOM}#k=${KEY}`, 'ws://127.0.0.1:12345')
    const url = new URL(route, 'http://localhost:15340')
    expect(url.searchParams.has('test')).toBe(true)
    expect(url.searchParams.get('collabTransport')).toBe('test')
    expect(url.searchParams.get('collabRelay')).toBe('ws://127.0.0.1:12345')
    expect(url.searchParams.has('k')).toBe(false)
    expect(parseRoomInvite(new URL(url.href).href)).toEqual({ roomId: ROOM, key: KEY })
  })
})
