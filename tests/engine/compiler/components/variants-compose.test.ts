import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import type { Fill, SceneGraph, SceneNode } from '@open-pencil/core/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

/**
 * Phase 3 §8 v5 — variant + text/fill props compose. A COMPONENT_SET variant
 * instance that ALSO carries `:text` / `:fills` overrides no longer inlines
 * (the v4 limitation): it emits the variant prop PLUS the text/className props
 * (`<Button size="Small" label="点我" badgeClassName="bg-red-500" />`).
 *
 * Per-variant defaults: one logical prop (`label`) spans multiple variant
 * subtrees with different static defaults, so the prop has NO signature default
 * and each variant subtree emits `{label ?? "thisVariantsOwnText"}` /
 * `className={badgeClassName ?? "thisVariantsClasses"}` (fork B — name-merged).
 *
 * Tailwind emits an arbitrary bg value as `bg-[#RRGGBB]` (uppercase hex), so
 * red = `bg-[#FF0000]`, blue = `bg-[#0000FF]`.
 */
function solid(r: number, g: number, b: number): Fill {
  return { type: 'SOLID', color: { r, g, b, a: 1 }, opacity: 1, visible: true }
}
const RED = solid(1, 0, 0)
const BLUE = solid(0, 0, 1)

/** A SET "Button" with two variants (Large|Default first → default, Small|Hover),
 *  each carrying a same-named TEXT "Label" (different default text) and a
 *  same-named RECTANGLE "Badge" (red fill). The same layer names across variants
 *  are what fork B merges into one prop. SET + variants on page 1, instances on
 *  page 2 (so only the instances compile into App.tsx). */
function buildSetGraph(): {
  graph: SceneGraph
  usePage: string
  large: SceneNode
  small: SceneNode
} {
  const graph = makeSceneGraph()
  const setPage = firstPageId(graph)
  const usePage = graph.addPage('Use').id
  const set = graph.createNode('COMPONENT_SET', setPage, { name: 'Button', width: 200, height: 100 })
  const large = graph.createNode('COMPONENT', set.id, {
    name: 'Size=Large, State=Default',
    width: 120,
    height: 40,
    layoutMode: 'VERTICAL'
  })
  graph.createNode('TEXT', large.id, { name: 'Label', text: 'BigBtn', width: 100, height: 20 })
  graph.createNode('RECTANGLE', large.id, { name: 'Badge', width: 100, height: 8, fills: [RED] })
  const small = graph.createNode('COMPONENT', set.id, {
    name: 'Size=Small, State=Hover',
    width: 80,
    height: 28,
    layoutMode: 'VERTICAL'
  })
  graph.createNode('TEXT', small.id, { name: 'Label', text: 'SmBtn', width: 60, height: 16 })
  graph.createNode('RECTANGLE', small.id, { name: 'Badge', width: 60, height: 6, fills: [RED] })
  return { graph, usePage, large, small }
}

/** Instantiate `variant` on the use-page and override its Label text / Badge
 *  fill the way the editor would (diverged value on the instance child + a
 *  presence marker in the overrides map). */
function makeInstance(
  graph: SceneGraph,
  variant: SceneNode,
  usePage: string,
  opts: { labelText?: string; badgeFill?: Fill }
): SceneNode {
  const inst = graph.createInstance(variant.id, usePage)
  if (!inst) throw new Error('instance not created')
  const overrides: Record<string, unknown> = {}
  for (const child of graph.getChildren(inst.id)) {
    if (child.name === 'Label' && opts.labelText !== undefined) {
      graph.updateNode(child.id, { text: opts.labelText })
      overrides[`${child.id}:text`] = opts.labelText
    }
    if (child.name === 'Badge' && opts.badgeFill !== undefined) {
      graph.updateNode(child.id, { fills: [opts.badgeFill] })
      overrides[`${child.id}:fills`] = true
    }
  }
  inst.overrides = overrides
  return inst
}

function compileUse(graph: SceneGraph, usePage: string) {
  return compile({ graph, pageIds: [usePage], options: withDefaults({ packageName: 'comp' }) })
}

describe('compile — COMPONENT_SET variant + text/fill compose (Phase 3 §8 v5)', () => {
  test('a variant instance with a :text override composes (not inlined)', () => {
    const { graph, usePage, small } = buildSetGraph()
    makeInstance(graph, small, usePage, { labelText: '点我' })

    const app = compileUse(graph, usePage).files.get('src/App.tsx') as string
    // variant prop + text prop on one ref; subtree not inlined
    expect(app).toMatch(/<Button[^>]*\bsize="Small"/)
    expect(app).toMatch(/<Button[^>]*\blabel="点我"/)
    expect(app).not.toContain('>SmBtn</p>')
  })

  test('the text prop has NO signature default; each variant body falls back to its own literal', () => {
    const { graph, usePage, small } = buildSetGraph()
    makeInstance(graph, small, usePage, { labelText: '点我' })

    const comp = compileUse(graph, usePage).files.get('src/components/Button.tsx') as string
    expect(comp).toContain('label?: string')
    // destructured bare (no `label = "..."`) — the body carries per-variant defaults
    expect(comp).not.toMatch(/label = /)
    expect(comp).toContain('{label ?? "BigBtn"}')
    expect(comp).toContain('{label ?? "SmBtn"}')
  })

  test('same-named Label across variants merges into ONE prop (no label/label2)', () => {
    const { graph, usePage, large, small } = buildSetGraph()
    makeInstance(graph, large, usePage, { labelText: 'A' })
    makeInstance(graph, small, usePage, { labelText: 'B' })

    const out = compileUse(graph, usePage)
    const comp = out.files.get('src/components/Button.tsx') as string
    expect((comp.match(/label\??:? ?string/g) ?? []).length).toBe(1)
    expect(comp).not.toContain('label2')
    const app = out.files.get('src/App.tsx') as string
    expect(app).toMatch(/<Button[^>]*\bsize="Large"[^>]*\blabel="A"|<Button[^>]*\blabel="A"/)
    expect(app).toMatch(/<Button[^>]*\bsize="Small"[^>]*\blabel="B"|<Button[^>]*\blabel="B"/)
  })

  test('a clean variant instance passes no text prop (keeps its own default)', () => {
    const { graph, usePage, large, small } = buildSetGraph()
    makeInstance(graph, large, usePage, { labelText: 'A' }) // makes the label prop exist
    graph.createInstance(small.id, usePage) // clean Small — no label override

    const app = compileUse(graph, usePage).files.get('src/App.tsx') as string
    // exactly one ref carries label= (the Large override); the clean Small does not
    expect((app.match(/<Button[^>]*\blabel=/g) ?? []).length).toBe(1)
  })

  test('a :fills override composes to a className prop with per-variant fallback', () => {
    const { graph, usePage, small } = buildSetGraph()
    makeInstance(graph, small, usePage, { badgeFill: BLUE })

    const out = compileUse(graph, usePage)
    const comp = out.files.get('src/components/Button.tsx') as string
    expect(comp).toContain('badgeClassName?: string')
    // every variant Badge falls back to its own (red) default classes
    expect(comp).toMatch(/className=\{badgeClassName \?\? "[^"]*bg-\[#FF0000\]/)
    const app = out.files.get('src/App.tsx') as string
    expect(app).toMatch(/<Button[^>]*\bbadgeClassName="[^"]*bg-\[#0000FF\]/)
    // instance-passed class is safelisted
    expect([...out.files.values()].join('\n')).toContain('bg-[#0000FF]')
  })

  test('text + fill compose together on one variant instance', () => {
    const { graph, usePage, small } = buildSetGraph()
    makeInstance(graph, small, usePage, { labelText: 'Hi', badgeFill: BLUE })

    const app = compileUse(graph, usePage).files.get('src/App.tsx') as string
    expect(app).toMatch(/<Button[^>]*\bsize="Small"/)
    expect(app).toMatch(/<Button[^>]*\blabel="Hi"/)
    expect(app).toMatch(/<Button[^>]*\bbadgeClassName="[^"]*bg-\[#0000FF\]/)
    expect(app).not.toContain('>SmBtn</p>')
  })

  test('a default-variant instance with a text override → text prop, no variant props', () => {
    const { graph, usePage, large } = buildSetGraph()
    makeInstance(graph, large, usePage, { labelText: 'Z' })

    const app = compileUse(graph, usePage).files.get('src/App.tsx') as string
    expect(app).toMatch(/<Button[^>]*\blabel="Z"/)
    expect(app).not.toContain('size="Large"')
    expect(app).not.toContain('state="Default"')
  })
})
