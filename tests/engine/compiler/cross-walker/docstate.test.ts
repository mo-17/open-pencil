import { beforeAll, describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { stripNavigateForSinglePage } from '@open-pencil/compiler/adapters/react/ir-walk'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRNode } from '@open-pencil/compiler/ir/types'
import { SceneGraph, initCodec } from '@open-pencil/core'

/**
 * Phase 2 §2 step 5 — cross-walker regression (§9.9 checklist experience A).
 *
 * Every IR transform that copies an `IRTree` or switches on a handler /
 * binding `kind` must carry the Phase 2 §2 additions through unchanged:
 *
 *   - `IRSetVariableHandler` — a new `IREventHandler` union member
 *   - `BindingExpr.kind:'docState'` — a new binding kind
 *   - `IRTree.docStates` / `docStateReads` / `docStateWrites` — new fields
 *
 * The riskiest walker is `stripNavigateForSinglePage`: it rebuilds the tree
 * to drop `navigate` handlers, so a naive `kept`-list or a missing field in
 * the `{ ...ir }` spread would silently delete a `setVariable` handler or a
 * doc-state read. This file pins that the strip is surgical.
 */
describe('cross-walker — setVariable + docState binding survive every walker', () => {
  beforeAll(async () => {
    await initCodec()
  })

  /** A single-page document: root declares `cartCount`; the page has a
   *  BUTTON whose onClick mixes a `navigate` (stripped single-page) and a
   *  `setVariable` (must survive), plus a TEXT bound to `cartCount` via a
   *  `kind:'docState'` binding. */
  function makeGraph(): { graph: SceneGraph; pageId: string } {
    const graph = new SceneGraph()
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'ds-cart', name: 'cartCount', type: 'number', defaultValue: 0 }]
    })
    const page = graph.getPages()[0]
    graph.updateNode(page.id, { name: 'Home' })
    graph.createNode('BUTTON', page.id, {
      interactiveProps: { text: 'Buy' },
      events: {
        onClick: [
          { id: 'a-nav', kind: 'navigate', to: '/about' },
          { id: 'a-set', kind: 'setVariable', targetName: 'cartCount', valueExpr: '$prev + 1' }
        ]
      }
    })
    graph.createNode('TEXT', page.id, {
      text: '0',
      bindings: { text: { kind: 'docState', docStateName: 'cartCount' } }
    })
    return { graph, pageId: page.id }
  }

  test('stripNavigateForSinglePage drops navigate but keeps setVariable + docState fields', () => {
    const { graph, pageId } = makeGraph()
    const ir = collectTree(graph, pageId)

    // collectTree itself must have seen the new constructs.
    expect(ir.docStates.map((d) => d.name)).toEqual(['cartCount'])
    expect(ir.docStateReads).toEqual(['cartCount'])
    expect(ir.docStateWrites).toEqual(['cartCount'])

    const { ir: cleaned, warnings } = stripNavigateForSinglePage(ir)

    // The `{ ...ir }` spread must carry every Phase 2 §2 field.
    expect(cleaned.docStates).toBe(ir.docStates)
    expect(cleaned.docStateReads).toEqual(['cartCount'])
    expect(cleaned.docStateWrites).toEqual(['cartCount'])

    // navigate gone, setVariable retained on the BUTTON.
    expect(warnings.some((w) => w.code === 'action-navigate-no-router')).toBe(true)
    const handlerKinds: string[] = []
    function walk(node: IRNode): void {
      if (node.kind === 'conditional') return walk(node.consequent)
      if (node.kind === 'list') return walk(node.template)
      if (node.kind !== 'element') return
      if (node.events) {
        for (const list of Object.values(node.events)) {
          for (const h of list ?? []) handlerKinds.push(h.kind)
        }
      }
      for (const c of node.children) walk(c)
    }
    cleaned.children.forEach(walk)
    expect(handlerKinds).toEqual(['setVariable'])
  })

  test('single-page compile: navigate stripped, setDocState + useDocState + runtime emitted', () => {
    const { graph, pageId } = makeGraph()
    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'cross-walker-singlepage' })
    })

    const app = out.files.get('src/App.tsx') as string
    expect(app).not.toContain('navigate(')
    expect(app).toContain('setDocState("cartCount", (prev) => prev + 1)')
    expect(app).toContain('useDocState("cartCount")')

    // Runtime file + zustand dep are emitted because the document declares
    // a Document State, independent of the navigate strip.
    expect(out.files.has('src/_lowcode_state.ts')).toBe(true)
    const pkg = JSON.parse(out.files.get('package.json') as string)
    expect(pkg.dependencies.zustand).toBeDefined()

    expect(out.warnings.some((w) => w.code === 'action-navigate-no-router')).toBe(true)
  })

  test('multi-page compile: setVariable + docState binding cross both pages', () => {
    const { graph, pageId } = makeGraph()
    const about = graph.addPage('About')
    graph.createNode('TEXT', about.id, {
      text: '0',
      bindings: { text: { kind: 'docState', docStateName: 'cartCount' } }
    })

    const out = compile({
      graph,
      pageIds: [pageId, about.id],
      options: withDefaults({ packageName: 'cross-walker-multipage' })
    })

    const home = out.files.get('src/pages/index.tsx') as string
    const aboutTsx = out.files.get('src/pages/about.tsx') as string
    // Home writes + reads; About only reads — both resolve the doc state.
    expect(home).toContain('setDocState("cartCount", (prev) => prev + 1)')
    expect(home).toContain('useDocState("cartCount")')
    expect(aboutTsx).toContain('useDocState("cartCount")')
    expect(aboutTsx).not.toContain('setDocState')

    // The runtime store is a single module shared by both pages.
    expect(out.files.has('src/_lowcode_state.ts')).toBe(true)
  })
})
