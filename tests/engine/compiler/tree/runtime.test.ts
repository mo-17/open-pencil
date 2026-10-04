import { expect, test } from 'bun:test'

import { buildOpenPencilTreeComponent } from '#compiler/adapters/react/modules/tree'
import { buildOpenPencilVueTree } from '#compiler/adapters/vue/modules/tree'

import { compile, withDefaults } from '@open-pencil/compiler'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRElement } from '@open-pencil/compiler/ir/types'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec, parseFigFile } from '@open-pencil/core/kiwi'
import {
  createTreeModuleInstance,
  createTreeModuleFrameOverrides,
  TREE_MODULE_DEFAULT_CONFIG,
  treeVisibleRows,
  moduleValueFields
} from '@open-pencil/core/plugins'
import { planValidatedFormValueBindings } from '@open-pencil/lowcode'
import { SceneGraph } from '@open-pencil/scene-graph'

import { inspectFormOverview } from '@/app/lowcode/form-overview'

import {
  treeBindingFixture,
  treeBindingGraph
} from '#tests/helpers/compiler/components/tree-binding/fixture'
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

for (const target of ['react', 'vue'] as const)
  test(`${target} Tree flag transitions remain type-safe through the generated component API`, () => {
    const result = treeBindingFixture(target, 'state-flags')
    expect(result.warnings).toEqual([])
    typeCheckCompilerFiles(
      new Map(
        [...result.files].filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      ),
      target
    )
  }, 35000)

test('Tree and TreeSelect use exact page/document value types through FORM, FIG and generated projects', async () => {
  await initCodec()
  const { graph, page, manyPage, oneDoc, onePage, manyDoc } = treeBindingGraph()
  expect(moduleValueFields(manyPage)[0]?.type).toBe('array')
  expect(moduleValueFields(oneDoc)[0]?.type).toBe('string')
  expect(moduleValueFields(onePage)[0]?.type).toBe('string')
  expect(moduleValueFields(manyDoc)[0]?.type).toBe('array')
  const ir = collectTree(graph, page.id)
  const firstForm = ir.children[0] as IRElement
  const firstTree = firstForm.children.find(
    (node) => node.kind === 'element' && node.sourceId === manyPage.id
  ) as IRElement
  expect(firstTree.module?.valueFields?.[0]?.name).toBe('categories')
  expect(inspectFormOverview(graph, manyPage.id)?.fields[0]?.submissionName).toBe('categories')
  const restored = await parseFigFile((await exportFigFile(graph)).slice().buffer)
  for (const node of [manyPage, oneDoc, onePage, manyDoc])
    expect(
      [...restored.getAllNodes()].find((candidate) => candidate.name === node.name)?.bindings
    ).toEqual(node.bindings)
  expect(
    [...restored.getAllNodes()].find((candidate) => candidate.name === manyPage.name)
      ?.interactiveProps?.moduleFieldNames
  ).toEqual({ value: 'categories' })
  expect(restored.getPages()[0].state).toEqual(page.state)
  for (const target of ['react', 'vue'] as const) {
    const result = treeBindingFixture(target)
    expect(result.warnings).toEqual([])
    typeCheckCompilerFiles(
      new Map(
        [...result.files].filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      ),
      target
    )
  }
}, 35000)

test('Tree FORM repair allocates a typed array state and preserves a custom field name', () => {
  const { graph, first, manyPage } = treeBindingGraph()
  graph.updateNode(manyPage.id, { bindings: {} })
  const plan = planValidatedFormValueBindings(graph, first.id, { moduleFields: moduleValueFields })
  expect(plan.ok).toBe(true)
  if (!plan.ok) return
  const repair = plan.data.bindings.find((binding) => binding.nodeId === manyPage.id)
  expect(repair?.bindings.value?.kind).toBe('ref')
  const target = plan.data.nextState.find((state) => state.id === repair?.bindings.value?.stateId)
  expect(target?.type).toBe('array')
  expect(graph.getNode(manyPage.id)?.interactiveProps?.moduleFieldNames).toEqual({
    value: 'categories'
  })
})

test('Vue module host passes readOnly as a component prop', () => {
  const result = treeBindingFixture('vue', 'flags')
  expect(result.warnings).toEqual([])
  const page = result.files.get('src/pages/index.vue')
  expect(typeof page === 'string' ? page : '').toContain(':read-only="true"')
  expect(typeof page === 'string' ? page : '').not.toMatch(
    /<OpenPencilTree[^\n]*\sreadonly(?:\s|>)/
  )
  typeCheckCompilerFiles(
    new Map(
      [...result.files].filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    ),
    'vue'
  )
})

test('switching Tree from multiple to single makes an array binding unavailable without rewriting state', () => {
  const { graph, page, manyPage } = treeBindingGraph(),
    before = structuredClone(page.state),
    module = manyPage.interactiveProps?.module
  if (!module) throw new Error('Tree module unavailable')
  graph.updateNode(manyPage.id, {
    interactiveProps: {
      ...manyPage.interactiveProps,
      module: createTreeModuleInstance({ ...module.config, selectionMode: 'single' })
    }
  })
  const result = compile({
    graph,
    pageIds: [page.id],
    options: withDefaults({ target: 'react', router: 'none', devMode: false })
  })
  expect(
    result.warnings.some(
      (warning) => warning.code === 'module-value-binding-invalid' && warning.nodeId === manyPage.id
    )
  ).toBe(true)
  expect(page.state).toEqual(before)
  const source = result.files.get('src/App.tsx')
  expect(typeof source === 'string' ? source : '').toContain('valueBound')
})
