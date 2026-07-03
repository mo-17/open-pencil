import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

function compileIndexHtml(opts: Parameters<typeof withDefaults>[0] = {}) {
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  const out = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ packageName: 'seo-app', ...opts })
  })
  return { html: out.files.get('index.html') as string, pageId }
}

describe('compile — static SEO metadata (Phase 5 §3)', () => {
  test('omits optional metadata tags when no metadata is configured', () => {
    const { html } = compileIndexHtml()

    expect(html).toContain('<title>seo-app</title>')
    expect(html).not.toContain('name="description"')
    expect(html).not.toContain('property="og:')
    expect(html).not.toContain('rel="canonical"')
  })

  test('emits document-level title, description, canonical, and Open Graph tags', () => {
    const { html } = compileIndexHtml({
      metadata: {
        title: 'Launch Page',
        description: 'A fast generated landing page.',
        image: 'https://cdn.example.com/og.png',
        canonicalUrl: 'https://example.com/launch'
      }
    })

    expect(html).toContain('<title>Launch Page</title>')
    expect(html).toContain('<meta name="description" content="A fast generated landing page." />')
    expect(html).toContain('<meta property="og:title" content="Launch Page" />')
    expect(html).toContain(
      '<meta property="og:description" content="A fast generated landing page." />'
    )
    expect(html).toContain('<meta property="og:image" content="https://cdn.example.com/og.png" />')
    expect(html).toContain('<link rel="canonical" href="https://example.com/launch" />')
    expect(html).toContain('<meta property="og:url" content="https://example.com/launch" />')
  })

  test('single-page override wins over document defaults for the compiled page', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({
        packageName: 'seo-app',
        metadata: {
          title: 'Document Title',
          description: 'Document description.',
          pages: {
            [pageId]: {
              title: 'Page Title',
              description: 'Page description.'
            }
          }
        }
      })
    })
    const html = out.files.get('index.html') as string

    expect(html).toContain('<title>Page Title</title>')
    expect(html).toContain('<meta name="description" content="Page description." />')
    expect(html).not.toContain('Document Title')
    expect(html).not.toContain('Document description.')
  })

  test('uses persisted root lowcodeSeoMetadata when options omit metadata', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.updateNode(graph.rootId, {
      lowcodeSeoMetadata: {
        title: 'Persisted Title',
        description: 'Persisted description.'
      }
    })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'seo-app' })
    })
    const html = out.files.get('index.html') as string

    expect(html).toContain('<title>Persisted Title</title>')
    expect(html).toContain('<meta name="description" content="Persisted description." />')
  })

  test('uses persisted page lowcodeSeoMetadata as a single-page override', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.updateNode(graph.rootId, {
      lowcodeSeoMetadata: {
        title: 'Root Title',
        description: 'Root description.'
      },
      lowcodeHeadMetadata: {
        meta: [{ kind: 'name', key: 'theme-color', content: '#2563eb' }]
      },
      lowcodeCustomCss: '.root-custom { color: CanvasText; }'
    })
    graph.updateNode(pageId, {
      lowcodeSeoMetadata: {
        title: 'Page Title',
        description: 'Page description.'
      }
    })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'seo-app' })
    })
    const html = out.files.get('index.html') as string
    const css = out.files.get('src/index.css') as string

    expect(html).toContain('<title>Page Title</title>')
    expect(html).toContain('<meta name="description" content="Page description." />')
    expect(html).toContain('<meta name="theme-color" content="#2563eb" />')
    expect(html).not.toContain('Root Title')
    expect(css).toContain('.root-custom { color: CanvasText; }')
  })

  test('explicit CompilerOptions.metadata overrides persisted metadata', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.updateNode(graph.rootId, {
      lowcodeSeoMetadata: {
        title: 'Persisted Title',
        description: 'Persisted description.'
      }
    })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({
        packageName: 'seo-app',
        metadata: {
          title: 'Explicit Title'
        }
      })
    })
    const html = out.files.get('index.html') as string

    expect(html).toContain('<title>Explicit Title</title>')
    expect(html).toContain('<meta name="description" content="Persisted description." />')
    expect(html).not.toContain('Persisted Title')
  })

  test('escapes metadata values in HTML attributes', () => {
    const { html } = compileIndexHtml({
      metadata: {
        title: 'A&B <Launch>',
        description: 'Use "quotes" and <tags>.'
      }
    })

    expect(html).toContain('<title>A&amp;B &lt;Launch&gt;</title>')
    expect(html).toContain(
      '<meta name="description" content="Use &quot;quotes&quot; and &lt;tags&gt;." />'
    )
  })

  test('emits controlled custom head metadata and custom CSS from the root node', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.updateNode(graph.rootId, {
      lowcodeHeadMetadata: {
        meta: [
          { kind: 'name', key: 'theme-color', content: '#111827' },
          { kind: 'httpEquiv', key: 'x-ua-compatible', content: 'IE=edge' }
        ],
        link: [
          {
            rel: 'preconnect',
            href: 'https://cdn.example.com',
            crossorigin: 'anonymous'
          }
        ],
        styles: ['body::before { content: "</style>"; }']
      },
      lowcodeCustomCss: 'body { scroll-behavior: smooth; }'
    })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'seo-app' })
    })
    const html = out.files.get('index.html') as string
    const css = out.files.get('src/index.css') as string

    expect(html).toContain('<meta name="theme-color" content="#111827" />')
    expect(html).toContain('<meta http-equiv="x-ua-compatible" content="IE=edge" />')
    expect(html).toContain(
      '<link rel="preconnect" href="https://cdn.example.com" crossorigin="anonymous" />'
    )
    expect(html).toContain('<style>body::before { content: "<\\/style>"; }</style>')
    expect(html).not.toContain('alert(')
    expect(css.trim().endsWith('body { scroll-behavior: smooth; }')).toBe(true)
  })

  test('skips unsafe custom head link href protocols at emit time', () => {
    const { html } = compileIndexHtml({
      metadata: {
        head: {
          link: [
            { rel: 'stylesheet', href: `java${'script'}:alert(1)` },
            { rel: 'preconnect', href: 'https://cdn.example.com' }
          ]
        }
      }
    })

    expect(html).not.toContain('alert(1)')
    expect(html).toContain('<link rel="preconnect" href="https://cdn.example.com" />')
  })
})
