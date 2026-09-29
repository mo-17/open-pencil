import { isEqual } from 'es-toolkit'
import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import { useModuleScalarCommit, type ModuleScalarCommit } from '@/app/lowcode/module-editor/scalar'

import {
  editOrgChartDraft,
  orgChartDraft,
  orgChartDraftConfig,
  orgChartDraftValid,
  type OrgChartEdit
} from './index'

export function useOrgChartDraft(
  owner: () => SceneNode | undefined,
  config: () => JSONObject,
  commit: (request: ModuleScalarCommit) => void,
  active?: Readonly<Ref<boolean>>
) {
  const draft = shallowRef(orgChartDraft(config()))
  const generation = ref(0),
    invalid = ref(false)
  let focused = '',
    alive = true
  let snapshot: Pick<ModuleScalarCommit, 'owner' | 'previousModule'>
  const authority = useModuleScalarCommit(owner, config, commit, active)
  function reset() {
    focused = ''
    snapshot = {
      owner: owner(),
      previousModule: structuredClone(owner()?.interactiveProps?.module)
    }
    generation.value++
    draft.value = orgChartDraft(config())
    invalid.value = false
  }
  watch(() => [owner(), config(), active?.value], reset, { immediate: true, flush: 'sync' })
  onScopeDispose(() => {
    alive = false
    generation.value++
  })
  const validGeneration = (version: number) =>
    alive &&
    active?.value !== false &&
    !!owner() &&
    version === generation.value &&
    snapshot.owner === owner() &&
    isEqual(snapshot.previousModule, owner()?.interactiveProps?.module)
  function begin(id: string, field: string, version: number) {
    focused = validGeneration(version) ? `${id}:${field}` : ''
  }
  function edit(change: OrgChartEdit, version: number) {
    if (!validGeneration(version)) return
    draft.value = editOrgChartDraft(draft.value, change)
    invalid.value = false
  }
  function input(
    id: string,
    field: 'label' | 'description',
    value: string | number,
    version: number
  ) {
    if (focused === `${id}:${field}`)
      edit({ kind: 'text', id, field, value: String(value) }, version)
  }
  function apply(version: number) {
    if (!validGeneration(version) || !dirty.value) return
    invalid.value = !orgChartDraftValid(config(), draft.value)
    if (invalid.value) return
    authority.beginInput(authority.ownerGeneration.value)
    authority.submit({ kind: 'value', value: orgChartDraftConfig(config(), draft.value) })
  }
  const dirty = computed(() => !isEqual(draft.value, orgChartDraft(config())))
  const rows = computed(() =>
    draft.value.items.map((item) => ({ ...item, generation: generation.value }))
  )
  return {
    draft,
    rows,
    generation,
    invalid,
    dirty,
    begin,
    input,
    edit,
    apply,
    cancel(version: number) {
      if (validGeneration(version)) reset()
    }
  }
}
