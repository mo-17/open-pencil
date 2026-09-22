<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import { useI18n } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import { openStorageWorkspace } from '@/app/shell/menu/navigation'
import Tip from '@/components/ui/overlay/Tip.vue'

const store = useEditorStore()
const router = useRouter()
const { recovery, locale, menu } = useI18n()
const save = computed(() => store.getSaveStatus())
const snapshot = computed(() => store.getRecoveryStatus())
const remote = computed(() => {
  // Read the reactive source revision through its status projection.
  store.getSaveStatus()
  return store.getStorageBinding() !== null
})
const needsSnapshot = computed(() => {
  store.getSaveStatus()
  const source = store.getSourceIdentity()
  return !remote.value && !source.path && !source.handle && !store.getDocumentFilePath()
})
const saveLabel = computed(() => {
  const text = recovery.value
  if (save.value.phase === 'saving') return text.fileSaving
  if (save.value.phase === 'failed') return text.fileFailed
  if (save.value.phase === 'saved') {
    if (save.value.destination === 'local-cache') return text.localCacheSaved
    if (save.value.destination === 'download') return text.downloadRequested
    return text.fileSaved
  }
  return text.fileNotSaved
})
const snapshotLabel = computed(() => {
  const text = recovery.value
  if (snapshot.value.errorCode === 'snapshot-cleanup-failed') return text.snapshotCleanupFailed
  switch (snapshot.value.phase) {
    case 'writing':
      return text.snapshotSaving
    case 'ready':
      return snapshot.value.sessionOnly ? text.snapshotSessionOnly : text.snapshotSaved
    case 'failed':
      return text.snapshotFailed
    case 'disabled':
      return text.snapshotDisabled
    default:
      return text.snapshotNone
  }
})
function time(value: string): string {
  return new Date(value).toLocaleString(locale.value)
}
async function retrySave(): Promise<void> {
  try {
    await store.saveFigFile()
  } catch (error) {
    console.warn('[Document status] Save retry failed:', error)
  }
}
async function retrySnapshot(): Promise<void> {
  const target = store
  try {
    if (snapshot.value.errorCode === 'snapshot-cleanup-failed') await target.discardRecovery()
    else await target.persistRecoveryNow()
  } catch (error) {
    console.warn('[Document status] Recovery retry failed:', error)
  }
}
</script>

<template>
  <div
    data-test-id="document-save-status"
    class="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-panel px-3 py-1 text-[10px] text-muted"
  >
    <span data-test-id="document-file-status" :data-phase="save.phase">
      {{ saveLabel }}
      <time v-if="save.updatedAt" :datetime="save.updatedAt"> · {{ time(save.updatedAt) }}</time>
      <button
        v-if="save.phase === 'failed'"
        type="button"
        data-test-id="document-save-retry"
        class="ml-2 rounded px-1 text-accent hover:underline"
        @click="retrySave"
      >
        {{ recovery.retrySave }}
      </button>
    </span>
    <Tip
      v-if="needsSnapshot || snapshot.phase === 'failed'"
      :label="snapshot.sessionOnly ? recovery.snapshotSessionHelp : recovery.snapshotHelp"
    >
      <span data-test-id="document-recovery-status" :data-phase="snapshot.phase">
        {{ snapshotLabel }}
        <time v-if="snapshot.updatedAt" :datetime="snapshot.updatedAt">
          · {{ time(snapshot.updatedAt) }}</time
        >
        <button
          v-if="snapshot.phase === 'failed'"
          type="button"
          data-test-id="document-recovery-retry"
          class="ml-2 rounded px-1 text-accent hover:underline"
          @click="retrySnapshot"
        >
          {{ recovery.retrySnapshot }}
        </button>
      </span>
    </Tip>
    <button
      v-if="snapshot.sessionOnly"
      type="button"
      class="rounded px-1 text-accent hover:underline"
      @click="retrySave"
    >
      {{ menu.saveAs }}
    </button>
    <button
      v-if="remote"
      type="button"
      data-test-id="document-sync-details"
      class="rounded px-1 text-accent hover:underline"
      @click="openStorageWorkspace(router)"
    >
      {{ recovery.remoteSyncDetails }}
    </button>
  </div>
</template>
