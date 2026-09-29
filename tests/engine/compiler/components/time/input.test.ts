import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRElement } from '@open-pencil/compiler/ir/types'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec, parseFigFile } from '@open-pencil/core/kiwi'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

function fixture(props: SceneNode['interactiveProps'] = {}) {
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  graph.updateNode(page.id, {
    state: [
      { id: 'time', name: 'appointmentTime', type: 'string', defaultValue: '09:30:15' },
      { id: 'number', name: 'count', type: 'number', defaultValue: 930 }
    ]
  })
  const node = graph.createNode('INPUT', page.id, {
    name: 'Time picker',
    width: 220,
    height: 44,
    interactiveProps: { inputType: 'time', ariaLabel: '预约时间', ...props }
  })
  const tree = () => collectTree(graph, page.id)
  const element = () => tree().children[0] as IRElement
  return { graph, page, node, tree, element }
}

describe('time INPUT compilation', () => {
  test('native attributes survive with string bounds while malformed data is dropped with stable diagnostics', () => {
    const valid = fixture({
      value: '09:30:15',
      min: '08:00',
      max: '18:00',
      step: 15,
      readOnly: true,
      disabled: true
    })
    expect(valid.element().attrs).toMatchObject({
      type: 'time',
      defaultValue: '09:30:15',
      min: '08:00',
      max: '18:00',
      step: 15,
      readOnly: true,
      disabled: true
    })
    expect(valid.tree().warnings).toEqual([])
    const invalid = fixture({ value: '9:30', min: 0, max: '25:00', step: 0 })
    expect(invalid.element().attrs).toEqual({ type: 'time', 'aria-label': '预约时间' })
    expect(invalid.tree().warnings.map((warning) => warning.code)).toEqual([
      'time-input-invalid-value',
      'time-input-invalid-min',
      'time-input-invalid-max',
      'time-input-invalid-step'
    ])
  })
  test('page and document string bindings preserve controlled writes, number binding is rejected', () => {
    const { graph, node, tree, element } = fixture({ value: '12:00' })
    graph.updateNode(node.id, { bindings: { value: { kind: 'ref', stateId: 'time' } } })
    expect(element().controlled?.write).toEqual({
      kind: 'state',
      name: 'appointmentTime',
      targetType: 'string'
    })
    expect(element().attrs.defaultValue).toBeUndefined()
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [
        { id: 'doc', name: 'savedTime', type: 'string', defaultValue: '13:00' }
      ]
    })
    graph.updateNode(node.id, {
      bindings: { value: { kind: 'docState', docStateName: 'savedTime' } }
    })
    expect(element().controlled?.write).toEqual({
      kind: 'docState',
      name: 'savedTime',
      targetType: 'string'
    })
    graph.updateNode(node.id, { bindings: { value: { kind: 'ref', stateId: 'number' } } })
    expect(element().controlled).toBeUndefined()
    expect(tree().warnings.map((warning) => warning.code)).toContain('binding-value-bad-state-type')
    expect(element().attrs.type).toBe('time')
  })
  test('FIG roundtrip retains ordinary INPUT identity, time props, string state and FORM bindings', async () => {
    await initCodec()
    const { graph, page, node } = fixture({
      value: '09:30:15',
      min: '08:00',
      max: '18:00',
      step: 15,
      readOnly: true
    })
    graph.updateNode(node.id, { bindings: { value: { kind: 'ref', stateId: 'time' } } })
    const restored = await parseFigFile((await exportFigFile(graph)).slice().buffer)
    const imported = [...restored.getAllNodes()].find((candidate) => candidate.name === node.name)
    expect(imported?.type).toBe('INPUT')
    expect(imported?.interactiveProps).toEqual(node.interactiveProps)
    expect(imported?.bindings).toEqual(node.bindings)
    expect(restored.getPages()[0].state).toEqual(graph.getNode(page.id)?.state)
    const input = collectTree(restored, restored.getPages()[0].id).children[0] as IRElement
    expect(input.attrs).toMatchObject({
      type: 'time',
      min: '08:00',
      max: '18:00',
      step: 15,
      readOnly: true
    })
    expect(input.controlled?.write.targetType).toBe('string')
  })
  test.each(['expo', 'flutter', 'taro', 'wechat-miniprogram', 'uni-app', 'mpx'] as const)(
    '%s does not silently turn a time picker into text',
    (target) => {
      const { graph, page } = fixture({ value: '09:30' })
      const output = compile({ graph, pageIds: [page.id], options: withDefaults({ target }) })
      expect(output.warnings.map((warning) => warning.code)).toContain(
        `${target}-input-time-unsupported`
      )
    }
  )
  test.each(['react', 'vue'] as const)(
    '%s keeps time bindings and form validation in a typechecked generated project',
    (target) => {
      const { graph, page, node } = fixture({
        min: '08:00',
        max: '18:00',
        step: 15,
        validation: { required: true }
      })
      const form = graph.createNode('FORM', page.id, { width: 300, height: 120 })
      graph.reparentNode(node.id, form.id)
      graph.updateNode(node.id, { bindings: { value: { kind: 'ref', stateId: 'time' } } })
      const tree = collectTree(graph, page.id),
        formIR = tree.children[0] as IRElement
      expect(formIR.formValidationKeys).toHaveLength(1)
      const output = compile({
        graph,
        pageIds: [page.id],
        options: withDefaults({ target, devMode: false })
      })
      expect(output.warnings).toEqual([])
      const source = [...output.files]
        .filter(([path]) => path.endsWith('.tsx') || path.endsWith('.vue'))
        .map(([, value]) => value)
        .join('\n')
      expect(source).toContain('type="time"')
      expect(source).toContain('appointmentTime')
      expect(source).toContain('08:00')
      typeCheckCompilerFiles(output.files, target)
    },
    35000
  )
})
