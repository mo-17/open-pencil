import * as v from 'valibot'

import { ROOM_ID_CHARS, ROOM_ID_LENGTH, ROOM_KEY_LENGTH } from '@/constants'

// The alphabet is plain lowercase letters and digits, so it needs no escaping in a class.
const roomIdSchema = v.pipe(
  v.string(),
  v.regex(new RegExp(`^[${ROOM_ID_CHARS}]{${ROOM_ID_LENGTH}}$`))
)

export function isRoomId(value: string): boolean {
  return v.is(roomIdSchema, value)
}

/**
 * The room ID in what someone pasted: a bare ID or a share link, with any query, hash, or
 * trailing slash. Null when it is not a room ID, so a mistyped link never joins another room.
 */
export function parseRoomInput(text: string): string | null {
  let candidate = text.trim()
  const shareIndex = candidate.lastIndexOf('/share/')
  if (shareIndex !== -1) candidate = candidate.slice(shareIndex + '/share/'.length)
  candidate = candidate.split(/[?#]/)[0] ?? ''
  candidate = candidate.replace(/\/+$/, '')
  return isRoomId(candidate) ? candidate : null
}

export interface RoomInvite {
  roomId: string
  key: string
}

/** A complete invitation, with its key in the fragment rather than an HTTP query. */
export function parseRoomInvite(input: string): RoomInvite | null {
  const text = input.trim()
  const roomId = parseRoomInput(text)
  if (!roomId) return null
  const hashIndex = text.indexOf('#')
  if (hashIndex === -1) return null
  const keys = new URLSearchParams(text.slice(hashIndex + 1)).getAll('k')
  const [key] = keys
  const keySchema = v.pipe(
    v.string(),
    v.regex(new RegExp(`^[${ROOM_ID_CHARS}]{${ROOM_KEY_LENGTH}}$`))
  )
  if (keys.length !== 1 || !v.is(keySchema, key)) return null
  return { roomId, key }
}
