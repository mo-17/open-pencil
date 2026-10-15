import { watch } from 'vue'
import type { RouteLocationNormalizedLoaded, Router } from 'vue-router'

import { activeRoom } from '@/app/collab/rooms'

export const SHARE_ROUTE_PREFIX = '/share/'

export function shareRoutePath(roomId: string): string {
  return `${SHARE_ROUTE_PREFIX}${roomId}`
}

/** The path for the active tab's room: its share link, or `/` after leaving a share link. */
function roomPathFor(roomId: string | null, currentPath: string): string {
  if (roomId) return shareRoutePath(roomId)
  return currentPath.startsWith(SHARE_ROUTE_PREFIX) ? '/' : currentPath
}

/**
 * Keeps the address bar on the active tab's room: `/share/<id>` while a room tab is active, and
 * back to `/` when the active tab is not in a room, so a reload or a copied URL opens what is
 * on screen.
 */
export function syncRoomRoute(router: Router, route: RouteLocationNormalizedLoaded): () => void {
  return watch(
    () => activeRoom.value,
    (room) => {
      const roomId = room?.roomId ?? null
      const path = roomPathFor(roomId, route.path)
      const hash = room?.roomKey ? `#k=${room.roomKey}` : ''
      if (path === route.path && hash === route.hash) return
      void router.replace({ path, query: route.query, hash })
    },
    { immediate: true }
  )
}
