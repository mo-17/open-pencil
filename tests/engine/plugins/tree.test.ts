import { expect, test } from 'bun:test'

import {
  createTreeModuleInstance,
  createTreeModuleFrameOverrides,
  resolveTreeModule,
  parseTreeItems,
  treeVisibleRows,
  TREE_MODULE_DEFAULT_CONFIG
} from '#core/plugins/tree'
const node = (id: string, parentId = '', disabled = false) => ({
  id,
  parentId,
  label: id,
  disabled
})
test('Tree preserves strict FRAME metadata and rejects unsupported versions and unexpected fields', () => {
  const frame = createTreeModuleFrameOverrides(),
    module = createTreeModuleInstance()
  expect(frame.interactiveProps?.module).toEqual(module)
  const serialized = JSON.stringify(module)
  expect(resolveTreeModule(JSON.parse(serialized))?.ok).toBe(true)
  expect(resolveTreeModule({ ...module, configVersion: 2 })?.ok).toBe(false)
  expect(() => createTreeModuleInstance({ unknown: true })).toThrow()
  expect(() => createTreeModuleInstance({ items: [{ ...node('a'), children: [] }] })).toThrow()
})
test('Tree rejects duplicate identities, missing parents, cycles, excessive depth and count', () => {
  for (const items of [
    [node('a'), node('a')],
    [node('a', 'missing')],
    [node('a', 'a')],
    [node('a', 'b'), node('b', 'a')],
    Array.from({ length: 7 }, (_, i) => node('n' + i, i ? 'n' + (i - 1) : '')),
    Array.from({ length: 129 }, (_, i) => node('n' + i))
  ])
    expect(() => parseTreeItems(items)).toThrow()
  expect(parseTreeItems(Array.from({ length: 128 }, (_, i) => node('n' + i)))).toHaveLength(128)
  expect(
    parseTreeItems(Array.from({ length: 6 }, (_, i) => node('n' + i, i ? 'n' + (i - 1) : '')))
  ).toHaveLength(6)
})
test('Tree never invokes accessors and rejects sparse node or identity arrays', () => {
  let calls = 0
  const unsafe = { ...node('a') }
  Object.defineProperty(unsafe, 'label', {
    enumerable: true,
    get() {
      calls++
      return 'bad'
    }
  })
  expect(() => parseTreeItems([unsafe])).toThrow()
  expect(calls).toBe(0)
  const sparse: unknown[] = []
  sparse.length = 2
  expect(() => parseTreeItems(sparse)).toThrow()
  expect(() => createTreeModuleInstance({ initialSelectedIds: sparse })).toThrow()
})
test('Tree validates initial selection and expansion including inherited disabled state', () => {
  const items = [node('root', '', true), node('child', 'root'), node('other')]
  expect(() =>
    createTreeModuleInstance({ items, initialSelectedIds: ['child'], initialExpandedIds: ['root'] })
  ).toThrow()
  expect(() =>
    createTreeModuleInstance({ initialSelectedIds: ['design', 'development'] })
  ).toThrow()
  expect(() => createTreeModuleInstance({ initialExpandedIds: ['design'] })).toThrow()
  expect(() => createTreeModuleInstance({ initialSelectedIds: ['missing'] })).toThrow()
  const config = {
    ...structuredClone(TREE_MODULE_DEFAULT_CONFIG),
    items,
    initialExpandedIds: ['root']
  }
  expect(
    treeVisibleRows(config)
      .filter((row) => row.disabled)
      .map((row) => row.item.id)
  ).toEqual(['root', 'child'])
})
test('Tree search reveals matching descendants with ancestors without mutating expansion', () => {
  const config = structuredClone(TREE_MODULE_DEFAULT_CONFIG)
  config.initialExpandedIds = []
  expect(treeVisibleRows(config).map((row) => row.item.id)).toEqual(['project', 'archive'])
  expect(treeVisibleRows(config, [], 'design').map((row) => row.item.id)).toEqual([
    'project',
    'design'
  ])
  expect(treeVisibleRows(config, [], 'not found')).toEqual([])
  expect(config.initialExpandedIds).toEqual([])
})
