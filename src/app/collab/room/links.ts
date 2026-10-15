import * as v from 'valibot'

import { parseRoomInvite } from '@/app/collab/room/id'
import { isTauri } from '@/app/tauri/env'

/** Desktop events and commands for keyed room links (`desktop/src/lib.rs`). */
export const ROOM_LINKS_EVENT = 'open-room-links'
const TAKE_PENDING_ROOMS = 'take_pending_rooms'

const pendingRoomsSchema = v.array(v.string())

export function roomLinkURL(roomId: string, key: string): string {
  const invite = parseRoomInvite(`${roomId}#k=${key}`)
  if (!invite || invite.roomId !== roomId || invite.key !== key)
    throw new Error('Invalid room invitation')
  return `openpencil://join?room=${encodeURIComponent(roomId)}#k=${encodeURIComponent(key)}`
}

/**
 * Drains complete `roomId#k=key` invitations from native memory at startup and while running.
 * Native code validates the ID and key; `open` validates them again before joining.
 */
export async function bindDesktopRoomLinks(open: (invite: string) => void): Promise<() => void> {
  if (!isTauri()) return () => undefined
  const [{ invoke }, { listen }] = await Promise.all([
    import('@tauri-apps/api/core'),
    import('@tauri-apps/api/event')
  ])
  async function drain() {
    const rooms = v.parse(pendingRoomsSchema, await invoke<unknown>(TAKE_PENDING_ROOMS))
    for (const invite of rooms) open(invite)
  }
  const stop = await listen(ROOM_LINKS_EVENT, () => {
    void drain().catch((error: unknown) => console.error('[Room link]', error))
  })
  await drain()
  return stop
}
