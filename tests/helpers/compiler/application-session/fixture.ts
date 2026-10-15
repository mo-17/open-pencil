import { compile, withDefaults } from '@open-pencil/compiler'
import type { SceneNode } from '@open-pencil/scene-graph'

import { applicationModeFixture } from '../application-mode/fixture'

export function applicationSessionFixture(retention: 'reset' | 'preserve' = 'preserve') {
  const fixture = applicationModeFixture(true)
  const { graph, home, homeEntry, products, productsEntry } = fixture
  const policy = home.lowcodeApplicationPage
  if (!policy) throw new Error('Missing fixture application page policy')
  graph.updateNode(home.id, {
    lowcodeApplicationPage: { ...policy, stateRetention: retention },
    state: [
      { id: 'filter', name: 'filter', type: 'string', defaultValue: '' },
      { id: 'page', name: 'page', type: 'number', defaultValue: 1 },
      { id: 'draftData', name: 'draftData', type: 'object', defaultValue: {} },
      { id: 'selectedItems', name: 'selectedItems', type: 'array', defaultValue: [] },
      {
        id: 'summary',
        name: 'summary',
        type: 'string',
        defaultValue: '',
        computedExpr: '"Page: " + page'
      }
    ]
  })
  graph.updateNode(homeEntry.id, { width: 360, height: 1800 })
  graph.createNode('INPUT', homeEntry.id, {
    width: 312,
    height: 48,
    interactiveProps: { placeholder: 'Filter products', text: '' },
    bindings: { value: { kind: 'ref', stateId: 'filter' } }
  })
  graph.createNode('TEXT', homeEntry.id, {
    text: 'Page: 1',
    width: 312,
    height: 32,
    bindings: { text: { kind: 'expr', expr: 'summary' } }
  })
  function button(owner: SceneNode, text: string, to: string) {
    graph.createNode('BUTTON', owner.id, {
      width: 312,
      height: 48,
      interactiveProps: { text },
      events: { onClick: [{ id: text, kind: 'navigate', to }] }
    })
  }
  graph.createNode('BUTTON', homeEntry.id, {
    width: 312,
    height: 48,
    interactiveProps: { text: 'Next list page' },
    events: {
      onClick: [
        { id: 'next-page', kind: 'setState', targetStateId: 'page', valueExpr: '$prev + 1' }
      ]
    }
  })
  button(homeEntry, 'Open second query', '/home?category=second')
  button(homeEntry, 'Open first query', '/home')
  button(homeEntry, 'Change fragment', '/home#selection')
  button(productsEntry, 'Return second query', '/home?category=second')
  const productPolicy = products.lowcodeApplicationPage
  if (!productPolicy) throw new Error('Missing product fixture policy')
  graph.updateNode(products.id, {
    lowcodeRoutePattern: '/products/:productId',
    lowcodeApplicationPage: { ...productPolicy, stateRetention: retention },
    state: [{ id: 'detailDraft', name: 'detailDraft', type: 'string', defaultValue: '' }]
  })
  graph.createNode('INPUT', productsEntry.id, {
    width: 312,
    height: 48,
    interactiveProps: { placeholder: 'Detail draft' },
    bindings: { value: { kind: 'ref', stateId: 'detailDraft' } }
  })
  button(productsEntry, 'Open next product', '/products/43')
  button(productsEntry, 'Open previous product', '/products/42')
  graph.createNode('BUTTON', productsEntry.id, {
    width: 312,
    height: 48,
    interactiveProps: { text: 'Back to previous page' },
    events: { onClick: [{ id: 'detail-back', kind: 'back', fallback: '/home' }] }
  })
  graph.updateNode(fixture.toProducts.id, {
    events: { onClick: [{ id: 'open-detail', kind: 'navigate', to: '/products/42' }] }
  })
  return fixture
}

export function compileApplicationSessionFixture(
  target: 'react' | 'vue',
  retention: 'reset' | 'preserve' = 'preserve'
) {
  const { graph } = applicationSessionFixture(retention)
  return compile({
    graph,
    pageIds: graph.getPages().map((page) => page.id),
    options: withDefaults({
      target,
      devMode: true,
      router: target === 'vue' ? 'vue-router-v4' : 'react-router-v6',
      packageName: 'application_session_fixture'
    })
  })
}
