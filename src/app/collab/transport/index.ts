import { usesTestCollabTransport } from './policy'
import { joinTestCollabRoom } from './test'
import { joinTrysteroCollabRoom } from './trystero'
import type { JoinCollabRoom } from './types'

export const joinCollabRoom: JoinCollabRoom = (roomId, options) =>
  usesTestCollabTransport() ? joinTestCollabRoom(roomId) : joinTrysteroCollabRoom(roomId, options)

export type { CollabActionReceiver, CollabRoomTransport, JoinCollabRoom } from './types'
