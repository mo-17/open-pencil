import { expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRElement } from '@open-pencil/compiler/ir/types'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec, parseFigFile } from '@open-pencil/core/kiwi'
import { SceneGraph } from '@open-pencil/scene-graph'

import {
  colorInputFixture,
  colorInputGraph
} from '#tests/helpers/compiler/components/color/fixture'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

for (const target of ['react', 'vue'] as const)
  test(`${target} color controls compile as typed editable projects`, () => {
    const { files } = colorInputFixture(target)
    typeCheckCompilerFiles(new Map(files), target)
  }, 35000)

test('color keeps invalid imported business data, emits bounded warning and validates controlled FORM state', () => {
  const { graph, page, color } = colorInputGraph()
  graph.updateNode(color.id, {
    interactiveProps: { ...color.interactiveProps, value: 'private-invalid-fixture' }
  })
  const tree = collectTree(graph, page.id)
  const form = tree.children[0] as IRElement,
    field = form.children[0] as IRElement
  expect(field.inputControl).toEqual({ kind: 'color', readOnly: false })
  expect(field.controlled).toBeDefined()
  expect(field.validation?.rules.pattern).toBe('^#[0-9a-fA-F]{6}$')
  expect(field.validation?.rules.required).toBe(true)
  expect(tree.warnings.filter((w) => w.code === 'color-input-invalid-value')).toHaveLength(1)
  expect(JSON.stringify(tree.warnings)).not.toContain('private-invalid-fixture')
})

test('color cannot silently bind a number and unconfigured text controls remain native', () => {
  const { graph, page, color } = colorInputGraph()
  graph.updateNode(page.id, {
    state: [
      { id: 'color', name: 'color', type: 'number', defaultValue: 42 },
      { id: 'submits', name: 'submits', type: 'number', defaultValue: 0 }
    ]
  })
  const tree = collectTree(graph, page.id),
    field = (tree.children[0] as IRElement).children[0] as IRElement
  expect(field.controlled).toBeUndefined()
  expect(tree.warnings.length).toBeGreaterThan(0)
  graph.updateNode(color.id, { interactiveProps: { inputType: 'text' }, bindings: {} })
  const plain = (collectTree(graph, page.id).children[0] as IRElement).children[0] as IRElement
  expect(plain.inputControl).toBeUndefined()
})

for (const target of ['expo', 'flutter', 'taro', 'wechat-miniprogram', 'uni-app', 'mpx'] as const)
  test(`${target} explicitly omits native web color picker behavior`, () => {
    const graph = new SceneGraph(),
      page = graph.getPages()[0]
    graph.createNode('INPUT', page.id, {
      width: 300,
      height: 44,
      interactiveProps: { inputType: 'color', value: '#2563eb', ariaLabel: 'Web color' }
    })
    const result = compile({ graph, pageIds: [page.id], options: withDefaults({ target }) })
    expect(result.warnings.map((w) => w.code)).toContain(
      `${target}-input-color-affordance-unsupported`
    )
    expect([...result.files.values()].join('\n')).not.toContain('Web color')
  })

test('color .fig roundtrip preserves ordinary INPUT, binding and readonly metadata', async () => {
  await initCodec()
  const { graph, color } = colorInputGraph()
  const restored = await parseFigFile((await exportFigFile(graph)).slice().buffer)
  const node = [...restored.getAllNodes()].find((n) => n.name === color.name)
  expect(node?.type).toBe('INPUT')
  expect(node?.interactiveProps).toEqual(color.interactiveProps)
  expect(node?.bindings).toEqual(color.bindings)
})

test('color format intersects authored patterns without dropping their search semantics', () => {
  const { graph, page, color } = colorInputGraph()
  graph.updateNode(color.id, {
    interactiveProps: { inputType: 'color', validation: { pattern: 'ff' } }
  })
  const field = (collectTree(graph, page.id).children[0] as IRElement).children[0] as IRElement
  const pattern = new RegExp(field.validation?.rules.pattern ?? '(?!)')
  expect(pattern.test('#aaff00')).toBe(true)
  expect(pattern.test('#aaff')).toBe(false)
  expect(pattern.test('#aabb00')).toBe(false)
  expect(pattern.test('not-a-color')).toBe(false)
})
