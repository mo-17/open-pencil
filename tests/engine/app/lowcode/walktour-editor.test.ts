import { expect, test } from 'bun:test'

import { effectScope, ref, shallowRef } from 'vue'

import { createEditor } from '@open-pencil/core/editor'
import {
  createWalktourModuleFrameOverrides,
  createWalktourModuleInstance,
  resolveWalktourModule
} from '@open-pencil/core/plugins'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import type { ModuleScalarCommit } from '@/app/lowcode/module-editor/scalar'
import {
  editWalktourSteps,
  walktourSteps,
  walktourStepsValid,
  walktourChildTargets,
  walktourTargetOptions,
  walktourTargetValue
} from '@/app/lowcode/walktour-editor'
import { useWalktourDraft } from '@/app/lowcode/walktour-editor/use'

import { expectDefined } from '#tests/helpers/assert'

function fixture() {
  const editor = createEditor()
  const node = editor.graph.createNode(
    'FRAME',
    editor.state.currentPageId,
    createWalktourModuleFrameOverrides()
  )
  const resolved = resolveWalktourModule(node.interactiveProps?.module)
  if (!resolved?.ok) throw new Error('Missing tour module')
  const owner = shallowRef(node),
    config = shallowRef<JSONObject>(resolved.config),
    active = ref(true),
    scope = effectScope(),
    requests: ModuleScalarCommit[] = []
  const draft = scope.run(() =>
    useWalktourDraft(
      () => owner.value,
      () => config.value,
      (request) => requests.push(request),
      active
    )
  )
  if (!draft) throw new Error('Missing tour draft')
  return {
    editor,
    owner,
    config,
    active,
    scope,
    requests,
    draft,
    dispose() {
      scope.stop()
      editor.dispose()
    }
  }
}

test('Walktour editing preserves step identities and limits, with independent overview steps', () => {
  const f = fixture()
  try {
    const original = walktourSteps(f.config.value)
    let steps = original
    for (let index = 0; index < 20; index++)
      steps = editWalktourSteps(steps, { kind: 'add', title: 'New' })
    expect(steps).toHaveLength(12)
    expect(new Set(steps.map((step) => step.id)).size).toBe(12)
    expect(walktourStepsValid(steps)).toBe(true)
    const moved = editWalktourSteps(steps, { kind: 'move', id: steps[0].id, offset: 1 })
    expect(moved[1]).toEqual(steps[0])
    expect(editWalktourSteps(steps, { kind: 'move', id: steps[0].id, offset: -1 })).toEqual(steps)
    for (let index = 0; index < 20; index++)
      steps = editWalktourSteps(steps, { kind: 'remove', id: steps[0].id })
    expect(steps).toHaveLength(1)
    expect(original).toHaveLength(3)
    expect(walktourStepsValid([{ ...original[0], title: ' ' }])).toBe(false)
    expect(walktourStepsValid(original.map((step) => ({ ...step, targetChildName: 'Card' })))).toBe(
      false
    )
  } finally {
    f.dispose()
  }
})

test('Walktour target options use unique visible direct children and retain unavailable names explicitly', () => {
  const f = fixture()
  try {
    const graph = f.editor.graph,
      root = f.owner.value
    const card = graph.createNode('FRAME', root.id, { name: 'Card' })
    graph.createNode('FRAME', card.id, { name: 'Nested' })
    graph.createNode('FRAME', root.id, { name: 'Hidden', visible: false })
    graph.createNode('FRAME', root.id, { name: 'Duplicate' })
    graph.createNode('FRAME', root.id, { name: 'Duplicate' })
    const steps = walktourSteps(f.config.value)
    steps[0].targetChildName = 'Missing'
    steps[1].targetChildName = 'Card'
    const children = walktourChildTargets(graph, root)
    expect(children).toEqual([
      { value: 'Card', label: 'Card', disabled: false },
      { value: 'Hidden', label: 'Hidden', disabled: true },
      { value: 'Duplicate', label: 'Duplicate', disabled: true }
    ])
    const options = walktourTargetOptions(steps, steps[0].id, children, 'Overview', 'Unavailable')
    expect(options).toContainEqual({
      value: 'child:Missing',
      label: 'Unavailable: Missing',
      disabled: true
    })
    expect(options).toContainEqual({ value: 'child:Card', label: 'Card', disabled: true })
    expect(options[0]).toEqual({ value: 'overview', label: 'Overview' })
    expect(walktourTargetValue('overview')).toBe('child:overview')
    expect(walktourTargetValue('#card > button')).toBe('child:#card > button')
    graph.updateNode(card.id, { name: 'Renamed card' })
    const renamed = walktourTargetOptions(
      steps,
      steps[1].id,
      walktourChildTargets(graph, root),
      'Overview',
      'Unavailable'
    )
    expect(renamed).toContainEqual({
      value: 'child:Card',
      label: 'Unavailable: Card',
      disabled: true
    })
    expect(steps[1].targetChildName).toBe('Card')
  } finally {
    f.dispose()
  }
})

for (const boundary of [
  'owner',
  'same-id',
  'config',
  'retained',
  'cancel',
  'dispose',
  'external-module'
] as const)
  test(`Walktour discards late input/apply authority across ${boundary}`, () => {
    const f = fixture()
    try {
      const d = f.draft,
        old = d.version.value,
        id = d.steps.value[0].id
      d.begin(id, 'title', old)
      d.input(id, 'title', 'Old draft', old)
      if (boundary === 'owner')
        f.owner.value = f.editor.graph.createNode(
          'FRAME',
          f.editor.state.currentPageId,
          createWalktourModuleFrameOverrides()
        )
      if (boundary === 'same-id') f.owner.value = structuredClone(f.owner.value)
      if (boundary === 'config') f.config.value = { ...f.config.value, triggerLabel: 'Changed' }
      if (boundary === 'retained') {
        f.active.value = false
        f.active.value = true
      }
      if (boundary === 'cancel') d.cancel(old)
      if (boundary === 'dispose') f.scope.stop()
      if (boundary === 'external-module')
        expectDefined(f.owner.value.interactiveProps).module = createWalktourModuleInstance({
          triggerLabel: 'External'
        })
      const current = d.version.value
      d.begin(id, 'title', current)
      d.input(id, 'title', 'Fresh', current)
      d.input(id, 'title', 'Late', old)
      d.apply(old)
      expect(f.requests).toEqual([])
      if (!['dispose', 'external-module'].includes(boundary)) {
        expect(d.steps.value[0].title).toBe('Fresh')
        d.apply(current)
        expect(f.requests).toHaveLength(1)
        expect(f.requests[0].owner).toBe(f.owner.value)
      }
    } finally {
      f.dispose()
    }
  })

test('Walktour preserves invalid drafts and submits an isolated steps array only after explicit apply', () => {
  const f = fixture()
  try {
    const d = f.draft,
      version = d.version.value,
      id = d.steps.value[0].id
    d.begin(id, 'title', version)
    d.input(id, 'title', '', version)
    d.apply(version)
    expect(d.invalid.value).toBe(true)
    expect(d.steps.value[0].title).toBe('')
    expect(f.requests).toHaveLength(0)
    d.input(id, 'title', 'Welcome', version)
    d.begin(id, 'content', version)
    d.input(id, 'content', '第一行\nSecond line', version)
    d.apply(version)
    expect(f.requests).toHaveLength(1)
    expect(f.requests[0].value).toEqual({ kind: 'value', value: d.steps.value })
    d.input(id, 'content', 'Unsaved follow-up', version)
    expect(f.requests[0].value).not.toEqual({ kind: 'value', value: d.steps.value })
  } finally {
    f.dispose()
  }
})
