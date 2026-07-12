import { beforeAll, describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { stripNavigateForSinglePage } from '@open-pencil/compiler/adapters/react/ir-walk'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRNode } from '@open-pencil/compiler/ir/types'
import { SceneGraph, initCodec } from '@open-pencil/core'
import type { ActionDef } from '@open-pencil/scene-graph'

/**
 * Phase 2 §3 step 4 — cross-walker regression (§9.9 checklist experience A).
 *
 * `apiCall` is a new `ActionDef` / `IREventHandler` kind. The riskiest
 * walker is `stripNavigateForSinglePage`: it rebuilds the tree to drop
 * `navigate` handlers, so a naive filter could also delete the sibling
 * `apiCall`. This file pins that the strip is surgical and that an apiCall
 * survives every walker into the emitted single- and multi-page output.
 */
describe('cross-walker — apiCall survives the navigate strip + every walker', () => {
  beforeAll(async () => {
    await initCodec()
  })

  /** A single-page document: root declares `users`; a BUTTON's onClick mixes
   *  a `navigate` (stripped single-page) and an `apiCall` (must survive). */
  function makeGraph(): { graph: SceneGraph; pageId: string } {
    const graph = new SceneGraph()
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'd-users', name: 'users', type: 'array', defaultValue: [] }]
    })
    const page = graph.getPages()[0]
    graph.updateNode(page.id, { name: 'Home' })
    const onClick: ActionDef[] = [
      { id: 'a-nav', kind: 'navigate', to: '/about' },
      {
        id: 'a-api',
        kind: 'apiCall',
        method: 'GET',
        url: 'https://x.test/users',
        targetName: 'users'
      }
    ]
    graph.createNode('BUTTON', page.id, { interactiveProps: { text: 'Load' }, events: { onClick } })
    return { graph, pageId: page.id }
  }

  test('stripNavigateForSinglePage drops navigate but keeps the apiCall handler', () => {
    const { graph, pageId } = makeGraph()
    const ir = collectTree(graph, pageId)
    const { ir: cleaned, warnings } = stripNavigateForSinglePage(ir)

    expect(warnings.some((w) => w.code === 'action-navigate-no-router')).toBe(true)
    // The `{ ...ir }` spread must carry the docState bookkeeping.
    expect(cleaned.docStateWrites).toEqual(['users'])

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
    expect(handlerKinds).toEqual(['apiCall'])
  })

  test('single-page compile: navigate stripped, async fetch + setDocState emitted', () => {
    const { graph, pageId } = makeGraph()
    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'cross-walker-apicall-single' })
    })

    const app = out.files.get('src/App.tsx') as string
    expect(app).not.toContain('navigate(')
    expect(app).toContain('async () => {')
    expect(app).toContain('await fetch("https://x.test/users")')
    expect(app).toContain('setDocState("users", data)')
    // apiCall writes a docState → the runtime store is still emitted.
    expect(out.files.has('src/_lowcode_state.ts')).toBe(true)
    expect(out.warnings.some((w) => w.code === 'action-navigate-no-router')).toBe(true)
  })

  test('multi-page compile: navigate and apiCall both survive on the page', () => {
    const { graph, pageId } = makeGraph()
    const about = graph.addPage('About')
    graph.createNode('TEXT', about.id, { text: 'about' })

    const out = compile({
      graph,
      pageIds: [pageId, about.id],
      options: withDefaults({ packageName: 'cross-walker-apicall-multi' })
    })

    const home = out.files.get('src/pages/index.tsx') as string
    expect(home).toContain('navigate("/about")')
    expect(home).toContain('await fetch("https://x.test/users")')
    expect(home).toContain('setDocState("users", data)')
  })
})
