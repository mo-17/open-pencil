import { expect, mock, test } from 'bun:test'

import type { Canvas } from 'canvaskit-wasm'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { controlDesignDependencies } from '#core/canvas/control-state'
import { renderShapeUncached } from '#core/canvas/scene'
import { selectDesignContent } from '#core/canvas/select-state'
import { lowcodeTextProjection } from '#core/text/lowcode'
import { collectGraphFontRequirements } from '#core/text/requirements'

import { createMockCanvas, createMockRenderer, mockCalls } from './effects/helpers'

function fixture(overrides: Partial<SceneNode> = {}) {
  const graph = new SceneGraph()
  const node = graph.createNode('SELECT', graph.getPages()[0].id, {
    width: 240,
    height: 44,
    fontSize: 14,
    paddingLeft: 12,
    paddingRight: 12,
    paddingTop: 4,
    paddingBottom: 4,
    interactiveProps: {
      options: ['个人', '团队'],
      value: '团队',
      placeholder: '请选择'
    },
    ...overrides
  })
  const canvas = createMockCanvas()
  const renderer = createMockRenderer({ renderEffects: mock(() => undefined) })
  const render = () => renderShapeUncached(renderer, canvas as Canvas, node, graph)
  const labels = () =>
    mockCalls(renderer.renderText as ReturnType<typeof mock>).map((call) => call[1])
  return { graph, node, canvas, renderer, render, labels }
}

test('SELECT draws a selected label and chevron through the ordinary shape renderer', () => {
  const { node, canvas, render, labels } = fixture()
  const before = structuredClone(node)
  render()
  expect(labels()).toMatchObject([{ type: 'TEXT', text: '团队', maxLines: 1 }])
  expect(canvas.drawLine).toHaveBeenCalledTimes(2)
  expect(canvas.clipRRect).toHaveBeenCalledTimes(1)
  expect(node).toEqual(before)
})

test('SELECT participates in ordinary text font preflight without synthetic children', () => {
  const { node } = fixture()
  expect(lowcodeTextProjection(node)).toMatchObject({
    node: { type: 'TEXT', text: '团队', childIds: [] },
    contentKind: 'select_value'
  })
})

test('uses option labels rather than submitted values and keeps authored padding', () => {
  const { canvas, render, labels } = fixture({
    interactiveProps: {
      options: [{ label: '专业团队', value: 'team_id_7' }],
      value: 'team_id_7'
    }
  })
  render()
  expect(labels()).toMatchObject([
    {
      text: '专业团队',
      width: 196,
      height: 36,
      textTruncation: 'ENDING',
      textAlignVertical: 'CENTER'
    }
  ])
  expect(canvas.translate).toHaveBeenCalledWith(12, 4)
  expect(canvas.clipRect).toHaveBeenCalledWith(new Float32Array([0, 0, 216, 36]), 0, true)
})

test.each([
  [{ placeholder: '请选择' }, '请选择'],
  [{ allowClear: true }, 'Select an option'],
  [{}, '个人'],
  [{ placeholder: '' }, '个人'],
  [{ value: '' }, '个人'],
  [{ value: 'legacy-unmatched' }, '个人'],
  [{ value: 'unknown', placeholder: '请选择' }, '请选择'],
  [{ value: '', placeholder: '请选择' }, '请选择']
] as const)('resolves empty/default selection without inventing a value: %j', (props, text) => {
  const { node, render, labels } = fixture({
    interactiveProps: {
      options: [{ label: 'Disabled', value: 'disabled', disabled: true }, '个人', '团队'],
      ...props
    }
  })
  expect(lowcodeTextProjection(node)?.node.text).toBe(text)
  render()
  expect(labels()).toEqual(text === '' ? [] : [expect.objectContaining({ text })])
})

test('an explicit empty option owns its display label and may be deliberately selected', () => {
  const { node, render, labels } = fixture({
    interactiveProps: {
      options: [
        { label: '所有团队', value: '' },
        { label: '团队', value: 'team' }
      ],
      value: '',
      placeholder: '请选择',
      allowClear: true
    }
  })
  render()
  expect(labels()).toMatchObject([{ text: '所有团队' }])
  expect(lowcodeTextProjection(node)?.contentKind).toBe('select_value')
})

test('bound page and document defaults take precedence, including an explicitly empty value', () => {
  for (const scope of ['page', 'document'] as const) {
    const { graph, node, render, labels } = fixture()
    const owner = scope === 'page' ? graph.getPages()[0].id : graph.rootId
    graph.updateNode(node.id, {
      bindings: {
        value:
          scope === 'page'
            ? { kind: 'ref', stateId: 'plan' }
            : { kind: 'docState', docStateName: 'plan' }
      }
    })
    for (const defaultValue of ['个人', '']) {
      graph.updateNode(owner, {
        [scope === 'page' ? 'state' : 'lowcodeDocumentState']: [
          { id: 'plan', name: 'plan', type: 'string', defaultValue }
        ]
      })
      render()
      expect(labels().at(-1)).toMatchObject({ text: defaultValue || '请选择' })
    }
    expect(node.interactiveProps.value).toBe('团队')
    expect(controlDesignDependencies(graph, node)).toContain(owner)
  }
})

test('unknown, computed and component-scoped bindings show a placeholder instead of a false selection', () => {
  const { graph, node, render, labels } = fixture()
  const page = graph.getPages()[0]
  graph.updateNode(page.id, {
    state: [{ id: 'plan', name: 'plan', type: 'string', defaultValue: '个人', computedExpr: '' }]
  })
  for (const value of [
    { kind: 'ref', stateId: 'missing' },
    { kind: 'ref', stateId: 'plan' },
    { kind: 'expr', expr: 'plan' }
  ] as const) {
    graph.updateNode(node.id, { bindings: { value } })
    render()
    expect(labels().at(-1)).toMatchObject({ text: '请选择' })
  }
  graph.updateNode(page.id, {
    state: [{ id: 'plan', name: 'plan', type: 'string', defaultValue: '个人' }]
  })
  graph.updateNode(node.id, { bindings: { value: { kind: 'ref', stateId: 'plan' } } })
  const component = graph.createNode('COMPONENT', page.id)
  graph.reparentNode(node.id, component.id)
  render()
  expect(labels().at(-1)).toMatchObject({ text: '请选择' })
})

test.each(['ref', 'stateRef', 'docStateRef'] as const)(
  'reads %s option defaults through simple own-data paths and preflights the actual Chinese label',
  (kind) => {
    const { graph, node, render, labels } = fixture({
      interactiveProps: {
        options: ['Ignored static'],
        value: 'team',
        placeholder: 'Choose',
        optionsSource: {
          kind,
          stateId: 'choices',
          docStateName: 'choices',
          itemName: 'option',
          valueExpr: 'option.id',
          labelExpr: 'option.name'
        }
      }
    })
    const owner = kind === 'docStateRef' ? graph.rootId : graph.getPages()[0].id
    graph.updateNode(owner, {
      [kind === 'docStateRef' ? 'lowcodeDocumentState' : 'state']: [
        {
          id: 'choices',
          name: 'choices',
          type: 'array',
          defaultValue: [{ id: 'team', name: '团队计划' }]
        }
      ]
    })
    render()
    expect(labels()).toMatchObject([{ text: '团队计划' }])
    expect(controlDesignDependencies(graph, node)).toContain(owner)
    const requirements = collectGraphFontRequirements(graph, [node.id])
    expect(requirements.characters).toBe('团队计划')
    expect(requirements.scripts).toEqual(['cjk-sc'])
    expect(requirements.nodes[0]).toMatchObject({ id: node.id, type: 'TEXT', text: '团队计划' })
  }
)

test('simple string sources work, while expressions, missing and invalid dynamic sources never fall back to static options', () => {
  const { graph, node, render, labels } = fixture({
    interactiveProps: {
      options: ['Static'],
      value: 'Static',
      placeholder: 'Loading',
      optionsSource: { kind: 'ref', stateId: 'choices' }
    }
  })
  const page = graph.getPages()[0]
  render()
  expect(labels().at(-1)).toMatchObject({ text: 'Loading' })
  graph.updateNode(page.id, {
    state: [{ id: 'choices', name: 'choices', type: 'array', defaultValue: ['Static'] }]
  })
  render()
  expect(labels().at(-1)).toMatchObject({ text: 'Static' })
  for (const labelExpr of ['item + " label"', 'item.constructor', 'item.toString()']) {
    graph.updateNode(node.id, {
      interactiveProps: {
        ...node.interactiveProps,
        optionsSource: { kind: 'ref', stateId: 'choices', labelExpr }
      }
    })
    render()
    expect(labels().at(-1)).toMatchObject({ text: 'Loading' })
  }
  expect(selectDesignContent(graph, node).unresolved).toBe(true)
})

test('dims disabled text and arrow, truncates long labels and clips extremely small bounds', () => {
  const disabled = fixture({
    interactiveProps: { options: ['团队'], value: '团队', disabled: true, textColor: '#336699' }
  })
  disabled.render()
  expect(disabled.renderer.color4f).toHaveBeenCalledWith(0.2, 0.4, 0.6, 0.45)
  const tiny = fixture({ width: 28, height: 10, paddingTop: 0, paddingBottom: 0 })
  tiny.render()
  expect(tiny.labels()).toEqual([])
  expect(tiny.canvas.drawLine).toHaveBeenCalledTimes(2)
  const empty = fixture({ width: 20 })
  empty.render()
  expect(empty.labels()).toEqual([])
  expect(empty.canvas.drawLine).not.toHaveBeenCalled()
})

test('dynamic own-data reads never call getters or confuse compiler-renamed iterator scopes', () => {
  const { graph, node, render, labels } = fixture({
    interactiveProps: {
      value: 'team',
      placeholder: 'Unknown initial data',
      optionsSource: {
        kind: 'ref',
        stateId: 'choices',
        valueExpr: 'item.id',
        labelExpr: 'item.label'
      }
    }
  })
  const getter = mock(() => 'Must not run')
  const item = { id: 'team' }
  Object.defineProperty(item, 'label', { enumerable: true, get: getter })
  const page = graph.getPages()[0]
  graph.updateNode(page.id, {
    state: [{ id: 'choices', name: 'choices', type: 'array', defaultValue: [item] }]
  })
  render()
  expect(labels().at(-1)).toMatchObject({ text: 'Unknown initial data' })
  expect(getter).not.toHaveBeenCalled()

  graph.updateNode(page.id, {
    state: [
      {
        id: 'choices',
        name: 'choices',
        type: 'array',
        defaultValue: [{ id: 'team', label: 'Team' }]
      },
      { id: 'item', name: 'item', type: 'string', defaultValue: 'Reserved page scope' }
    ]
  })
  render()
  expect(labels().at(-1)).toMatchObject({ text: 'Unknown initial data' })
  graph.updateNode(node.id, {
    interactiveProps: {
      ...node.interactiveProps,
      optionsSource: {
        kind: 'ref',
        stateId: 'choices',
        itemName: 'row',
        valueExpr: 'row.id',
        labelExpr: 'row.label'
      }
    }
  })
  render()
  expect(labels().at(-1)).toMatchObject({ text: 'Team' })
  const list = graph.createNode('LIST', page.id)
  graph.reparentNode(node.id, list.id)
  render()
  expect(labels().at(-1)).toMatchObject({ text: 'Unknown initial data' })
})

test('moving selects between pages refreshes both their option source and selected initial value', () => {
  const { graph, node, render, labels } = fixture({
    bindings: { value: { kind: 'ref', stateId: 'selection' } },
    interactiveProps: { placeholder: 'Choose', optionsSource: { kind: 'ref', stateId: 'choices' } }
  })
  const first = graph.getPages()[0]
  const second = graph.addPage('Another page')
  for (const [page, defaultValue] of [
    [first, 'First'],
    [second, 'Second']
  ] as const) {
    graph.updateNode(page.id, {
      state: [
        { id: 'choices', name: 'choices', type: 'array', defaultValue: [defaultValue] },
        { id: 'selection', name: 'selection', type: 'string', defaultValue }
      ]
    })
  }
  render()
  expect(labels().at(-1)).toMatchObject({ text: 'First' })
  graph.reparentNode(node.id, second.id)
  render()
  expect(labels().at(-1)).toMatchObject({ text: 'Second' })
  expect(controlDesignDependencies(graph, node)).toEqual([second.id])
})

test('a null option source leaves static SELECT options active, matching native compilation', () => {
  const { graph, node, render, labels } = fixture({
    interactiveProps: { options: ['团队'], optionsSource: null }
  })
  expect(selectDesignContent(graph, node).unresolved).toBe(false)
  render()
  expect(labels()).toMatchObject([{ text: '团队' }])
})
