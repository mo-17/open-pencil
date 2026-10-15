import { compile, withDefaults } from '@open-pencil/compiler'
import {
  createPaginationModuleFrameOverrides,
  createPaginationModuleInstance
} from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

export function paginationGraph() {
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  graph.updateNode(page.id, {
    state: [
      { id: 'page', name: 'page', type: 'number', defaultValue: 1 },
      { id: 'total', name: 'total', type: 'number', defaultValue: 95 },
      { id: 'size', name: 'size', type: 'number', defaultValue: 10 }
    ]
  })
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [{ id: 'docPage', name: 'docPage', type: 'number', defaultValue: 2 }]
  })
  const frame = graph.createNode('FRAME', page.id, {
    width: 350,
    height: 700,
    layoutMode: 'VERTICAL',
    itemSpacing: 12
  })
  const main = graph.createNode('FRAME', frame.id, {
    ...createPaginationModuleFrameOverrides({ label: 'Results pages', showFirstLast: true }),
    width: 350,
    interactiveProps: {
      lang: 'en',
      module: createPaginationModuleInstance({ label: 'Results pages', showFirstLast: true })
    },
    bindings: {
      currentPage: { kind: 'ref', stateId: 'page' },
      total: { kind: 'ref', stateId: 'total' },
      pageSize: { kind: 'ref', stateId: 'size' }
    }
  })
  const doc = graph.createNode('FRAME', frame.id, {
    ...createPaginationModuleFrameOverrides({ label: 'Document pages' }),
    width: 350,
    interactiveProps: {
      lang: 'en',
      module: createPaginationModuleInstance({ label: 'Document pages' })
    },
    bindings: {
      currentPage: { kind: 'docState', docStateName: 'docPage' },
      total: { kind: 'expr', expr: 'total + 5' },
      pageSize: { kind: 'ref', stateId: 'size' }
    }
  })
  graph.createNode('TEXT', frame.id, {
    name: 'Page output',
    width: 340,
    height: 30,
    bindings: {
      text: {
        kind: 'expr',
        expr: '"Page[" + page + "] Doc[" + docPage + "] Total[" + total + "] Size[" + size + "]"'
      }
    }
  })
  for (const [text, state, value] of [
    ['Empty', 'total', '0'],
    ['Shrink', 'total', '5'],
    ['Restore', 'total', '95'],
    ['Bad total', 'total', '-1'],
    ['Bad page', 'page', '0'],
    ['Reset page', 'page', '1'],
    ['Big page', 'page', '10'],
    ['Size 20', 'size', '20']
  ] as const)
    graph.createNode('BUTTON', frame.id, {
      width: 330,
      height: 36,
      interactiveProps: { text },
      events: {
        onClick: [
          { id: 'fixture-action-1', kind: 'setState', targetStateId: state, valueExpr: value }
        ]
      }
    })
  return { graph, page, main, doc, frame }
}
export function paginationFixture(target: 'react' | 'vue') {
  const { graph, page } = paginationGraph()
  return compile({
    graph,
    pageIds: [page.id],
    options: withDefaults({ target, router: 'none', devMode: false, sourceLocale: 'en' })
  })
}
