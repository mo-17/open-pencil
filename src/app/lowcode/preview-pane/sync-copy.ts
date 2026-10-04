import type { useCodeMessages } from '@open-pencil/vue'

import type { PreviewRefreshPolicy } from './compile-scheduler'

type SyncMessages = ReturnType<typeof useCodeMessages>['value']

export function previewSyncLabel(messages: SyncMessages, policy: PreviewRefreshPolicy): string {
  const labels = {
    auto: messages.previewSyncAuto,
    save: messages.previewSyncSave,
    manual: messages.previewSyncManual,
    realtime: messages.previewSyncRealtime
  }
  return labels[policy]
}

export function previewSyncDescription(
  messages: SyncMessages,
  policy: PreviewRefreshPolicy
): string {
  const descriptions = {
    auto: messages.previewSyncAutoDescription,
    save: messages.previewSyncSaveDescription,
    manual: messages.previewSyncManualDescription,
    realtime: messages.previewSyncRealtimeDescription
  }
  return descriptions[policy]
}
