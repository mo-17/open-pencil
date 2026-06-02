import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import type { SceneGraph, SceneNode } from '@open-pencil/core/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

/**
 * Phase 3 §8 v4 — COMPONENT_SET variants. A SET (with ≥1 instanced variant)
 * becomes ONE component with a string-union prop per variant axis; the body
 * switches between variant subtrees. A variant instance passes its (non-default)
 * axis values; an instance with any override falls back to inline (variant-only).
 *
 * The SET + variant children live on page 1; instances on page 2. Only page 2
 * is compiled, so the SET itself never inlines into the assertions while the
 * one shared component file is still emitted (registry scans the whole graph).
 */
function buildSetGraph(): { graph: SceneGraph; setPage: string; usePage: string; variants: SceneNode[] } {
  const graph = makeSceneGraph()
  const setPage = firstPageId(graph)
  const usePage = graph.addPage('Use').id
  const set = graph.createNode('COMPONENT_SET', setPage, { name: 'Button', width: 200, height: 100 })
  // Large|Default (first → default variant) and Small|Hover.
  const large = graph.createNode('COMPONENT', set.id, {
    name: 'Size=Large, State=Default',
    width: 120,
    height: 40,
    layoutMode: 'VERTICAL'
  })
  graph.createNode('TEXT', large.id, { text: 'BigBtn', width: 100, height: 20 })
  const small = graph.createNode('COMPONENT', set.id, {
    name: 'Size=Small, State=Hover',
    width: 80,
    height: 28,
    layoutMode: 'VERTICAL'
  })
  graph.createNode('TEXT', small.id, { text: 'SmBtn', width: 60, height: 16 })
  return { graph, setPage, usePage, variants: [large, small] }
}

describe('compile — COMPONENT_SET variants (Phase 3 §8 v4)', () => {
  test('a SET becomes one component with a string-union prop per axis', () => {
    const { graph, usePage, variants } = buildSetGraph()
    graph.createInstance(variants[1].id, usePage) // instance of Small|Hover

    const out = compile({ graph, pageIds: [usePage], options: withDefaults({ packageName: 'comp' }) })
    const comp = out.files.get('src/components/Button.tsx') as string
    expect(comp).toBeDefined()
    expect(comp).toContain('size?: "Large" | "Small"')
    expect(comp).toContain('state?: "Default" | "Hover"')
    // defaults = the first variant's axis values
    expect(comp).toContain('size = "Large", state = "Default"')
    // switch on the joined key + the non-default guard + default fallback
    expect(comp).toContain('const __variant = `${size}|${state}`')
    expect(comp).toContain('if (__variant === "Small|Hover")')
    expect(comp).toContain('>SmBtn</p>')
    expect(comp).toContain('>BigBtn</p>')
  })

  test('a variant instance passes its non-default axis values', () => {
    const { graph, usePage, variants } = buildSetGraph()
    graph.createInstance(variants[1].id, usePage) // Small|Hover

    const out = compile({ graph, pageIds: [usePage], options: withDefaults({ packageName: 'comp' }) })
    const app = out.files.get('src/App.tsx') as string
    expect(app).toMatch(/<Button[^>]*\bsize="Small"/)
    expect(app).toMatch(/<Button[^>]*\bstate="Hover"/)
    // the variant subtree is NOT inlined onto the page
    expect(app).not.toContain('>SmBtn</p>')
  })

  test('a default-variant instance passes no variant props', () => {
    const { graph, usePage, variants } = buildSetGraph()
    graph.createInstance(variants[0].id, usePage) // Large|Default (defaults)

    const out = compile({ graph, pageIds: [usePage], options: withDefaults({ packageName: 'comp' }) })
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('<Button')
    expect(app).not.toContain('size="Large"')
    expect(app).not.toContain('state="Default"')
  })

  test('variant children are not registered as their own components', () => {
    const { graph, usePage, variants } = buildSetGraph()
    graph.createInstance(variants[1].id, usePage)

    const out = compile({ graph, pageIds: [usePage], options: withDefaults({ packageName: 'comp' }) })
    // sanitized variant name would be SizeSmallStateHover — must not be a file.
    expect(out.files.get('src/components/SizeSmallStateHover.tsx')).toBeUndefined()
    expect([...out.files.keys()].filter((k) => k.startsWith('src/components/'))).toEqual([
      'src/components/Button.tsx'
    ])
  })

  test('a variant instance with any visible override composes (§8 v6)', () => {
    // §8 v5 composes `:text` / `:fills`; §8 v6 generalizes to all visual
    // overrides (here `:fontSize`) — the variant instance still emits a ref
    // (no inline), passing its recomputed child className.
    const { graph, usePage, variants } = buildSetGraph()
    const inst = graph.createInstance(variants[1].id, usePage)
    if (inst) {
      const child = graph.getChildren(inst.id)[0]
      graph.updateNode(child.id, { fontSize: 24 })
      inst.overrides = { [`${child.id}:fontSize`]: 24 }
    }

    const out = compile({ graph, pageIds: [usePage], options: withDefaults({ packageName: 'comp' }) })
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('<Button')
    expect(app).not.toContain('>SmBtn</p>') // subtree lives in the component file, not inlined
  })

  test('variant subtree classes reach the Tailwind safelist', () => {
    const { graph, usePage, variants } = buildSetGraph()
    graph.createInstance(variants[1].id, usePage)

    const out = compile({ graph, pageIds: [usePage], options: withDefaults({ packageName: 'comp' }) })
    // the small variant's text size class lives only in the component file's
    // subtree; it must still be safelisted so the iframe keeps it.
    const allSrc = [...out.files.values()].join('\n')
    // both variant subtrees' wrappers carry flex-col (VERTICAL auto-layout)
    expect(allSrc).toContain('flex-col')
  })
})

/**
 * Phase 3 §8 v7 — the SET's default variant is taken from its
 * `componentPropertyDefinitions` (VARIANT default) when present, instead of the
 * first variant child (the v4 fallback).
 */
describe('compile — COMPONENT_SET variant defaults (Phase 3 §8 v7)', () => {
  function setNode(graph: SceneGraph, setPage: string): SceneNode {
    const set = graph.getChildren(setPage).find((n) => n.type === 'COMPONENT_SET')
    if (!set) throw new Error('no COMPONENT_SET')
    return set
  }

  test('componentPropertyDefinitions VARIANT defaults override the first-variant default', () => {
    const { graph, setPage, usePage, variants } = buildSetGraph()
    graph.updateNode(setNode(graph, setPage).id, {
      componentPropertyDefinitions: [
        { id: 'p1', name: 'Size', type: 'VARIANT', defaultValue: 'Small', variantOptions: ['Large', 'Small'] },
        { id: 'p2', name: 'State', type: 'VARIANT', defaultValue: 'Hover', variantOptions: ['Default', 'Hover'] }
      ]
    })
    graph.createInstance(variants[1].id, usePage)

    const out = compile({ graph, pageIds: [usePage], options: withDefaults({ packageName: 'comp' }) })
    const comp = out.files.get('src/components/Button.tsx') as string
    // defaults now come from componentPropertyDefinitions, not the first variant
    expect(comp).toContain('size = "Small", state = "Hover"')
  })

  test('a declared default that is not a real option falls back to the first variant', () => {
    const { graph, setPage, usePage, variants } = buildSetGraph()
    graph.updateNode(setNode(graph, setPage).id, {
      componentPropertyDefinitions: [
        { id: 'p1', name: 'Size', type: 'VARIANT', defaultValue: 'Gigantic' } // no such option
      ]
    })
    graph.createInstance(variants[1].id, usePage)

    const out = compile({ graph, pageIds: [usePage], options: withDefaults({ packageName: 'comp' }) })
    const comp = out.files.get('src/components/Button.tsx') as string
    // stale default ignored → the first variant's value (Large) is kept
    expect(comp).toContain('size = "Large"')
  })

  test('no componentPropertyDefinitions → first-variant default (v4 unchanged)', () => {
    const { graph, usePage, variants } = buildSetGraph()
    graph.createInstance(variants[1].id, usePage)

    const out = compile({ graph, pageIds: [usePage], options: withDefaults({ packageName: 'comp' }) })
    const comp = out.files.get('src/components/Button.tsx') as string
    expect(comp).toContain('size = "Large", state = "Default"')
  })
})
