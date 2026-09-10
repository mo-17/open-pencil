import { usesTestCollabTransport } from './policy'
import { joinTestCollabRoom } from './test'
import { joinTrysteroCollabRoom } from './trystero'
import type { JoinCollabRoom } from './types'

export const joinCollabRoom: JoinCollabRoom = (roomId) =>
  usesTestCollabTransport() ? joinTestCollabRoom(roomId) : joinTrysteroCollabRoom(roomId)

export type { CollabRoomTransport, JoinCollabRoom } from './types'
