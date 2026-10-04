import { expect, test } from 'bun:test'

import {
  applicationPreviewFrameURL,
  applicationPreviewInitialRoute,
  applicationPreviewNavigationRoute,
  applicationPreviewRoutes,
  flutterPreviewPageIds,
  flutterPreviewScopeKey
} from '@/app/lowcode/application-mode/runtime'

import { applicationModeFixture } from '#tests/helpers/compiler/application-mode/fixture'

test('design preview retains page order and Flutter current-page selection', () => {
  const { graph, home, reference } = applicationModeFixture()
  expect(applicationPreviewRoutes(graph).map((route) => route.pageId)).toEqual(
    graph.getPages().map((page) => page.id)
  )
  expect(flutterPreviewPageIds(graph, home.id)).toEqual([home.id])
  expect(flutterPreviewScopeKey(graph, home.id)).not.toBe(
    flutterPreviewScopeKey(graph, reference.id)
  )
})

test('application bridge routes match scope and native navigation captures the complete app', () => {
  const { graph, home, products, reference } = applicationModeFixture(true)
  expect(applicationPreviewRoutes(graph).map((route) => [route.pageId, route.route])).toEqual([
    [home.id, '/home'],
    [products.id, '/products']
  ])
  expect(flutterPreviewPageIds(graph, reference.id)).toEqual(
    graph.getPages().map((page) => page.id)
  )
  expect(flutterPreviewScopeKey(graph, home.id)).toBe(flutterPreviewScopeKey(graph, products.id))
  expect(flutterPreviewScopeKey(graph, home.id)).toBe(flutterPreviewScopeKey(graph, reference.id))
})

test('invalid application configuration reaches native compilation instead of becoming a design preview', () => {
  const { graph, home } = applicationModeFixture(true)
  graph.updateNode(home.id, {
    lowcodeApplicationPage: { version: 1, role: 'application', entryNodeId: 'deleted' }
  })
  expect(flutterPreviewPageIds(graph, home.id)).toContain(home.id)
})

test('current static application page wins while reference and component pages keep the runtime route', () => {
  const { graph, home, products, reference } = applicationModeFixture(true)
  graph.updateNode(graph.rootId, {
    lowcodeApplication: { version: 1, enabled: true, startPageId: products.id }
  })
  const before = structuredClone(graph.getNode(graph.rootId))
  expect(applicationPreviewNavigationRoute(graph, home.id, '/products')).toBe('/home')
  expect(applicationPreviewNavigationRoute(graph, reference.id, '/home')).toBe('/home')
  const concrete = '/home?tab=details&filter=a%2Fb#counter'
  expect(applicationPreviewNavigationRoute(graph, reference.id, concrete)).toBe(concrete)
  graph.updateNode(reference.id, { lowcodeApplicationPage: { version: 1, role: 'components' } })
  expect(applicationPreviewNavigationRoute(graph, reference.id, concrete)).toBe(concrete)
  expect(graph.getNode(graph.rootId)).toEqual(before)
})

test('dynamic application routes restore only concrete paths without guessing parameters', () => {
  const { graph, products, reference } = applicationModeFixture(true)
  graph.updateNode(products.id, { lowcodeRoutePattern: '/products/:id?' })
  const concrete = '/products/42?tab=details#reviews'
  expect(applicationPreviewNavigationRoute(graph, reference.id, concrete)).toBe(concrete)
  expect(applicationPreviewNavigationRoute(graph, products.id, concrete)).toBe(concrete)
  expect(applicationPreviewNavigationRoute(graph, reference.id, '/products?tab=all')).toBe(
    '/products?tab=all'
  )
  expect(applicationPreviewNavigationRoute(graph, products.id)).toBeUndefined()
  for (const route of ['/products/:id', '/products/:id?', '/products/*', '/missing', '/reference'])
    expect(applicationPreviewNavigationRoute(graph, reference.id, route)).toBeUndefined()
})

test('same-page application restoration keeps query and hash while manual page changes select that page', () => {
  const { graph, home, products, reference } = applicationModeFixture(true)
  const homeLocation = '/home?tab=details&filter=a%2Fb#counter'
  expect(applicationPreviewNavigationRoute(graph, home.id, homeLocation)).toBe(homeLocation)
  expect(applicationPreviewNavigationRoute(graph, products.id, homeLocation)).toBe('/products')
  const productLocation = '/products?tab=reviews#rating'
  expect(applicationPreviewNavigationRoute(graph, products.id, productLocation)).toBe(
    productLocation
  )
  expect(applicationPreviewNavigationRoute(graph, home.id, productLocation)).toBe('/home')
  expect(applicationPreviewNavigationRoute(graph, reference.id, productLocation)).toBe(
    productLocation
  )
  // A malformed remembered location never replaces the current static application page.
  expect(applicationPreviewNavigationRoute(graph, home.id, '/home\\details')).toBe('/home')
})

test('fresh application frames start at the retained concrete location before router initialization', () => {
  const { graph, home, products, reference } = applicationModeFixture(true)
  graph.updateNode(products.id, { lowcodeRoutePattern: '/products/:id' })
  const concrete = '/products/42?tab=details&filter=a%2Fb#reviews'
  expect(applicationPreviewInitialRoute(graph, products.id, concrete)).toBe(concrete)
  expect(applicationPreviewInitialRoute(graph, reference.id, concrete)).toBe(concrete)
  expect(applicationPreviewInitialRoute(graph, reference.id)).toBe('/home')
  expect(applicationPreviewInitialRoute(graph, products.id)).toBe('/home')
  expect(applicationPreviewInitialRoute(graph, home.id, concrete)).toBe('/home')
  expect(applicationPreviewFrameURL('blob:http://localhost:1420/artifact', concrete)).toBe(
    'blob:http://localhost:1420/artifact#/products/42?tab=details&filter=a%2Fb#reviews'
  )
  expect(applicationPreviewFrameURL('http://localhost:15980/', concrete)).toBe(
    'http://localhost:15980/products/42?tab=details&filter=a%2Fb#reviews'
  )
  expect(applicationPreviewFrameURL('https://localhost:15980/', '/home')).toBe(
    'https://localhost:15980/home'
  )
  expect(applicationPreviewFrameURL('blob:http://localhost:1420/artifact')).toBe(
    'blob:http://localhost:1420/artifact'
  )
  const legacy = applicationModeFixture()
  expect(applicationPreviewInitialRoute(legacy.graph, legacy.home.id, concrete)).toBeUndefined()
  graph.updateNode(graph.rootId, {
    lowcodeApplication: { version: 1, enabled: true, startPageId: products.id }
  })
  expect(applicationPreviewInitialRoute(graph, reference.id)).toBeUndefined()
})

test('runtime restoration rejects removed, changed and excluded application routes', () => {
  const { graph, products, reference } = applicationModeFixture(true)
  graph.updateNode(products.id, { lowcodeRoutePattern: '/catalog' })
  expect(
    applicationPreviewNavigationRoute(graph, reference.id, '/products?tab=all')
  ).toBeUndefined()
  expect(applicationPreviewNavigationRoute(graph, reference.id, '/catalog')).toBe('/catalog')
  graph.updateNode(products.id, { lowcodeApplicationPage: { version: 1, role: 'reference' } })
  expect(applicationPreviewNavigationRoute(graph, reference.id, '/catalog')).toBeUndefined()
  graph.deleteNode(products.id)
  expect(applicationPreviewNavigationRoute(graph, reference.id, '/catalog')).toBeUndefined()
  const deleted = applicationModeFixture(true)
  deleted.graph.deleteNode(deleted.products.id)
  expect(
    applicationPreviewNavigationRoute(deleted.graph, deleted.reference.id, '/products?tab=all')
  ).toBeUndefined()
})

test('runtime restoration never accepts external, malformed or unmatched targets', () => {
  const { graph, reference } = applicationModeFixture(true)
  for (const route of [
    '',
    'https://example.com/home',
    '//example.com/home',
    '/home\\details',
    '/home\n',
    '/home-extra',
    '/missing?tab=home',
    '/reference',
    '/components'
  ])
    expect(applicationPreviewNavigationRoute(graph, reference.id, route)).toBeUndefined()
})

test('legacy uses only the current page route and ignores the remembered application route', () => {
  const { graph, home, products, reference } = applicationModeFixture()
  expect(applicationPreviewNavigationRoute(graph, reference.id, '/home')).toBe('/')
  expect(applicationPreviewNavigationRoute(graph, home.id, '/products')).toBe('/home')
  expect(applicationPreviewNavigationRoute(graph, home.id, '/home?tab=details#counter')).toBe(
    '/home'
  )
  expect(applicationPreviewNavigationRoute(graph, 'missing', '/home')).toBeUndefined()
  graph.updateNode(products.id, { lowcodeRoutePattern: '/products/:id' })
  expect(applicationPreviewNavigationRoute(graph, products.id, '/products/42')).toBeUndefined()
  graph.updateNode(graph.rootId, { lowcodeApplication: undefined })
  expect(applicationPreviewNavigationRoute(graph, reference.id, '/home')).toBe('/')
})

test('invalid application scope never restores a current or remembered runtime route', () => {
  const { graph, home, products, reference } = applicationModeFixture(true)
  graph.updateNode(products.id, {
    lowcodeApplicationPage: { version: 1, role: 'application', entryNodeId: 'missing' }
  })
  expect(applicationPreviewNavigationRoute(graph, home.id, '/home')).toBeUndefined()
  expect(applicationPreviewNavigationRoute(graph, reference.id, '/home')).toBeUndefined()
  graph.updateNode(graph.rootId, {
    pluginData: [{ pluginId: 'open-pencil', key: 'lowcode/application', value: '{"version":2}' }]
  })
  expect(applicationPreviewNavigationRoute(graph, home.id, '/home')).toBeUndefined()
})
