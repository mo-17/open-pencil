import { expect, test } from 'bun:test'

import { effectScope, ref, shallowRef } from 'vue'

import { createEditor } from '@open-pencil/core/editor'
import {
  createDescriptionsModuleFrameOverrides,
  DESCRIPTIONS_MODULE_DEFAULT_CONFIG
} from '@open-pencil/core/plugins'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import {
  descriptionsDraftValid,
  descriptionsRows,
  nextDescriptionsId
} from '@/app/lowcode/descriptions-editor'
import { useDescriptionsDraft } from '@/app/lowcode/descriptions-editor/use'
import type { ModuleScalarCommit } from '@/app/lowcode/module-editor/scalar'

test('descriptions boundary rejects malformed item fields without converting them into display text', () => {
  const valid = { id: 'item-1', label: 'Label', value: 'First line\nSecond line' }
  for (const malformed of [
    null,
    [],
    3,
    'text',
    {},
    { ...valid, id: 3 },
    { ...valid, label: { nested: 'text' } },
    { ...valid, value: ['text'] },
    { ...valid, value: false },
    { id: 'item-2', label: 'Missing value' }
  ]) {
    const config = { items: [valid, malformed] }
    const before = structuredClone(config)
    expect(descriptionsRows(config)).toEqual([])
    expect(config).toEqual(before)
  }
  expect(descriptionsRows({ items: { label: 'Not an array' } })).toEqual([])
  const rows = descriptionsRows({ items: [valid] })
  expect(rows).toEqual([valid])
  rows[0].value = 'Draft only'
  expect(valid.value).toBe('First line\nSecond line')
})

function fixture() {
  const editor = createEditor(),
    owner = shallowRef(
      editor.graph.createNode(
        'FRAME',
        editor.state.currentPageId,
        createDescriptionsModuleFrameOverrides()
      )
    )
  const config = shallowRef<JSONObject>(structuredClone(DESCRIPTIONS_MODULE_DEFAULT_CONFIG)),
    active = ref(true),
    requests: ModuleScalarCommit[] = [],
    scope = effectScope()
  const draft = scope.run(() =>
    useDescriptionsDraft(
      () => owner.value,
      () => config.value,
      (request) => requests.push(request),
      active
    )
  )
  if (!draft) throw new Error('Missing descriptions draft')
  return {
    editor,
    owner,
    config,
    active,
    requests,
    draft,
    scope,
    dispose() {
      scope.stop()
      editor.dispose()
    }
  }
}

for (const boundary of ['cancel', 'config', 'retained'] as const) {
  test(`descriptions ${boundary} rejects an old input even after the replacement with the same ID takes focus`, () => {
    const f = fixture()
    try {
      const d = f.draft,
        id = d.rows.value[0].id,
        oldGeneration = d.generation.value
      d.begin(id, oldGeneration)
      d.input(id, 'value', 'Old draft', oldGeneration)
      if (boundary === 'cancel') d.cancel(oldGeneration)
      if (boundary === 'config') f.config.value = { ...f.config.value, columns: 1 }
      if (boundary === 'retained') {
        f.active.value = false
        f.active.value = true
      }
      const freshGeneration = d.generation.value
      expect(freshGeneration).not.toBe(oldGeneration)
      d.begin(id, freshGeneration)
      d.input(id, 'value', 'Current draft', freshGeneration)
      d.input(id, 'value', 'Late old event', oldGeneration)
      d.input(id, 'label', 'Late old label', oldGeneration)
      expect(d.rows.value[0]).toMatchObject({ label: 'Name', value: 'Current draft' })
      d.apply(freshGeneration)
      expect(f.requests).toHaveLength(1)
      expect(f.requests[0].value).toEqual({ kind: 'value', value: d.rows.value })
    } finally {
      f.dispose()
    }
  })
}
test('descriptions drafts preserve invalid labels, multiline values and stable IDs until explicit apply', () => {
  const f = fixture()
  try {
    const d = f.draft,
      gen = d.generation.value,
      id = d.rows.value[0].id
    d.begin(id, gen)
    d.input(id, 'label', ' ', gen)
    d.input(id, 'value', '第一行\nSecond line', gen)
    d.apply(gen)
    expect(d.invalid.value).toBe(true)
    expect(f.requests).toEqual([])
    expect(d.rows.value[0].value).toBe('第一行\nSecond line')
    d.input(id, 'label', '项目', gen)
    d.apply(gen)
    expect(f.requests).toHaveLength(1)
    expect(f.requests[0].value).toEqual({ kind: 'value', value: d.rows.value })
    expect(d.rows.value[0]).toEqual({ id, label: '项目', value: '第一行\nSecond line' })
    d.cancel(gen)
    expect(d.dirty.value).toBe(false)
    for (let i = 0; i < 30; i++) d.add('Item', d.generation.value)
    expect(d.rows.value).toHaveLength(24)
    expect(new Set(d.rows.value.map((r) => r.id)).size).toBe(24)
    for (let i = 0; i < 30; i++) d.remove(d.rows.value[0].id, d.generation.value)
    expect(d.rows.value).toHaveLength(1)
    expect(
      nextDescriptionsId([
        { id: 'item-1', label: 'A', value: '' },
        { id: 'item-3', label: 'B', value: '' }
      ])
    ).toBe('item-2')
    expect(
      descriptionsDraftValid(f.config.value, [{ id: 'x', label: 'A', value: 'x'.repeat(1001) }])
    ).toBe(false)
  } finally {
    f.dispose()
  }
})
for (const boundary of [
  'selection',
  'replacement',
  'config',
  'pause',
  'disposal',
  'late-module'
] as const) {
  test(`descriptions ${boundary} rejects obsolete input and apply events`, () => {
    const f = fixture()
    try {
      const d = f.draft,
        gen = d.generation.value,
        id = d.rows.value[0].id
      d.begin(id, gen)
      d.input(id, 'value', 'Pending', gen)
      if (boundary === 'selection')
        f.owner.value = f.editor.graph.createNode(
          'FRAME',
          f.editor.state.currentPageId,
          createDescriptionsModuleFrameOverrides()
        )
      if (boundary === 'replacement') f.owner.value = structuredClone(f.owner.value)
      if (boundary === 'config') f.config.value = { ...f.config.value, columns: 1 }
      if (boundary === 'pause') {
        f.active.value = false
        f.active.value = true
      }
      if (boundary === 'disposal') f.scope.stop()
      if (boundary === 'late-module')
        f.editor.graph.updateNode(
          f.owner.value.id,
          createDescriptionsModuleFrameOverrides({ columns: 1 })
        )
      d.begin(id, gen)
      d.input(id, 'label', 'Late', gen)
      d.apply(gen)
      expect(f.requests).toEqual([])
    } finally {
      f.dispose()
    }
  })
}
