import { watch, type WatchStopHandle } from 'vue'

import type { DocumentSaveStatus } from '@/app/document/io/save'

/** Successful writes create a new status; a cancelled save restores the old status. */
export function watchPreviewSaveSync(
  getStatus: () => DocumentSaveStatus,
  onSaved: () => void
): WatchStopHandle {
  const seen = new WeakSet<DocumentSaveStatus>()
  const initial = getStatus()
  if (initial.phase === 'saved') seen.add(initial)

  return watch(getStatus, (status) => {
    if (status.phase !== 'saved' || seen.has(status)) return
    seen.add(status)
    onSaved()
  })
}
