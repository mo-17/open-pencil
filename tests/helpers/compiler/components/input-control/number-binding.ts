import { compile, withDefaults } from '@open-pencil/compiler'
import { SceneGraph } from '@open-pencil/scene-graph'

/** Number state bindings exercised through the generated page, not a replacement App. */
export function numberBindingFixture(
  target: 'react' | 'vue',
  required = true,
  uiKit?: 'shadcn',
  remote = false
) {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  graph.updateNode(pageId, {
    state: [
      { id: 'pageQuantity', name: 'pageQuantity', type: 'number', defaultValue: 2 },
      { id: 'submitCount', name: 'submitCount', type: 'number', defaultValue: 0 }
    ]
  })
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [
      { id: 'documentQuantity', name: 'documentQuantity', type: 'number', defaultValue: 4 }
    ]
  })
  const form = graph.createNode('FORM', pageId, {
    name: 'Number form',
    width: 360,
    height: 340,
    layoutMode: 'VERTICAL',
    itemSpacing: 12,
    paddingLeft: 12,
    paddingTop: 12,
    events: {
      onSubmit: [
        {
          id: 'fixture-action-1',
          kind: 'setState',
          targetStateId: 'submitCount',
          valueExpr: 'submitCount + 1'
        }
      ]
    }
  })
  const pageInput = graph.createNode('INPUT', form.id, {
    name: 'Page number',
    width: 300,
    height: 44,
    interactiveProps: {
      ariaLabel: 'Page number',
      inputType: 'number',
      min: -10,
      max: 10,
      step: 0.5,
      validation: required
        ? {
            required: true,
            messages: { required: 'Page number required' },
            ...(target === 'react' && remote
              ? {
                  async: {
                    url: 'https://validation.example.test/number',
                    method: 'POST' as const,
                    message: 'Page number was rejected'
                  }
                }
              : {})
          }
        : undefined
    },
    bindings: { value: { kind: 'ref', stateId: 'pageQuantity' } }
  })
  const documentInput = graph.createNode('INPUT', form.id, {
    name: 'Document number',
    width: 300,
    height: 44,
    interactiveProps: {
      ariaLabel: 'Document number',
      inputType: 'number',
      min: -10,
      max: 10,
      step: 0.5,
      showStepper: true,
      stepperPlacement: 'sides',
      validation: required
        ? { required: true, messages: { required: 'Document number required' } }
        : undefined
    },
    bindings: { value: { kind: 'docState', docStateName: 'documentQuantity' } }
  })
  graph.createNode('BUTTON', form.id, {
    width: 120,
    height: 40,
    interactiveProps: { text: 'Submit numbers', type: 'submit' }
  })
  graph.createNode('BUTTON', form.id, {
    width: 160,
    height: 40,
    interactiveProps: { text: 'Set page externally', type: 'button' },
    events: {
      onClick: [
        { id: 'fixture-action-2', kind: 'setState', targetStateId: 'pageQuantity', valueExpr: '7' }
      ]
    }
  })
  graph.createNode('TEXT', form.id, {
    width: 320,
    height: 32,
    text: 'Number state',
    bindings: {
      text: {
        kind: 'expr',
        expr: '"Page[" + pageQuantity + "] Doc[" + documentQuantity + "] Submitted[" + submitCount + "]"'
      }
    }
  })
  const result = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ target, router: 'none', devMode: false, uiKit })
  })
  return { ...result, pageInputId: pageInput.id, documentInputId: documentInput.id }
}
