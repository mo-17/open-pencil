import { expect, test } from 'bun:test'

import { buildOpenPencilTreeComponent } from '#compiler/adapters/react/modules/tree'
import { buildOpenPencilVueTree } from '#compiler/adapters/vue/modules/tree'

import { compile, withDefaults } from '@open-pencil/compiler'
import {
  createTreeModuleFrameOverrides,
  TREE_MODULE_DEFAULT_CONFIG,
  treeVisibleRows
} from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

import { treeRuntime } from '#tests/helpers/compiler/modules/tree/model'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

test('shared Tree runtime matches Canvas expansion/search and keyboard navigates without selecting', async () => {
  const runtime = await treeRuntime(),
    config = structuredClone(TREE_MODULE_DEFAULT_CONFIG)
  let state = runtime.initialTree(config)
  for (const query of ['', 'design', 'development', 'none']) {
    state = { ...state, query }
    expect(runtime.visibleRows(config, state)).toEqual(
      treeVisibleRows(config, state.expanded, query)
    )
  }
  state = { ...runtime.initialTree(config), activeId: 'project' }
  let result = runtime.treeKeyboard(config, state, 'ArrowRight')
  expect(result.focus).toBe('design')
  expect(result.state.selected).toEqual([])
  result = runtime.treeKeyboard(config, result.state, 'End')
  expect(result.focus).toBe('development')
  result = runtime.treeKeyboard(config, result.state, 'Enter')
  expect(result.state.selected).toEqual(['development'])
  result = runtime.treeKeyboard(config, result.state, 'ArrowLeft')
  expect(result.focus).toBe('project')
  result = runtime.treeKeyboard(config, result.state, 'ArrowLeft')
  expect(result.state.expanded).toEqual([])
  expect(result.state.selected).toEqual(['development'])
})
test('multiple selection is independent, disabled trees reject actions, single TreeSelect closes', async () => {
  const runtime = await treeRuntime(),
    config = { ...structuredClone(TREE_MODULE_DEFAULT_CONFIG), selectionMode: 'multiple' as const }
  let state = runtime.initialTree(config)
  state = runtime.chooseTree(config, state, 'project')
  expect(state.selected).toEqual(['project'])
  state = runtime.chooseTree(config, state, 'design')
  expect(state.selected).toEqual(['project', 'design'])
  state = runtime.chooseTree(config, state, 'archive')
  expect(state.selected).toEqual(['project', 'design'])
  state = runtime.chooseTree(config, state, 'project')
  expect(state.selected).toEqual(['design'])
  expect(runtime.treeKeyboard({ ...config, disabled: true }, state, 'Enter').state).toBe(state)
  const select = { ...config, presentation: 'select' as const, selectionMode: 'single' as const }
  state = { ...runtime.initialTree(select), open: true }
  expect(runtime.chooseTree(select, state, 'development')).toMatchObject({
    selected: ['development'],
    open: false
  })
})
for (const target of ['react', 'vue'] as const)
  test(`${target} Tree compiler emits type-safe local runtime; native target stays explicit`, () => {
    const graph = new SceneGraph(),
      page = graph.getPages()[0]
    graph.createNode('FRAME', page.id, createTreeModuleFrameOverrides())
    const result = compile({
      graph,
      pageIds: [page.id],
      options: withDefaults({ target, router: 'none', devMode: false })
    })
    expect(result.warnings).toEqual([])
    const file = `src/__openpencil_tree.${target === 'react' ? 'tsx' : 'vue'}`
    expect(result.files.has(file)).toBe(true)
    const files = new Map<string, string>()
    for (const [key, value] of result.files) if (typeof value === 'string') files.set(key, value)
    files.set(file, target === 'react' ? buildOpenPencilTreeComponent() : buildOpenPencilVueTree())
    expect(() => typeCheckCompilerFiles(files, target)).not.toThrow()
    const native = compile({
      graph,
      pageIds: [page.id],
      options: withDefaults({ target: 'expo', router: 'none' })
    })
    expect(native.warnings.some((warning) => warning.code.includes('unsupported'))).toBe(true)
  }, 35000)
