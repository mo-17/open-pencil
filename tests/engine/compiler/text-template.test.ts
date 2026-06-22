import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import type { SceneGraph } from '@open-pencil/core/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

/**
 * Phase 3 §9 v5 — non-i18n text templates. A visible TEXT literal containing
 * `${expr}` interpolations is lowered to a JSX template expression
 * (`{`Total: ${count}`}`) even when i18n is OFF — generalizing §9 v4's
 * i18n-only ICU interpolation. Reuses `parseTemplate` + `unknownIdentifiers`:
 * an unknown reference / parse failure falls back to the plain literal; with
 * i18n ON the text still becomes a `<FormattedMessage>` (v4), so the two paths
 * never both fire.
 */
function pageWithText(
  text: string,
  opts: { state?: string; docState?: string } = {}
): { graph: SceneGraph; pageId: string } {
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  if (opts.state) {
    graph.updateNode(pageId, {
      state: [{ id: 's1', name: opts.state, type: 'string', defaultValue: '' }]
    })
  }
  if (opts.docState) {
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'd1', name: opts.docState, type: 'string', defaultValue: '' }]
    })
  }
  const frame = graph.createNode('FRAME', pageId, {
    width: 200,
    height: 100,
    layoutMode: 'VERTICAL'
  })
  graph.createNode('TEXT', frame.id, { text, width: 160, height: 20 })
  return { graph, pageId }
}

function compileText(graph: SceneGraph, pageId: string) {
  return compile({ graph, pageIds: [pageId], options: withDefaults({ packageName: 'tmpl' }) })
}

describe('compile — non-i18n text templates (Phase 3 §9 v5)', () => {
  test('a state interpolation lowers to a JSX template expression', () => {
    const { graph, pageId } = pageWithText('Total: ${count}', { state: 'count' })
    const app = compileText(graph, pageId).files.get('src/App.tsx') as string
    expect(app).toContain('{`Total: ${count}`}')
    expect(app).not.toContain('FormattedMessage')
  })

  test('a docState interpolation registers a useDocState read', () => {
    const { graph, pageId } = pageWithText('Hi ${name}', { docState: 'name' })
    const app = compileText(graph, pageId).files.get('src/App.tsx') as string
    expect(app).toContain('const name = useDocState("name")')
    expect(app).toContain('{`Hi ${name}`}')
  })

  test('a member / arithmetic expression interpolates verbatim', () => {
    const { graph, pageId } = pageWithText('Owner ${user.name}', { docState: 'user' })
    const app = compileText(graph, pageId).files.get('src/App.tsx') as string
    expect(app).toContain('{`Owner ${user.name}`}')
  })

  test('multiple interpolations in one literal', () => {
    const { graph, pageId } = pageWithText('${greeting}, ${name}!', {
      state: 'greeting',
      docState: 'name'
    })
    const app = compileText(graph, pageId).files.get('src/App.tsx') as string
    expect(app).toContain('{`${greeting}, ${name}!`}')
  })

  test('an unknown interpolation identifier falls back to a plain literal + warns', () => {
    const { graph, pageId } = pageWithText('Hi ${mystery}')
    const out = compileText(graph, pageId)
    const app = out.files.get('src/App.tsx') as string
    // no template expression; the raw `${mystery}` survives as escaped literal text
    expect(app).not.toContain('{`')
    expect(app).toContain('$&#123;mystery&#125;')
    expect(out.warnings.some((w) => w.code === 'text-interpolation-unknown-identifier')).toBe(true)
  })

  test('plain text without ${} stays a plain literal (no template, no warning)', () => {
    const { graph, pageId } = pageWithText('Just text')
    const out = compileText(graph, pageId)
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('>Just text<')
    expect(app).not.toContain('{`')
    expect(out.warnings).toHaveLength(0)
  })
})
