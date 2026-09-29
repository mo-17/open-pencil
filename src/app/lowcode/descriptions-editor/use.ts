import { isEqual } from 'es-toolkit'
import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'

import { DESCRIPTIONS_MODULE_LIMITS } from '@open-pencil/core/plugins'
import type { SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import { useModuleScalarCommit, type ModuleScalarCommit } from '@/app/lowcode/module-editor/scalar'

import { descriptionsDraftValid, descriptionsRows, nextDescriptionsId } from './index'

/** Apply an entire label/value draft in one existing module transaction. */
export function useDescriptionsDraft(
  owner: () => SceneNode | undefined,
  config: () => JSONObject,
  commit: (request: ModuleScalarCommit) => void,
  active?: Readonly<Ref<boolean>>
) {
  const rows = shallowRef(descriptionsRows(config())),
    generation = ref(0),
    invalid = ref(false)
  const dirty = computed(() => !isEqual(rows.value, descriptionsRows(config())))
  let snapshot: Pick<ModuleScalarCommit, 'owner' | 'previousModule'> | undefined
  const authority = useModuleScalarCommit(
    owner,
    config,
    (request) => {
      if (
        snapshot?.owner === request.owner &&
        isEqual(snapshot?.previousModule, request.previousModule)
      )
        commit(request)
    },
    active
  )
  let inputId: string | undefined,
    disposed = false
  function restore() {
    generation.value++
    inputId = undefined
    invalid.value = false
    rows.value = descriptionsRows(config())
    snapshot = {
      owner: owner(),
      previousModule: structuredClone(owner()?.interactiveProps?.module)
    }
  }
  watch(() => [owner(), config(), active?.value], restore, { flush: 'sync', immediate: true })
  onScopeDispose(() => {
    disposed = true
    inputId = undefined
  })
  function available(rendered: number) {
    return !disposed && active?.value !== false && !!owner() && rendered === generation.value
  }
  function begin(id: string, rendered: number) {
    inputId = available(rendered) ? id : undefined
  }
  function input(id: string, field: 'label' | 'value', value: string | number, rendered: number) {
    if (!available(rendered) || inputId !== id) return
    rows.value = rows.value.map((row) => (row.id === id ? { ...row, [field]: String(value) } : row))
    invalid.value = false
  }
  function add(label: string, rendered: number) {
    if (!available(rendered) || rows.value.length >= DESCRIPTIONS_MODULE_LIMITS.itemsMax) return
    rows.value = [...rows.value, { id: nextDescriptionsId(rows.value), label, value: '' }]
    inputId = undefined
    invalid.value = false
  }
  function remove(id: string, rendered: number) {
    if (!available(rendered) || rows.value.length <= 1) return
    rows.value = rows.value.filter((row) => row.id !== id)
    inputId = undefined
    invalid.value = false
  }
  function cancel(rendered: number) {
    if (available(rendered)) restore()
  }
  function apply(rendered: number) {
    if (!available(rendered) || !dirty.value) return
    invalid.value = !descriptionsDraftValid(config(), rows.value)
    if (invalid.value) return
    authority.beginInput(authority.ownerGeneration.value)
    authority.submit({ kind: 'value', value: rows.value.map((row) => ({ ...row })) })
  }
  return { rows, generation, invalid, dirty, begin, input, add, remove, cancel, apply }
}
