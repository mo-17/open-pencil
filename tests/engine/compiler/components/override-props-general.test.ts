import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import type { Fill, SceneGraph } from '@open-pencil/core/scene-graph'

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

    const out = compile({ graph, pageIds: [pageId], options: withDefaults({ packageName: 'comp' }) })
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

    const out = compile({ graph, pageIds: [pageId], options: withDefaults({ packageName: 'comp' }) })
    const app = out.files.get('src/App.tsx') as string
    // master + clean + dirty = 3 refs; nothing inlines
    expect((app.match(/<Tag\b/g) ?? []).length).toBe(3)
    expect(app).toMatch(/<Tag[^>]*\bboxClassName="[^"]+"/)
  })
})
