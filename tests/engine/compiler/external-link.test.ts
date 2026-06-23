import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

/**
 * Phase 4 §25 — external links. A node carrying `interactiveProps.href` (or
 * `interactiveProps.link.href`) emits as an `<a>` with href/target/rel. This is
 * intentionally separate from internal `navigate` actions.
 */
describe('compile — external links (Phase 4 §25)', () => {
  function compileLink(interactiveProps: Record<string, unknown>, docState = false) {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    if (docState) {
      graph.updateNode(graph.rootId, {
        lowcodeDocumentState: [
          { id: 'd1', name: 'profileUrl', type: 'string', defaultValue: 'https://example.com' }
        ]
      })
    }
    const frame = graph.createNode('FRAME', pageId, {
      name: 'LinkCard',
      width: 200,
      height: 80,
      interactiveProps
    })
    graph.createNode('TEXT', frame.id, { text: 'Open' })
    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'links' })
    })
    return { app: out.files.get('src/App.tsx') as string, warnings: out.warnings }
  }

  test('direct href emits <a href target=_blank rel>', () => {
    const { app } = compileLink({ href: 'https://openpencil.dev', target: '_blank' })
    expect(app).toContain('<a')
    expect(app).toContain('href="https://openpencil.dev"')
    expect(app).toContain('target="_blank"')
    expect(app).toContain('rel="noopener noreferrer"')
    expect(app).toContain('Open')
  })

  test('nested link config is supported', () => {
    const { app } = compileLink({ link: { href: 'mailto:hello@example.com', target: '_self' } })
    expect(app).toContain('<a')
    expect(app).toContain('href="mailto:hello@example.com"')
    expect(app).toContain('target="_self"')
    expect(app).not.toContain('rel="noopener noreferrer"')
  })

  test('invalid target falls back to _blank with safe rel', () => {
    const { app } = compileLink({ href: 'https://openpencil.dev', target: 'popup' })
    expect(app).toContain('<a')
    expect(app).toContain('href="https://openpencil.dev"')
    expect(app).toContain('target="_blank"')
    expect(app).toContain('rel="noopener noreferrer"')
  })

  test('static href is escaped as an attribute', () => {
    const { app } = compileLink({ href: 'https://example.com/?q="quoted"&from=op' })
    expect(app).toContain('href="https://example.com/?q=&quot;quoted&quot;&amp;from=op"')
  })

  test('hrefExpr emits bound href and registers docState read', () => {
    const { app } = compileLink({ link: { hrefExpr: 'profileUrl', target: '_blank' } }, true)
    expect(app).toContain('const profileUrl = useDocState("profileUrl")')
    expect(app).toContain('href={profileUrl}')
    expect(app).toContain('target="_blank"')
  })

  test('unknown hrefExpr warns and keeps normal element', () => {
    const { app, warnings } = compileLink({ link: { hrefExpr: 'missingUrl' } })
    expect(warnings.map((w) => w.code)).toContain('link-href-unknown')
    expect(app).not.toContain('<a')
  })

  test('no link config leaves element as a normal div', () => {
    const { app } = compileLink({})
    expect(app).toContain('<div')
    expect(app).not.toContain('<a')
  })
})
