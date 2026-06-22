import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

/**
 * Phase 3 §8 — custom components / Symbol cross-page reuse. A Figma COMPONENT
 * master with ≥1 INSTANCE is extracted to `src/components/<Name>.tsx`; the
 * master and every clean instance (no overrides) emit `<Name />` instead of
 * inlining the subtree. Phase 3 §8 v6: instances carrying overrides compose —
 * `:text` → content prop, every other visual override → a className prop — so
 * there is no inline fallback for property overrides anymore.
 */
describe('compile — components / instances (Phase 3 §8)', () => {
  function makeComponentGraph() {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const master = graph.createNode('COMPONENT', pageId, {
      name: 'Card Badge',
      width: 120,
      height: 40,
      layoutMode: 'VERTICAL'
    })
    graph.createNode('TEXT', master.id, { text: 'Badge', width: 100, height: 20 })
    return { graph, pageId, master }
  }

  test('a COMPONENT with instances is extracted to src/components/<Name>.tsx', () => {
    const { graph, pageId, master } = makeComponentGraph()
    graph.createInstance(master.id, pageId)

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'comp' })
    })
    const comp = out.files.get('src/components/CardBadge.tsx') as string
    expect(comp).toBeDefined()
    expect(comp).toContain('export default function CardBadge({ className }: CardBadgeProps)')
    expect(comp).toContain('>Badge</p>')
  })

  test('master + clean instances all emit <CardBadge /> and import it once', () => {
    const { graph, pageId, master } = makeComponentGraph()
    graph.createInstance(master.id, pageId)
    graph.createInstance(master.id, pageId)

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'comp' })
    })
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain("import CardBadge from './components/CardBadge'")
    // master (1) + 2 instances = 3 usages
    const refs = app.match(/<CardBadge\b/g) ?? []
    expect(refs.length).toBe(3)
    // The shared subtree is NOT inlined on the page — only the <p> in the
    // component file carries the Badge text.
    expect(app).not.toContain('>Badge</p>')
  })

  test('each usage carries its own root className (position/size)', () => {
    const { graph, pageId, master } = makeComponentGraph()
    const inst = graph.createInstance(master.id, pageId)
    if (inst) graph.updateNode(inst.id, { x: 40, y: 80 })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'comp' })
    })
    const app = out.files.get('src/App.tsx') as string
    // The relocated instance ref carries left/top utilities for its position.
    // (The master itself also emits a ref at 0,0 — find the relocated one.)
    const refs = app.match(/<CardBadge className="[^"]*"/g) ?? []
    const relocated = refs.find((r) => r.includes('left-10')) ?? ''
    expect(relocated).toContain('left-10') // 40px → 10
    expect(relocated).toContain('top-20') // 80px → 20
  })

  test('§8 v6: a non-text override composes to a className prop (no inline fallback)', () => {
    // §8 v6 generalized override→props: any non-text visual override (here
    // `:fontSize`) routes through the child's className prop (whole-className
    // recompute), so the instance composes instead of inlining.
    const { graph, pageId, master } = makeComponentGraph()
    graph.createInstance(master.id, pageId) // clean → ref
    const dirty = graph.createInstance(master.id, pageId)
    if (dirty) {
      const child = graph.getChildren(dirty.id)[0]
      graph.updateNode(child.id, { fontSize: 24 })
      dirty.overrides = { [`${child.id}:fontSize`]: 24 }
    }

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'comp' })
    })
    const app = out.files.get('src/App.tsx') as string
    // master + clean + dirty = 3 refs; nothing inlines now.
    expect((app.match(/<CardBadge\b/g) ?? []).length).toBe(3)
    expect(app).not.toContain('>Badge</p>')
    // the dirty instance passes its recomputed child className via the prop
    expect(app).toMatch(/<CardBadge[^>]*ClassName="[^"]+"/)
  })

  test('an instance reuses a master defined on another page (cross-page reuse)', () => {
    // §8's headline: a component authored on page 1 is instanced on page 2,
    // and both pages import the one shared `src/components/<Name>.tsx`.
    const graph = makeSceneGraph()
    const page1 = firstPageId(graph)
    const page2 = graph.addPage('Second').id
    const master = graph.createNode('COMPONENT', page1, {
      name: 'Shared Card',
      width: 120,
      height: 40,
      layoutMode: 'VERTICAL'
    })
    graph.createNode('TEXT', master.id, { text: 'Shared', width: 100, height: 20 })
    graph.createInstance(master.id, page2)

    const out = compile({
      graph,
      pageIds: [page1, page2],
      options: withDefaults({ packageName: 'cross-page' })
    })
    expect(out.files.get('src/components/SharedCard.tsx')).toBeDefined()
    // page 2's module imports the component from the sibling components dir.
    const page2File = [...out.files].find(
      ([k]) => k.startsWith('src/pages/') && k.includes('second')
    )
    const page2Src = (page2File?.[1] as string) ?? ''
    expect(page2Src).toContain("from '../components/SharedCard'")
    expect(page2Src).toContain('<SharedCard')
  })

  test('a COMPONENT with no instances stays inlined (no component file)', () => {
    const { graph, pageId } = makeComponentGraph()
    // No instances created.
    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'comp' })
    })
    expect(out.files.get('src/components/CardBadge.tsx')).toBeUndefined()
    const app = out.files.get('src/App.tsx') as string
    expect(app).not.toContain('import CardBadge')
    // Inlined: the master's subtree renders directly on the page.
    expect(app).toContain('>Badge</p>')
  })
})
