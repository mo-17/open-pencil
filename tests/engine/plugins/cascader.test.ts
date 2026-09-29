import { expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { exportFigFile } from '#core/io/formats/fig'
import { initCodec, parseFigFile } from '#core/kiwi'
import {
  CASCADER_MODULE_DEFAULT_CONFIG,
  createCascaderModuleFrameOverrides,
  createCascaderModuleInstance,
  parseCascaderItems,
  parseCascaderPath,
  resolveCascaderModule
} from '#core/plugins/cascader'

const item = (id: string, parentId = '', disabled = false) => ({
  id,
  parentId,
  label: id,
  disabled
})
test('Cascader preserves strict FRAME/v1 identity with independent immutable defaults', () => {
  const module = createCascaderModuleInstance()
  expect(createCascaderModuleFrameOverrides()).toMatchObject({
    width: 320,
    height: 44,
    layoutMode: 'NONE',
    interactiveProps: { module }
  })
  expect(Object.isFrozen(CASCADER_MODULE_DEFAULT_CONFIG.items)).toBe(true)
  expect(Object.isFrozen(CASCADER_MODULE_DEFAULT_CONFIG.items[0])).toBe(true)
  const first = createCascaderModuleInstance({ initialPath: ['asia', 'china', 'xiamen'] })
  expect(first.config).not.toBe(module.config)
  expect(resolveCascaderModule({ ...module, pluginId: 'foreign.cascader' })).toBeNull()
  expect(resolveCascaderModule({ ...module, configVersion: 2 })?.ok).toBe(false)
  for (const config of [
    { lazy: true },
    { remoteUrl: 'https://example.invalid' },
    { onChange: [] },
    { multiple: true }
  ])
    expect(() => createCascaderModuleInstance(config)).toThrow()
})

test('Cascader reuses bounded tree validation and rejects ambiguous or disabled initial paths', () => {
  for (const items of [
    [],
    [item('a'), item('a')],
    [item('a', 'missing')],
    [item('a', 'b'), item('b', 'a')],
    Array.from({ length: 7 }, (_, i) => item('n' + i, i ? 'n' + (i - 1) : '')),
    Array.from({ length: 129 }, (_, i) => item('n' + i))
  ])
    expect(() => parseCascaderItems(items)).toThrow()
  const items = [item('a'), item('b', 'a'), item('c', '', true), item('d', 'c')]
  expect(parseCascaderPath(items, [])).toEqual([])
  expect(parseCascaderPath(items, ['a', 'b'])).toEqual(['a', 'b'])
  for (const path of [
    ['a'],
    ['b'],
    ['b', 'a'],
    ['a', 'missing'],
    ['c', 'd'],
    ['a', 'a'],
    'b',
    undefined,
    null
  ]) {
    expect(parseCascaderPath(items, path)).toBeNull()
    expect(() => createCascaderModuleInstance({ items, initialPath: path })).toThrow()
  }
  expect(parseCascaderItems(Array.from({ length: 128 }, (_, i) => item('n' + i)))).toHaveLength(128)
  const six = Array.from({ length: 6 }, (_, i) => item('n' + i, i ? 'n' + (i - 1) : ''))
  expect(
    parseCascaderPath(
      six,
      six.map((entry) => entry.id)
    )
  ).toHaveLength(6)
})

test('Cascader accepts only own bounded data and never reads hidden getters', () => {
  let calls = 0
  const unsafe = { ...item('a') }
  Object.defineProperty(unsafe, 'label', {
    enumerable: true,
    get() {
      calls++
      return 'unsafe'
    }
  })
  expect(() => parseCascaderItems([unsafe])).toThrow()
  const array: unknown[] = []
  Object.defineProperty(array, '0', {
    enumerable: true,
    get() {
      calls++
      return 'a'
    }
  })
  const sparse: unknown[] = []
  sparse.length = 2
  const custom = Object.assign(['asia', 'china', 'xiamen'], { extra: true })
  const symbol = ['asia', 'china', 'xiamen']
  Object.defineProperty(symbol, Symbol('hidden'), { value: true })
  for (const value of [array, sparse, custom, symbol]) {
    expect(parseCascaderPath(CASCADER_MODULE_DEFAULT_CONFIG.items, value)).toBeNull()
    expect(() => parseCascaderItems(value)).toThrow()
  }
  expect(calls).toBe(0)
  for (const config of [
    { fontSize: '14' },
    { rowHeight: 0 },
    { borderRadius: Infinity },
    { searchable: 1 },
    { label: ' ' },
    { items: [item('a')], initialPath: ['a'], textColor: 'url(x)' }
  ])
    expect(() => createCascaderModuleInstance(config)).toThrow()
  const items = Array.from({ length: 128 }, (_, i) => ({
    ...item('n' + i),
    label: '中'.repeat(120)
  }))
  expect(() => createCascaderModuleInstance({ items })).toThrow()
})

test('Cascader FIG roundtrip retains ordinary nodes, path metadata and binding references', async () => {
  await initCodec()
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  graph.updateNode(page.id, {
    state: [{ id: 'path', name: 'path', type: 'array', defaultValue: ['asia', 'china', 'xiamen'] }]
  })
  const node = graph.createNode('FRAME', page.id, {
    ...createCascaderModuleFrameOverrides(),
    bindings: { value: { kind: 'ref', stateId: 'path' } }
  })
  const before = structuredClone(node),
    restored = await parseFigFile((await exportFigFile(graph)).slice().buffer)
  const found = [...restored.getAllNodes()].find((candidate) => candidate.name === node.name)
  expect(found?.type).toBe('FRAME')
  expect(found?.interactiveProps?.module).toEqual(node.interactiveProps?.module)
  expect(found?.bindings).toEqual(node.bindings)
  expect(node).toEqual(before)
})
