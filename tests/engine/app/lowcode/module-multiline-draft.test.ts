import { expect, test } from 'bun:test'

import { effectScope, ref, shallowRef } from 'vue'

import { CODE_BLOCK_MODULE_DEFINITION } from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

import { useModuleTextDraft } from '@/app/lowcode/module-editor/multiline'
import type { ModuleScalarCommit } from '@/app/lowcode/module-editor/scalar'

import { expectDefined } from '#tests/helpers/assert'

test('multiline drafts expire on node/configuration changes, retention and disposal before late blur', () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const first = graph.createNode(
    'FRAME',
    page.id,
    CODE_BLOCK_MODULE_DEFINITION.createFrameOverrides()
  )
  const second = graph.createNode(
    'FRAME',
    page.id,
    CODE_BLOCK_MODULE_DEFINITION.createFrameOverrides()
  )
  const owner = shallowRef(first)
  const config = shallowRef({ code: 'original' })
  const active = ref(true)
  const requests: ModuleScalarCommit[] = []
  const scope = effectScope()
  const draft = expectDefined(
    scope.run(() =>
      useModuleTextDraft(
        () => owner.value,
        () => config.value,
        () => config.value.code,
        () => 40,
        active,
        (request) => requests.push(request)
      )
    )
  )
  if (!draft) throw new Error('Missing multiline draft')
  function edit(value: string) {
    const generation = draft.generation.value
    draft.beginInput(generation)
    draft.update(value, generation)
    return generation
  }
  try {
    const accepted = edit('line 1\n中文 line 2')
    draft.submit(accepted)
    draft.submit(accepted)
    expect(requests).toHaveLength(1)
    expect(requests[0].owner).toBe(first)
    expect(requests[0].value).toEqual({ kind: 'value', value: 'line 1\n中文 line 2' })
    requests.length = 0

    const oldNode = edit('stale first node')
    owner.value = second
    draft.beginInput(oldNode)
    draft.update('late input', oldNode)
    draft.submit(oldNode)
    expect(draft.draft.value).toBe('original')
    expect(requests).toEqual([])

    const oldConfig = edit('stale configuration')
    config.value = { code: 'external edit' }
    draft.submit(oldConfig)
    expect(draft.draft.value).toBe('external edit')
    expect(requests).toEqual([])

    const retained = edit('discarded draft')
    active.value = false
    draft.submit(retained)
    active.value = true
    draft.beginInput(retained)
    draft.submit(retained)
    expect(draft.draft.value).toBe('external edit')
    expect(requests).toEqual([])

    draft.submit(edit('x'.repeat(41)))
    expect(requests).toEqual([])
    const disposed = edit('disposed draft')
    scope.stop()
    draft.submit(disposed)
    expect(requests).toEqual([])
  } finally {
    scope.stop()
  }
})

test('multiline source editing also works outside a retained panel provider', () => {
  const graph = new SceneGraph()
  const owner = graph.createNode(
    'FRAME',
    graph.getPages()[0].id,
    CODE_BLOCK_MODULE_DEFINITION.createFrameOverrides()
  )
  const config = { code: 'before' }
  const requests: ModuleScalarCommit[] = []
  const scope = effectScope()
  const draft = expectDefined(
    scope.run(() =>
      useModuleTextDraft(
        () => owner,
        () => config,
        () => config.code,
        () => 40,
        undefined,
        (request) => requests.push(request)
      )
    )
  )
  if (!draft) throw new Error('Missing multiline draft')
  try {
    draft.beginInput(draft.generation.value)
    draft.update('after', draft.generation.value)
    draft.submit(draft.generation.value)
    expect(requests[0]?.value).toEqual({ kind: 'value', value: 'after' })
  } finally {
    scope.stop()
  }
})
