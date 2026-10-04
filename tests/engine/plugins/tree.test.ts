import { expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import {
  createTreeModuleInstance,
  createTreeModuleFrameOverrides,
  resolveTreeModule,
  parseTreeItems,
  treeVisibleRows,
  TREE_MODULE_DEFAULT_CONFIG,
  treeSelectedIds
} from '#core/plugins/tree'
import { moduleValueFields } from '#core/plugins/value-controls'
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

test('Tree exposes one typed value field and rejects bad business IDs without changing its source', () => {
  const graph = new SceneGraph(),
    page = graph.getPages()[0],
    single = graph.createNode(
      'FRAME',
      page.id,
      createTreeModuleFrameOverrides({
        initialSelectedIds: ['design']
      })
    ),
    multiple = graph.createNode(
      'FRAME',
      page.id,
      createTreeModuleFrameOverrides({
        selectionMode: 'multiple',
        initialSelectedIds: ['design', 'development']
      })
    )
  expect(moduleValueFields(single)).toMatchObject([
    { key: 'value', type: 'string', initialValue: 'design' }
  ])
  expect(moduleValueFields(multiple)).toMatchObject([
    { key: 'value', type: 'array', initialValue: ['design', 'development'] }
  ])
  const singleConfig = resolveTreeModule(single.interactiveProps?.module),
    multipleConfig = resolveTreeModule(multiple.interactiveProps?.module)
  if (!singleConfig?.ok || !multipleConfig?.ok) throw new Error('Tree config unavailable')
  expect(treeSelectedIds(singleConfig.config, '')).toEqual([])
  expect(treeSelectedIds(singleConfig.config, 'design')).toEqual(['design'])
  expect(treeSelectedIds(singleConfig.config, ['design'])).toBeNull()
  expect(treeSelectedIds(singleConfig.config, 'missing')).toBeNull()
  expect(treeSelectedIds(singleConfig.config, 'archive')).toBeNull()
  expect(treeSelectedIds(multipleConfig.config, [])).toEqual([])
  expect(treeSelectedIds(multipleConfig.config, ['design', 'development'])).toEqual([
    'design',
    'development'
  ])
  expect(treeSelectedIds(multipleConfig.config, ['design', 'design'])).toBeNull()
  expect(treeSelectedIds(multipleConfig.config, ['design', 'archive'])).toBeNull()
  expect(treeSelectedIds(multipleConfig.config, 'design')).toBeNull()
})
