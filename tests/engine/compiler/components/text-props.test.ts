import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import type { SceneGraph } from '@open-pencil/core/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

/**
 * Phase 3 §8 v2 — text-override → component props. A dirty INSTANCE whose
 * overrides are all `:text` no longer inlines: the component gains an optional
 * string prop per overridden child (defaulting to the master's text), and the
 * instance passes its overridden value (`<Card title="..." />`).
 */
describe('compile — components text-override props (Phase 3 §8 v2)', () => {
  function makeGraph(): { graph: SceneGraph; pageId: string; masterId: string; textChildId: string } {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const master = graph.createNode('COMPONENT', pageId, {
      name: 'Card',
      width: 120,
      height: 40,
      layoutMode: 'VERTICAL'
    })
    const text = graph.createNode('TEXT', master.id, {
      name: 'Title',
      text: 'Default',
      width: 100,
      height: 20
    })
    return { graph, pageId, masterId: master.id, textChildId: text.id }
  }

  /** Create an instance and override its (single) text child's value, marking
   *  the `:text` override the way the editor would (diverged value on the
   *  child node + a presence marker in the overrides map). */
  function makeTextOverrideInstance(graph: SceneGraph, masterId: string, pageId: string, value: string) {
    const inst = graph.createInstance(masterId, pageId)
    if (!inst) throw new Error('instance not created')
    const child = graph.getChildren(inst.id)[0]
    graph.updateNode(child.id, { text: value })
    inst.overrides = { [`${child.id}:text`]: value }
    return inst
  }

  test('component gains an optional prop defaulting to the master text', () => {
    const { graph, pageId, masterId } = makeGraph()
    makeTextOverrideInstance(graph, masterId, pageId, 'Hello')

    const out = compile({ graph, pageIds: [pageId], options: withDefaults({ packageName: 'comp' }) })
    const comp = out.files.get('src/components/Card.tsx') as string
    expect(comp).toContain('title?: string')
    expect(comp).toContain('export default function Card({ className, title = "Default" }: CardProps)')
    // body renders the prop, not the literal master text
    expect(comp).toContain('{title}')
    expect(comp).not.toContain('>Default</p>')
  })

  test('a text-override instance passes its value and is NOT inlined', () => {
    const { graph, pageId, masterId } = makeGraph()
    makeTextOverrideInstance(graph, masterId, pageId, 'Hello')

    const out = compile({ graph, pageIds: [pageId], options: withDefaults({ packageName: 'comp' }) })
    const app = out.files.get('src/App.tsx') as string
    expect(app).toMatch(/<Card[^>]*\btitle="Hello"/)
    // subtree not inlined onto the page
    expect(app).not.toContain('>Hello</p>')
  })

  test('master + clean instance emit <Card /> (no prop → master default)', () => {
    const { graph, pageId, masterId } = makeGraph()
    graph.createInstance(masterId, pageId) // clean
    makeTextOverrideInstance(graph, masterId, pageId, 'Hello') // dirty text

    const out = compile({ graph, pageIds: [pageId], options: withDefaults({ packageName: 'comp' }) })
    const app = out.files.get('src/App.tsx') as string
    // master + clean instance + dirty instance = 3 refs
    expect((app.match(/<Card\b/g) ?? []).length).toBe(3)
    // exactly one carries title=
    expect((app.match(/<Card[^>]*\btitle="Hello"/g) ?? []).length).toBe(1)
  })

  test('two instances overriding the same child collapse onto one prop (union)', () => {
    const { graph, pageId, masterId } = makeGraph()
    makeTextOverrideInstance(graph, masterId, pageId, 'A')
    makeTextOverrideInstance(graph, masterId, pageId, 'B')

    const out = compile({ graph, pageIds: [pageId], options: withDefaults({ packageName: 'comp' }) })
    const comp = out.files.get('src/components/Card.tsx') as string
    // one prop slot, not two
    expect((comp.match(/title\?: string/g) ?? []).length).toBe(1)
    const app = out.files.get('src/App.tsx') as string
    expect(app).toMatch(/<Card[^>]*\btitle="A"/)
    expect(app).toMatch(/<Card[^>]*\btitle="B"/)
  })

  test('cross-page: a text-override instance on another page shares the props', () => {
    const graph = makeSceneGraph()
    const page1 = firstPageId(graph)
    const page2 = graph.addPage('Second').id
    const master = graph.createNode('COMPONENT', page1, {
      name: 'Banner',
      width: 120,
      height: 40,
      layoutMode: 'VERTICAL'
    })
    graph.createNode('TEXT', master.id, { name: 'Label', text: 'Base', width: 100, height: 20 })
    const inst = graph.createInstance(master.id, page2)
    if (inst) {
      const child = graph.getChildren(inst.id)[0]
      graph.updateNode(child.id, { text: 'Page2' })
      inst.overrides = { [`${child.id}:text`]: 'Page2' }
    }

    const out = compile({ graph, pageIds: [page1, page2], options: withDefaults({ packageName: 'x' }) })
    const comp = out.files.get('src/components/Banner.tsx') as string
    expect(comp).toContain('label?: string')
    expect(comp).toContain('label = "Base"')
    const page2File = [...out.files].find(([k]) => k.startsWith('src/pages/') && k.includes('second'))
    expect((page2File?.[1] as string) ?? '').toMatch(/<Banner[^>]*\blabel="Page2"/)
  })
})
