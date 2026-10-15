import { compile, withDefaults } from '#compiler/index'

import { SceneGraph } from '@open-pencil/scene-graph'

export function validationIdentityFixture(target: 'react' | 'vue', kit = false) {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [{ id: 'value', name: 'value', type: 'string', defaultValue: '' }]
  })
  graph.updateNode(page.id, {
    state: [{ id: 'rows', name: 'rows', type: 'array', defaultValue: ['first', 'second'] }]
  })
  const createForm = (parent: string, x = 0, y = 0) =>
    graph.createNode('FORM', parent, {
      x,
      y,
      width: 360,
      height: 340,
      layoutMode: 'VERTICAL',
      itemSpacing: 12
    })
  const createField = (parent: string, name: string) =>
    graph.createNode('INPUT', parent, {
      name,
      width: 320,
      height: 36,
      interactiveProps: {
        ariaLabel: name,
        validation: { required: true, messages: { required: name + ' required' } }
      },
      bindings: { value: { kind: 'docState', docStateName: 'value' } }
    })
  const createSubmit = (parent: string, text: string) =>
    graph.createNode('BUTTON', parent, {
      width: 240,
      height: 40,
      interactiveProps: { text, type: 'submit' }
    })
  const repeated = createForm(page.id, 20, 20)
  let parent = repeated.id
  for (const height of [200, 92]) {
    parent = graph.createNode('LIST', parent, {
      width: 320,
      height,
      layoutMode: 'VERTICAL',
      itemSpacing: 8,
      interactiveProps: {
        dataSourceRef: { kind: 'stateRef', stateId: 'rows' },
        itemName: `item${height}`,
        indexName: `index${height}`
      }
    }).id
  }
  createField(parent, 'Repeated value')
  createSubmit(repeated.id, 'Validate repeated fields')

  const library = graph.addPage('Library')
  const master = graph.createNode('COMPONENT', library.id, {
    name: 'Validated card',
    width: 360,
    height: 180
  })
  const componentForm = createForm(master.id)
  graph.updateNode(componentForm.id, { height: 180 })
  createField(componentForm.id, 'Instance value')
  createSubmit(componentForm.id, 'Validate instance')
  for (const y of [20, 260]) {
    const instance = graph.createInstance(master.id, page.id)
    if (!instance) throw new Error('Fixture component instance unavailable')
    graph.updateNode(instance.id, { x: 440, y })
  }
  return compile({
    graph,
    pageIds: [page.id],
    options: withDefaults({ target, devMode: false, ...(kit ? { uiKit: 'shadcn' } : {}) })
  })
}
