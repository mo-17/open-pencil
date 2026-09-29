import { onScopeDispose, ref, watch, type Ref } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import type { ModuleEditorCommit } from './owner'

export type ModuleScalarEdit =
  | { kind: 'value'; value: unknown }
  | { kind: 'boolean'; event: Event }
  | { kind: 'json'; source: string }
export type ModuleScalarCommit = ModuleEditorCommit<ModuleScalarEdit>

/** Capture authority when interaction begins; a late blur never acquires a new owner. */
export function useModuleScalarCommit(
  getOwner: () => SceneNode | undefined,
  getConfig: () => JSONObject,
  commit: (request: ModuleScalarCommit) => void,
  active?: Readonly<Ref<boolean>>
) {
  const ownerGeneration = ref(0)
  let input: Pick<ModuleScalarCommit, 'owner' | 'previousModule'> | undefined
  let disposed = false
  let committing = false
  let committedModule: unknown
  watch(
    () => [getOwner(), getConfig(), active?.value],
    (current, previous) => {
      if (
        current[0] !== previous[0] ||
        (input && !committing && getOwner()?.interactiveProps?.module !== committedModule)
      )
        ownerGeneration.value++
      input = undefined
      committedModule = undefined
    },
    { flush: 'sync' }
  )
  onScopeDispose(() => {
    disposed = true
    input = undefined
  })

  function beginInput(renderedGeneration: number): void {
    const owner = getOwner()
    input =
      !disposed && active?.value !== false && owner && renderedGeneration === ownerGeneration.value
        ? { owner, previousModule: structuredClone(owner.interactiveProps?.module) }
        : undefined
  }
  function submit(value: ModuleScalarEdit): void {
    if (disposed || active?.value === false || !input?.owner || input.owner !== getOwner()) return
    committing = true
    try {
      commit({ ...input, value })
      committedModule = getOwner()?.interactiveProps?.module
    } finally {
      committing = false
    }
  }
  return { ownerGeneration, beginInput, submit }
}
