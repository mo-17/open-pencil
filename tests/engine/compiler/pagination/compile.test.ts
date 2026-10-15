import { expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRElement } from '@open-pencil/compiler/ir/types'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec, parseFigFile } from '@open-pencil/core/kiwi'
import { createPaginationModuleInstance } from '@open-pencil/core/plugins'

import {
  paginationFixture,
  paginationGraph
} from '#tests/helpers/compiler/components/pagination/fixture'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

for (const target of ['react', 'vue'] as const)
  test(`${target} Pagination produces a typed project with page and document writes`, () => {
    const result = paginationFixture(target)
    expect(result.warnings).toEqual([])
    const source = [...result.files.values()].join('\n')
    expect(source).toContain('Pagination')
    if (target === 'react') expect(source).toContain('setPage(value)')
    else expect(source).toContain('.value = value')
    typeCheckCompilerFiles(result.files, target)
  }, 35000)

function moduleIR() {
  const f = paginationGraph(),
    tree = collectTree(f.graph, f.page.id)
  return { ...f, tree, module: ((tree.children[0] as IRElement).children[0] as IRElement).module }
}
test('Pagination registers read/write ownership exactly', () => {
  const { tree, module } = moduleIR()
  expect(module?.pagination?.write).toEqual({ kind: 'state', name: 'page', targetType: 'number' })
  expect(tree.docStateReads).toContain('docPage')
  expect(tree.docStateWrites).toContain('docPage')
  expect(module?.pagination?.total).toEqual({ kind: 'ident', name: 'total' })
})
for (const kind of ['string', 'computed', 'unknown', 'expression'] as const)
  test(`Pagination rejects ${kind} currentPage without unbound fallback`, () => {
    const { graph, page, main } = paginationGraph()
    if (kind === 'string')
      graph.updateNode(page.id, {
        state: page.state?.map((s) =>
          s.id === 'page' ? { ...s, type: 'string', defaultValue: '1' } : s
        )
      })
    if (kind === 'computed')
      graph.updateNode(page.id, {
        state: page.state?.map((s) => (s.id === 'page' ? { ...s, computedExpr: 'total / 10' } : s))
      })
    if (kind === 'unknown')
      graph.updateNode(main.id, {
        bindings: { ...main.bindings, currentPage: { kind: 'ref', stateId: 'missing' } }
      })
    if (kind === 'expression')
      graph.updateNode(main.id, {
        bindings: { ...main.bindings, currentPage: { kind: 'expr', expr: 'page' } }
      })
    const tree = collectTree(graph, page.id),
      module = ((tree.children[0] as IRElement).children[0] as IRElement).module
    expect(module?.pagination?.currentPage).toEqual({ kind: 'ident', name: 'undefined' })
    expect(module?.pagination?.write).toBeUndefined()
    expect(tree.warnings.some((w) => w.code === 'pagination-binding-invalid')).toBe(true)
  })
test('unknown module versions do not acquire Pagination bindings', () => {
  const { graph, page, main } = paginationGraph()
  graph.updateNode(main.id, {
    interactiveProps: { module: { ...createPaginationModuleInstance(), configVersion: 99 } }
  })
  const tree = collectTree(graph, page.id),
    node = (tree.children[0] as IRElement).children[0] as IRElement
  expect(node.module).toBeUndefined()
  expect(tree.warnings.length).toBeGreaterThan(0)
})
test('invalid numeric reads remain present and warn instead of selecting authored totals', () => {
  const { graph, page, main } = paginationGraph()
  graph.updateNode(main.id, {
    bindings: {
      ...main.bindings,
      total: { kind: 'expr', expr: 'missingCount' },
      pageSize: { kind: 'literal', literalValue: 10 }
    }
  })
  const tree = collectTree(graph, page.id),
    module = ((tree.children[0] as IRElement).children[0] as IRElement).module
  expect(module?.pagination?.total).toEqual({ kind: 'ident', name: 'undefined' })
  expect(module?.pagination?.pageSize).toEqual({ kind: 'ident', name: 'undefined' })
  expect(tree.warnings.length).toBeGreaterThanOrEqual(2)
})
for (const kind of ['ref', 'expr'] as const)
  test(`invalid computed state cannot become a valid Pagination ${kind} read`, () => {
    const { graph, page, main } = paginationGraph()
    graph.updateNode(page.id, {
      state: page.state?.map((state) =>
        state.id === 'total' ? { ...state, computedExpr: 'missing + 1' } : state
      )
    })
    graph.updateNode(main.id, {
      bindings: {
        ...main.bindings,
        total:
          kind === 'ref' ? { kind: 'ref', stateId: 'total' } : { kind: 'expr', expr: 'total + 1' }
      }
    })
    const tree = collectTree(graph, page.id),
      module = ((tree.children[0] as IRElement).children[0] as IRElement).module
    expect(module?.pagination?.total).toEqual({ kind: 'ident', name: 'undefined' })
    expect(tree.warnings.some((w) => w.code === 'pagination-binding-invalid')).toBe(true)
  })

for (const target of ['expo', 'flutter', 'taro', 'wechat-miniprogram', 'uni-app', 'mpx'] as const)
  test(`${target} preserves an explicit unsupported-module boundary`, () => {
    const { graph, page } = paginationGraph()
    const result = compile({ graph, pageIds: [page.id], options: withDefaults({ target }) })
    const expectedCodes = {
      expo: 'expo-module-unsupported',
      flutter: 'flutter-element-feature-unsupported',
      taro: 'taro-plugin-module-unsupported',
      'wechat-miniprogram': 'wechat-miniprogram-node-runtime-unsupported',
      'uni-app': 'uni-app-plugin-module-unsupported',
      mpx: 'mpx-plugin-module-unsupported'
    }
    expect(result.warnings.some((w) => w.code === expectedCodes[target])).toBe(true)
    expect([...result.files.values()].join('\n')).not.toContain('data-openpencil-pagination')
  })

test('Pagination .fig roundtrip retains ordinary FRAME and its explicit state references', async () => {
  await initCodec()
  const { graph, main } = paginationGraph()
  const restored = await parseFigFile((await exportFigFile(graph)).slice().buffer)
  const restoredMain = [...restored.getAllNodes()].find(
    (node) => node.name === main.name && node.bindings?.currentPage?.kind === 'ref'
  )
  expect(restoredMain?.type).toBe('FRAME')
  expect(restoredMain?.interactiveProps).toEqual(main.interactiveProps)
  expect(restoredMain?.bindings).toEqual(main.bindings)
})
