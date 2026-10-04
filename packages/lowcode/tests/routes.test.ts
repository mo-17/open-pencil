import { describe, expect, test } from 'bun:test'

import {
  deriveLowcodePageRoutes,
  inspectLowcodeRouteParameters,
  lowcodeNavigationPathname,
  lowcodeRouteCollisionKey,
  lowcodeRouteMatches,
  validateLowcodeApplicationStartRoute,
  validateLowcodeRoutePattern
} from '@open-pencil/lowcode'

describe('lowcode route helpers', () => {
  test('derives the compiler route contract including deterministic slug collisions', () => {
    const routes = deriveLowcodePageRoutes([
      { pageId: 'home', pageName: 'Home' },
      { pageId: 'about-1', pageName: 'About' },
      { pageId: 'about-2', pageName: 'About' },
      { pageId: 'cn', pageName: '中文' }
    ])
    expect(routes.map((route) => route.slug)).toEqual(['index', 'about', 'about-2', 'page-3'])
    expect(routes.map((route) => route.route)).toEqual(['/', '/about', '/about-2', '/page-3'])
  })

  test('continues probing when the deterministic collision suffix is already used', () => {
    const routes = deriveLowcodePageRoutes([
      { pageId: 'home', pageName: 'Home' },
      { pageId: 'foo-3', pageName: 'foo-3' },
      { pageId: 'foo-1', pageName: 'foo' },
      { pageId: 'foo-2', pageName: 'foo' }
    ])

    expect(routes.map((route) => route.slug)).toEqual(['index', 'foo-3', 'foo', 'foo-4'])
    expect(routes.map((route) => route.route)).toEqual(['/', '/foo-3', '/foo', '/foo-4'])
    expect(new Set(routes.map((route) => route.slug)).size).toBe(routes.length)
    expect(new Set(routes.map((route) => route.route)).size).toBe(routes.length)
  })

  test('uses an explicit dynamic pattern and reports invalid-pattern fallback', () => {
    const routes = deriveLowcodePageRoutes([
      { pageId: 'home', pageName: 'Home' },
      { pageId: 'product', pageName: 'Product', routePattern: '/product/:id' },
      { pageId: 'bad', pageName: 'Bad', routePattern: 'missing-slash' }
    ])
    expect(routes[1]).toMatchObject({
      route: '/product/:id',
      routeSource: 'explicit'
    })
    expect(routes[2]).toMatchObject({
      route: '/bad',
      routeSource: 'derived',
      routePatternError: 'route pattern must start with "/"'
    })
    expect(validateLowcodeRoutePattern('/ok').ok).toBe(true)
    expect(validateLowcodeRoutePattern('bad').ok).toBe(false)
  })

  test('inspects dynamic params and matches concrete paths', () => {
    expect(inspectLowcodeRouteParameters('/:locale?/product/:id')).toEqual({
      parameters: [
        { name: 'locale', optional: true },
        { name: 'id', optional: false }
      ],
      issues: []
    })
    expect(inspectLowcodeRouteParameters('/items/:/:id/:id').issues).toEqual([
      'malformed route parameter segment ":"',
      'duplicate route parameter "id"'
    ])
    expect(lowcodeRouteMatches('/product/:id', '/product/42')).toBe(true)
    expect(lowcodeRouteMatches('/:locale?/product/:id', '/product/42')).toBe(true)
    expect(lowcodeRouteMatches('/:locale?/product/:id', '/zh/product/42')).toBe(true)
    expect(lowcodeRouteMatches('/product/:id', '/product')).toBe(false)
  })

  test('canonicalizes dynamic route shapes and strips navigation suffixes', () => {
    expect(lowcodeRouteCollisionKey('/product/:id')).toBe(
      lowcodeRouteCollisionKey('/product/:slug')
    )
    expect(lowcodeNavigationPathname('/about?tab=team#top')).toBe('/about')
    expect(lowcodeNavigationPathname('/product/:id?/edit')).toBe('/product/:id?/edit')
    expect(lowcodeNavigationPathname('/product/:id?/edit?tab=details#top')).toBe(
      '/product/:id?/edit'
    )
  })
})

describe('application start route validation', () => {
  test('accepts concrete internal paths, including the root and encoded literal segments', () => {
    for (const route of ['/', '/home', '/catalog/products', '/products/42', '/%3Aname', '/产品']) {
      expect(validateLowcodeApplicationStartRoute(route)).toEqual({ ok: true })
    }
  })

  test('keeps dynamic page patterns valid while refusing to guess startup parameters', () => {
    for (const route of ['/products/:id', '/:locale?/home', '/files/*', '/static*', '/items/:']) {
      expect(validateLowcodeRoutePattern(route).ok).toBe(true)
      const result = validateLowcodeApplicationStartRoute(route)
      expect(result.ok).toBe(false)
      expect(result.reason).toBeTruthy()
    }
  })

  test('does not turn a query or fragment into a concrete start route', () => {
    for (const route of ['/home?tab=details', '/home#top', '/home?', '/home#']) {
      expect(validateLowcodeApplicationStartRoute(route).ok).toBe(false)
    }
  })

  test('reuses internal navigation authority and separator validation', () => {
    for (const route of [
      '',
      'home',
      'https://example.test/home',
      '//example.test/home',
      '/bad\\path',
      '/bad\npath'
    ]) {
      const result = validateLowcodeApplicationStartRoute(route)
      expect(result.ok).toBe(false)
      expect(result.reason).toBeTruthy()
    }
  })
})
