import { createStepperModuleFrameOverrides } from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

export function stepperGraph() {
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  graph.updateNode(page.id, {
    state: [
      { id: 'step', name: 'step', type: 'number', defaultValue: 0 },
      { id: 'changed', name: 'changed', type: 'number', defaultValue: 0 },
      { id: 'previous', name: 'previous', type: 'number', defaultValue: 0 },
      { id: 'calls', name: 'calls', type: 'number', defaultValue: 0 }
    ]
  })
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [{ id: 'doc-step', name: 'docStep', type: 'number', defaultValue: 1 }]
  })
  const form = graph.createNode('FORM', page.id, { name: 'Stepper form' })
  const overrides = createStepperModuleFrameOverrides({
    currentIndex: 1,
    allowStepClick: true,
    items: [
      { title: 'Details', description: '', status: 'auto', disabled: false },
      { title: 'Review', description: '', status: 'auto', disabled: false },
      { title: 'Locked', description: '', status: 'auto', disabled: true },
      { title: 'Complete', description: '', status: 'auto', disabled: false }
    ]
  })
  const main = graph.createNode('FRAME', form.id, {
    ...overrides,
    name: 'Bound page Stepper',
    bindings: { currentIndex: { kind: 'ref', stateId: 'step' } },
    events: {
      onChange: [
        { id: 'set-value', kind: 'setState', targetStateId: 'changed', valueExpr: '$value' },
        {
          id: 'set-value',
          kind: 'setState',
          targetStateId: 'previous',
          valueExpr: '$event.detail.previousIndex'
        },
        { id: 'set-value', kind: 'setState', targetStateId: 'calls', valueExpr: 'calls + 1' }
      ]
    }
  })
  const sibling = graph.createNode('FRAME', form.id, {
    ...overrides,
    name: 'Shared page Stepper',
    bindings: { currentIndex: { kind: 'ref', stateId: 'step' } }
  })
  const doc = graph.createNode('FRAME', form.id, {
    ...overrides,
    name: 'Bound document Stepper',
    bindings: { currentIndex: { kind: 'docState', docStateName: 'docStep' } }
  })
  const local = graph.createNode('FRAME', form.id, { ...overrides, name: 'Local Stepper' })
  return { graph, page, form, main, sibling, doc, local }
}
