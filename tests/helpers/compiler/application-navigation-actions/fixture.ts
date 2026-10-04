import { compile, withDefaults } from '@open-pencil/compiler'
import type { ActionDef, SceneNode } from '@open-pencil/scene-graph'

import { applicationSessionFixture } from '../application-session/fixture'

export function compileApplicationNavigationActionsFixture(target: 'react' | 'vue') {
  const fixture = applicationSessionFixture('preserve')
  const { graph, homeEntry, productsEntry } = fixture
  function button(owner: SceneNode, text: string, action: ActionDef) {
    graph.createNode('BUTTON', owner.id, {
      width: 312,
      height: 48,
      interactiveProps: { text },
      events: { onClick: [action] }
    })
  }
  button(homeEntry, 'Safe back', {
    id: 'safe-home-back',
    kind: 'back',
    fallback: '/home?category=fallback#top'
  })
  button(homeEntry, 'Replace with details', {
    id: 'replace-detail',
    kind: 'navigate',
    to: '/products/42?mode=edit#form',
    history: 'replace'
  })
  button(productsEntry, 'Safe back', {
    id: 'safe-detail-back',
    kind: 'back',
    fallback: '/home?category=fallback#top'
  })
  return compile({
    graph,
    pageIds: graph.getPages().map((page) => page.id),
    options: withDefaults({
      target,
      devMode: true,
      router: target === 'react' ? 'react-router-v6' : 'vue-router-v4',
      packageName: 'application_navigation_actions_fixture'
    })
  })
}
