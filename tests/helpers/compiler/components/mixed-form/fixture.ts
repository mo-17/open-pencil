import { compile, withDefaults } from '@open-pencil/compiler'
import { createSliderModuleFrameOverrides } from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

import { moduleValuesGraph } from '../module-values/fixture'

/** A single real SceneGraph exercises native and module fields under one FORM owner. */
export function mixedFormFixture(target: 'react' | 'vue') {
  const { graph, page, form } = moduleValuesGraph()
  if (!(graph instanceof SceneGraph)) throw new Error('Expected a SceneGraph')
  graph.updateNode(page.id, {
    state: [
      ...(graph.getNode(page.id)?.state ?? []),
      { id: 'pageQuantity', name: 'pageQuantity', type: 'number', defaultValue: 2 },
      { id: 'color', name: 'color', type: 'string', defaultValue: '#2563eb' },
      { id: 'city', name: 'city', type: 'string', defaultValue: '北京 Beijing' },
      { id: 'showCity', name: 'showCity', type: 'boolean', defaultValue: true },
      { id: 'otherQuantity', name: 'otherQuantity', type: 'number', defaultValue: 9 },
      { id: 'reviewScore', name: 'reviewScore', type: 'number', defaultValue: 11 },
      { id: 'lockedScore', name: 'lockedScore', type: 'number', defaultValue: 17 }
    ]
  })
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [
      ...(graph.getNode(graph.rootId)?.lowcodeDocumentState ?? []),
      { id: 'documentQuantity', name: 'documentQuantity', type: 'number', defaultValue: 4 },
      { id: 'mainEmbedded', name: 'mainEmbedded', type: 'number', defaultValue: 6 },
      { id: 'otherEmbedded', name: 'otherEmbedded', type: 'number', defaultValue: 13 }
    ]
  })
  graph.updateNode(form.id, { height: 1150 })
  graph.createNode('INPUT', form.id, {
    name: 'Page number',
    width: 310,
    height: 44,
    interactiveProps: {
      inputType: 'number',
      ariaLabel: 'Page number',
      min: -10,
      max: 10,
      step: 0.5,
      validation: { required: true }
    },
    bindings: { value: { kind: 'ref', stateId: 'pageQuantity' } }
  })
  graph.createNode('INPUT', form.id, {
    name: 'Document number',
    width: 310,
    height: 44,
    interactiveProps: {
      inputType: 'number',
      ariaLabel: 'Document number',
      showStepper: true,
      stepperPlacement: 'sides',
      min: -10,
      max: 10,
      step: 0.5,
      validation: { required: true }
    },
    bindings: { value: { kind: 'docState', docStateName: 'documentQuantity' } }
  })
  graph.createNode('INPUT', form.id, {
    name: 'Color',
    width: 310,
    height: 44,
    interactiveProps: { inputType: 'color', ariaLabel: 'Color', validation: { required: true } },
    bindings: { value: { kind: 'ref', stateId: 'color' } }
  })
  graph.createNode('INPUT', form.id, {
    name: 'City',
    width: 310,
    height: 44,
    renderCondition: 'showCity',
    interactiveProps: {
      inputType: 'text',
      ariaLabel: 'City',
      suggestions: ['北京 Beijing', '厦门 Xiamen', '上海 Shanghai'],
      validation: { required: true }
    },
    bindings: { value: { kind: 'ref', stateId: 'city' } }
  })
  const addSlider = (
    parentId: string,
    label: string,
    binding: { kind: 'ref'; stateId: string } | { kind: 'docState'; docStateName: string },
    flags: { readOnly?: boolean; disabled?: boolean } = {}
  ) => {
    const overrides = createSliderModuleFrameOverrides({ label, ...flags })
    graph.createNode('FRAME', parentId, {
      ...overrides,
      bindings: { value: binding },
      interactiveProps: { ...overrides.interactiveProps, lang: 'en' }
    })
  }
  addSlider(form.id, 'Review score', { kind: 'ref', stateId: 'reviewScore' }, { readOnly: true })
  addSlider(form.id, 'Locked score', { kind: 'ref', stateId: 'lockedScore' }, { disabled: true })
  const other = graph.createNode('FORM', page.id, {
    name: 'Other form',
    x: 470,
    y: 300,
    width: 320,
    height: 140,
    layoutMode: 'VERTICAL',
    itemSpacing: 8
  })
  graph.createNode('INPUT', other.id, {
    name: 'Other number',
    width: 300,
    height: 44,
    interactiveProps: { inputType: 'number', ariaLabel: 'Other number' },
    bindings: { value: { kind: 'ref', stateId: 'otherQuantity' } }
  })
  const library = graph.addPage('Library')
  const mainMaster = graph.createNode('COMPONENT', library.id, { name: 'Main embedded score' })
  addSlider(mainMaster.id, 'Main embedded score', {
    kind: 'docState',
    docStateName: 'mainEmbedded'
  })
  const otherMaster = graph.createNode('COMPONENT', library.id, { name: 'Other embedded score' })
  addSlider(otherMaster.id, 'Other embedded score', {
    kind: 'docState',
    docStateName: 'otherEmbedded'
  })
  graph.createInstance(mainMaster.id, form.id)
  graph.createInstance(otherMaster.id, other.id)
  let buttonIndex = 0
  const button = (text: string, stateId: string, valueExpr: string) =>
    graph.createNode('BUTTON', page.id, {
      name: text,
      x: 470,
      y: buttonIndex++ * 46,
      width: 130,
      height: 36,
      interactiveProps: { text, type: 'button' },
      events: {
        onClick: [{ id: 'fixture-action-1', kind: 'setState', targetStateId: stateId, valueExpr }]
      }
    })
  button('External number', 'pageQuantity', '8')
  button('Hide city', 'showCity', 'pageQuantity > 100')
  button('Show city', 'showCity', 'pageQuantity >= 0')
  graph.createNode('BUTTON', page.id, {
    name: 'External document number',
    x: 470,
    y: buttonIndex++ * 46,
    width: 200,
    height: 36,
    interactiveProps: { text: 'External document number', type: 'button' },
    events: {
      onClick: [
        {
          id: 'fixture-action-2',
          kind: 'setVariable',
          targetName: 'documentQuantity',
          valueExpr: '7'
        }
      ]
    }
  })
  for (const [index, stateId, value] of [
    ['Review score', 'reviewScore', '12'],
    ['Locked score', 'lockedScore', '18']
  ] as const)
    graph.createNode('BUTTON', page.id, {
      name: `External ${index}`,
      x: 820,
      y: index === 'Review score' ? 0 : 46,
      width: 180,
      height: 36,
      interactiveProps: { text: `External ${index}`, type: 'button' },
      events: {
        onClick: [
          { id: 'fixture-action-3', kind: 'setState', targetStateId: stateId, valueExpr: value }
        ]
      }
    })
  for (const [index, name, value] of [
    [0, 'mainEmbedded', '7'],
    [1, 'otherEmbedded', '14']
  ] as const)
    graph.createNode('BUTTON', page.id, {
      name: `External ${name}`,
      x: 820,
      y: 92 + index * 46,
      width: 180,
      height: 36,
      interactiveProps: { text: `External ${name}`, type: 'button' },
      events: {
        onClick: [
          { id: 'fixture-action-4', kind: 'setVariable', targetName: name, valueExpr: value }
        ]
      }
    })
  graph.createNode('TEXT', page.id, {
    name: 'Mixed state',
    x: 470,
    y: 210,
    width: 500,
    height: 44,
    text: 'Mixed state',
    bindings: {
      text: {
        kind: 'expr',
        expr: '"Mixed:" + pageQuantity + "/" + documentQuantity + "/" + color + "/" + city + "/" + otherQuantity + "/" + submitted'
      }
    }
  })
  graph.createNode('TEXT', page.id, {
    name: 'Protected state',
    x: 820,
    y: 210,
    width: 520,
    height: 44,
    text: 'Protected state',
    bindings: {
      text: {
        kind: 'expr',
        expr: '"Protected:" + reviewScore + "/" + lockedScore + "/" + mainEmbedded + "/" + otherEmbedded'
      }
    }
  })
  return compile({
    graph,
    pageIds: [page.id],
    options: withDefaults({ target, router: 'none', devMode: false, sourceLocale: 'zh-CN' })
  })
}
