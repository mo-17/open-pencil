import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRElement } from '@open-pencil/compiler/ir/types'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec, parseFigFile } from '@open-pencil/core/kiwi'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

function dateTimeFixture(properties: SceneNode['interactiveProps'] = {}) {
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  graph.updateNode(page.id, {
    state: [
      { id: 'date-time', name: 'appointment', type: 'string', defaultValue: '2026-09-28T09:30:15' },
      { id: 'numeric', name: 'numericDate', type: 'number', defaultValue: 20260928 }
    ]
  })
  const input = graph.createNode('INPUT', page.id, {
    name: 'Local appointment',
    width: 320,
    height: 44,
    interactiveProps: { inputType: 'datetime-local', ariaLabel: '预约日期时间', ...properties }
  })
  const tree = () => collectTree(graph, page.id)
  const element = () => tree().children[0] as IRElement
  return { graph, page, input, tree, element }
}

describe('datetime-local INPUT compile boundary', () => {
  test('emits native local strings and omits malformed attributes with field diagnostics', () => {
    const valid = dateTimeFixture({
      value: '2026-09-28T09:30:15',
      min: '2026-09-28T08:00',
      max: '2026-09-29T18:00',
      step: 15,
      disabled: true,
      readOnly: true
    })
    expect(valid.element().attrs).toMatchObject({
      type: 'datetime-local',
      defaultValue: '2026-09-28T09:30:15',
      min: '2026-09-28T08:00',
      max: '2026-09-29T18:00',
      step: 15,
      disabled: true,
      readOnly: true
    })
    expect(valid.tree().warnings).toEqual([])
    const invalid = dateTimeFixture({
      value: '2026-02-30T12:00',
      min: '2026-09-28T12:00Z',
      max: 1,
      step: 0.5
    })
    expect(invalid.element().attrs).toEqual({
      type: 'datetime-local',
      'aria-label': '预约日期时间'
    })
    expect(invalid.tree().warnings.map(({ code }) => code)).toEqual([
      'date-time-input-invalid-value',
      'date-time-input-invalid-min',
      'date-time-input-invalid-max',
      'date-time-input-invalid-step'
    ])
  })

  test('inverted full-date bounds are rejected without rewriting them to a midnight interval', () => {
    const fixture = dateTimeFixture({
      value: '2026-09-28T23:00',
      min: '2026-09-28T22:00',
      max: '2026-09-28T02:00',
      step: 30
    })
    expect(fixture.tree().warnings.map(({ code }) => code)).toContain(
      'date-time-input-range-inverted'
    )
    expect(fixture.element().attrs).toMatchObject({
      type: 'datetime-local',
      defaultValue: '2026-09-28T23:00',
      step: 30
    })
    expect(fixture.element().attrs.min).toBeUndefined()
    expect(fixture.element().attrs.max).toBeUndefined()
  })

  test('string page/doc state remains writable while numeric page and doc state are rejected', () => {
    const { graph, input, element, tree } = dateTimeFixture({ value: '2026-09-28T12:00' })
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [
        { id: 'doc', name: 'savedAppointment', type: 'string', defaultValue: '2026-09-29T10:00' },
        { id: 'num', name: 'numericAppointment', type: 'number', defaultValue: 20260928 }
      ]
    })
    graph.updateNode(input.id, { bindings: { value: { kind: 'ref', stateId: 'date-time' } } })
    expect(element().controlled?.write).toEqual({
      kind: 'state',
      name: 'appointment',
      targetType: 'string'
    })
    expect(element().attrs.defaultValue).toBeUndefined()
    graph.updateNode(input.id, {
      bindings: { value: { kind: 'docState', docStateName: 'savedAppointment' } }
    })
    expect(element().controlled?.write).toEqual({
      kind: 'docState',
      name: 'savedAppointment',
      targetType: 'string'
    })
    for (const binding of [
      { kind: 'ref', stateId: 'numeric' } as const,
      { kind: 'docState', docStateName: 'numericAppointment' } as const
    ]) {
      graph.updateNode(input.id, { bindings: { value: binding } })
      expect(element().controlled).toBeUndefined()
      expect(tree().warnings.some(({ code }) => code.startsWith('binding-value-'))).toBe(true)
    }
  })

  test('FIG readback preserves native INPUT, calendar strings and binding metadata', async () => {
    await initCodec()
    const { graph, input, page } = dateTimeFixture({
      min: '2026-09-28T08:00',
      max: '2026-10-01T18:00',
      step: 'any'
    })
    graph.updateNode(input.id, { bindings: { value: { kind: 'ref', stateId: 'date-time' } } })
    const restored = await parseFigFile((await exportFigFile(graph)).slice().buffer)
    const imported = [...restored.getAllNodes()].find((node) => node.name === input.name)
    expect(imported?.type).toBe('INPUT')
    expect(imported?.interactiveProps).toEqual(input.interactiveProps)
    expect(imported?.bindings).toEqual(input.bindings)
    expect(restored.getPages()[0].state).toEqual(page.state)
    const ir = collectTree(restored, restored.getPages()[0].id).children[0] as IRElement
    expect(ir.attrs.type).toBe('datetime-local')
    expect(ir.controlled?.write.targetType).toBe('string')
  })

  test.each(['expo', 'flutter', 'taro', 'wechat-miniprogram', 'uni-app', 'mpx'] as const)(
    '%s explicitly omits the unsupported local date-time field',
    (target) => {
      const { graph, page } = dateTimeFixture({ value: '2026-09-28T09:30' })
      const output = compile({ graph, pageIds: [page.id], options: withDefaults({ target }) })
      expect(output.warnings.map(({ code }) => code)).toContain(
        `${target}-input-datetime-local-unsupported`
      )
      const source = [...output.files.values()]
        .filter((file): file is string => typeof file === 'string')
        .join('\n')
      expect(source).not.toContain('预约日期时间')
    }
  )

  test.each(['react', 'vue'] as const)(
    '%s keeps native FORM constraints in a typechecked generated project',
    (target) => {
      const { graph, page, input } = dateTimeFixture({
        min: '2026-09-28T08:00',
        max: '2026-10-01T18:00',
        step: 15,
        validation: { required: true }
      })
      const form = graph.createNode('FORM', page.id, { width: 360, height: 160 })
      graph.reparentNode(input.id, form.id)
      graph.updateNode(input.id, { bindings: { value: { kind: 'ref', stateId: 'date-time' } } })
      expect(
        (collectTree(graph, page.id).children[0] as IRElement).formValidationKeys
      ).toHaveLength(1)
      const output = compile({
        graph,
        pageIds: [page.id],
        options: withDefaults({ target, devMode: false })
      })
      expect(output.warnings).toEqual([])
      const source = [...output.files]
        .filter(([path]) => /\.(tsx|vue)$/.test(path))
        .map(([, file]) => file)
        .join('\n')
      expect(source).toContain('type="datetime-local"')
      expect(source).toContain('2026-09-28T08:00')
      expect(source).toContain('appointment')
      typeCheckCompilerFiles(output.files, target)
    },
    35000
  )
})
