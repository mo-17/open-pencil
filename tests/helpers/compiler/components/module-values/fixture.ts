import { compile, withDefaults } from '@open-pencil/compiler'
import {
  createSliderModuleFrameOverrides,
  createRatingModuleFrameOverrides,
  createDateRangeModuleFrameOverrides,
  createCascaderModuleFrameOverrides
} from '@open-pencil/core/plugins'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

export function moduleValuesGraph() {
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  graph.updateNode(page.id, {
    state: [
      { id: 'amount', name: 'amount', type: 'number', defaultValue: 20 },
      { id: 'end', name: 'end', type: 'number', defaultValue: 80 },
      { id: 'rating', name: 'rating', type: 'number', defaultValue: 0 },
      { id: 'startDate', name: 'startDate', type: 'string', defaultValue: '' },
      { id: 'path', name: 'path', type: 'array', defaultValue: [] },
      { id: 'submitted', name: 'submitted', type: 'number', defaultValue: 0 }
    ]
  })
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [{ id: 'endDate', name: 'endDate', type: 'string', defaultValue: '' }]
  })
  const form = graph.createNode('FORM', page.id, {
    name: 'Bound modules',
    width: 340,
    height: 820,
    layoutMode: 'VERTICAL',
    itemSpacing: 12,
    events: {
      onSubmit: [{ kind: 'setState', targetStateId: 'submitted', valueExpr: 'submitted + 1' }]
    }
  })
  function add(
    overrides: Partial<SceneNode>,
    value: string,
    endValue?: string,
    documentEnd = false
  ) {
    return graph.createNode('FRAME', form.id, {
      ...overrides,
      bindings: {
        value: { kind: 'ref', stateId: value },
        ...(endValue
          ? {
              endValue: documentEnd
                ? { kind: 'docState' as const, docStateName: endValue }
                : { kind: 'ref' as const, stateId: endValue }
            }
          : {})
      },
      interactiveProps: {
        ...overrides.interactiveProps,
        lang: 'en',
        validation: { required: true },
        ...(endValue ? { endValidation: { required: true } } : {})
      }
    })
  }
  const slider = add(
    createSliderModuleFrameOverrides({ label: 'Budget', range: true }),
    'amount',
    'end'
  )
  const rating = add(createRatingModuleFrameOverrides({ label: 'Experience' }), 'rating')
  const dates = add(
    createDateRangeModuleFrameOverrides({ label: 'Travel dates' }),
    'startDate',
    'endDate',
    true
  )
  const cascader = add(createCascaderModuleFrameOverrides({ label: 'Destination' }), 'path')
  graph.createNode('BUTTON', form.id, {
    width: 320,
    height: 44,
    interactiveProps: { text: 'Submit' }
  })
  graph.createNode('TEXT', form.id, {
    width: 320,
    height: 30,
    text: 'Values',
    bindings: {
      text: {
        kind: 'expr',
        expr: '"Values:" + amount + "/" + end + "/" + rating + "/" + startDate + "/" + endDate + "/" + submitted'
      }
    }
  })
  return { graph, page, form, slider, rating, dates, cascader }
}
export function moduleValuesFixture(target: 'react' | 'vue') {
  const { graph, page } = moduleValuesGraph()
  return compile({
    graph,
    pageIds: [page.id],
    options: withDefaults({ target, router: 'none', devMode: false })
  })
}
