import { compile, withDefaults } from '@open-pencil/compiler'
import { createSlideMenuModuleInstance } from '@open-pencil/core/plugins'

import { compositionGraph } from '../composition'

/** A mapped native FORM is logically inside its owner and portaled outside its DOM FORM. */
export function slideMenuFormFixture(target: 'react' | 'vue') {
  const { graph, pageId, modal, modalBody, tabs } = compositionGraph()
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [
      ...(graph.getNode(graph.rootId)?.lowcodeDocumentState ?? []).map((state) =>
        state.name === 'modalEmail' ? { ...state, defaultValue: 'inner-default' } : state
      ),
      { id: 'outerValue', name: 'outerValue', type: 'string', defaultValue: 'outer-default' },
      { id: 'outerSubmits', name: 'outerSubmits', type: 'number', defaultValue: 0 }
    ]
  })
  graph.updateNode(tabs.id, { visible: false })
  const outer = graph.createNode('FORM', pageId, {
    name: 'Outer form',
    x: 24,
    y: 24,
    width: 450,
    height: 360,
    layoutMode: 'VERTICAL',
    itemSpacing: 12,
    events: {
      onSubmit: [{ kind: 'setVariable', targetName: 'outerSubmits', valueExpr: '$prev + 1' }]
    }
  })
  graph.createNode('INPUT', outer.id, {
    name: 'Outer value',
    width: 320,
    height: 44,
    bindings: { value: { kind: 'docState', docStateName: 'outerValue' } },
    interactiveProps: {
      ariaLabel: 'Outer value',
      validation: { required: true, messages: { required: 'Outer is required' } }
    }
  })
  graph.createNode('BUTTON', outer.id, {
    width: 140,
    height: 44,
    interactiveProps: { text: 'Save outer', type: 'submit' }
  })
  graph.createNode('TEXT', outer.id, {
    width: 400,
    height: 40,
    bindings: {
      text: { kind: 'expr', expr: '"Outer:" + outerValue + "/" + outerSubmits' }
    }
  })
  graph.reparentNode(modal.id, outer.id)
  graph.updateNode(modal.id, {
    x: 0,
    y: 0,
    width: 180,
    height: 48,
    interactiveProps: {
      module: createSlideMenuModuleInstance({
        presentation: 'dialog',
        direction: 'right',
        triggerLabel: 'Open inner form',
        title: 'Inner drawer',
        description: '',
        panelSize: 420,
        items: [],
        contentChildName: modalBody.name
      })
    }
  })
  graph.updateNode(modalBody.id, { width: 350, height: 280 })
  const innerInput = graph.getChildren(modalBody.id).find((node) => node.type === 'INPUT')
  if (!innerInput) throw new Error('Mapped inner input unavailable')
  graph.updateNode(innerInput.id, {
    interactiveProps: {
      ariaLabel: 'Inner value',
      validation: { required: true, messages: { required: 'Inner is required' } }
    }
  })
  graph.createNode('BUTTON', modalBody.id, {
    width: 140,
    height: 44,
    interactiveProps: { text: 'Reset inner', type: 'reset' }
  })
  graph.createNode('TEXT', modalBody.id, {
    width: 340,
    height: 40,
    bindings: { text: { kind: 'expr', expr: '"Inner:" + modalEmail + "/" + status' } }
  })
  return compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({
      target,
      router: 'none',
      packageName: 'slide-menu-form-boundary',
      sourceLocale: 'en',
      devMode: false
    })
  })
}
