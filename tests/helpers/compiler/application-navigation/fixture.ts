import { compile, withDefaults } from '@open-pencil/compiler'

import { applicationModeFixture } from '../application-mode/fixture'

/** Parameter detail pages and URL-bound content in the optional application scope. */
export function applicationNavigationFixture() {
  const fixture = applicationModeFixture(true)
  const { graph, products, productsEntry, toProducts } = fixture
  graph.updateNode(products.id, { lowcodeRoutePattern: '/products/:id' })
  graph.updateNode(toProducts.id, {
    events: {
      onClick: [
        {
          kind: 'navigate',
          to: '/products/:id?tab=details&filter=a%2Fb#reviews',
          params: { id: '"42"' }
        }
      ]
    }
  })
  const location = graph.createNode('TEXT', productsEntry.id, {
    name: 'Product location',
    width: 312,
    height: 32,
    fontSize: 16,
    text: 'Product location',
    bindings: { text: { kind: 'expr', expr: '"Product: " + $params.id + " / tab: " + $query.tab' } }
  })
  graph.createNode('BUTTON', productsEntry.id, {
    name: 'Open related product',
    width: 312,
    height: 48,
    interactiveProps: { text: 'Open related product' },
    events: {
      onClick: [{ kind: 'navigate', to: '/products/:id?tab=related#specs', params: { id: '"73"' } }]
    }
  })
  return { ...fixture, location }
}

export function compileApplicationNavigationFixture(target: 'react' | 'vue') {
  const { graph } = applicationNavigationFixture()
  return compile({
    graph,
    pageIds: graph.getPages().map((page) => page.id),
    options: withDefaults({
      target,
      router: target === 'react' ? 'react-router-v6' : 'vue-router-v4',
      devMode: true
    })
  })
}
