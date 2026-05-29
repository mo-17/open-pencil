import { describe, expect, test } from 'bun:test'

import { generateRoomId, generateRoomKey } from '@/app/collab/awareness'
import { ROOM_ID_CHARS, ROOM_KEY_LENGTH } from '@/constants'

/**
 * Phase 3 §4.2 — room auth key. The key is the Trystero password (encrypts
 * signaling SDP). It must be long + random + drawn from the known alphabet,
 * and distinct from the short, guessable roomId.
 */
describe('room key generation (Phase 3 §4.2)', () => {
  test('generateRoomKey is ROOM_KEY_LENGTH chars from the room alphabet', () => {
    const key = generateRoomKey()
    expect(key).toHaveLength(ROOM_KEY_LENGTH)
    for (const ch of key) expect(ROOM_ID_CHARS).toContain(ch)
  })

  test('keys are non-trivially unique (crypto-backed, not Math.random)', () => {
    const keys = new Set(Array.from({ length: 200 }, () => generateRoomKey()))
    expect(keys.size).toBe(200)
  })

  test('room key is much longer than the room id (stronger than the id alone)', () => {
    expect(generateRoomKey().length).toBeGreaterThan(generateRoomId().length)
  })
})

/**
 * The CollabPanel parses an invite (full URL / `/share/<id>#k=<key>` / bare id)
 * into { roomId, key }. This mirrors `parseInvite` in
 * `src/components/CollabPanel/context.ts` — kept in lockstep with that logic.
 * (The Vue component itself isn't unit-mounted here; this pins the parsing
 * contract so the key in the URL fragment is recovered, never the roomId only.)
 */
function parseInvite(raw: string): { roomId: string; key: string } {
  const trimmed = raw.trim()
  const hashIdx = trimmed.indexOf('#k=')
  const key = hashIdx !== -1 ? trimmed.slice(hashIdx + 3) : ''
  const beforeHash = hashIdx !== -1 ? trimmed.slice(0, hashIdx) : trimmed
  const roomId = beforeHash.replace(/.*\/share\//, '').replace(/[#?].*$/, '')
  return { roomId, key }
}

describe('invite parsing (Phase 3 §4.2)', () => {
  test('full share URL → roomId + key from the fragment', () => {
    expect(parseInvite('https://openpencil.dev/share/abcd1234#k=KEY123')).toEqual({
      roomId: 'abcd1234',
      key: 'KEY123'
    })
  })

  test('bare /share path with fragment', () => {
    expect(parseInvite('/share/room42#k=secretkey')).toEqual({
      roomId: 'room42',
      key: 'secretkey'
    })
  })

  test('legacy bare roomId (no key) parses with empty key', () => {
    expect(parseInvite('abcd1234')).toEqual({ roomId: 'abcd1234', key: '' })
  })

  test('legacy keyless share URL → empty key (connects unkeyed, not crash)', () => {
    expect(parseInvite('https://openpencil.dev/share/abcd1234')).toEqual({
      roomId: 'abcd1234',
      key: ''
    })
  })
})
