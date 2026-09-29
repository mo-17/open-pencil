import { isEqual } from 'es-toolkit'
import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import type { ModuleScalarCommit } from '@/app/lowcode/module-editor/scalar'

import {
  editWalktourSteps,
  walktourSteps,
  walktourStepsValid,
  type WalktourStepEdit
} from './index'

export function useWalktourDraft(
  owner: () => SceneNode | undefined,
  config: () => JSONObject,
  send: (request: ModuleScalarCommit) => void,
  active?: Readonly<Ref<boolean>>
) {
  let serial = 0,
    focused = '',
    disposed = false
  const capture = () => ({
    version: ++serial,
    owner: owner(),
    previousModule: structuredClone(owner()?.interactiveProps?.module),
    steps: walktourSteps(config())
  })
  const session = shallowRef(capture()),
    invalid = ref(false)
  const reset = () => {
    focused = ''
    invalid.value = false
    session.value = capture()
  }
  watch(() => [owner(), config(), active?.value], reset, { flush: 'sync' })
  onScopeDispose(() => {
    disposed = true
    focused = ''
  })
  function authorized(version: number) {
    const saved = session.value
    return (
      !disposed &&
      active?.value !== false &&
      saved.version === version &&
      !!saved.owner &&
      saved.owner === owner() &&
      isEqual(saved.previousModule, owner()?.interactiveProps?.module)
    )
  }
  function edit(change: WalktourStepEdit, version: number) {
    if (authorized(version)) {
      session.value = { ...session.value, steps: editWalktourSteps(session.value.steps, change) }
      invalid.value = false
    }
  }
  const dirty = computed(() => !isEqual(session.value.steps, walktourSteps(config())))
  return {
    steps: computed(() => session.value.steps),
    version: computed(() => session.value.version),
    invalid,
    dirty,
    rows: computed(() =>
      session.value.steps.map((step) => ({ ...step, version: session.value.version }))
    ),
    begin(id: string, field: string, version: number) {
      focused = authorized(version) ? `${id}:${field}` : ''
    },
    input(id: string, field: 'title' | 'content', value: string | number, version: number) {
      if (focused === `${id}:${field}`)
        edit({ kind: 'field', id, field, value: String(value) }, version)
    },
    edit,
    cancel(version: number) {
      if (authorized(version)) reset()
    },
    apply(version: number) {
      if (!authorized(version) || !dirty.value) return
      invalid.value = !walktourStepsValid(session.value.steps)
      if (invalid.value) return
      const { owner, previousModule, steps } = session.value
      send({ owner, previousModule, value: { kind: 'value', value: structuredClone(steps) } })
    }
  }
}
