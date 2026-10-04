import { expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRElement } from '@open-pencil/compiler/ir/types'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec, parseFigFile } from '@open-pencil/core/kiwi'
import {
  createChartModuleFrameOverrides,
  createDataGridModuleFrameOverrides,
  moduleDataField
} from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

import { controlDesignDependencies } from '#core/canvas/control-state'
import { readModuleDataInitial } from '#core/canvas/module-data'
import { collectGraphFontRequirements } from '#core/text/requirements'

import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

function fixture() {
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  graph.updateNode(page.id, {
    state: [
      { id: 'rows', name: 'rows', type: 'array', defaultValue: [{ id: 'one', cells: ['新行'] }] },
      {
        id: 'chart',
        name: 'chartData',
        type: 'object',
        defaultValue: { values: [7, 4], labels: ['绑定甲', '绑定乙'] }
      },
      {
        id: 'computed',
        name: 'computedRows',
        type: 'array',
        defaultValue: [],
        computedExpr: 'rows'
      }
    ]
  })
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [
      {
        id: 'doc',
        name: 'documentData',
        type: 'object',
        defaultValue: { values: [3], labels: ['文档'] }
      }
    ]
  })
  const chart = graph.createNode('FRAME', page.id, {
    ...createChartModuleFrameOverrides(),
    name: 'Bound chart',
    bindings: { data: { kind: 'ref', stateId: 'chart' } }
  })
  const grid = graph.createNode('FRAME', page.id, {
    ...createDataGridModuleFrameOverrides({
      data: {
        columns: [
          {
            id: 'name',
            label: 'Name',
            type: 'text',
            align: 'start',
            width: 200,
            sortable: true,
            filterable: true
          }
        ],
        rows: [{ id: 'static', cells: ['Authored example'] }]
      }
    }),
    name: 'Bound grid',
    bindings: { rows: { kind: 'ref', stateId: 'rows' } }
  })
  return { graph, page, chart, grid }
}

function elements(graph: SceneGraph, pageId: string) {
  const tree = collectTree(graph, pageId)
  return { tree, chart: tree.children[0] as IRElement, grid: tree.children[1] as IRElement }
}

test('reviewed data fields read state without acquiring FORM or business write authority', () => {
  const f = fixture(),
    { tree, chart, grid } = elements(f.graph, f.page.id)
  expect(tree.warnings).toEqual([])
  expect(chart.module?.chartDataExpr).toEqual({ kind: 'ident', name: 'chartData' })
  expect(grid.module?.dataGridRowsExpr).toEqual({ kind: 'ident', name: 'rows' })
  for (const node of [chart, grid]) {
    expect(node.module?.valueFields).toBeUndefined()
    expect(node.controlled).toBeUndefined()
    expect(node.validation).toBeUndefined()
  }
  expect(tree.docStateWrites).toEqual([])
  expect(moduleDataField(f.chart)).toEqual({ key: 'data', type: 'object' })
  expect(moduleDataField(f.grid)).toEqual({ key: 'rows', type: 'array' })
})

for (const target of ['react', 'vue'] as const)
  test(`${target} generates typed guarded readonly sources`, () => {
    const f = fixture()
    const result = compile({
      graph: f.graph,
      pageIds: [f.page.id],
      options: withDefaults({ target, router: 'none', devMode: false })
    })
    expect(result.warnings).toEqual([])
    const files = new Map(
      [...result.files].filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    )
    const source = [...files.values()].join('\n')
    expect(source).toContain(target === 'react' ? 'rowsBound rows={' : ':rows-bound="true"')
    expect(source).toContain(target === 'react' ? 'dataBound data={' : ':data-bound="true"')
    expect(() => typeCheckCompilerFiles(files, target)).not.toThrow()
  }, 35000)

for (const kind of [
  'missing',
  'wrong-type',
  'duplicate-id',
  'duplicate-name',
  'computed-invalid',
  'expr-invalid',
  'getter'
] as const)
  test(`present ${kind} never restores authored data`, () => {
    const f = fixture()
    if (kind === 'missing')
      f.graph.updateNode(f.chart.id, { bindings: { data: { kind: 'ref', stateId: 'missing' } } })
    if (kind === 'wrong-type')
      f.graph.updateNode(f.chart.id, { bindings: { data: { kind: 'ref', stateId: 'rows' } } })
    if (kind === 'duplicate-id' || kind === 'duplicate-name')
      f.graph.updateNode(f.page.id, {
        state: [
          ...(f.page.state ?? []),
          {
            id: kind === 'duplicate-id' ? 'chart' : 'other',
            name: kind === 'duplicate-name' ? 'chartData' : 'other',
            type: 'object',
            defaultValue: {}
          }
        ]
      })
    if (kind === 'computed-invalid')
      f.graph.updateNode(f.page.id, {
        state: f.page.state?.map((s) => (s.id === 'chart' ? { ...s, computedExpr: 'missing' } : s))
      })
    if (kind === 'expr-invalid')
      f.graph.updateNode(f.chart.id, { bindings: { data: { kind: 'expr', expr: 'missing' } } })
    if (kind === 'getter') {
      const binding = {}
      Object.defineProperty(binding, 'kind', {
        get() {
          throw new Error('getter executed')
        }
      })
      f.chart.bindings = { data: binding as never }
    }
    const { tree, chart } = elements(f.graph, f.page.id)
    expect(chart.module?.chartDataExpr).toEqual({ kind: 'ident', name: 'undefined' })
    expect(tree.warnings.length).toBeGreaterThan(0)
    expect(readModuleDataInitial(f.chart, f.graph, 'data')).toEqual({
      bound: true,
      value: undefined
    })
  })

test('computed and expression state reads remain runtime-only; document reads have no writes', () => {
  const f = fixture()
  f.graph.updateNode(f.grid.id, { bindings: { rows: { kind: 'ref', stateId: 'computed' } } })
  f.graph.updateNode(f.chart.id, {
    bindings: { data: { kind: 'docState', docStateName: 'documentData' } }
  })
  let result = elements(f.graph, f.page.id)
  expect(result.tree.warnings).toEqual([])
  expect(result.grid.module?.dataGridRowsExpr).toEqual({ kind: 'ident', name: 'computedRows' })
  expect(result.tree.docStateReads).toContain('documentData')
  expect(result.tree.docStateWrites).toEqual([])
  expect(readModuleDataInitial(f.grid, f.graph, 'rows')).toEqual({ bound: true, value: undefined })
  f.graph.updateNode(f.grid.id, { bindings: { rows: { kind: 'expr', expr: 'rows' } } })
  result = elements(f.graph, f.page.id)
  expect(result.tree.warnings).toEqual([])
  expect(result.grid.module?.dataGridRowsExpr).toEqual({ kind: 'ident', name: 'rows' })
  expect(readModuleDataInitial(f.grid, f.graph, 'rows').value).toBeUndefined()
})

test('Canvas fonts and chunk dependencies follow valid initial data without changing authored nodes', () => {
  const f = fixture(),
    before = JSON.stringify([...f.graph.getAllNodes()])
  expect(readModuleDataInitial(f.chart, f.graph, 'data')).toEqual({
    bound: true,
    value: { values: [7, 4], labels: ['绑定甲', '绑定乙'] }
  })
  for (const node of [f.chart, f.grid])
    expect(controlDesignDependencies(f.graph, node)).toEqual([f.page.id])
  const fonts = collectGraphFontRequirements(f.graph, [f.chart.id, f.grid.id])
  for (const character of '绑定甲乙新行') expect(fonts.characters).toContain(character)
  expect(JSON.stringify([...f.graph.getAllNodes()])).toBe(before)
})

test('reusable body does not borrow page authority but retains document data', () => {
  const f = fixture(),
    master = f.graph.createNode('COMPONENT', f.page.id)
  f.graph.reparentNode(f.grid.id, master.id)
  expect(readModuleDataInitial(f.grid, f.graph, 'rows')).toEqual({ bound: true, value: undefined })
  f.graph.updateNode(f.chart.id, {
    bindings: { data: { kind: 'docState', docStateName: 'documentData' } }
  })
  f.graph.reparentNode(f.chart.id, master.id)
  expect(readModuleDataInitial(f.chart, f.graph, 'data').value).toEqual({
    values: [3],
    labels: ['文档']
  })
})

test('FIG roundtrip preserves bounded data and readonly bindings', async () => {
  await initCodec()
  const f = fixture(),
    restored = await parseFigFile((await exportFigFile(f.graph)).slice().buffer)
  for (const node of [f.chart, f.grid])
    expect(
      [...restored.getAllNodes()].find((candidate) => candidate.name === node.name)?.bindings
    ).toEqual(node.bindings)
  expect(restored.getPages()[0].state).toEqual(f.page.state)
  const { tree, chart, grid } = elements(restored, restored.getPages()[0].id)
  expect(tree.warnings).toEqual([])
  expect(chart.module?.chartDataExpr).toBeDefined()
  expect(grid.module?.dataGridRowsExpr).toBeDefined()
})

for (const target of ['expo', 'flutter', 'wechat-miniprogram', 'taro', 'uni-app', 'mpx'] as const)
  test(`${target} retains explicit unsupported module warnings`, () => {
    const f = fixture(),
      result = compile({
        graph: f.graph,
        pageIds: [f.page.id],
        options: withDefaults({ target, router: 'none' })
      })
    for (const node of [f.chart, f.grid])
      expect(
        result.warnings.some((w) => w.nodeId === node.id && w.code.includes('unsupported'))
      ).toBe(true)
  })

for (const kind of ['ref', 'expression'] as const)
  test(`document computed ${kind} is unavailable instead of showing a stale default`, () => {
    const f = fixture()
    f.graph.updateNode(f.graph.rootId, {
      lowcodeDocumentState: [
        {
          id: 'doc',
          name: 'documentData',
          type: 'object',
          defaultValue: { values: [9], labels: ['Stale'] },
          computedExpr: '{}'
        }
      ]
    })
    f.graph.updateNode(f.chart.id, {
      bindings: {
        data:
          kind === 'ref'
            ? { kind: 'docState', docStateName: 'documentData' }
            : { kind: 'expr', expr: 'documentData' }
      }
    })
    const { tree, chart } = elements(f.graph, f.page.id)
    expect(chart.module?.chartDataExpr).toEqual({ kind: 'ident', name: 'undefined' })
    expect(tree.warnings.some((w) => w.code === 'module-data-binding-invalid')).toBe(true)
    expect(readModuleDataInitial(f.chart, f.graph, 'data').value).toBeUndefined()
  })

test('Canvas initial data refuses cyclic ancestry without looping', () => {
  const f = fixture()
  f.graph.updateNode(f.chart.id, { parentId: f.chart.id })
  expect(readModuleDataInitial(f.chart, f.graph, 'data')).toEqual({ bound: true, value: undefined })
})

for (const kind of ['ref', 'expression'] as const)
  test(`page computed ${kind} cannot indirectly expose unsupported document computations`, () => {
    const f = fixture()
    f.graph.updateNode(f.graph.rootId, {
      lowcodeDocumentState: [
        {
          id: 'doc',
          name: 'documentData',
          type: 'object',
          defaultValue: { values: [9], labels: ['Stale'] },
          computedExpr: '{}'
        }
      ]
    })
    f.graph.updateNode(f.page.id, {
      state: [
        ...(f.page.state ?? []),
        {
          id: 'derived',
          name: 'derived',
          type: 'object',
          defaultValue: {},
          computedExpr: 'documentData'
        }
      ]
    })
    f.graph.updateNode(f.chart.id, {
      bindings: {
        data:
          kind === 'ref' ? { kind: 'ref', stateId: 'derived' } : { kind: 'expr', expr: 'derived' }
      }
    })
    const { tree, chart } = elements(f.graph, f.page.id)
    expect(chart.module?.chartDataExpr).toEqual({ kind: 'ident', name: 'undefined' })
    expect(tree.warnings.some((w) => w.code === 'module-data-binding-invalid')).toBe(true)
  })
