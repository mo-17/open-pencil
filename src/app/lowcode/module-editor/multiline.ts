import { onScopeDispose, ref, watch, type Ref } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import { useModuleScalarCommit, type ModuleScalarCommit } from './scalar'

export function useModuleTextDraft(
  getOwner: () => SceneNode | undefined,
  getConfig: () => JSONObject,
  getValue: () => string,
  getLimit: () => number,
  active: Readonly<Ref<boolean>> | undefined,
  commit: (request: ModuleScalarCommit) => void
) {
  const authority = useModuleScalarCommit(getOwner, getConfig, commit, active)
  const draft = ref(getValue())
  const generation = ref(0)
  let lastCommitted = draft.value
  let inputGeneration: number | undefined
  let disposed = false

  watch(
    () => [getOwner(), getConfig(), getValue(), active?.value],
    () => {
      generation.value++
      inputGeneration = undefined
      draft.value = getValue()
      lastCommitted = draft.value
    },
    { flush: 'sync' }
  )
  onScopeDispose(() => {
    disposed = true
    inputGeneration = undefined
  })

  function beginInput(renderedGeneration: number): void {
    if (disposed || active?.value === false || renderedGeneration !== generation.value) return
    inputGeneration = renderedGeneration
    authority.beginInput(authority.ownerGeneration.value)
  }

  function update(value: string, renderedGeneration: number): void {
    if (disposed || active?.value === false || renderedGeneration !== inputGeneration) return
    draft.value = value
  }

  function submit(renderedGeneration: number): void {
    if (
      disposed ||
      active?.value === false ||
      renderedGeneration !== inputGeneration ||
      draft.value.length > getLimit() ||
      draft.value === lastCommitted
    )
      return
    lastCommitted = draft.value
    authority.submit({ kind: 'value', value: draft.value })
  }

  return { draft, generation, beginInput, update, submit }
}
