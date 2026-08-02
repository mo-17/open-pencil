import { describe, expect, test } from 'bun:test'

import {
  derivePagePaths,
  findPageInfoByPageId
} from '@open-pencil/compiler/adapters/react/route-paths'
import { buildRouterApp } from '@open-pencil/compiler/adapters/react/scaffold'
import type { IRTree } from '@open-pencil/compiler/ir/types'

function makeIR(pageName: string, pageId = `p-${pageName}`): IRTree {
  return {
    pageId,
    pageName,
    children: [],
    states: [],
    docStates: [],
    docStateReads: [],
    docStateWrites: [],
    warnings: []
  }
}

describe('derivePagePaths (Phase 1 §11)', () => {
  test('single page → slug "index", route "/", component "PageIndex"', () => {
    const [info] = derivePagePaths([makeIR('Home')])
    expect(info.slug).toBe('index')
    expect(info.originalSlug).toBe('index')
    expect(info.route).toBe('/')
    expect(info.file).toBe('index.tsx')
    expect(info.component).toBe('PageIndex')
  })

  test('two pages → first is /, second slugifies pageName', () => {
    const infos = derivePagePaths([makeIR('Home'), makeIR('About')])
    expect(infos.map((i) => i.slug)).toEqual(['index', 'about'])
    expect(infos.map((i) => i.route)).toEqual(['/', '/about'])
    expect(infos.map((i) => i.file)).toEqual(['index.tsx', 'about.tsx'])
    expect(infos.map((i) => i.component)).toEqual(['PageIndex', 'PageAbout'])
  })

  test('slugify lowercases, drops punctuation, hyphenates spaces', () => {
    const [, info] = derivePagePaths([makeIR('Home'), makeIR('My Page!')])
    expect(info.slug).toBe('my-page')
    expect(info.component).toBe('PageMyPage')
  })

  test('multi-word name yields PascalCase component', () => {
    const [, info] = derivePagePaths([makeIR('Home'), makeIR('About Us Team')])
    expect(info.slug).toBe('about-us-team')
    expect(info.component).toBe('PageAboutUsTeam')
  })

  test('duplicate names → second appends -${index}', () => {
    const infos = derivePagePaths([makeIR('Home'), makeIR('About'), makeIR('About')])
    expect(infos.map((i) => i.slug)).toEqual(['index', 'about', 'about-2'])
    expect(infos[2].originalSlug).toBe('about')
  })

  test('keeps routes, files, and component names unique when a suffix is already occupied', () => {
    const infos = derivePagePaths([
      makeIR('Home'),
      makeIR('foo-3'),
      makeIR('foo', 'p-foo-1'),
      makeIR('foo', 'p-foo-2')
    ])

    expect(infos.map((info) => info.slug)).toEqual(['index', 'foo-3', 'foo', 'foo-4'])
    expect(infos.map((info) => info.route)).toEqual(['/', '/foo-3', '/foo', '/foo-4'])
    expect(infos.map((info) => info.file)).toEqual([
      'index.tsx',
      'foo-3.tsx',
      'foo.tsx',
      'foo-4.tsx'
    ])
    expect(infos.map((info) => info.component)).toEqual([
      'PageIndex',
      'PageFoo3',
      'PageFoo',
      'PageFoo4'
    ])
    expect(new Set(infos.map((info) => info.file)).size).toBe(infos.length)
    expect(new Set(infos.map((info) => info.component)).size).toBe(infos.length)

    const app = buildRouterApp(infos, { devMode: false })
    expect(app.split('\n').filter((line) => line.startsWith('import Page'))).toEqual([
      "import PageIndex from './pages/index'",
      "import PageFoo3 from './pages/foo-3'",
      "import PageFoo from './pages/foo'",
      "import PageFoo4 from './pages/foo-4'"
    ])
  })

  test('non-first page named "index" → suffixed to avoid colliding with the implicit / route', () => {
    const infos = derivePagePaths([makeIR('Home'), makeIR('index')])
    expect(infos[1].slug).toBe('index-1')
    expect(infos[1].originalSlug).toBe('index')
    expect(infos[1].route).toBe('/index-1')
  })

  test('empty / non-ASCII pageName falls back to page-${index}', () => {
    const infos = derivePagePaths([makeIR('Home'), makeIR(''), makeIR('中文')])
    expect(infos[1].slug).toBe('page-1')
    expect(infos[2].slug).toBe('page-2')
  })

  test('leading/trailing punctuation gets trimmed', () => {
    const [, info] = derivePagePaths([makeIR('Home'), makeIR('!!About!!')])
    expect(info.slug).toBe('about')
  })

  test('uses the shared explicit route-pattern override while keeping the derived filename', () => {
    const product = makeIR('Product Detail')
    product.routePattern = '/product/:id'
    const [, info] = derivePagePaths([makeIR('Home'), product])
    expect(info.route).toBe('/product/:id')
    expect(info.slug).toBe('product-detail')
    expect(info.file).toBe('product-detail.tsx')
  })

  // Phase 2 §7: editor preview bridge needs pageId on PagePathInfo so it can
  // map currentPageId → route without traversing back through `info.ir`.
  test('pageId is lifted to the info from ir.pageId', () => {
    const infos = derivePagePaths([
      makeIR('Home', 'page-home-123'),
      makeIR('About', 'page-about-456')
    ])
    expect(infos[0].pageId).toBe('page-home-123')
    expect(infos[1].pageId).toBe('page-about-456')
  })
})

describe('findPageInfoByPageId (Phase 2 §7)', () => {
  test('returns the info whose pageId matches', () => {
    const infos = derivePagePaths([makeIR('Home', 'p-1'), makeIR('About', 'p-2')])
    const found = findPageInfoByPageId(infos, 'p-2')
    expect(found?.slug).toBe('about')
    expect(found?.route).toBe('/about')
  })

  test('returns undefined when no page matches (e.g. stale id after deletion)', () => {
    const infos = derivePagePaths([makeIR('Home', 'p-1')])
    expect(findPageInfoByPageId(infos, 'p-missing')).toBeUndefined()
  })

  test('works against an empty list (defensive — pre-derivePagePaths state)', () => {
    expect(findPageInfoByPageId([], 'anything')).toBeUndefined()
  })
})
