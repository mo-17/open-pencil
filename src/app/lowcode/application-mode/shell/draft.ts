import { computed, onScopeDispose, ref, watch } from 'vue'

import type { ApplicationShellPanelModel, ApplicationShellSource } from './types'

/** Drafts and rendered callbacks retire synchronously with their editor/page authority. */
export function useApplicationShellDraft(source: () => ApplicationShellSource) {
  const frameNodeId = ref(source().frameNodeId)
  const slotNodeId = ref(source().slotNodeId)
  const generation = ref(0)
  let disposed = false
  function reset() {
    generation.value++
    frameNodeId.value = source().frameNodeId
    slotNodeId.value = source().slotNodeId
  }
  watch(
    () => [source().version, source().disabled, source().frameNodeId, source().slotNodeId],
    reset,
    {
      flush: 'sync'
    }
  )
  onScopeDispose(() => {
    disposed = true
    generation.value++
  })
  return computed<ApplicationShellPanelModel>(() => {
    const current = source()
    const capturedGeneration = generation.value
    const frame = frameNodeId.value
    const slot = slotNodeId.value
    const dirty = frame !== current.frameNodeId || slot !== current.slotNodeId
    const slots = current.getSlots(frame)
    function live() {
      return (
        !disposed &&
        !current.disabled &&
        !source().disabled &&
        source().version === current.version &&
        generation.value === capturedGeneration
      )
    }
    return {
      ...current,
      version: capturedGeneration,
      frameNodeId: frame,
      slotNodeId: slot,
      slots,
      dirty,
      canApply: !current.disabled && dirty && current.eligible(frame, slot),
      selectFrame(value) {
        if (!live() || typeof value !== 'string') return false
        if (value && !current.frames.some((option) => option.value === value && !option.disabled))
          return false
        if (value === frame) return false
        generation.value++
        frameNodeId.value = value
        slotNodeId.value = ''
        return true
      },
      selectSlot(value) {
        if (!live() || typeof value !== 'string') return false
        if (value && !slots.some((option) => option.value === value && !option.disabled))
          return false
        if (value === slot) return false
        generation.value++
        slotNodeId.value = value
        return true
      },
      apply() {
        if (!live() || !dirty || !current.eligible(frame, slot)) return false
        return current.commit({ frameNodeId: frame, slotNodeId: slot })
      },
      cancel() {
        if (live()) reset()
      },
      remove() {
        if (!live() || !current.configured) return false
        return current.commit(undefined)
      }
    }
  })
}
