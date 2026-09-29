import { isEqual } from 'es-toolkit'
import { computed, onScopeDispose, shallowRef, watch, type Ref } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'

/** Capture immutable write authority; a later focus cannot revive an old renderer's callback. */
export function useModuleValueSession(
  owner: () => SceneNode | undefined,
  source: () => unknown,
  active?: Readonly<Ref<boolean>>
) {
  let serial = 0
  let disposed = false
  const capture = () => ({
    version: ++serial,
    owner: owner(),
    previousModule: structuredClone(owner()?.interactiveProps?.module),
    source: structuredClone(source())
  })
  const session = shallowRef(capture())
  watch(
    () => [owner(), source(), active?.value],
    () => {
      session.value = capture()
    },
    { flush: 'sync' }
  )
  onScopeDispose(() => {
    disposed = true
  })
  return {
    version: computed(() => session.value.version),
    request(version: number) {
      const current = session.value
      if (
        disposed ||
        active?.value === false ||
        version !== current.version ||
        !current.owner ||
        current.owner !== owner() ||
        !isEqual(current.source, source()) ||
        !isEqual(current.previousModule, owner()?.interactiveProps?.module)
      )
        return undefined
      return { owner: current.owner, previousModule: current.previousModule }
    }
  }
}
