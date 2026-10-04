import { compile, withDefaults } from '@open-pencil/compiler'
import type { ActionDef, SceneNode } from '@open-pencil/scene-graph'

import { applicationSessionFixture } from '../application-session/fixture'

export interface ApplicationGuardsFixtureOptions {
  hasAccess?: boolean
}

/** Real authored pages shared by standalone runtimes and editor acceptance. */
export function applicationGuardsFixture(options: ApplicationGuardsFixtureOptions = {}) {
  const fixture = applicationSessionFixture()
  const { graph, homeEntry, products, productsEntry } = fixture
  const productPolicy = products.lowcodeApplicationPage
  if (!productPolicy) throw new Error('Missing application product policy')
  const root = graph.getNode(graph.rootId)
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [
      ...(root?.lowcodeDocumentState ?? []),
      {
        id: 'hasAccess',
        name: 'hasAccess',
        type: 'boolean',
        defaultValue: options.hasAccess ?? true
      }
    ]
  })
  graph.updateNode(products.id, {
    lowcodeApplicationPage: {
      ...productPolicy,
      stateRetention: 'reset',
      enterGuard: {
        conditionExpr: 'hasAccess && $params.productId !== "blocked" && $query.mode !== "blocked"',
        fallback: '/home'
      },
      leaveConfirm: {
        dirtyExpr: 'detailDraft !== ""',
        message: 'Leave without saving this draft?'
      }
    }
  })
  graph.updateNode(productsEntry.id, { height: 1800 })
  function button(owner: SceneNode, text: string, actions: ActionDef[]) {
    return graph.createNode('BUTTON', owner.id, {
      name: text,
      width: 312,
      height: 48,
      interactiveProps: { text },
      events: { onClick: actions }
    })
  }
  const pushHome = button(productsEntry, 'Push Home', [
    { id: 'guard-push-home', kind: 'navigate', to: '/home' }
  ])
  const replaceHome = button(productsEntry, 'Replace with Home', [
    { id: 'guard-replace-home', kind: 'navigate', to: '/home', history: 'replace' }
  ])
  const grantAccess = button(homeEntry, 'Grant product access', [
    { id: 'guard-grant-access', kind: 'setVariable', targetName: 'hasAccess', valueExpr: '1 > 0' }
  ])
  const revokeActions: ActionDef[] = [
    {
      id: 'guard-revoke-access',
      kind: 'setVariable',
      targetName: 'hasAccess',
      valueExpr: '0 > 1'
    }
  ]
  button(homeEntry, 'Revoke product access', structuredClone(revokeActions))
  const revokeAccess = button(productsEntry, 'Revoke product access', revokeActions)
  button(homeEntry, 'Open blocked product', [
    { id: 'guard-blocked-param', kind: 'navigate', to: '/products/blocked' }
  ])
  button(homeEntry, 'Open blocked query', [
    { id: 'guard-blocked-query', kind: 'navigate', to: '/products/42?mode=blocked' }
  ])
  const detailQuery = button(productsEntry, 'Open detail query', [
    { id: 'guard-detail-query', kind: 'navigate', to: '/products/43?mode=edit' }
  ])
  return { ...fixture, pushHome, replaceHome, grantAccess, revokeAccess, detailQuery }
}

export function compileApplicationGuardsFixture(
  target: 'react' | 'vue',
  options: ApplicationGuardsFixtureOptions = {}
) {
  const { graph } = applicationGuardsFixture(options)
  return compile({
    graph,
    pageIds: graph.getPages().map(({ id }) => id),
    options: withDefaults({
      target,
      devMode: true,
      router: target === 'vue' ? 'vue-router-v4' : 'react-router-v6',
      packageName: 'application_guards_acceptance'
    })
  })
}
