import { ref, shallowRef } from 'vue'

import type { PreviewEditorPayload } from '../iframe/messages'
import {
  appendRuntimeDebugEntries,
  type RuntimeDebugBatch,
  type RuntimeDebugEntry
} from './protocol'

export function useRuntimeDebug(post: (payload: PreviewEditorPayload) => void) {
  const open = ref(false)
  const recording = ref(false)
  const entries = shallowRef<RuntimeDebugEntry[]>([])
  const dropped = ref(0)
  let received = 0

  function clearEntries() {
    entries.value = []
    dropped.value = 0
    received = 0
  }
  function clear() {
    clearEntries()
    if (recording.value) post({ type: 'runtimeDebug', enabled: true })
  }
  function setRecording(enabled: boolean) {
    recording.value = enabled
    post({ type: 'runtimeDebug', enabled })
  }
  function toggle() {
    open.value = !open.value
    setRecording(open.value)
  }
  function close() {
    open.value = false
    setRecording(false)
  }
  function accept(batch: RuntimeDebugBatch) {
    if (!recording.value) return
    const previousLast = entries.value.at(-1)?.sequence ?? -1
    received += batch.entries.filter((entry) => entry.sequence > previousLast).length
    entries.value = appendRuntimeDebugEntries(entries.value, batch.entries)
    dropped.value = batch.dropped + Math.max(0, received - entries.value.length)
  }
  function reset() {
    clearEntries()
  }
  function replay() {
    clearEntries()
    if (recording.value) post({ type: 'runtimeDebug', enabled: true })
  }
  return {
    open,
    recording,
    entries,
    dropped,
    toggle,
    close,
    setRecording,
    clear,
    accept,
    reset,
    replay
  }
}
