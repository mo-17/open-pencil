import { expect, test } from 'bun:test'

import type { DocumentStateDef } from '@open-pencil/scene-graph'

import { createApplicationPreviewStateCache } from '@/app/lowcode/preview-pane/application-state'

import { applicationModeFixture } from '#tests/helpers/compiler/application-mode/fixture'

function fixture(declarations?: DocumentStateDef[]) {
  const data = applicationModeFixture(true)
  if (declarations) data.graph.updateNode(data.graph.rootId, { lowcodeDocumentState: declarations })
  return { ...data, cache: createApplicationPreviewStateCache() }
}

test('application runtime changes survive same-graph recompiles without mutating design defaults', () => {
  const { graph, homeEntry, cache } = fixture()
  const before = structuredClone(graph.getNode(graph.rootId)?.lowcodeDocumentState)
  expect(cache.accept(graph, 'react', 'sharedCount', 1)).toBe(true)
  graph.updateNode(homeEntry.id, { width: 390 })
  expect(cache.synchronize(graph, 'react')).toBe(true)
  expect(cache.entries(graph, 'react')).toEqual([{ name: 'sharedCount', value: 1 }])
  expect(graph.getNode(graph.rootId)?.lowcodeDocumentState).toEqual(before)
  cache.clear()
  expect(cache.entries(graph, 'react')).toEqual([])
})

test('graph, target, default declarations and application validity bound cache ownership', () => {
  const { graph, products, cache } = fixture()
  expect(cache.accept(graph, 'react', 'sharedCount', 1)).toBe(true)
  const second = applicationModeFixture(true)
  expect(cache.entries(second.graph, 'react')).toEqual([])
  expect(cache.accept(graph, 'react', 'sharedCount', 2)).toBe(true)
  expect(cache.entries(graph, 'vue')).toEqual([])
  expect(cache.entries(graph, 'react')).toEqual([])
  expect(cache.accept(graph, 'react', 'sharedCount', 3)).toBe(true)
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [
      { id: 'shared-count', name: 'sharedCount', type: 'number', defaultValue: 5 }
    ]
  })
  expect(cache.entries(graph, 'react')).toEqual([])
  expect(cache.accept(graph, 'react', 'sharedCount', 6)).toBe(true)
  graph.updateNode(graph.rootId, { lowcodeApplication: { version: 1, enabled: false } })
  expect(cache.entries(graph, 'react')).toEqual([])
  expect(cache.accept(graph, 'react', 'sharedCount', 7)).toBe(false)
  graph.updateNode(graph.rootId, { lowcodeApplication: { version: 1, enabled: true } })
  expect(cache.accept(graph, 'react', 'sharedCount', 8)).toBe(true)
  graph.updateNode(products.id, {
    lowcodeApplicationPage: { version: 1, role: 'application', entryNodeId: 'missing' }
  })
  expect(cache.entries(graph, 'react')).toEqual([])
  expect(cache.accept(graph, 'react', 'sharedCount', 9)).toBe(false)
})

test('accepted values and returned snapshots are detached and limited to declared document types', () => {
  const { graph, cache } = fixture([
    { id: 'obj', name: 'settings', type: 'object', defaultValue: {} },
    { id: 'arr', name: 'items', type: 'array', defaultValue: [] },
    { id: 'bool', name: 'flag', type: 'boolean', defaultValue: true },
    { id: 'text', name: 'title', type: 'string', defaultValue: 'initial' },
    { id: 'num', name: 'count', type: 'number', defaultValue: 0 }
  ])
  const object = { nested: { count: 1 } }
  const array = [1, { title: 'initial' }]
  expect(cache.accept(graph, 'react', 'settings', object)).toBe(true)
  expect(cache.accept(graph, 'react', 'items', array)).toBe(true)
  expect(cache.accept(graph, 'react', 'flag', false)).toBe(true)
  expect(cache.accept(graph, 'react', 'title', '')).toBe(true)
  expect(cache.accept(graph, 'react', 'count', -0)).toBe(true)
  object.nested.count = 99
  array.push(3)
  const snapshots = cache.entries(graph, 'react')
  expect(snapshots).toEqual([
    { name: 'settings', value: { nested: { count: 1 } } },
    { name: 'items', value: [1, { title: 'initial' }] },
    { name: 'flag', value: false },
    { name: 'title', value: '' },
    { name: 'count', value: -0 }
  ])
  const settings = snapshots[0].value as { nested: { count: number } }
  settings.nested.count = 10
  expect(cache.entries(graph, 'react')[0]).toEqual({
    name: 'settings',
    value: { nested: { count: 1 } }
  })
  expect(cache.accept(graph, 'react', 'unknown', 1)).toBe(false)
  expect(cache.accept(graph, 'react', 'settings', null)).toBe(false)
  expect(cache.accept(graph, 'react', 'items', {})).toBe(false)
  expect(cache.accept(graph, 'react', 'flag', 1)).toBe(false)
  expect(cache.accept(graph, 'react', 'title', false)).toBe(false)
  expect(cache.accept(graph, 'react', 'count', Number.NaN)).toBe(false)
  expect(cache.entries(graph, 'react')).toEqual([])
})

test('portable protocol rejection removes an old snapshot without evaluating accessors', () => {
  const { graph, cache } = fixture([
    { id: 'obj', name: 'settings', type: 'object', defaultValue: {} }
  ])
  let reads = 0
  const accessor = Object.defineProperty({}, 'unsafe', {
    enumerable: true,
    get() {
      reads += 1
      return 'do not read'
    }
  })
  const cycle: Record<string, unknown> = {}
  cycle.self = cycle
  const sparse: unknown[] = []
  sparse.length = 1
  const inputs = [accessor, cycle, { values: sparse }, { fn: () => 1 }, new Date(), { x: Infinity }]
  for (const input of inputs) {
    expect(cache.accept(graph, 'react', 'settings', { safe: true })).toBe(true)
    expect(cache.accept(graph, 'react', 'settings', input)).toBe(false)
    expect(cache.entries(graph, 'react')).toEqual([])
  }
  expect(reads).toBe(0)
})

test('cache enforces 64 slots and replaces existing keys without using an extra slot', () => {
  const declarations: DocumentStateDef[] = Array.from({ length: 65 }, (_, index) => ({
    id: `state-${index}`,
    name: `value${index}`,
    type: 'number',
    defaultValue: 0
  }))
  const { graph, cache } = fixture(declarations)
  for (let index = 0; index < 64; index++)
    expect(cache.accept(graph, 'react', `value${index}`, index)).toBe(true)
  expect(cache.accept(graph, 'react', 'value64', 64)).toBe(false)
  expect(cache.entries(graph, 'react')).toHaveLength(64)
  expect(cache.accept(graph, 'react', 'value0', 100)).toBe(true)
  expect(cache.entries(graph, 'react')[0]).toEqual({ name: 'value0', value: 100 })
})

test('aggregate UTF-8 JSON budget cannot retain a stale value after an overflowing update', () => {
  const declarations: DocumentStateDef[] = Array.from({ length: 16 }, (_, index) => ({
    id: `state-${index}`,
    name: `value${index}`,
    type: 'string',
    defaultValue: ''
  }))
  const { graph, cache } = fixture(declarations)
  const large = 'x'.repeat(65_536)
  for (let index = 0; index < 15; index++)
    expect(cache.accept(graph, 'react', `value${index}`, large)).toBe(true)
  expect(cache.accept(graph, 'react', 'value15', 'short')).toBe(true)
  expect(cache.accept(graph, 'react', 'value15', large)).toBe(false)
  expect(cache.entries(graph, 'react').some((entry) => entry.name === 'value15')).toBe(false)
  expect(cache.accept(graph, 'react', 'value0', 'x'.repeat(65_537))).toBe(false)
  expect(cache.entries(graph, 'react').some((entry) => entry.name === 'value0')).toBe(false)
  expect(cache.accept(graph, 'react', 'value15', large)).toBe(true)
})
