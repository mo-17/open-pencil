import { compile, withDefaults } from '@open-pencil/compiler'
import { createChartModuleFrameOverrides } from '@open-pencil/core/plugins'
import { SceneGraph, type BindingExpr } from '@open-pencil/scene-graph'

export const CHART_BOUND_INITIAL = { values: [15, 45], labels: ['绑定甲', '绑定乙'] }
export const CHART_BOUND_REPLACEMENT = {
  values: [30, 10, 60],
  labels: ['新收入', '<b>支出</b>', '净额']
}

/** Complete authored graph: compiled bindings, computed data and external actions are exercised. */
export function chartDataGraph() {
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  graph.updateNode(page.id, {
    state: [
      { id: 'chartData', name: 'chartData', type: 'object', defaultValue: CHART_BOUND_INITIAL },
      {
        id: 'chartComputed',
        name: 'chartComputed',
        type: 'object',
        defaultValue: {},
        computedExpr: 'chartData'
      },
      { id: 'revision', name: 'revision', type: 'number', defaultValue: 0 },
      {
        id: 'chartInitial',
        name: 'chartInitial',
        type: 'object',
        defaultValue: CHART_BOUND_INITIAL
      },
      {
        id: 'chartReplacement',
        name: 'chartReplacement',
        type: 'object',
        defaultValue: CHART_BOUND_REPLACEMENT
      },
      {
        id: 'chartEmpty',
        name: 'chartEmpty',
        type: 'object',
        defaultValue: { values: [], labels: [] }
      },
      {
        id: 'chartInvalid',
        name: 'chartInvalid',
        type: 'object',
        defaultValue: { values: [1], labels: [] }
      },
      {
        id: 'chartDocReplacement',
        name: 'chartDocReplacement',
        type: 'object',
        defaultValue: { values: [80, 20], labels: ['文档新甲', '文档新乙'] }
      }
    ]
  })
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [
      {
        id: 'chartDoc',
        name: 'chartDoc',
        type: 'object',
        defaultValue: { values: [24], labels: ['文档数据'] }
      }
    ]
  })
  const controls = [
    ['Replace data', 'chartData', 'chartReplacement', false],
    ['Empty data', 'chartData', 'chartEmpty', false],
    ['Invalid data', 'chartData', 'chartInvalid', false],
    ['Repair data', 'chartData', 'chartInitial', false],
    ['Replace document', 'chartDoc', 'chartDocReplacement', true],
    ['Rerender host', 'revision', 'revision + 1', false]
  ] as const
  controls.forEach(([label, name, valueExpr, document], index) => {
    graph.createNode('BUTTON', page.id, {
      x: 20 + (index % 2) * 164,
      y: 20 + Math.floor(index / 2) * 48,
      width: 152,
      height: 40,
      interactiveProps: { text: label },
      events: {
        onClick: [
          document
            ? { kind: 'setVariable', targetName: name, valueExpr }
            : { kind: 'setState', targetStateId: name, valueExpr }
        ]
      }
    })
  })
  graph.createNode('TEXT', page.id, {
    x: 20,
    y: 170,
    width: 320,
    height: 30,
    bindings: { text: { kind: 'expr', expr: '"Revision: " + revision' } }
  })
  const bindings: (BindingExpr | undefined)[] = [
    ...Array.from({ length: 5 }, () => ({ kind: 'ref' as const, stateId: 'chartData' })),
    { kind: 'docState', docStateName: 'chartDoc' },
    { kind: 'ref', stateId: 'chartComputed' },
    { kind: 'expr', expr: 'chartData' },
    undefined
  ]
  const nodes = bindings.map((binding, index) =>
    graph.createNode('FRAME', page.id, {
      ...createChartModuleFrameOverrides({
        chartType: (['bar', 'line', 'area', 'pie', 'donut'] as const)[index % 5],
        values: [99],
        labels: ['Authored example'],
        showValues: true
      }),
      x: 20,
      y: 220 + index * 220,
      width: 320,
      height: 200,
      textLanguage: 'zh-CN',
      ...(binding ? { bindings: { data: binding } } : {})
    })
  )
  return { graph, page, nodes }
}

export function chartDataFixture(target: 'react' | 'vue') {
  const { graph, page } = chartDataGraph()
  const output = compile({
    graph,
    pageIds: [page.id],
    options: withDefaults({ target, router: 'none', devMode: false })
  })
  const html = output.files.get('index.html')
  if (typeof html === 'string')
    output.files.set('index.html', html.replace(/<html[^>]*>/, '<html lang="zh-CN">'))
  return output
}
