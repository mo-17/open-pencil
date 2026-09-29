import { isEqual } from 'es-toolkit'
import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import {
  editTreeEditor,
  treeEditorValue,
  validTreeEditor,
  type TreeEditorCommit,
  type TreeEditorEdit
} from './index'
export function useTreeEditorDraft(
  owner: () => SceneNode | undefined,
  config: () => JSONObject,
  submit: (request: TreeEditorCommit) => void,
  active?: Readonly<Ref<boolean>>
) {
  const draft = shallowRef(treeEditorValue(config())),
    generation = ref(0),
    invalid = ref(false)
  let snapshot: Pick<TreeEditorCommit, 'owner' | 'previousModule'>,
    disposed = false,
    inputGeneration: number | undefined
  function restore() {
    generation.value++
    inputGeneration = undefined
    invalid.value = false
    snapshot = {
      owner: owner(),
      previousModule: structuredClone(owner()?.interactiveProps?.module)
    }
    draft.value = treeEditorValue(config())
  }
  watch(() => [owner(), config(), active?.value], restore, { flush: 'sync', immediate: true })
  onScopeDispose(() => {
    disposed = true
    inputGeneration = undefined
    generation.value++
  })
  function available(value: number) {
    return (
      !disposed &&
      active?.value !== false &&
      value === generation.value &&
      snapshot.owner === owner() &&
      Boolean(snapshot.owner) &&
      isEqual(snapshot.previousModule, owner()?.interactiveProps?.module)
    )
  }
  function begin(value: number) {
    inputGeneration = available(value) ? value : undefined
  }
  function edit(change: TreeEditorEdit, value: number) {
    if (!available(value)) return
    draft.value = editTreeEditor(draft.value, change)
    invalid.value = false
  }
  function input(index: number, field: 'id' | 'label', value: string | number, version: number) {
    if (inputGeneration === version)
      edit({ kind: 'text', index, field, value: String(value) }, version)
  }
  function apply(value: number) {
    if (!available(value)) return
    invalid.value = !validTreeEditor(config(), draft.value)
    if (!invalid.value) submit({ ...snapshot, value: structuredClone(draft.value) })
  }
  function cancel(value: number) {
    if (available(value)) restore()
  }
  const rows = computed(() =>
    draft.value.items.map((item, index) => ({ item, index, generation: generation.value }))
  )
  const dirty = computed(() => !isEqual(draft.value, treeEditorValue(config())))
  return { draft, rows, generation, invalid, dirty, begin, input, edit, apply, cancel }
}
