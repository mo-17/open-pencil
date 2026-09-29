import { isEqual } from 'es-toolkit'
import { onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import type { ModuleEditorCommit } from './owner'

interface ModuleEditorDraftOperations<Value, Edit, Field extends string> {
  read: (config: JSONObject) => Value
  copy: (value: Value) => Value
  edit: (value: Value, change: Edit) => Value
  valid: (config: JSONObject, value: Value) => boolean
  inputEdit: (index: number, field: Field, value: string) => Edit
}

/** Controlled module drafts expire synchronously before a retained panel can emit late blur. */
export function useModuleEditorDraft<Value, Edit, Field extends string>(
  getOwner: () => SceneNode | undefined,
  getConfig: () => JSONObject,
  commitRequest: (request: ModuleEditorCommit<Value>) => void,
  operations: ModuleEditorDraftOperations<Value, Edit, Field>,
  active?: Readonly<Ref<boolean>>
) {
  const draft = shallowRef(operations.read(getConfig()))
  const invalid = ref(false)
  let draftOwner = getOwner()
  let previousModule = structuredClone(draftOwner?.interactiveProps?.module)
  let inputOwner: SceneNode | undefined
  let disposed = false

  function restore(): void {
    inputOwner = undefined
    draftOwner = getOwner()
    previousModule = structuredClone(draftOwner?.interactiveProps?.module)
    draft.value = operations.read(getConfig())
    invalid.value = false
  }
  watch(() => [getOwner(), getConfig(), active?.value], restore, { flush: 'sync' })
  onScopeDispose(() => {
    disposed = true
    inputOwner = undefined
  })

  function available(): boolean {
    return !disposed && active?.value !== false && !!draftOwner && draftOwner === getOwner()
  }
  function beginInput(): void {
    inputOwner = available() ? draftOwner : undefined
  }
  function input(index: number, field: Field, value: string | number): void {
    if (!available() || inputOwner !== draftOwner) return
    draft.value = operations.edit(draft.value, operations.inputEdit(index, field, String(value)))
  }
  function commit(): void {
    if (!available() || isEqual(draft.value, operations.read(getConfig()))) return
    invalid.value = !operations.valid(getConfig(), draft.value)
    if (!invalid.value)
      commitRequest({ owner: draftOwner, previousModule, value: operations.copy(draft.value) })
  }
  function edit(change: Edit): void {
    if (!available()) return
    draft.value = operations.edit(draft.value, change)
    commit()
  }

  return { draft, invalid, restore, beginInput, input, commit, edit }
}
