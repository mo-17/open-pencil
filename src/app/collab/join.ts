import { useCollaborationMessages, useDialogMessages } from '@open-pencil/vue'

import { parseRoomInvite } from '@/app/collab/room/id'
import { joinRoom } from '@/app/collab/rooms'
import { toast } from '@/app/shell/ui'

/**
 * Joins a complete keyed invitation in a tab of its own. An ID alone or an invalid key
 * is refused, so the caller can ask for a fresh invitation instead of joining without a key.
 */
export function useJoinRoom() {
  const dialogs = useDialogMessages()
  const messages = useCollaborationMessages()
  return (input: string): boolean => {
    const invite = parseRoomInvite(input)
    if (!invite) return false
    const { roomId, key } = invite
    return (
      joinRoom(roomId, {
        tabName: messages.value.sharedFile,
        key,
        onAuthError: () => toast.error(dialogs.value.roomKeyError)
      }) !== null
    )
  }
}
