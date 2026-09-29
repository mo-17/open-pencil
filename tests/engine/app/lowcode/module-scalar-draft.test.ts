import { expect, test } from 'bun:test'

import { effectScope, ref, shallowRef } from 'vue'

import { createSliderModuleFrameOverrides } from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

import { useModuleScalarCommit, type ModuleScalarCommit } from '@/app/lowcode/module-editor/scalar'

test('numeric and text scalar commits retain the original authority and expire before late blur', () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const first = graph.createNode('FRAME', page.id, createSliderModuleFrameOverrides())
  const second = graph.createNode('FRAME', page.id, createSliderModuleFrameOverrides())
  const owner = shallowRef(first)
  const config = shallowRef({ initialValue: 30 })
  const active = ref(true)
  const scope = effectScope()
  const requests: ModuleScalarCommit[] = []
  const input = scope.run(() =>
    useModuleScalarCommit(
      () => owner.value,
      () => config.value,
      (request) => requests.push(request),
      active
    )
  )
  if (!input) throw new Error('Missing scalar editor')
  try {
    input.beginInput(input.ownerGeneration.value)
    input.submit({ kind: 'value', value: 35 })
    expect(requests[0].owner).toBe(first)
    expect(requests[0].previousModule).toEqual(first.interactiveProps?.module)
    requests.length = 0
    input.beginInput(input.ownerGeneration.value)
    owner.value = second
    expect(input.ownerGeneration.value).toBe(1)
    input.submit({ kind: 'value', value: 99 })
    expect(requests).toEqual([])
    input.beginInput(input.ownerGeneration.value)
    const staleGeneration = input.ownerGeneration.value
    config.value = { initialValue: 40 }
    // A late Tab/Enter from the old DOM must not acquire the new configuration's authority.
    input.beginInput(staleGeneration)
    input.submit({ kind: 'value', value: 99 })
    expect(requests).toEqual([])
    input.beginInput(input.ownerGeneration.value)
    active.value = false
    input.submit({ kind: 'value', value: 99 })
    expect(requests).toEqual([])
    active.value = true
    input.beginInput(input.ownerGeneration.value)
    scope.stop()
    input.submit({ kind: 'value', value: 99 })
    expect(requests).toEqual([])
  } finally {
    scope.stop()
  }
})
