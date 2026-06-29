import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

/**
 * Phase 4 §21 — user-authored overlays. A FRAME carrying
 * `interactiveProps.overlay` renders as a conditional fixed shell whose open
 * state is a boolean docState. v1 is pure headless/plain emit: no new NodeType,
 * no codec changes, no Radix dependency.
 */
describe('compile — overlays (Phase 4 §21)', () => {
  function compileOverlay(
    overlay: Record<string, unknown>,
    opts: { docType?: 'boolean' | 'string'; nodeType?: 'FRAME' | 'RECTANGLE' } = {}
  ): { app: string; css: string; warnings: { code: string }[] } {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [
        { id: 'd1', name: 'isOpen', type: opts.docType ?? 'boolean', defaultValue: false }
      ]
    })
    const node = graph.createNode(opts.nodeType ?? 'FRAME', pageId, {
      name: 'Overlay',
      width: 320,
      height: 180,
      interactiveProps: { overlay }
    })
    graph.createNode('TEXT', node.id, { text: 'Overlay body' })
    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'overlay' })
    })
    return {
      app: out.files.get('src/App.tsx') as string,
      css: out.files.get('src/index.css') as string,
      warnings: out.warnings
    }
  }

  test('FRAME overlay emits conditional modal shell and reads open docState', () => {
    const { app } = compileOverlay({ kind: 'modal', openRef: 'isOpen' })
    expect(app).toContain('import { useDocState, setDocState }')
    expect(app).toContain('const isOpen = useDocState("isOpen")')
    expect(app).toContain('{isOpen && (')
    expect(app).toContain('className="fixed inset-0 z-50 flex items-center justify-center"')
    expect(app).toContain('className="absolute inset-0 bg-foreground/50"')
    expect(app).not.toContain('bg-black/50')
    expect(app).toContain('onClick={() => setDocState("isOpen", false)}')
    expect(app).toContain('Overlay body')
  })

  test('drawer kind uses drawer positioning classes', () => {
    const { app } = compileOverlay({ kind: 'drawer', openRef: 'isOpen' })
    expect(app).toContain('className="fixed inset-0 z-50 flex justify-end"')
    expect(app).toContain('relative z-10 h-full')
  })

  test('closeOnBackdrop=false keeps backdrop but does not import setDocState', () => {
    const { app } = compileOverlay({ kind: 'modal', openRef: 'isOpen', closeOnBackdrop: false })
    expect(app).toContain('import { useDocState }')
    expect(app).not.toContain('setDocState')
    expect(app).toContain('aria-hidden="true"')
    expect(app).not.toContain('aria-label="Close overlay"')
  })

  test('overlay runtime classes are seeded into Tailwind safelist', () => {
    const { css } = compileOverlay({ kind: 'modal', openRef: 'isOpen' })
    expect(css).toContain('fixed')
    expect(css).toContain('z-50')
    expect(css).toContain('bg-foreground/50')
    expect(css).toContain('@theme inline')
    expect(css).toContain('--color-foreground')
    expect(css).not.toContain('bg-black/50')
  })

  test('unknown openRef warns and falls back to a normal element', () => {
    const { app, warnings } = compileOverlay({ kind: 'modal', openRef: 'missing' })
    expect(warnings.map((w) => w.code)).toContain('overlay-open-ref-unknown')
    expect(app).not.toContain('{isOpen && (')
  })

  test('non-boolean openRef warns and falls back to a normal element', () => {
    const { app, warnings } = compileOverlay(
      { kind: 'modal', openRef: 'isOpen' },
      { docType: 'string' }
    )
    expect(warnings.map((w) => w.code)).toContain('overlay-open-ref-not-boolean')
    expect(app).not.toContain('{isOpen && (')
  })

  test('non-FRAME overlay config warns and is skipped', () => {
    const { app, warnings } = compileOverlay(
      { kind: 'modal', openRef: 'isOpen' },
      { nodeType: 'RECTANGLE' }
    )
    expect(warnings.map((w) => w.code)).toContain('overlay-not-frame')
    expect(app).not.toContain('{isOpen && (')
  })
})
