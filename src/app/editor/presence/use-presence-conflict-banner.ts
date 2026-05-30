import { computed } from 'vue'

import { useI18n } from '@open-pencil/vue'

import { useCollabInjected } from '@/app/collab/use'

/**
 * Phase 3 §4.5 — active concurrent-edit banner for the document/page-level
 * lowcode panels (page state / document state / Supabase config).
 *
 * Those collections are whole-field last-write-wins (no auto-merge, §4.5 γ), so
 * when §4.4 presence shows another peer editing the SAME panel kind, we warn the
 * user up front that a save may clobber the other's change. Returns a localized
 * banner string, or null when not connected / nobody else is editing this kind.
 */
type ConflictBannerKind = 'state' | 'docState' | 'supabaseConfig'

const TARGET_KEY = {
  state: 'presenceTargetState',
  docState: 'presenceTargetDocState',
  supabaseConfig: 'presenceTargetSupabaseConfig'
} as const

export function usePresenceConflictBanner(kind: ConflictBannerKind) {
  const collab = useCollabInjected()
  const { dialogs } = useI18n()

  return computed<string | null>(() => {
    if (!collab?.state.value.connected) return null
    const otherEditing = collab.remotePeers.value.some((peer) => peer.editing?.kind === kind)
    if (!otherEditing) return null
    return dialogs.value.presenceConflictBanner({ target: dialogs.value[TARGET_KEY[kind]] })
  })
}
