import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import type { Fill, SceneGraph } from '@open-pencil/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

/**
 * Phase 3 §8 v6 — override→props generalized. Beyond v2 (`:text`) / v3
 * (`:fills`), ANY non-text visual override (fontSize, strokes, opacity,
 * cornerRadius, size, …) now routes through the child's single className prop
 * (the whole recomputed className), so every property override composes — there
 * is no inline fallback for property overrides anymore. Multiple non-text
 * overrides on one child collapse onto its single className prop.
 */
function solid(r: number, g: number, b: number): Fill {
  return { type: 'SOLID', color: { r, g, b, a: 1 }, opacity: 1, visible: true }
}
const RED = solid(1, 0, 0)
const BLUE = solid(0, 0, 1)

function makeGraph(): { graph: SceneGraph; pageId: string; masterId: string } {
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  const master = graph.createNode('COMPONENT', pageId, {
    name: 'Tag',
    width: 120,
    height: 40,
    layoutMode: 'VERTICAL'
  })
  graph.createNode('RECTANGLE', master.id, {
    name: 'Box',
    width: 100,
    height: 20,
    fills: [RED],
    opacity: 1,
    cornerRadius: 0
  })
  return { graph, pageId, masterId: master.id }
}

describe('compile — override→props generalized (Phase 3 §8 v6)', () => {
  test('multiple non-text overrides on one child collapse onto a single className prop', () => {
    const { graph, pageId, masterId } = makeGraph()
    const inst = graph.createInstance(masterId, pageId)
    if (inst) {
      const child = graph.getChildren(inst.id)[0]
      // three separate visual overrides on the same child
      graph.updateNode(child.id, { fills: [BLUE], opacity: 0.5, cornerRadius: 8 })
      inst.overrides = {
        [`${child.id}:fills`]: true,
        [`${child.id}:opacity`]: 0.5,
        [`${child.id}:cornerRadius`]: 8
      }
    }

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'comp' })
    })
    const comp = out.files.get('src/components/Tag.tsx') as string
    // ONE className prop, not three
    expect((comp.match(/boxClassName\??: ?string/g) ?? []).length).toBe(1)
    expect(comp).toContain('className={boxClassName}')
    const app = out.files.get('src/App.tsx') as string
    // instance passes ONE className prop carrying the whole recomputed look
    expect((app.match(/\bboxClassName=/g) ?? []).length).toBe(1)
    expect(app).toMatch(/<Tag[^>]*\bboxClassName="[^"]*bg-\[#0000FF\]/)
  })

  test('a stroke-only override composes (no inline fallback)', () => {
    const { graph, pageId, masterId } = makeGraph()
    graph.createInstance(masterId, pageId) // clean
    const dirty = graph.createInstance(masterId, pageId)
    if (dirty) {
      const child = graph.getChildren(dirty.id)[0]
      graph.updateNode(child.id, { strokes: [BLUE] })
      dirty.overrides = { [`${child.id}:strokes`]: true }
    }

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'comp' })
    })
    const app = out.files.get('src/App.tsx') as string
    // master + clean + dirty = 3 refs; nothing inlines
    expect((app.match(/<Tag\b/g) ?? []).length).toBe(3)
    expect(app).toMatch(/<Tag[^>]*\bboxClassName="[^"]+"/)
  })

  // Phase 3 §8 v7 — a `:visible=false` override hides the child via `hidden` in
  // the className prop (collectTailwindClasses ignores `visible`, so before v7
  // this override was silently a no-op).
  test('a :visible=false override emits `hidden` in the child className prop', () => {
    const { graph, pageId, masterId } = makeGraph()
    graph.createInstance(masterId, pageId) // clean — child stays visible
    const dirty = graph.createInstance(masterId, pageId)
    if (dirty) {
      const child = graph.getChildren(dirty.id)[0]
      graph.updateNode(child.id, { visible: false })
      dirty.overrides = { [`${child.id}:visible`]: false }
    }

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'comp' })
    })
    const app = out.files.get('src/App.tsx') as string
    const comp = out.files.get('src/components/Tag.tsx') as string
    // the hiding instance passes a className prop carrying `hidden`
    expect(app).toMatch(/<Tag[^>]*\bboxClassName="[^"]*\bhidden\b/)
    // master default (child visible) does NOT carry hidden
    expect(comp).toMatch(/boxClassName = "[^"]*"/)
    expect(comp).not.toMatch(/boxClassName = "[^"]*\bhidden\b/)
    // `hidden` reaches the Tailwind safelist (index.css @source inline)
    expect(out.files.get('src/index.css') as string).toContain('hidden')
  })
})

const GREEN = solid(0, 1, 0)

/** Master 'Tag' whose 'Box' child is base-HIDDEN (visible:false). The reverse of
 *  §8 v7: an instance reveals it via a `:visible=true` override. */
function makeHiddenChildGraph(): { graph: SceneGraph; pageId: string; masterId: string } {
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  const master = graph.createNode('COMPONENT', pageId, {
    name: 'Tag',
    width: 120,
    height: 40,
    layoutMode: 'VERTICAL'
  })
  graph.createNode('RECTANGLE', master.id, {
    name: 'Box',
    width: 100,
    height: 20,
    fills: [GREEN],
    visible: false
  })
  return { graph, pageId, masterId: master.id }
}

/**
 * Phase 3 §8 v8 — instance `:visible` reverse. A base-hidden master child is
 * dropped before emit by every walk's `if(!child.visible) continue`, so an
 * instance could never reveal it. v8 keeps a hidden child that carries a prop
 * slot (some instance overrides it): it emits with `hidden` in its base
 * className (§8 v7a), and a revealing instance drops `hidden` via the className
 * prop. Without any override the hidden child is still omitted (byte regression).
 */
describe('compile — instance :visible reverse (Phase 3 §8 v8)', () => {
  test('a :visible=true override reveals a base-hidden master child', () => {
    const { graph, pageId, masterId } = makeHiddenChildGraph()
    graph.createInstance(masterId, pageId) // clean — box stays hidden
    const reveal = graph.createInstance(masterId, pageId)
    if (reveal) {
      const child = graph.getChildren(reveal.id)[0]
      graph.updateNode(child.id, { visible: true })
      reveal.overrides = { [`${child.id}:visible`]: true }
    }

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'comp' })
    })
    const comp = out.files.get('src/components/Tag.tsx') as string
    const app = out.files.get('src/App.tsx') as string
    // the hidden child is now IN the component body, parameterized by a prop
    expect(comp).toContain('className={boxClassName}')
    // master default carries `hidden` (the base child is hidden) + the green fill
    expect(comp).toMatch(/boxClassName = "[^"]*\bhidden\b/)
    expect(comp).toContain('bg-[#00FF00]')
    // the revealing instance passes a className WITHOUT hidden → shown
    const passed = app.match(/<Tag[^>]*\bboxClassName="([^"]*)"/)
    expect(passed).not.toBeNull()
    expect(passed?.[1]).not.toContain('hidden')
    expect(passed?.[1]).toContain('bg-[#00FF00]')
    // `hidden` reaches the Tailwind safelist
    expect(out.files.get('src/index.css') as string).toContain('hidden')
  })

  test('a base-hidden child with NO override is still omitted (byte regression)', () => {
    const { graph, pageId, masterId } = makeHiddenChildGraph()
    graph.createInstance(masterId, pageId) // clean — no override touches the box

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'comp' })
    })
    const comp = out.files.get('src/components/Tag.tsx') as string
    // no slot → the hidden child never reaches emit
    expect(comp).not.toContain('bg-[#00FF00]')
    expect(comp).not.toContain('boxClassName')
  })
})
