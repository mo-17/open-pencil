import { compile, withDefaults } from '@open-pencil/compiler'
import {
  createModalModuleFrameOverrides,
  createTabsModuleFrameOverrides
} from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

export function compositionGraph() {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [
      { id: 'modal-email', name: 'modalEmail', type: 'string', defaultValue: '' },
      { id: 'tab-email', name: 'tabEmail', type: 'string', defaultValue: '' },
      { id: 'status', name: 'status', type: 'string', defaultValue: 'Not submitted' },
      { id: 'rows', name: 'rows', type: 'array', defaultValue: ['Alpha', 'Beta'] }
    ]
  })
  const modal = graph.createNode('FRAME', pageId, {
    ...createModalModuleFrameOverrides({
      triggerLabel: 'Open profile',
      title: 'Profile dialog',
      contentChildName: 'Dialog form'
    }),
    x: 24,
    y: 24
  })
  const tabs = graph.createNode('FRAME', pageId, {
    ...createTabsModuleFrameOverrides({
      tabs: [
        {
          id: 'profile',
          label: 'Profile',
          content: 'Legacy profile',
          contentChildName: 'Tab form'
        },
        { id: 'rows', label: 'Rows', content: 'Legacy rows', contentChildName: 'Rows list' }
      ],
      initialTabId: 'profile',
      activationMode: 'manual'
    }),
    x: 24,
    y: 110,
    width: 540,
    height: 340,
    layoutMode: 'VERTICAL'
  })
  function form(parentId: string, name: string, stateName: string, label: string) {
    const node = graph.createNode('FORM', parentId, {
      name,
      width: 350,
      height: 150,
      layoutMode: 'VERTICAL',
      itemSpacing: 12,
      events: {
        onSubmit: [
          {
            id: `${stateName}-save`,
            kind: 'setVariable',
            targetName: 'status',
            valueExpr: JSON.stringify(label + ' saved')
          }
        ]
      }
    })
    graph.createNode('INPUT', node.id, {
      width: 320,
      height: 44,
      bindings: { value: { kind: 'docState', docStateName: stateName } },
      interactiveProps: {
        placeholder: label + ' email',
        validation: { required: true, messages: { required: label + ' is required' } }
      }
    })
    graph.createNode('BUTTON', node.id, {
      width: 140,
      height: 44,
      interactiveProps: { text: 'Save ' + label, type: 'submit' }
    })
    return node
  }
  const modalBody = form(modal.id, 'Dialog form', 'modalEmail', 'Dialog')
  const tabBody = form(tabs.id, 'Tab form', 'tabEmail', 'Tab')
  const list = graph.createNode('LIST', tabs.id, {
    name: 'Rows list',
    width: 340,
    height: 150,
    layoutMode: 'VERTICAL',
    interactiveProps: {
      dataSourceRef: { kind: 'docStateRef', docStateName: 'rows' },
      itemName: 'row'
    }
  })
  graph.createNode('TEXT', list.id, { width: 320, height: 30, text: `Item: \${row}` })
  graph.createNode('TEXT', pageId, {
    x: 24,
    y: 480,
    width: 420,
    height: 40,
    bindings: { text: { kind: 'docState', docStateName: 'status' } }
  })
  return { graph, pageId, modal, tabs, modalBody, tabBody, list }
}

export function compositionFiles(target: 'react' | 'vue', hiddenContent = false) {
  const { graph, pageId, modalBody, tabBody } = compositionGraph()
  if (hiddenContent) {
    graph.updateNode(modalBody.id, { renderCondition: '1 === 2' })
    graph.updateNode(tabBody.id, { renderCondition: '1 === 2' })
  }
  return compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({
      target,
      router: 'none',
      packageName: 'component-composition',
      devMode: false
    })
  })
}
