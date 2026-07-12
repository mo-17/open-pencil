import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import type { Fill, SceneGraph } from '@open-pencil/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

/**
 * Phase 3 §8 v3 — fill/color override → className prop. A dirty INSTANCE whose
 * overrides are all `:text` / `:fills` no longer inlines: a `:fills` override
 * parameterizes the overridden child's whole className
 * (`className={badgeClassName}`), defaulting to the master child's classes, and
 * the instance passes its own computed className.
 *
 * Tailwind emits an arbitrary bg value as `bg-[#RRGGBB]` (uppercase hex, alpha
 * dropped at full opacity), so red = `bg-[#FF0000]`, blue = `bg-[#0000FF]`.
 */
function solid(r: number, g: number, b: number): Fill {
  return { type: 'SOLID', color: { r, g, b, a: 1 }, opacity: 1, visible: true }
}
const RED = solid(1, 0, 0)
const BLUE = solid(0, 0, 1)

describe('compile — components fill-override props (Phase 3 §8 v3)', () => {
  function makeGraph(): { graph: SceneGraph; pageId: string; masterId: string } {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const master = graph.createNode('COMPONENT', pageId, {
      name: 'Card',
      width: 120,
      height: 40,
      layoutMode: 'VERTICAL'
    })
    graph.createNode('RECTANGLE', master.id, {
      name: 'Badge',
      width: 100,
      height: 20,
      fills: [RED]
    })
    return { graph, pageId, masterId: master.id }
  }

  /** Create an instance and override its (single) child's fill, marking the
   *  `:fills` override the way the editor would (diverged fill on the child
   *  node + a presence marker in the overrides map). */
  function makeFillOverrideInstance(
    graph: SceneGraph,
    masterId: string,
    pageId: string,
    fill: Fill
  ) {
    const inst = graph.createInstance(masterId, pageId)
    if (!inst) throw new Error('instance not created')
    const child = graph.getChildren(inst.id)[0]
    graph.updateNode(child.id, { fills: [fill] })
    inst.overrides = { [`${child.id}:fills`]: true }
    return inst
  }

  test('component child className becomes a prop defaulting to the master classes', () => {
    const { graph, pageId, masterId } = makeGraph()
    makeFillOverrideInstance(graph, masterId, pageId, BLUE)

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'comp' })
    })
    const comp = out.files.get('src/components/Card.tsx') as string
    expect(comp).toContain('badgeClassName?: string')
    // default carries the master red fill; the body child reads the prop
    expect(comp).toMatch(/badgeClassName = "[^"]*bg-\[#FF0000\]/)
    expect(comp).toContain('className={badgeClassName}')
  })

  test('a fill-override instance passes its own className and is NOT inlined', () => {
    const { graph, pageId, masterId } = makeGraph()
    makeFillOverrideInstance(graph, masterId, pageId, BLUE)

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'comp' })
    })
    const app = out.files.get('src/App.tsx') as string
    // instance passes its blue className via the prop
    expect(app).toMatch(/<Card[^>]*\bbadgeClassName="[^"]*bg-\[#0000FF\]/)
  })

  test('the instance-passed className is Tailwind-safelisted', () => {
    const { graph, pageId, masterId } = makeGraph()
    makeFillOverrideInstance(graph, masterId, pageId, BLUE)

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'comp' })
    })
    // the safelist file (index.css / tailwind input) must mention the blue bg
    const allSrc = [...out.files.values()].join('\n')
    expect(allSrc).toContain('bg-[#0000FF]')
  })

  test('text + fill on the same child produce two distinct props', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const master = graph.createNode('COMPONENT', pageId, {
      name: 'Tag',
      width: 120,
      height: 40,
      layoutMode: 'VERTICAL'
    })
    graph.createNode('TEXT', master.id, {
      name: 'Label',
      text: 'Base',
      width: 100,
      height: 20,
      fills: [solid(0, 0, 0)]
    })
    const inst = graph.createInstance(master.id, pageId)
    if (inst) {
      const child = graph.getChildren(inst.id)[0]
      graph.updateNode(child.id, { text: 'New', fills: [BLUE] })
      inst.overrides = { [`${child.id}:text`]: 'New', [`${child.id}:fills`]: true }
    }

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'comp' })
    })
    const comp = out.files.get('src/components/Tag.tsx') as string
    expect(comp).toContain('label?: string')
    expect(comp).toContain('labelClassName?: string')
    const app = out.files.get('src/App.tsx') as string
    expect(app).toMatch(/<Tag[^>]*\blabel="New"/)
    expect(app).toMatch(/<Tag[^>]*\blabelClassName="/)
  })

  test('§8 v6: a fontSize override also composes to the className prop', () => {
    // §8 v6: a non-fill visual override (`:fontSize`) routes through the same
    // child className prop — the recomputed className carries the new font size,
    // so the instance composes instead of inlining (v3 used to inline this).
    const { graph, pageId, masterId } = makeGraph()
    graph.createInstance(masterId, pageId) // clean
    const dirty = graph.createInstance(masterId, pageId)
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
    // master + clean + dirty = 3 refs; nothing inlines.
    expect((app.match(/<Card\b/g) ?? []).length).toBe(3)
    expect(app).toMatch(/<Card[^>]*\bbadgeClassName="[^"]+"/)
  })
})
