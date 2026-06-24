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
      }
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

    expect(html).toContain('<title>Page Title</title>')
    expect(html).toContain('<meta name="description" content="Page description." />')
    expect(html).not.toContain('Root Title')
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
})
