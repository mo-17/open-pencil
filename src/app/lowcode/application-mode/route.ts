import { onScopeDispose, ref, watch, type Ref } from 'vue'

import { applicationRouteValid } from './model'

export interface ApplicationRouteSource {
  value: string
  version: number
  disabled: boolean
  commit: (value: string) => void
}

/** A cancelled draft cannot be submitted by a later blur/change from its detached input. */
export function useApplicationRouteDraft(
  source: () => ApplicationRouteSource,
  active?: Readonly<Ref<boolean>>
) {
  const draft = ref(source().value)
  let captured: ApplicationRouteSource | undefined
  let disposed = false
  function cancel() {
    captured = undefined
    draft.value = source().value
  }
  watch(() => [source().value, source().version, source().disabled, active?.value], cancel, {
    flush: 'sync'
  })
  onScopeDispose(() => {
    disposed = true
    captured = undefined
  })
  return {
    draft,
    cancel,
    edit(value: string | number) {
      if (disposed || source().disabled || active?.value === false) return
      captured ??= source()
      draft.value = String(value)
    },
    commit() {
      const current = source()
      if (
        disposed ||
        !captured ||
        active?.value === false ||
        current.disabled ||
        current.version !== captured.version ||
        current.value !== captured.value ||
        !applicationRouteValid(draft.value) ||
        draft.value === current.value
      )
        return
      const owner = captured
      captured = undefined
      owner.commit(draft.value)
    }
  }
}
